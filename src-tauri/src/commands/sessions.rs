use serde::Serialize;
use sqlx::PgPool;
use tauri::State;
use uuid::Uuid;

use crate::AppState;

#[derive(Serialize, sqlx::FromRow)]
pub struct Session {
    pub id: Uuid,
    pub room_id: Uuid,
    pub name: String,
}

#[tauri::command]
pub async fn list_sessions(state: State<'_, AppState>, room_id: Uuid) -> Result<Vec<Session>, String> {
    sqlx::query_as::<_, Session>(
        "SELECT id, room_id, name FROM sessions WHERE room_id = $1 ORDER BY created_at ASC",
    )
    .bind(room_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_session(
    state: State<'_, AppState>,
    room_id: Uuid,
    name: Option<String>,
) -> Result<Session, String> {
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM sessions WHERE room_id = $1")
        .bind(room_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    let name = name.unwrap_or_else(|| format!("Cuộc trò chuyện {}", count + 1));

    sqlx::query_as::<_, Session>(
        "INSERT INTO sessions (room_id, name) VALUES ($1, $2) RETURNING id, room_id, name",
    )
    .bind(room_id)
    .bind(name)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())
}

/// Deleting a session cascades to its messages and compaction state (FK
/// `ON DELETE CASCADE`); this also kills any live ACP process keyed to it
/// so a deleted session's process doesn't linger in the background.
#[tauri::command]
pub async fn delete_session(state: State<'_, AppState>, session_id: Uuid) -> Result<(), String> {
    sqlx::query("DELETE FROM sessions WHERE id = $1")
        .bind(session_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    state.process_manager.shutdown_for(session_id).await;
    Ok(())
}

#[tauri::command]
pub async fn rename_session(state: State<'_, AppState>, session_id: Uuid, name: String) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("session name cannot be empty".into());
    }
    sqlx::query("UPDATE sessions SET name = $1 WHERE id = $2")
        .bind(name)
        .bind(session_id)
        .execute(&state.db)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub async fn get_session_room(pool: &PgPool, session_id: Uuid) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar("SELECT room_id FROM sessions WHERE id = $1")
        .bind(session_id)
        .fetch_one(pool)
        .await
}
