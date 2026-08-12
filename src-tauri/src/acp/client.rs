//! ACP client — talks to a `codex-acp` / `claude-agent-acp` subprocess over
//! stdio using newline-delimited JSON-RPC 2.0 (NDJSON).
//!
//! Wire format confirmed by reading the reference implementation at
//! `D:\My projects\buzz\crates\buzz-acp\src\acp.rs` (NDJSON via LinesCodec,
//! `initialize` -> `session/new` -> `session/prompt`, `session/update`
//! notifications, `session/request_permission` requests).

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio_util::codec::{FramedRead, LinesCodec};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::future::Future;
use std::pin::Pin;

const MAX_LINE_SIZE: usize = 10_000_000;
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

#[derive(Debug, thiserror::Error)]
pub enum AcpError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("agent process exited unexpectedly")]
    AgentExited,
    #[error("request timed out")]
    Timeout,
    #[error("agent turn cancelled")]
    Cancelled,
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("agent reported error (code {code}): {message}")]
    AgentError { code: i64, message: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopReason {
    EndTurn,
    Cancelled,
    MaxTokens,
    MaxTurnRequests,
    Refusal,
    Other(String),
}

impl StopReason {
    fn from_str(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "end_turn" => Self::EndTurn,
            "cancelled" => Self::Cancelled,
            "max_tokens" => Self::MaxTokens,
            "max_turn_requests" => Self::MaxTurnRequests,
            "refusal" => Self::Refusal,
            other => Self::Other(other.to_string()),
        }
    }
}

/// A streamed update emitted while a `session/prompt` turn is in flight.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentUpdate {
    /// A chunk of the agent's own chat reply text.
    MessageChunk { text: String },
    /// A tool invocation started.
    ToolCall { title: String, raw: serde_json::Value },
    /// A tool invocation finished/updated.
    ToolCallUpdate { raw: serde_json::Value },
    /// Anything else we don't specifically render.
    Other { update_type: String, raw: serde_json::Value },
}

pub type PermissionHandler = Arc<dyn Fn(serde_json::Value) -> Pin<Box<dyn Future<Output = Option<String>> + Send>> + Send + Sync>;

/// A model the agent adapter reports as available, extracted from the
/// `session/new` response (`models.availableModels` / `configOptions`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub model_id: String,
    pub name: Option<String>,
}

pub struct SessionNewResult {
    pub session_id: String,
    pub raw: serde_json::Value,
}

/// `session/prompt` content-block builders. Shapes confirmed against the
/// ACP JSON schema shipped in `@agentclientprotocol/sdk`'s `schema.json`
/// (`$defs.ContentBlock` / `ImageContent` / `ResourceLink`).
pub mod content_blocks {
    pub fn text(text: &str) -> serde_json::Value {
        serde_json::json!({ "type": "text", "text": text })
    }

    /// `data` is base64-encoded image bytes (no data: URI prefix).
    pub fn image(data_base64: &str, mime_type: &str) -> serde_json::Value {
        serde_json::json!({ "type": "image", "data": data_base64, "mimeType": mime_type })
    }

    /// A reference to a local file the agent can read itself — no bytes are
    /// sent. `uri` should be an absolute `file://` URI.
    pub fn resource_link(uri: &str, name: &str, mime_type: Option<&str>) -> serde_json::Value {
        let mut block = serde_json::json!({ "type": "resource_link", "uri": uri, "name": name });
        if let Some(mime) = mime_type {
            block["mimeType"] = serde_json::Value::String(mime.to_string());
        }
        block
    }
}

/// How to deliver a system prompt in `session/new` — the two adapters use
/// incompatible mechanisms, confirmed against the reference implementation
/// at `D:\My projects\buzz\crates\buzz-acp\src\acp.rs` / `pool.rs`
/// (`session_new_system_prompt`):
///
/// - `Field` — a bare top-level `systemPrompt` string. What `codex-acp`
///   expects.
/// - `ClaudeMeta` — `_meta.systemPrompt: {"append": text}`. What
///   `claude-agent-acp` expects instead, to append to its own native preset
///   rather than replace it. A bare `systemPrompt` field is silently
///   ignored by claude-agent-acp — sending the wrong transport doesn't
///   error, it just means the agent never sees the prompt at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SystemPromptTransport<'a> {
    Field(&'a str),
    ClaudeMeta(&'a str),
}

/// Extract the list of models advertised by an adapter. Claude/Codex expose
/// this under `models.availableModels`; current Grok Build exposes the same
/// list under `_meta.modelState.availableModels` during `initialize`.
pub fn extract_models(raw: &serde_json::Value) -> Vec<ModelInfo> {
    let arrays = [
        raw.pointer("/models/availableModels"),
        raw.pointer("/_meta/modelState/availableModels"),
    ];

    for value in arrays.into_iter().flatten() {
        if let Some(arr) = value.as_array() {
            let models: Vec<ModelInfo> = arr
                .iter()
                .filter_map(|m| {
                    let model_id = m.get("modelId")?.as_str()?.to_string();
                    let name = m.get("name").and_then(|n| n.as_str()).map(|s| s.to_string());
                    Some(ModelInfo { model_id, name })
                })
                .collect();
            if !models.is_empty() {
                return models;
            }
        }
    }

    Vec::new()
}

pub struct AcpClient {
    child: Child,
    stdin: ChildStdin,
    reader: FramedRead<ChildStdout, LinesCodec>,
    next_id: u64,
}

impl AcpClient {
    /// Spawn the adapter binary with the given working directory.
    pub async fn spawn(command: &str, args: &[String], cwd: &str) -> Result<Self, AcpError> {
        use std::process::Stdio;

        let mut cmd = tokio::process::Command::new(command);
        cmd.args(args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true);

        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AcpError::Protocol("failed to open agent stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AcpError::Protocol("failed to open agent stdout".into()))?;

        Ok(Self {
            child,
            stdin,
            reader: FramedRead::new(stdout, LinesCodec::new_with_max_length(MAX_LINE_SIZE)),
            next_id: 0,
        })
    }

    pub async fn shutdown(&mut self) {
        let _ = self.child.start_kill();
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), self.child.wait()).await;
    }

    pub async fn initialize(&mut self) -> Result<serde_json::Value, AcpError> {
        let params = serde_json::json!({
            "protocolVersion": 2,
            "clientCapabilities": {
                "auth": { "terminal": true }
            },
            "clientInfo": {
                "name": "agentchat",
                "version": env!("CARGO_PKG_VERSION")
            },
        });
        self.send_request("initialize", params).await
    }

    /// Grok Build's ACP adapter currently speaks protocol v1 and requires an
    /// explicit authenticate request before session/new. Claude/Codex use the
    /// v2 initialize flow above, so keep this handshake isolated.
    pub async fn initialize_grok(&mut self) -> Result<serde_json::Value, AcpError> {
        let init = self.send_request("initialize", serde_json::json!({
            "protocolVersion": 1,
            "clientCapabilities": {
                "fs": { "readTextFile": true, "writeTextFile": true },
                "terminal": true
            },
            "clientInfo": { "name": "agentchat", "version": env!("CARGO_PKG_VERSION") }
        })).await?;

        let auth_methods = init.get("authMethods").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let has = |id: &str| auth_methods.iter().any(|m| m.get("id").and_then(|v| v.as_str()) == Some(id));
        let method = if std::env::var("XAI_API_KEY").is_ok() && has("xai.api_key") {
            Some("xai.api_key")
        } else if has("cached_token") {
            Some("cached_token")
        } else {
            // Current Grok Build versions expose the logged-in browser/device
            // flow as `grok.com`; older versions exposed `cached_token`.
            // Select the adapter's first advertised method as a compatible
            // fallback instead of hard-coding one generation.
            auth_methods.first()
                .and_then(|m| m.get("id"))
                .and_then(|v| v.as_str())
        };
        if let Some(method_id) = method {
            self.send_request("authenticate", serde_json::json!({
                "methodId": method_id,
                "_meta": { "headless": true }
            })).await?;
        } else if !auth_methods.is_empty() {
            return Err(AcpError::Protocol("Grok CLI is not authenticated; run `grok login` first".into()));
        }
        Ok(init)
    }

    pub async fn session_new(
        &mut self,
        cwd: &str,
        system_prompt: Option<SystemPromptTransport<'_>>,
    ) -> Result<SessionNewResult, AcpError> {
        let mut params = serde_json::json!({
            "cwd": cwd,
            "mcpServers": [],
        });
        match system_prompt {
            Some(SystemPromptTransport::Field(sp)) => {
                params["systemPrompt"] = serde_json::Value::String(sp.to_string());
            }
            Some(SystemPromptTransport::ClaudeMeta(sp)) => {
                params["_meta"]["systemPrompt"] = serde_json::json!({ "append": sp });
            }
            None => {}
        }
        let result = self.send_request("session/new", params).await?;
        let session_id = result
            .get("sessionId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AcpError::Protocol("session/new missing sessionId".into()))?
            .to_string();
        Ok(SessionNewResult {
            session_id,
            raw: result,
        })
    }

    /// Resume a previously-created session (`session/load`) instead of
    /// starting a fresh one — only meaningful if the adapter advertised the
    /// `loadSession` capability at `initialize`; callers should treat any
    /// error here as "this adapter/session can't be resumed" and fall back
    /// to `session_new` rather than aborting the turn. The agent may stream
    /// the replayed history back as `session/update` notifications while
    /// this is in flight; those are intentionally dropped here (same as any
    /// other unsolicited notification arriving during a plain request) since
    /// the app already has the full history in its own database.
    pub async fn session_load(&mut self, session_id: &str, cwd: &str) -> Result<(), AcpError> {
        let params = serde_json::json!({
            "sessionId": session_id,
            "cwd": cwd,
            "mcpServers": [],
        });
        self.send_request("session/load", params).await?;
        Ok(())
    }

    /// Send `session/set_model` (unstable ACP path) to switch the session's
    /// model after `session/new`. Best-effort — callers should ignore
    /// failures rather than aborting the turn, since not every adapter
    /// implements this path for every model.
    pub async fn session_set_model(
        &mut self,
        session_id: &str,
        model_id: &str,
    ) -> Result<serde_json::Value, AcpError> {
        let params = serde_json::json!({
            "sessionId": session_id,
            "modelId": model_id,
        });
        self.send_request("session/set_model", params).await
    }

    /// Send `session/prompt` and stream updates to `on_update` until the
    /// turn completes. Returns the final stop reason. `blocks` are raw ACP
    /// content blocks — see `content_blocks` for builders (text/image/
    /// resource_link), confirmed against the ACP schema shipped with the
    /// `@agentclientprotocol/sdk` package.
    pub async fn session_prompt(
        &mut self,
        session_id: &str,
        blocks: Vec<serde_json::Value>,
        on_update: impl FnMut(AgentUpdate),
    ) -> Result<StopReason, AcpError> {
        self.session_prompt_with_cancel(session_id, blocks, on_update, None).await
    }

    pub async fn session_prompt_with_cancel(
        &mut self,
        session_id: &str,
        blocks: Vec<serde_json::Value>,
        on_update: impl FnMut(AgentUpdate),
        cancel: Option<Arc<AtomicBool>>,
    ) -> Result<StopReason, AcpError> {
        self.session_prompt_with_permission(session_id, blocks, on_update, cancel, None).await
    }

    pub async fn session_prompt_with_permission(
        &mut self,
        session_id: &str,
        blocks: Vec<serde_json::Value>,
        mut on_update: impl FnMut(AgentUpdate),
        cancel: Option<Arc<AtomicBool>>,
        permission_handler: Option<PermissionHandler>,
    ) -> Result<StopReason, AcpError> {
        let id = self.next_id;
        self.next_id += 1;

        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "session/prompt",
            "params": {
                "sessionId": session_id,
                "prompt": blocks,
            },
        });
        self.write_ndjson(&msg).await?;

        loop {
            let line = match cancel.as_ref() {
                Some(flag) => tokio::select! {
                    _ = async {
                        while !flag.load(Ordering::Relaxed) {
                            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                        }
                    } => return Err(AcpError::Cancelled),
                    line = self.reader.next() => line,
                },
                None => self.reader.next().await,
            };
            let line = match line {
                None => return Err(AcpError::AgentExited),
                Some(Err(e)) => return Err(AcpError::Protocol(e.to_string())),
                Some(Ok(line)) => line,
            };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let wire: serde_json::Value = match serde_json::from_str(trimmed) {
                Ok(v) => v,
                Err(_) => continue,
            };

            // Response to our session/prompt request.
            if let Some(rid) = wire.get("id") {
                if *rid == serde_json::json!(id) && wire.get("method").is_none() {
                    if let Some(error) = wire.get("error") {
                        let code = error.get("code").and_then(|c| c.as_i64()).unwrap_or(-32000);
                        let message = error
                            .get("message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("unknown error")
                            .to_string();
                        return Err(AcpError::AgentError { code, message });
                    }
                    let raw_reason = wire
                        .pointer("/result/stopReason")
                        .and_then(|v| v.as_str())
                        .unwrap_or("end_turn");
                    return Ok(StopReason::from_str(raw_reason));
                }
            }

            if let Some(method) = wire.get("method").and_then(|v| v.as_str()) {
                match method {
                    "session/update" => {
                        self.handle_session_update(&wire, &mut on_update);
                    }
                    "session/request_permission" => {
                        if let Some(handler) = &permission_handler {
                            let selected = handler(wire.clone()).await;
                            self.respond_permission(&wire, selected.as_deref()).await?;
                        } else {
                            self.auto_approve_permission(&wire).await?;
                        }
                    }
                    _ => {
                        if wire.get("id").is_some() {
                            let err_resp = serde_json::json!({
                                "jsonrpc": "2.0",
                                "id": wire["id"],
                                "error": {"code": -32601, "message": format!("Method not found: {method}")}
                            });
                            self.write_ndjson(&err_resp).await?;
                        }
                    }
                }
            }
        }
    }

    fn handle_session_update(
        &self,
        wire: &serde_json::Value,
        on_update: &mut impl FnMut(AgentUpdate),
    ) {
        let update = &wire["params"]["update"];
        let update_type = update
            .get("sessionUpdate")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");

        let event = match update_type {
            "agent_message_chunk" => {
                let text = update
                    .pointer("/content/text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                AgentUpdate::MessageChunk { text }
            }
            "tool_call" => AgentUpdate::ToolCall {
                title: update.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                raw: update.clone(),
            },
            "tool_call_update" => AgentUpdate::ToolCallUpdate { raw: update.clone() },
            other => AgentUpdate::Other {
                update_type: other.to_string(),
                raw: update.clone(),
            },
        };
        on_update(event);
    }

    async fn auto_approve_permission(&mut self, wire: &serde_json::Value) -> Result<(), AcpError> {
        let options = wire
            .pointer("/params/options")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        // Prefer an "allow_once"-style option if the adapter enumerates one;
        // otherwise fall back to the first option (adapters that only offer
        // one choice for auto-approved permission requests).
        let option_id = options
            .iter()
            .find_map(|o| {
                let oid = o.get("optionId").and_then(|v| v.as_str())?;
                if oid.contains("allow") {
                    Some(oid.to_string())
                } else {
                    None
                }
            })
            .or_else(|| {
                options
                    .first()
                    .and_then(|o| o.get("optionId").and_then(|v| v.as_str()))
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| "allow_once".to_string());

        self.respond_permission(wire, Some(&option_id)).await
    }

    async fn respond_permission(&mut self, wire: &serde_json::Value, option_id: Option<&str>) -> Result<(), AcpError> {
        let id = wire.get("id").cloned().unwrap_or(serde_json::Value::Null);
        let selected = option_id.unwrap_or("deny");
        let response = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "outcome": { "outcome": "selected", "optionId": selected } }
        });
        self.write_ndjson(&response).await
    }

    async fn write_ndjson(&mut self, value: &serde_json::Value) -> Result<(), AcpError> {
        let line = serde_json::to_string(value)?;
        self.stdin.write_all(line.as_bytes()).await?;
        self.stdin.write_all(b"\n").await?;
        self.stdin.flush().await?;
        Ok(())
    }

    async fn send_request(
        &mut self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, AcpError> {
        let id = self.next_id;
        self.next_id += 1;
        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        self.write_ndjson(&msg).await?;

        tokio::time::timeout(REQUEST_TIMEOUT, self.read_until_response(id))
            .await
            .map_err(|_| AcpError::Timeout)?
    }

    async fn read_until_response(&mut self, expected_id: u64) -> Result<serde_json::Value, AcpError> {
        loop {
            let line = match self.reader.next().await {
                None => return Err(AcpError::AgentExited),
                Some(Err(e)) => return Err(AcpError::Protocol(e.to_string())),
                Some(Ok(line)) => line,
            };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let wire: serde_json::Value = match serde_json::from_str(trimmed) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let Some(id) = wire.get("id") {
                if *id == serde_json::json!(expected_id) && wire.get("method").is_none() {
                    if let Some(error) = wire.get("error") {
                        let code = error.get("code").and_then(|c| c.as_i64()).unwrap_or(-32000);
                        let message = error
                            .get("message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("unknown error")
                            .to_string();
                        return Err(AcpError::AgentError { code, message });
                    }
                    return Ok(wire["result"].clone());
                }
            }
            // Requests/notifications arriving before our response (e.g. permission
            // requests during session/new) — ack politely so the agent isn't stuck.
            if let Some(method) = wire.get("method").and_then(|v| v.as_str()) {
                if method == "session/request_permission" {
                    self.auto_approve_permission(&wire).await?;
                } else if wire.get("id").is_some() {
                    let err_resp = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": wire["id"],
                        "error": {"code": -32601, "message": format!("Method not found: {method}")}
                    });
                    self.write_ndjson(&err_resp).await?;
                }
            }
        }
    }
}
