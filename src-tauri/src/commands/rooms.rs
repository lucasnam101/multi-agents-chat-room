use serde::Serialize;
use sqlx::PgPool;
use tauri::State;
use uuid::Uuid;

use crate::AppState;

#[derive(Serialize, sqlx::FromRow)]
pub struct Room {
    pub id: Uuid,
    pub name: String,
    pub folder_path: String,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct RoomAgentStatus {
    pub agent_kind: String,
    pub is_active: bool,
}

#[tauri::command]
pub async fn create_room(
    state: State<'_, AppState>,
    name: String,
    folder_path: String,
) -> Result<Room, String> {
    sqlx::query_as::<_, Room>(
        "INSERT INTO rooms (name, folder_path) VALUES ($1, $2) RETURNING id, name, folder_path",
    )
    .bind(name)
    .bind(folder_path)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_rooms(state: State<'_, AppState>) -> Result<Vec<Room>, String> {
    sqlx::query_as::<_, Room>("SELECT id, name, folder_path FROM rooms ORDER BY created_at DESC")
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tag_agent(
    state: State<'_, AppState>,
    room_id: Uuid,
    agent_kind: String,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO room_agents (room_id, agent_kind) VALUES ($1, $2)
         ON CONFLICT (room_id, agent_kind) DO NOTHING",
    )
    .bind(room_id)
    .bind(agent_kind)
    .execute(&state.db)
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// "Active" now means: at least one of this room's conversation sessions
/// currently has that agent kind running (the ACP process is keyed by
/// session, not room — see `acp::process::ProcessManager`).
#[tauri::command]
pub async fn room_agent_statuses(
    state: State<'_, AppState>,
    room_id: Uuid,
) -> Result<Vec<RoomAgentStatus>, String> {
    let tagged: Vec<String> =
        sqlx::query_scalar("SELECT agent_kind FROM room_agents WHERE room_id = $1")
            .bind(room_id)
            .fetch_all(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    let session_ids: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM sessions WHERE room_id = $1")
        .bind(room_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    let mut statuses = Vec::new();
    for kind_str in tagged {
        let kind = match kind_str.as_str() {
            "claude" => crate::acp::AgentKind::Claude,
            "codex" => crate::acp::AgentKind::Codex,
            _ => continue,
        };
        let mut is_active = false;
        for session_id in &session_ids {
            if state.process_manager.is_active(*session_id, kind).await {
                is_active = true;
                break;
            }
        }
        statuses.push(RoomAgentStatus {
            agent_kind: kind_str,
            is_active,
        });
    }
    Ok(statuses)
}

pub async fn get_room_folder(pool: &PgPool, room_id: Uuid) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("SELECT folder_path FROM rooms WHERE id = $1")
        .bind(room_id)
        .fetch_one(pool)
        .await
}

/// Fuzzy-ish (substring) match of relative file paths under a room's folder,
/// for the `@`-file-reference autocomplete in the chat input. Runs on a
/// blocking thread since `walkdir` is synchronous I/O.
#[tauri::command]
pub async fn list_room_files(
    state: State<'_, AppState>,
    room_id: Uuid,
    query: String,
) -> Result<Vec<String>, String> {
    let folder_path = get_room_folder(&state.db, room_id)
        .await
        .map_err(|e| e.to_string())?;
    let query_lower = query.to_lowercase();

    tauri::async_runtime::spawn_blocking(move || {
        const SKIP_DIRS: &[&str] = &[
            ".git", "node_modules", "target", "dist", "build", ".venv", "venv",
            "__pycache__", ".next", ".turbo", ".cache",
        ];
        const MAX_RESULTS: usize = 200;

        let base = std::path::Path::new(&folder_path);
        let mut results = Vec::new();
        for entry in walkdir::WalkDir::new(base)
            .into_iter()
            .filter_entry(|e| {
                e.depth() == 0 || !SKIP_DIRS.contains(&e.file_name().to_string_lossy().as_ref())
            })
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_dir() {
                continue;
            }
            let Ok(rel) = entry.path().strip_prefix(base) else {
                continue;
            };
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            if query_lower.is_empty() || rel_str.to_lowercase().contains(&query_lower) {
                results.push(rel_str);
                if results.len() >= MAX_RESULTS {
                    break;
                }
            }
        }
        results
    })
    .await
    .map_err(|e| e.to_string())
}
