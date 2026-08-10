use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::acp::{AcpClient, AgentKind, ModelInfo};
use crate::AppState;

/// Best-effort login/availability check — runs `<cli> --version` and reports
/// success/failure. Does not (and should not) inspect actual auth tokens.
#[tauri::command]
pub async fn check_cli_status(cli: String) -> Result<bool, String> {
    // npm global-bin shims on Windows are `.cmd` files — raw `CreateProcess`
    // (what tokio::process::Command uses, no shell) won't resolve a bare
    // name to them, the same issue fixed for the ACP adapters in
    // AgentKind::command(). Without this, the spawn fails with NotFound and
    // the settings screen always shows "chưa đăng nhập" regardless of
    // actual login state.
    let binary = match cli.as_str() {
        #[cfg(windows)]
        "claude" => "claude.cmd",
        #[cfg(not(windows))]
        "claude" => "claude",
        #[cfg(windows)]
        "codex" => "codex.cmd",
        #[cfg(not(windows))]
        "codex" => "codex",
        other => return Err(format!("unknown cli: {other}")),
    };
    let mut cmd = tokio::process::Command::new(binary);
    cmd.arg("--version");
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    match cmd.output().await {
        Ok(output) => Ok(output.status.success()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub async fn get_orchestrator_kind(state: State<'_, AppState>) -> Result<String, String> {
    sqlx::query_scalar("SELECT orchestrator_agent_kind FROM app_settings WHERE id = true")
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_orchestrator_kind(state: State<'_, AppState>, kind: String) -> Result<(), String> {
    if kind != "claude" && kind != "codex" {
        return Err("invalid orchestrator kind".into());
    }
    sqlx::query("UPDATE app_settings SET orchestrator_agent_kind = $1, updated_at = now() WHERE id = true")
        .bind(&kind)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Drop the cached orchestrator session so the new kind takes effect on
    // the next compaction call instead of silently keeping the old one alive.
    let mut guard = state.orchestrator.lock().await;
    *guard = None;
    Ok(())
}

/// Ask the adapter itself what models it currently offers, by spawning a
/// throwaway session in the app's own working directory (per
/// NEW_TOOL_PLAN_V2.md §6.0 — the model list is queried dynamically from the
/// CLI, never hardcoded). Not tied to any room or the orchestrator session.
#[tauri::command]
pub async fn list_models(agent_kind: String) -> Result<Vec<ModelInfo>, String> {
    let kind = parse_kind(&agent_kind)?;
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());

    let mut client = AcpClient::spawn(kind.command(), &[], &cwd)
        .await
        .map_err(|e| e.to_string())?;
    client.initialize().await.map_err(|e| e.to_string())?;
    let session = client.session_new(&cwd, None).await.map_err(|e| e.to_string())?;
    let models = crate::acp::client::extract_models(&session.raw);
    client.shutdown().await;
    Ok(models)
}

fn parse_kind(s: &str) -> Result<AgentKind, String> {
    match s {
        "claude" => Ok(AgentKind::Claude),
        "codex" => Ok(AgentKind::Codex),
        other => Err(format!("unknown agent kind: {other}")),
    }
}

#[derive(Serialize)]
pub struct ModelSettings {
    pub claude_model: Option<String>,
    pub codex_model: Option<String>,
    pub orchestrator_model: Option<String>,
}

#[tauri::command]
pub async fn get_model_settings(state: State<'_, AppState>) -> Result<ModelSettings, String> {
    let row: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT claude_model, codex_model, orchestrator_model FROM app_settings WHERE id = true",
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(ModelSettings {
        claude_model: row.0,
        codex_model: row.1,
        orchestrator_model: row.2,
    })
}

/// `scope` is one of "claude" | "codex" | "orchestrator". `model` of `None`
/// clears the override, falling back to whatever the adapter defaults to.
#[tauri::command]
pub async fn set_model_setting(
    state: State<'_, AppState>,
    scope: String,
    model: Option<String>,
) -> Result<(), String> {
    let column = match scope.as_str() {
        "claude" => "claude_model",
        "codex" => "codex_model",
        "orchestrator" => "orchestrator_model",
        other => return Err(format!("unknown model scope: {other}")),
    };
    // Column name is one of the three fixed literals above, never user input.
    let query = format!("UPDATE app_settings SET {column} = $1, updated_at = now() WHERE id = true");
    sqlx::query(&query)
        .bind(&model)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    if scope == "orchestrator" {
        let mut guard = state.orchestrator.lock().await;
        *guard = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_room_model(
    state: State<'_, AppState>,
    room_id: Uuid,
    agent_kind: String,
) -> Result<Option<String>, String> {
    sqlx::query_scalar(
        "SELECT model FROM room_agent_settings WHERE room_id = $1 AND agent_kind = $2",
    )
    .bind(room_id)
    .bind(agent_kind)
    .fetch_optional(&state.db)
    .await
    .map(|opt| opt.flatten())
    .map_err(|e| e.to_string())
}

/// `model` of `None` clears the room's override so it inherits the global
/// default for that agent kind again.
#[tauri::command]
pub async fn set_room_model(
    state: State<'_, AppState>,
    room_id: Uuid,
    agent_kind: String,
    model: Option<String>,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO room_agent_settings (room_id, agent_kind, model) VALUES ($1, $2, $3)
         ON CONFLICT (room_id, agent_kind) DO UPDATE SET model = EXCLUDED.model",
    )
    .bind(room_id)
    .bind(agent_kind)
    .bind(model)
    .execute(&state.db)
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_context_budget(state: State<'_, AppState>) -> Result<i64, String> {
    sqlx::query_scalar("SELECT context_budget_tokens FROM app_settings WHERE id = true")
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_context_budget(state: State<'_, AppState>, tokens: i64) -> Result<(), String> {
    if tokens <= 0 {
        return Err("context budget must be positive".into());
    }
    sqlx::query("UPDATE app_settings SET context_budget_tokens = $1, updated_at = now() WHERE id = true")
        .bind(tokens)
        .execute(&state.db)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct ContextUsage {
    pub used_tokens: i64,
    pub budget_tokens: i64,
}

#[tauri::command]
pub async fn get_room_context_usage(
    state: State<'_, AppState>,
    session_id: Uuid,
) -> Result<ContextUsage, String> {
    let budget_tokens: i64 = sqlx::query_scalar("SELECT context_budget_tokens FROM app_settings WHERE id = true")
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    let used_tokens = crate::orchestrator::compaction::estimate_context_tokens(&state.db, session_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ContextUsage { used_tokens, budget_tokens })
}

/// Spawn both Claude and Codex for a conversation session — the "play"
/// side of the play/pause control, called explicitly by the user (not
/// automatically on session open anymore: opening a session to re-read
/// history shouldn't spin up either CLI for nothing). Best-effort per
/// agent — e.g. a CLI that isn't logged in just stays idle and gets
/// retried lazily on the first real turn regardless.
#[tauri::command]
pub async fn ensure_session_agents(state: State<'_, AppState>, session_id: Uuid) -> Result<(), String> {
    let room_id = crate::commands::sessions::get_session_room(&state.db, session_id)
        .await
        .map_err(|e| e.to_string())?;
    let cwd = crate::commands::rooms::get_room_folder(&state.db, room_id)
        .await
        .map_err(|e| e.to_string())?;
    let rolling_summary: String = sqlx::query_scalar(
        "SELECT rolling_summary FROM compaction_state WHERE session_id = $1",
    )
    .bind(session_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .unwrap_or_default();

    for kind in [AgentKind::Claude, AgentKind::Codex] {
        let model = resolve_model(&state.db, room_id, kind).await.unwrap_or(None);
        let summary = rolling_summary.clone();
        let _ = state
            .process_manager
            .ensure_running(session_id, kind, &cwd, model.as_deref(), move || {
                if summary.is_empty() {
                    crate::system_context::SYSTEM_CONTEXT.to_string()
                } else {
                    format!("{}\n\n[Project summary so far]\n{summary}", crate::system_context::SYSTEM_CONTEXT)
                }
            })
            .await;
    }
    Ok(())
}

/// Kill both agent processes for a session — the "pause" side of the
/// play/pause control: a user who just wants to re-read old history
/// shouldn't have both CLIs spun up for nothing. Chatting still works
/// afterward regardless — `run_agent_turn` calls `ensure_running` itself on
/// the next real turn — this only tears down the pre-warmed idle processes.
#[tauri::command]
pub async fn stop_session_agents(state: State<'_, AppState>, session_id: Uuid) -> Result<(), String> {
    state.process_manager.shutdown_for(session_id).await;
    Ok(())
}

#[derive(Serialize)]
pub struct SessionAgentStatus {
    pub agent_kind: String,
    pub is_active: bool,
}

#[tauri::command]
pub async fn session_agent_statuses(state: State<'_, AppState>, session_id: Uuid) -> Result<Vec<SessionAgentStatus>, String> {
    let mut statuses = Vec::new();
    for kind in [AgentKind::Claude, AgentKind::Codex] {
        let is_active = state.process_manager.is_active(session_id, kind).await;
        statuses.push(SessionAgentStatus { agent_kind: kind.as_str().to_string(), is_active });
    }
    Ok(statuses)
}

/// Read a local file and base64-encode it, for sending as an ACP `image`
/// content block (which requires inline base64 data, not just a path).
#[tauri::command]
pub async fn read_file_as_base64(path: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Resolve the model to use for `kind` in `room_id`: a per-room override if
/// set, else the global default for that agent kind (either may be `None`,
/// meaning "let the adapter pick its own default").
pub async fn resolve_model(
    pool: &sqlx::PgPool,
    room_id: Uuid,
    kind: AgentKind,
) -> Result<Option<String>, sqlx::Error> {
    let room_override: Option<String> = sqlx::query_scalar(
        "SELECT model FROM room_agent_settings WHERE room_id = $1 AND agent_kind = $2",
    )
    .bind(room_id)
    .bind(kind.as_str())
    .fetch_optional(pool)
    .await?
    .flatten();
    if room_override.is_some() {
        return Ok(room_override);
    }

    let column = match kind {
        AgentKind::Claude => "claude_model",
        AgentKind::Codex => "codex_model",
    };
    let query = format!("SELECT {column} FROM app_settings WHERE id = true");
    sqlx::query_scalar(&query).fetch_one(pool).await
}

/// Resolve which CLI kind + model the orchestrator should use for a given
/// room: the CLI kind is a global setting (there's one shared orchestrator
/// process for the whole app lifetime), but the model can be overridden per
/// room on top of the global default.
pub async fn resolve_orchestrator_settings(pool: &sqlx::PgPool, room_id: Uuid) -> (AgentKind, Option<String>) {
    let row: (String, Option<String>) = sqlx::query_as(
        "SELECT orchestrator_agent_kind, orchestrator_model FROM app_settings WHERE id = true",
    )
    .fetch_one(pool)
    .await
    .unwrap_or_else(|_| ("codex".to_string(), None));
    let (kind_str, global_model) = row;
    let kind = match kind_str.as_str() {
        "claude" => AgentKind::Claude,
        _ => AgentKind::Codex,
    };

    let room_override: Option<String> = sqlx::query_scalar::<_, Option<String>>(
        "SELECT model FROM room_agent_settings WHERE room_id = $1 AND agent_kind = 'orchestrator'",
    )
    .bind(room_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .flatten();

    (kind, room_override.or(global_model))
}

#[tauri::command]
pub async fn get_chat_font_size(state: State<'_, AppState>) -> Result<String, String> {
    sqlx::query_scalar("SELECT chat_font_size FROM app_settings WHERE id = true")
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_chat_font_size(state: State<'_, AppState>, size: String) -> Result<(), String> {
    if !["sm", "base", "lg"].contains(&size.as_str()) {
        return Err("invalid font size".into());
    }
    sqlx::query("UPDATE app_settings SET chat_font_size = $1, updated_at = now() WHERE id = true")
        .bind(&size)
        .execute(&state.db)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}
