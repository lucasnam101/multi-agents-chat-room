use serde::{Deserialize, Serialize};
use sqlx::types::Json;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::acp::{content_blocks, AgentKind};
use crate::commands::sessions::get_session_room;
use crate::orchestrator::mention_router::{find_mentions, MAX_CHAIN_DEPTH};
use crate::system_context::SYSTEM_CONTEXT;
use crate::AppState;

/// An attachment on a user message — sent to the agent as a real ACP
/// content block (image: base64 bytes; file: a resource_link path
/// reference, no bytes — the agent can read it itself). Only ever
/// meaningful on the top-level message that triggered a turn; chained
/// @mention replies never carry attachments of their own.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub kind: String, // "image" | "file"
    pub name: String,
    pub mime_type: Option<String>,
    pub data_base64: Option<String>,
    pub path: Option<String>,
}

#[derive(Serialize, Clone, sqlx::FromRow)]
pub struct Message {
    pub id: i64,
    pub session_id: Uuid,
    pub author_kind: String,
    pub message_type: String,
    pub content: String,
    pub attachments: Json<Vec<Attachment>>,
    pub model: Option<String>,
}

#[tauri::command]
pub async fn list_messages(state: State<'_, AppState>, session_id: Uuid) -> Result<Vec<Message>, String> {
    sqlx::query_as::<_, Message>(
        "SELECT id, session_id, author_kind, message_type, content, attachments, model FROM messages
         WHERE session_id = $1 ORDER BY id ASC",
    )
    .bind(session_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_message(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: Uuid,
    content: String,
    attachments: Vec<Attachment>,
) -> Result<Message, String> {
    let room_id = get_session_room(&state.db, session_id)
        .await
        .map_err(|e| e.to_string())?;

    let message = insert_and_announce(&app, &state, session_id, "user", "chat", &content, &attachments)
        .await
        .map_err(|e| e.to_string())?;

    let inner = state.inner().clone();
    let app_for_task = app.clone();
    let content_for_task = content.clone();
    tokio::spawn(async move {
        maybe_autoname_session(&app_for_task, &inner, session_id, room_id, &content_for_task).await;
        if find_mentions(&content_for_task).is_empty() {
            // No agent was tagged — the orchestrator answers directly as the
            // room's default assistant, instead of the message going nowhere.
            run_orchestrator_reply(app_for_task, inner, session_id, room_id, &content_for_task, &attachments).await;
        } else {
            process_mentions(app_for_task, inner, session_id, room_id, &content_for_task, 1, &attachments).await;
        }
    });

    Ok(message)
}

async fn insert_message(
    state: &AppState,
    session_id: Uuid,
    author_kind: &str,
    message_type: &str,
    content: &str,
    attachments: &[Attachment],
) -> Result<Message, sqlx::Error> {
    sqlx::query_as::<_, Message>(
        "INSERT INTO messages (session_id, author_kind, message_type, content, attachments)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, session_id, author_kind, message_type, content, attachments, model",
    )
    .bind(session_id)
    .bind(author_kind)
    .bind(message_type)
    .bind(content)
    .bind(Json(attachments.to_vec()))
    .fetch_one(&state.db)
    .await
}

/// Insert a message and immediately tell the frontend about it — every
/// insert (user message, placeholder, system note) goes through this so the
/// UI never has to guess a row exists before it can attach streamed updates
/// to it.
async fn insert_and_announce(
    app: &AppHandle,
    state: &AppState,
    session_id: Uuid,
    author_kind: &str,
    message_type: &str,
    content: &str,
    attachments: &[Attachment],
) -> Result<Message, sqlx::Error> {
    let message = insert_message(state, session_id, author_kind, message_type, content, attachments).await?;
    let _ = app.emit("message-inserted", &message);
    Ok(message)
}

/// Overwrite a message's content and tell the frontend the exact final
/// text — this is also the signal the frontend uses to end a "typing"
/// indicator, so it must fire on every turn outcome, including errors.
async fn finalize_message(app: &AppHandle, state: &AppState, session_id: Uuid, message_id: i64, content: &str) {
    let _ = sqlx::query("UPDATE messages SET content = $1 WHERE id = $2")
        .bind(content)
        .bind(message_id)
        .execute(&state.db)
        .await;
    let _ = app.emit(
        "message-updated",
        serde_json::json!({ "id": message_id, "session_id": session_id, "content": content }),
    );
}

async fn set_message_model(app: &AppHandle, state: &AppState, session_id: Uuid, message_id: i64, model: Option<&str>) {
    let _ = sqlx::query("UPDATE messages SET model = $1 WHERE id = $2")
        .bind(model)
        .bind(message_id)
        .execute(&state.db)
        .await;
    let _ = app.emit("message-updated", serde_json::json!({
        "id": message_id, "session_id": session_id, "content": "", "model": model
    }));
}

/// Walk one hop of the @mention chain starting from `content` (either the
/// user's message or a prior agent reply), dispatching each mentioned agent
/// in turn and recursing into its reply. See NEW_TOOL_PLAN_V2.md §7.
/// `attachments` only apply at the hop that was directly triggered by the
/// user's own message (depth == 1) — callers pass `&[]` for deeper hops.
async fn process_mentions(
    app: AppHandle,
    state: AppState,
    session_id: Uuid,
    room_id: Uuid,
    content: &str,
    depth: u32,
    attachments: &[Attachment],
) {
    let mentions = find_mentions(content);
    if mentions.is_empty() {
        return;
    }

    if depth > MAX_CHAIN_DEPTH {
        let _ = insert_and_announce(
            &app,
            &state,
            session_id,
            "system",
            "system_note",
            "Chuỗi @mention đã đạt giới hạn 5 lượt tự động — vui lòng tiếp tục thủ công.",
            &[],
        )
        .await;
        return;
    }

    for kind in mentions {
        match run_agent_turn(&app, &state, session_id, room_id, kind, content, attachments).await {
            Ok(reply) => {
                maybe_compact(&state, session_id, room_id).await;
                // A reply that itself contains @mentions keeps the chain going.
                // Attachments don't carry through — they belonged to the
                // message that started this hop, not the agent's reply.
                Box::pin(process_mentions(app.clone(), state.clone(), session_id, room_id, &reply, depth + 1, &[]))
                    .await;
            }
            Err(e) => {
                let _ = insert_and_announce(
                    &app,
                    &state,
                    session_id,
                    "system",
                    "system_note",
                    &format!("Lỗi khi gọi {}: {e}", kind.as_str()),
                    &[],
                )
                .await;
            }
        }
    }
}

/// Convert an absolute local path into a `file://` URI. Not fully
/// RFC 3986-encoded (spaces/unicode pass through raw) — good enough for the
/// typical project-relative paths this app deals with.
fn file_uri(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    if normalized.starts_with('/') {
        format!("file://{normalized}")
    } else {
        format!("file:///{normalized}")
    }
}

fn attachment_blocks(attachments: &[Attachment]) -> Vec<serde_json::Value> {
    attachments
        .iter()
        .filter_map(|a| match a.kind.as_str() {
            "image" => {
                let data = a.data_base64.as_deref()?;
                let mime = a.mime_type.as_deref().unwrap_or("application/octet-stream");
                Some(content_blocks::image(data, mime))
            }
            "file" => {
                let path = a.path.as_deref()?;
                Some(content_blocks::resource_link(&file_uri(path), &a.name, a.mime_type.as_deref()))
            }
            _ => None,
        })
        .collect()
}

/// Run one agent turn end-to-end: spawn/resume the session, insert a
/// placeholder message (announced immediately so the frontend can render a
/// typing indicator and attach streamed chunks to it), stream the reply, and
/// always finalize the placeholder — with the real reply on success, or an
/// inline error string on failure — so a mid-turn failure can never leave a
/// bubble stuck "thinking" forever.
async fn run_agent_turn(
    app: &AppHandle,
    state: &AppState,
    session_id: Uuid,
    room_id: Uuid,
    kind: AgentKind,
    triggering_content: &str,
    attachments: &[Attachment],
) -> Result<String, String> {
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

    let recent: Vec<Message> = sqlx::query_as(
        "SELECT id, session_id, author_kind, message_type, content, attachments, model FROM messages
         WHERE session_id = $1 ORDER BY id DESC LIMIT 10",
    )
    .bind(session_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    let recent_text = recent
        .iter()
        .rev()
        .map(|m| format!("[{}] {}", m.author_kind, m.content))
        .collect::<Vec<_>>()
        .join("\n");

    let model = crate::commands::agents::resolve_model(&state.db, room_id, kind)
        .await
        .map_err(|e| e.to_string())?;

    state
        .process_manager
        .ensure_running(session_id, kind, &cwd, model.as_deref(), || {
            if rolling_summary.is_empty() {
                SYSTEM_CONTEXT.to_string()
            } else {
                format!("{SYSTEM_CONTEXT}\n\n[Project summary so far]\n{rolling_summary}")
            }
        })
        .await
        .map_err(|e| e.to_string())?;

    let full_prompt = format!(
        "[Project summary so far]\n{rolling_summary}\n\n[Recent messages]\n{recent_text}\n\n[Current instruction]\n{triggering_content}"
    );
    let mut blocks = vec![content_blocks::text(&full_prompt)];
    blocks.extend(attachment_blocks(attachments));

    // Placeholder assistant message — announced immediately (before the
    // prompt is even sent) so the UI shows a typing indicator right away and
    // has somewhere to attach streamed chunks to.
    let placeholder = insert_and_announce(app, state, session_id, kind.as_str(), "chat", "", &[])
        .await
        .map_err(|e| e.to_string())?;
    let placeholder_id = placeholder.id;
    set_message_model(app, state, session_id, placeholder_id, model.as_deref()).await;

    let mut accumulated = String::new();
    // True right after a tool call, until the next text chunk — used to
    // insert a paragraph break so "round 1 text" / tool activity / "round 2
    // text" don't visually run together as one unbroken sentence.
    let mut pending_round_break = false;
    let app_for_stream = app.clone();
    let permission_handler = Some(crate::commands::agents::permission_handler(
        app.clone(), state.approvals.clone(), session_id, kind,
    ));
    let result = state
        .process_manager
        .prompt_with_permission(session_id, kind, blocks, |update| {
            match &update {
                crate::acp::AgentUpdate::MessageChunk { text } => {
                    if pending_round_break && !accumulated.is_empty() {
                        // A markdown horizontal rule, not just whitespace -
                        // makes the boundary between "round" of text/tool
                        // activity/text visually unmistakable rather than
                        // relying on paragraph-spacing alone.
                        accumulated.push_str("\n\n---\n\n");
                    }
                    pending_round_break = false;
                    accumulated.push_str(text);
                }
                crate::acp::AgentUpdate::ToolCall { .. } | crate::acp::AgentUpdate::ToolCallUpdate { .. } => {
                    pending_round_break = true;
                }
                crate::acp::AgentUpdate::Other { .. } => {}
            }
            let _ = app_for_stream.emit(
                "agent-update",
                serde_json::json!({
                    "session_id": session_id,
                    "message_id": placeholder_id,
                    "agent_kind": kind.as_str(),
                    "update": update,
                }),
            );
        }, permission_handler)
        .await;

    if let Err(e) = result {
        accumulated = format!("⚠️ Lỗi: {e}");
    }

    finalize_message(app, state, session_id, placeholder_id, &accumulated).await;
    Ok(accumulated)
}

/// Make sure `state.orchestrator` holds a session matching the CLI kind +
/// model resolved for `room_id` (room override, else the global default),
/// respawning it if either differs from what's currently cached. There is
/// one shared orchestrator session for the whole app lifetime, so switching
/// between rooms with different orchestrator model overrides does force a
/// respawn — an accepted cost for correctness.
async fn ensure_orchestrator(state: &AppState, room_id: Uuid, cwd: &str) -> Result<(), String> {
    let (kind, model) = crate::commands::agents::resolve_orchestrator_settings(&state.db, room_id).await;
    let mut guard = state.orchestrator.lock().await;
    let needs_respawn = match guard.as_ref() {
        None => true,
        Some(o) => o.kind != kind || o.model != model,
    };
    if needs_respawn {
        let session = crate::orchestrator::compaction::OrchestratorSession::spawn(kind, cwd, model.as_deref())
            .await
            .map_err(|e| e.to_string())?;
        *guard = Some(session);
    }
    Ok(())
}

/// The room's default response when the user's message doesn't @mention
/// either agent — the orchestrator (the same cheap session used for
/// compaction) answers directly instead of the message going unanswered.
async fn run_orchestrator_reply(
    app: AppHandle,
    state: AppState,
    session_id: Uuid,
    room_id: Uuid,
    user_content: &str,
    attachments: &[Attachment],
) {
    let cwd = match crate::commands::rooms::get_room_folder(&state.db, room_id).await {
        Ok(cwd) => cwd,
        Err(_) => return,
    };

    if let Err(e) = ensure_orchestrator(&state, room_id, &cwd).await {
        let _ = insert_and_announce(
            &app,
            &state,
            session_id,
            "system",
            "system_note",
            &format!("Không thể khởi động orchestrator: {e}"),
            &[],
        )
        .await;
        return;
    }
    let mut guard = state.orchestrator.lock().await;
    let Some(orchestrator) = guard.as_mut() else {
        return;
    };

    let rolling_summary: String = sqlx::query_scalar(
        "SELECT rolling_summary FROM compaction_state WHERE session_id = $1",
    )
    .bind(session_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .unwrap_or_default();

    // The rolling summary alone is not the conversation — it stays empty
    // until compaction first triggers (§6.1: 20 messages or the context
    // budget), so early on it's the *only* signal the orchestrator had,
    // meaning it saw nothing of the actual chat. Recent raw messages fill
    // that gap, same as the @mention path already does in run_agent_turn.
    let recent: Vec<Message> = sqlx::query_as(
        "SELECT id, session_id, author_kind, message_type, content, attachments, model FROM messages
         WHERE session_id = $1 ORDER BY id DESC LIMIT 10",
    )
    .bind(session_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let recent_text = recent
        .iter()
        .rev()
        .map(|m| format!("[{}] {}", m.author_kind, m.content))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        "{SYSTEM_CONTEXT}\n\n[Project summary so far]\n{rolling_summary}\n\n\
[Recent messages]\n{recent_text}\n\n\
[No agent was explicitly @mentioned in this message — answer directly and \
concisely as the room's default assistant]\n{user_content}"
    );
    let mut blocks = vec![content_blocks::text(&prompt)];
    blocks.extend(attachment_blocks(attachments));

    let placeholder = match insert_and_announce(&app, &state, session_id, "orchestrator", "chat", "", &[]).await {
        Ok(m) => m,
        Err(_) => return,
    };
    let placeholder_id = placeholder.id;
    let orchestrator_model = orchestrator.model.clone();
    set_message_model(&app, &state, session_id, placeholder_id, orchestrator_model.as_deref()).await;

    let mut accumulated = String::new();
    let mut pending_round_break = false;
    let app_for_stream = app.clone();
    let result = orchestrator
        .client
        .session_prompt(&orchestrator.session_id, blocks, |update| {
            match &update {
                crate::acp::AgentUpdate::MessageChunk { text } => {
                    if pending_round_break && !accumulated.is_empty() {
                        // A markdown horizontal rule, not just whitespace -
                        // makes the boundary between "round" of text/tool
                        // activity/text visually unmistakable rather than
                        // relying on paragraph-spacing alone.
                        accumulated.push_str("\n\n---\n\n");
                    }
                    pending_round_break = false;
                    accumulated.push_str(text);
                }
                crate::acp::AgentUpdate::ToolCall { .. } | crate::acp::AgentUpdate::ToolCallUpdate { .. } => {
                    pending_round_break = true;
                }
                crate::acp::AgentUpdate::Other { .. } => {}
            }
            let _ = app_for_stream.emit(
                "agent-update",
                serde_json::json!({
                    "session_id": session_id,
                    "message_id": placeholder_id,
                    "agent_kind": "orchestrator",
                    "update": update,
                }),
            );
        })
        .await;

    if let Err(e) = result {
        accumulated = format!("⚠️ Lỗi orchestrator: {e}");
    }

    finalize_message(&app, &state, session_id, placeholder_id, &accumulated).await;
}

async fn maybe_compact(state: &AppState, session_id: Uuid, room_id: Uuid) {
    let budget_tokens: i64 = sqlx::query_scalar("SELECT context_budget_tokens FROM app_settings WHERE id = true")
        .fetch_one(&state.db)
        .await
        .unwrap_or(crate::orchestrator::compaction::DEFAULT_CONTEXT_BUDGET_TOKENS);

    let should = crate::orchestrator::compaction::should_compact(&state.db, session_id, budget_tokens)
        .await
        .unwrap_or(false);
    if !should {
        return;
    }

    let cwd = match crate::commands::rooms::get_room_folder(&state.db, room_id).await {
        Ok(cwd) => cwd,
        Err(_) => return,
    };

    if ensure_orchestrator(&state, room_id, &cwd).await.is_err() {
        return;
    }
    let mut guard = state.orchestrator.lock().await;
    if let Some(orchestrator) = guard.as_mut() {
        let _ = crate::orchestrator::compaction::compact_room(&state.db, orchestrator, session_id).await;
    }
}

/// Auto-title a session from its first user message, the way ChatGPT/
/// Claude's web UIs do — runs the same one-shot-prompt pattern as
/// compaction, through the shared orchestrator session, so it costs no
/// separate API key/process. Only fires once: guarded by checking this is
/// genuinely the first message in the session (an unnamed default title
/// only ever needs naming once).
async fn maybe_autoname_session(app: &AppHandle, state: &AppState, session_id: Uuid, room_id: Uuid, first_message: &str) {
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM messages WHERE session_id = $1")
        .bind(session_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);
    if count != 1 {
        return;
    }

    let cwd = match crate::commands::rooms::get_room_folder(&state.db, room_id).await {
        Ok(cwd) => cwd,
        Err(_) => return,
    };
    if ensure_orchestrator(state, room_id, &cwd).await.is_err() {
        return;
    }

    let title = {
        let mut guard = state.orchestrator.lock().await;
        let Some(orchestrator) = guard.as_mut() else {
            return;
        };
        let prompt = format!(
            "Summarize the following user message into a very short conversation \
title (max 6 words, no quotes, no trailing punctuation). Output ONLY the \
title text, nothing else.\n\n{first_message}"
        );
        let mut title = String::new();
        let result = orchestrator
            .client
            .session_prompt(&orchestrator.session_id, vec![content_blocks::text(&prompt)], |update| {
                if let crate::acp::AgentUpdate::MessageChunk { text } = update {
                    title.push_str(&text);
                }
            })
            .await;
        if result.is_err() {
            return;
        }
        title
    };

    let title: String = title.trim().trim_matches('"').chars().take(80).collect();
    if title.is_empty() {
        return;
    }

    let _ = sqlx::query("UPDATE sessions SET name = $1 WHERE id = $2")
        .bind(&title)
        .bind(session_id)
        .execute(&state.db)
        .await;
    let _ = app.emit("session-renamed", serde_json::json!({ "session_id": session_id, "name": title }));
}
