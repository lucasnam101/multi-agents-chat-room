use sqlx::postgres::{PgPool, PgPoolOptions};

pub async fn init_pool() -> Result<PgPool, sqlx::Error> {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://agentchat:agentchat_dev@127.0.0.1:5433/agentchat".into());

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    Ok(pool)
}

/// Mark any agent placeholder left with empty content from a previous run —
/// the only way a `chat`-type row from claude/codex/orchestrator stays empty
/// while the app is alive is mid-flight streaming, which `finalize_message`
/// always resolves within seconds. If one is still empty at the *next*
/// startup, the app was killed or crashed mid-turn. The room's history and
/// rolling summary are untouched (persisted in Postgres regardless), so
/// re-@mentioning the same agent picks the conversation back up — this just
/// replaces the silently-stuck-looking blank bubble with a note saying so.
pub async fn recover_orphaned_placeholders(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE messages SET content = $1
         WHERE message_type = 'chat' AND author_kind IN ('claude', 'codex', 'grok', 'orchestrator') AND content = ''",
    )
    .bind("⚠️ Lượt trả lời này bị ngắt vì ứng dụng đã tắt — @mention lại agent để tiếp tục, ngữ cảnh trước đó vẫn được giữ.")
    .execute(pool)
    .await?;
    Ok(())
}
