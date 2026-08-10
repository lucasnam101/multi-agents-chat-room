//! Asymmetric rolling-summary compaction. See NEW_TOOL_PLAN_V2.md §6.
//!
//! Runs the summary-update turn through a dedicated, long-lived orchestrator
//! ACP session (one per app lifetime, not per room) rather than an API key —
//! per the plan, there is no external LLM API anywhere in this app.
//!
//! Scoped by app-level `session_id` (one independent conversation per tab in
//! the session switcher), not by room — each session accumulates and
//! compacts its own history separately.

use sqlx::PgPool;
use uuid::Uuid;

use crate::acp::{content_blocks, AcpClient, AgentKind};

pub const TRIGGER_MESSAGE_COUNT: i64 = 20;
pub const DEFAULT_CONTEXT_BUDGET_TOKENS: i64 = 300_000;

pub struct OrchestratorSession {
    pub client: AcpClient,
    pub session_id: String,
    pub kind: AgentKind,
    pub model: Option<String>,
}

impl OrchestratorSession {
    pub async fn spawn(kind: AgentKind, cwd: &str, model: Option<&str>) -> Result<Self, crate::acp::AcpError> {
        let mut client = AcpClient::spawn(kind.command(), &[], cwd).await?;
        client.initialize().await?;
        let session = client.session_new(cwd, None).await?;
        if let Some(model_id) = model {
            let _ = client.session_set_model(&session.session_id, model_id).await;
        }
        Ok(Self {
            client,
            session_id: session.session_id,
            kind,
            model: model.map(|m| m.to_string()),
        })
    }
}

#[derive(sqlx::FromRow)]
struct RawMessage {
    id: i64,
    author_kind: String,
    content: String,
}

/// Estimated tokens (`chars / 4` heuristic) currently in play for a
/// conversation session: the rolling summary plus every raw message since
/// the last compaction — i.e. what the next agent turn's context would
/// actually contain.
pub async fn estimate_context_tokens(pool: &PgPool, app_session_id: Uuid) -> Result<i64, sqlx::Error> {
    let existing: Option<(String, i64)> = sqlx::query_as(
        "SELECT rolling_summary, last_compacted_message_id FROM compaction_state WHERE session_id = $1",
    )
    .bind(app_session_id)
    .fetch_optional(pool)
    .await?;
    let (summary, last_compacted) = existing.unwrap_or_default();

    let char_sum: Option<i64> = sqlx::query_scalar(
        "SELECT sum(char_length(content)) FROM messages WHERE session_id = $1 AND id > $2",
    )
    .bind(app_session_id)
    .bind(last_compacted)
    .fetch_one(pool)
    .await?;

    Ok((summary.len() as i64 + char_sum.unwrap_or(0)) / 4)
}

/// Check whether a session has accumulated enough new raw content since its
/// last compaction to warrant running the orchestrator again.
pub async fn should_compact(pool: &PgPool, app_session_id: Uuid, budget_tokens: i64) -> Result<bool, sqlx::Error> {
    let last_compacted: i64 = sqlx::query_scalar(
        "SELECT last_compacted_message_id FROM compaction_state WHERE session_id = $1",
    )
    .bind(app_session_id)
    .fetch_optional(pool)
    .await?
    .unwrap_or(0);

    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM messages WHERE session_id = $1 AND id > $2",
    )
    .bind(app_session_id)
    .bind(last_compacted)
    .fetch_one(pool)
    .await?;

    let estimated_tokens = estimate_context_tokens(pool, app_session_id).await?;
    Ok(count >= TRIGGER_MESSAGE_COUNT || estimated_tokens >= budget_tokens)
}

/// Run one compaction pass for `app_session_id` against the given
/// orchestrator session, updating `compaction_state` in place.
pub async fn compact_room(
    pool: &PgPool,
    orchestrator: &mut OrchestratorSession,
    app_session_id: Uuid,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let existing: Option<(String, i64)> = sqlx::query_as(
        "SELECT rolling_summary, last_compacted_message_id FROM compaction_state WHERE session_id = $1",
    )
    .bind(app_session_id)
    .fetch_optional(pool)
    .await?;
    let (s_old, last_compacted) = existing.unwrap_or_default();

    let new_messages: Vec<RawMessage> = sqlx::query_as(
        "SELECT id, author_kind, content FROM messages WHERE session_id = $1 AND id > $2 ORDER BY id",
    )
    .bind(app_session_id)
    .bind(last_compacted)
    .fetch_all(pool)
    .await?;

    if new_messages.is_empty() {
        return Ok(());
    }
    let highest_id = new_messages.iter().map(|m| m.id).max().unwrap_or(last_compacted);

    let b_new = new_messages
        .iter()
        .map(|m| format!("[{}] {}", m.author_kind, m.content))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        "You maintain a running project-status summary for an ongoing \
multi-agent coding conversation in a shared project folder.\n\n\
Existing summary — keep its structure and content mostly intact, only \
make small edits for accuracy or coherence. Do NOT rewrite it from \
scratch:\n---\n{s_old}\n---\n\n\
New conversation since the last update — compress this heavily into a \
few bullet points capturing key decisions, tasks assigned to which \
agent, and outcomes. Discard small talk and verbose detail:\n---\n{b_new}\n---\n\n\
Output ONLY the updated summary text (no preamble, no \"Here is the summary:\")."
    );

    let mut new_summary = String::new();
    orchestrator
        .client
        .session_prompt(&orchestrator.session_id, vec![content_blocks::text(&prompt)], |update| {
            if let crate::acp::AgentUpdate::MessageChunk { text } = update {
                new_summary.push_str(&text);
            }
        })
        .await?;

    sqlx::query(
        "INSERT INTO compaction_state (session_id, rolling_summary, last_compacted_message_id, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (session_id) DO UPDATE SET
            rolling_summary = EXCLUDED.rolling_summary,
            last_compacted_message_id = EXCLUDED.last_compacted_message_id,
            updated_at = now()",
    )
    .bind(app_session_id)
    .bind(new_summary.trim())
    .bind(highest_id)
    .execute(pool)
    .await?;

    Ok(())
}
