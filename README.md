# Agent Chat

A native desktop app for running **Claude Code** and **Codex** side by side in a shared chat, against real local project folders — driven entirely through their CLIs (subscription login, no API keys).

Each *room* is bound to one folder on disk. Inside a room you can hold several independent conversations (*sessions*), `@mention` either agent to hand it a turn, and let agents `@mention` each other to chain work automatically. Everything — tool calls, subagent activity, streaming replies — is visible in the UI as it happens.

## Features

- **Two agents, one thread** — tag `@claude` / `@codex` into a message (yours or theirs) to hand off a turn. Chains are capped at 5 hops to avoid runaway loops.
- **No agent mentioned? No problem** — a lightweight orchestrator (also just a CLI session, no API key) answers directly instead of the message going nowhere.
- **Multiple sessions per room** — like the Claude Code VS Code extension's chat switcher. Sessions auto-title themselves from your first message and can be renamed, created, or deleted independently.
- **Live streaming** — replies, tool calls, and subagent activity stream in as they happen, with a dedicated side panel to inspect tool/subagent output without cluttering the main thread.
- **Attachments** — drop in images (sent as real multimodal content) or files (sent as resource references) alongside a message.
- **Context budget + rolling summary compaction** — a per-conversation token budget (configurable) triggers an asymmetric summary compaction pass so long-running sessions don't blow past an agent's context window.
- **Per-room and per-session controls** — override the default model per room, per session, or for the orchestrator; start/stop an agent's process explicitly instead of always keeping it warm.
- **Light/dark theme, adjustable message font size.**
- Runs **entirely locally** — Postgres in Docker, no network calls beyond what the `claude`/`codex` CLIs themselves make.

## Prerequisites

- **Rust** stable toolchain + platform build tools (on Windows: Visual Studio Build Tools with the C++ workload, plus `cmake`).
- **Node.js** (npm).
- **Docker Desktop** (for the local Postgres instance).
- The `claude` and `codex` CLIs installed and already logged in:
  ```bash
  claude login
  codex login
  ```
  This app never asks for or stores API keys — it only drives these two already-authenticated CLIs.
- The ACP adapters, installed globally:
  ```bash
  npm install -g @agentclientprotocol/codex-acp @agentclientprotocol/claude-agent-acp
  ```

## Getting started

```bash
npm install
cp .env.example .env          # DATABASE_URL for the local Postgres container
docker compose up -d          # starts Postgres on 127.0.0.1:5433
```

Then, for day-to-day development:

```powershell
scripts\win-dev-start.ps1     # brings up Postgres, Vite, and `cargo run`
scripts\win-dev-stop.ps1      # tears it all down (data is preserved)
```

Database migrations run automatically on startup — there's nothing to run by hand.

## Building a standalone release

```bash
npm run build:release
```

This builds the frontend and then the Rust binary **with the `custom-protocol` feature** (`src-tauri/target/release/agentchat.exe`), which embeds the built UI instead of trying to reach a Vite dev server. `scripts/run-app.ps1` (and the desktop shortcut it's wired to) launches that binary directly, ensuring Postgres is up first.

> Building without `--features custom-protocol` produces a binary that still expects a running Vite dev server — don't use plain `cargo build --release` for anything meant to run standalone.

## Project structure

```
src/                      React + TypeScript frontend
  components/             Room list, chat view, message bubbles, settings, etc.
  lib/                     Typed wrappers around Tauri's invoke()/listen()
src-tauri/
  src/
    acp/                   ACP JSON-RPC client + process lifecycle for the CLIs
    commands/              Tauri commands (rooms, sessions, chat, agent/model settings)
    orchestrator/           @mention routing + rolling-summary compaction
    db.rs                  sqlx pool + automatic migrations
  migrations/              Postgres schema, applied automatically on startup
scripts/                  Dev start/stop and standalone-launch scripts
docker-compose.yml         Local Postgres
```

## Tech stack

Tauri 2 (Rust + WebView) · React + TypeScript + Vite · Tailwind CSS · Postgres via `sqlx` · Claude Code / Codex CLIs via the Agent Client Protocol (ACP).
