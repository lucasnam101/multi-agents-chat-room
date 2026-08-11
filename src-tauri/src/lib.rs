pub mod acp;
pub mod commands;
pub mod db;
pub mod orchestrator;
pub mod system_context;

use std::sync::Arc;

use sqlx::PgPool;
use tauri::Manager;
use tokio::sync::{Mutex, oneshot};
use std::collections::HashMap;

use acp::ProcessManager;
use orchestrator::compaction::OrchestratorSession;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub process_manager: Arc<ProcessManager>,
    pub orchestrator: Arc<Mutex<Option<OrchestratorSession>>>,
    pub approvals: Arc<ApprovalStore>,
}

#[derive(Default)]
pub struct ApprovalStore {
    pub pending: Mutex<HashMap<String, oneshot::Sender<String>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Required before any rustls usage (sqlx's postgres+rustls TLS path) —
    // multiple crypto-provider backends are compiled in transitively and
    // rustls panics at first use without an explicit process-level default.
    let _ = rustls::crypto::ring::default_provider().install_default();
    dotenvy::dotenv().ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let pool = db::init_pool().await.expect("failed to connect to Postgres");
                let _ = db::recover_orphaned_placeholders(&pool).await;
                let process_manager = ProcessManager::new();

                let reaper = process_manager.clone();
                tokio::spawn(async move {
                    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
                    loop {
                        interval.tick().await;
                        reaper.reap_idle().await;
                    }
                });

                handle.manage(AppState {
                    db: pool,
                    process_manager,
                    orchestrator: Arc::new(Mutex::new(None)),
                    approvals: Arc::new(ApprovalStore::default()),
                });
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::rooms::create_room,
            commands::rooms::list_rooms,
            commands::rooms::tag_agent,
            commands::rooms::room_agent_statuses,
            commands::rooms::set_room_pinned,
            commands::rooms::reorder_rooms,
            commands::rooms::open_terminal,
            commands::rooms::delete_room,
            commands::agents::resolve_approval,
            commands::agents::cancel_turn,
            commands::rooms::list_room_files,
            commands::chat::list_messages,
            commands::chat::send_message,
            commands::agents::check_cli_status,
            commands::agents::get_orchestrator_kind,
            commands::agents::set_orchestrator_kind,
            commands::agents::list_models,
            commands::agents::get_model_settings,
            commands::agents::set_model_setting,
            commands::agents::get_room_model,
            commands::agents::set_room_model,
            commands::agents::get_context_budget,
            commands::agents::set_context_budget,
            commands::agents::get_room_context_usage,
            commands::agents::ensure_session_agents,
            commands::agents::stop_session_agents,
            commands::agents::session_agent_statuses,
            commands::agents::read_file_as_base64,
            commands::agents::get_chat_font_size,
            commands::agents::set_chat_font_size,
            commands::sessions::list_sessions,
            commands::sessions::create_session,
            commands::sessions::delete_session,
            commands::sessions::rename_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
