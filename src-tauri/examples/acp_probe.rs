//! Headless proof that the ACP mechanism works end to end against a real
//! `codex-acp` subprocess, before any UI wiring. Run with:
//!   cargo run --example acp_probe -- <cwd>

use agentchat_lib::acp::{AcpClient, AgentKind};

#[tokio::main]
async fn main() {
    let cwd = std::env::args().nth(1).unwrap_or_else(|| ".".to_string());
    let cwd = std::fs::canonicalize(&cwd).unwrap().to_string_lossy().to_string();
    println!("spawning codex-acp in {cwd}");

    let mut client = AcpClient::spawn(AgentKind::Codex.command(), &[], &cwd)
        .await
        .expect("failed to spawn codex-acp");

    let init = client.initialize().await.expect("initialize failed");
    println!("initialize response: {init}");

    let session = client
        .session_new(&cwd, None)
        .await
        .expect("session/new failed");
    println!("session id: {}", session.session_id);
    let models = agentchat_lib::acp::client::extract_models(&session.raw);
    println!("available models: {models:?}");

    println!("--- sending prompt ---");
    let stop_reason = client
        .session_prompt(&session.session_id, "list the files in this folder", |update| {
            println!("update: {update:?}");
        })
        .await
        .expect("session/prompt failed");
    println!("stop reason: {stop_reason:?}");

    client.shutdown().await;
}
