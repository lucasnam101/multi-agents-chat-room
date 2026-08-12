//! Process lifecycle: one ACP subprocess per (session_id, agent_kind),
//! spawned lazily on first @mention (or eagerly when a session is opened —
//! see `ensure_room_agents`), kept alive while that session is in active
//! use, torn down after an idle timeout. See NEW_TOOL_PLAN_V2.md §5.3.
//!
//! `session_id` here is this app's own conversation-session concept (one
//! per tab in the session switcher) — deliberately 1:1 with the
//! underlying ACP `session/new` session, so switching app-level sessions
//! never bleeds context between them.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use std::sync::atomic::{AtomicBool, Ordering};

use tokio::sync::Mutex;
use uuid::Uuid;

use super::client::{AcpClient, PermissionHandler, SystemPromptTransport};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    Claude,
    Codex,
    Grok,
}

impl AgentKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentKind::Claude => "claude",
            AgentKind::Codex => "codex",
            AgentKind::Grok => "grok",
        }
    }

    /// npm global-bin shims on Windows are `.cmd` files — raw `CreateProcess`
    /// (what `std`/`tokio::process::Command` use) does not resolve bare
    /// names to them the way a shell would, so the extension must be
    /// explicit here. Confirmed via a failed headless spawn (`NotFound`)
    /// against the extensionless PATH entry before this fix.
    pub fn command(&self) -> &'static str {
        match self {
            #[cfg(windows)]
            AgentKind::Claude => "claude-agent-acp.cmd",
            #[cfg(not(windows))]
            AgentKind::Claude => "claude-agent-acp",
            #[cfg(windows)]
            AgentKind::Codex => "codex-acp.cmd",
            #[cfg(not(windows))]
            AgentKind::Codex => "codex-acp",
            AgentKind::Grok => "grok",
        }
    }

    pub fn args(&self) -> Vec<String> {
        match self {
            // `--no-auto-update` is a global flag and must precede the
            // `agent` subcommand (the CLI rejects it after `stdio`).
            AgentKind::Grok => vec!["--no-auto-update".into(), "agent".into(), "stdio".into()],
            _ => Vec::new(),
        }
    }
}

pub struct RunningAgent {
    pub client: AcpClient,
    pub session_id: String,
    pub last_active: Instant,
    pub cancel_requested: Arc<AtomicBool>,
    pub is_prompting: Arc<AtomicBool>,
}

pub const IDLE_TEARDOWN: std::time::Duration = std::time::Duration::from_secs(30 * 60);

/// Keyed by (app session_id, agent_kind). Guarded by a single mutex —
/// process churn is low-frequency (mentions, not per-token), so lock
/// contention is not a concern.
#[derive(Default)]
pub struct ProcessManager {
    agents: Mutex<HashMap<(Uuid, AgentKind), RunningAgent>>,
}

impl ProcessManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Get the running agent for (session, kind), spawning + initializing it
    /// (primed with `priming_prompt` as the first turn context) if it isn't
    /// already alive.
    /// Returns the ACP session id now backing (session_id, kind) — either
    /// the one that was already running, a resumed one (if `resume` was
    /// given and the adapter honored `session/load`), or a freshly created
    /// one — so callers can persist it for a future resume attempt.
    pub async fn ensure_running<F>(
        &self,
        session_id: Uuid,
        kind: AgentKind,
        cwd: &str,
        model: Option<&str>,
        resume: Option<String>,
        build_priming_prompt: F,
    ) -> Result<String, super::client::AcpError>
    where
        F: FnOnce() -> String,
    {
        let mut agents = self.agents.lock().await;
        let key = (session_id, kind);
        if let Some(agent) = agents.get_mut(&key) {
            agent.last_active = Instant::now();
            return Ok(agent.session_id.clone());
        }

        let mut client = AcpClient::spawn(kind.command(), &kind.args(), cwd).await?;
        if kind == AgentKind::Grok {
            client.initialize_grok().await?;
        } else {
            client.initialize().await?;
        }

        // Prefer resuming the agent's own native session over starting a
        // fresh one — only meaningful continuity for context beyond what
        // the app's own "[Recent messages]" text replay can offer. Adapters
        // that don't support `loadSession` (or a resume id that's since
        // expired/been deleted on the CLI side) fall straight through to a
        // normal `session_new`, so this is never a hard failure mode.
        let acp_session_id = match resume {
            Some(resume_id) if client.session_load(&resume_id, cwd).await.is_ok() => resume_id,
            _ => {
                let system_prompt = build_priming_prompt();
                let transport = if system_prompt.is_empty() {
                    None
                } else if kind == AgentKind::Claude {
                    // claude-agent-acp silently ignores a bare `systemPrompt`
                    // field — it only reads `_meta.systemPrompt.append`.
                    // Sending the wrong shape doesn't error, it just means
                    // the agent never sees the room's shared context (or the
                    // @mention handoff instructions) at all. See
                    // `SystemPromptTransport` for the full story.
                    Some(SystemPromptTransport::ClaudeMeta(&system_prompt))
                } else {
                    Some(SystemPromptTransport::Field(&system_prompt))
                };
                client.session_new(cwd, transport).await?.session_id
            }
        };

        if let Some(model_id) = model {
            // Best-effort: some adapters/models reject session/set_model for
            // certain sessions. Don't abort the spawn over it.
            let _ = client.session_set_model(&acp_session_id, model_id).await;
        }

        agents.insert(
            key,
            RunningAgent {
                client,
                session_id: acp_session_id.clone(),
                last_active: Instant::now(),
                cancel_requested: Arc::new(AtomicBool::new(false)),
                is_prompting: Arc::new(AtomicBool::new(false)),
            },
        );
        Ok(acp_session_id)
    }

    /// Run a prompt turn against an already-running agent, streaming updates.
    /// `blocks` are raw ACP content blocks (text/image/resource_link) —
    /// callers build these, see `acp::client::content_blocks`.
    pub async fn prompt(
        &self,
        session_id: Uuid,
        kind: AgentKind,
        blocks: Vec<serde_json::Value>,
        on_update: impl FnMut(super::client::AgentUpdate),
    ) -> Result<super::client::StopReason, super::client::AcpError> {
        self.prompt_with_permission(session_id, kind, blocks, on_update, None).await
    }

    pub async fn prompt_with_permission(
        &self,
        session_id: Uuid,
        kind: AgentKind,
        blocks: Vec<serde_json::Value>,
        on_update: impl FnMut(super::client::AgentUpdate),
        permission_handler: Option<PermissionHandler>,
    ) -> Result<super::client::StopReason, super::client::AcpError> {
        let mut agents = self.agents.lock().await;
        let key = (session_id, kind);
        let agent = agents
            .get_mut(&key)
            .ok_or_else(|| super::client::AcpError::Protocol("agent not running".into()))?;
        agent.last_active = Instant::now();
        agent.cancel_requested.store(false, Ordering::Relaxed);
        agent.is_prompting.store(true, Ordering::Relaxed);
        let acp_session_id = agent.session_id.clone();
        let cancel = Arc::clone(&agent.cancel_requested);
        let prompting = Arc::clone(&agent.is_prompting);
        let result = agent.client.session_prompt_with_permission(&acp_session_id, blocks, on_update, Some(cancel), permission_handler).await;
        prompting.store(false, Ordering::Relaxed);
        result
    }

    pub async fn cancel_for(&self, session_id: Uuid) {
        let agents = self.agents.lock().await;
        for ((sid, _), agent) in agents.iter() {
            if *sid == session_id {
                agent.cancel_requested.store(true, Ordering::Relaxed);
            }
        }
    }

    pub async fn is_active(&self, session_id: Uuid, kind: AgentKind) -> bool {
        self.agents.lock().await.contains_key(&(session_id, kind))
    }

    pub async fn is_busy(&self, session_id: Uuid, kind: AgentKind) -> bool {
        self.agents.lock().await
            .get(&(session_id, kind))
            .map(|agent| agent.is_prompting.load(Ordering::Relaxed))
            .unwrap_or(false)
    }

    /// Tear down and remove any agent processes for `session_id` (all agent
    /// kinds) — called when a session is deleted, so its process doesn't
    /// linger in the background with nothing left to serve.
    pub async fn shutdown_for(&self, session_id: Uuid) {
        let mut agents = self.agents.lock().await;
        let keys: Vec<(Uuid, AgentKind)> = agents
            .keys()
            .filter(|(sid, _)| *sid == session_id)
            .copied()
            .collect();
        for key in keys {
            if let Some(mut agent) = agents.remove(&key) {
                agent.client.shutdown().await;
            }
        }
    }

    /// Tear down any agent process idle for longer than `IDLE_TEARDOWN`.
    /// Intended to be called periodically from a background tick.
    pub async fn reap_idle(&self) {
        let mut agents = self.agents.lock().await;
        let now = Instant::now();
        let stale: Vec<(Uuid, AgentKind)> = agents
            .iter()
            .filter(|(_, agent)| now.duration_since(agent.last_active) > IDLE_TEARDOWN)
            .map(|(key, _)| *key)
            .collect();
        for key in stale {
            if let Some(mut agent) = agents.remove(&key) {
                agent.client.shutdown().await;
            }
        }
    }

    pub async fn shutdown_all(&self) {
        let mut agents = self.agents.lock().await;
        for (_, mut agent) in agents.drain() {
            agent.client.shutdown().await;
        }
    }
}
