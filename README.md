# Agent Chat

> A local-first desktop workspace for orchestrating multiple AI coding agents in the same project.

**Agent Chat** is a native desktop application that brings **Claude Code** and **Codex** into a shared, persistent chat workspace.

Instead of opening separate terminals and manually coordinating different AI coding agents, Agent Chat lets you connect a room to a real local project, start multiple independent sessions, and route work between agents using `@mentions`.

For example:

```text
You
 │
 ├── @claude  → Claude Code
 │                 │
 │                 └── @codex → Codex
 │                              │
 │                              └── @claude → Claude Code
 │
 └── Shared local project
```

The application is designed around a simple idea:

**Let multiple coding agents collaborate on the same codebase while keeping the entire workflow visible to the developer.**

---

## ✨ Features

### 🤖 Multi-Agent Chat

Run **Claude Code** and **Codex** inside the same conversation.

Mention an agent directly:

```text
@claude Analyze the authentication flow and identify potential issues.
```

or:

```text
@codex Implement the fix described above.
```

Agents can also mention each other, allowing work to move between agents automatically.

Agent-to-agent chains are limited to **5 hops** to prevent accidental infinite loops.

---

### 🧑‍💻 Project-Aware Rooms

Each room is associated with a real folder on your local machine.

This means agents operate against an actual project workspace instead of an isolated virtual conversation.

```text
Room
 ├── Project folder
 ├── Sessions
 ├── Messages
 ├── Agent configuration
 └── Model configuration
```

This makes the application suitable for real development workflows such as:

* debugging an existing project
* implementing features
* refactoring
* code review
* investigating bugs
* asking one agent to review another agent's work

---

### 💬 Multiple Sessions per Room

A single project can contain multiple independent conversations.

For example:

```text
my-project/
│
└── Agent Chat Room
    ├── Authentication
    ├── Payment integration
    ├── Bug investigation
    └── Refactoring
```

Sessions can be:

* created
* renamed
* deleted
* independently configured

Sessions are automatically titled based on the initial conversation.

---

### ⚡ Real-Time Streaming

Agent responses are streamed into the UI as they happen.

The application also exposes agent activity such as:

* tool calls
* subagent activity
* intermediate output
* streaming responses

A dedicated activity panel allows you to inspect these details without overwhelming the main conversation.

---

### 🔄 Agent Handoff

Agents can explicitly hand work to another agent.

For example:

```text
Claude:
I found the problem in the authentication middleware.

@codex Please implement the fix and add tests.
```

Codex can then continue from the same project context.

This enables workflows such as:

```text
Research → Implement → Review → Fix → Test
```

using different agents for different stages.

---

### 🧠 Automatic Orchestration

If a message does not explicitly mention an agent, Agent Chat can route it through a lightweight orchestrator session.

This prevents messages from becoming dead ends when no specific agent was selected.

The orchestrator itself is also driven through a CLI session rather than requiring a separate API key.

---

### 🗜️ Context Management

Long-running conversations can eventually exceed an agent's context window.

Agent Chat provides a configurable context budget and rolling-summary compaction mechanism.

When a conversation becomes too large, older context can be summarized and compacted before continuing.

Conceptually:

```text
Original conversation

Message 1
Message 2
Message 3
...
Message 100
       │
       ▼
 Context compaction
       │
       ▼
Summary + recent messages
       │
       ▼
Continue conversation
```

This allows sessions to remain useful over longer development tasks without continuously growing the prompt.

---

### 📎 Attachments

Messages can include additional project context through attachments.

Supported attachment types include:

* images
* files

Images are sent as multimodal content, while files are provided to agents as resource references.

---

### 🎛️ Model & Session Controls

Agent configuration can be controlled at different levels.

You can configure:

* default agent behavior
* room-level models
* session-level models
* orchestrator models

Agent processes can also be started and stopped explicitly instead of remaining active permanently.

---

### 🎨 Desktop UI

Agent Chat provides a native desktop interface with:

* light/dark themes
* adjustable chat font size
* room sidebar
* session switcher
* streaming chat
* agent activity panel
* settings

The frontend is built with React and runs inside a Tauri desktop application.

---

## 🏗️ Architecture

Agent Chat uses a hybrid **React + Rust/Tauri** architecture.

```text
┌─────────────────────────────────────────────┐
│                  Agent Chat                 │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │          React / TypeScript            │  │
│  │                                       │  │
│  │  Rooms · Sessions · Chat · Settings   │  │
│  └──────────────────┬────────────────────┘  │
│                     │ Tauri IPC              │
│  ┌──────────────────▼────────────────────┐  │
│  │              Rust / Tauri             │  │
│  │                                       │  │
│  │  Commands                             │  │
│  │  Orchestrator                         │  │
│  │  ACP Client                            │  │
│  │  Process Lifecycle                     │  │
│  │  Database                              │  │
│  └───────┬───────────────┬───────────────┘  │
│          │               │                  │
│          │               │ ACP              │
│          │               ▼                  │
│          │       ┌───────────────┐          │
│          │       │ Claude / Codex│          │
│          │       │     CLIs      │          │
│          │       └───────────────┘          │
│          │                                  │
│          ▼                                  │
│   ┌───────────────┐                         │
│   │  PostgreSQL   │                         │
│   │    Docker     │                         │
│   └───────────────┘                         │
└─────────────────────────────────────────────┘
```

### Agent Communication

Agent Chat does **not** directly implement the Claude or Codex model APIs.

Instead, it drives their existing CLI applications through the **Agent Client Protocol (ACP)**.

```text
Agent Chat
    │
    ├── Claude Agent ACP
    │       │
    │       └── claude CLI
    │
    └── Codex ACP
            │
            └── codex CLI
```

This allows the application to work with the user's existing CLI authentication.

**No provider API keys are stored by Agent Chat.**

---

## 🔐 Authentication & Privacy

Agent Chat relies on the user's existing authenticated CLI sessions.

You must authenticate the CLIs yourself:

```bash
claude login
codex login
```

The application then communicates with those CLI processes through ACP.

It does **not** ask you to enter or store Claude/OpenAI API keys.

The application itself runs locally, with PostgreSQL also running locally through Docker. Network communication is performed by the underlying `claude` and `codex` CLIs.

---

## 🧱 Tech Stack

### Frontend

* React 19
* TypeScript
* Vite
* Tailwind CSS
* React Markdown
* Shiki

### Desktop

* Tauri 2
* Rust
* WebView

### Backend

* Rust
* Tokio
* Tauri commands
* Agent Client Protocol
* JSON-RPC based agent communication

### Database

* PostgreSQL
* SQLx
* Docker Compose
* Automatic migrations

### AI Agents

* Claude Code
* Codex

---

## 📁 Project Structure

```text
multi-agents-chat-room/
│
├── src/
│   ├── assets/
│   ├── components/
│   │   ├── ...
│   │   └── ...
│   ├── lib/
│   │   └── Tauri API wrappers
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
│
├── src-tauri/
│   ├── src/
│   │   ├── acp/
│   │   │   └── ACP client and CLI process lifecycle
│   │   │
│   │   ├── commands/
│   │   │   └── Tauri commands
│   │   │
│   │   ├── orchestrator/
│   │   │   └── agent routing and context compaction
│   │   │
│   │   ├── db.rs
│   │   ├── system_context.rs
│   │   ├── lib.rs
│   │   └── main.rs
│   │
│   ├── migrations/
│   │   ├── 0001_init.sql
│   │   ├── 0002_model_settings.sql
│   │   ├── 0003_orchestrator_author.sql
│   │   ├── 0005_sessions.sql
│   │   ├── 0006_attachments.sql
│   │   ├── 0007_chat_font_size.sql
│   │   ├── 0008_room_orchestrator_model.sql
│   │   ├── 0009_room_ordering.sql
│   │   └── 0010_message_model.sql
│   │
│   └── Cargo.toml
│
├── scripts/
│   ├── win-dev-start.ps1
│   ├── win-dev-stop.ps1
│   └── run-app.ps1
│
├── docker-compose.yml
├── .env.example
├── package.json
├── vite.config.ts
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

Before running Agent Chat, install:

* Node.js
* npm
* Rust stable
* Docker Desktop
* Platform-specific Rust build tools

On Windows, you need:

* Visual Studio Build Tools
* C++ workload
* CMake

You also need the following CLIs installed and authenticated:

```bash
claude login
codex login
```

---

### Install ACP Adapters

Install the Claude Code and Codex ACP adapters globally:

```bash
npm install -g @agentclientprotocol/codex-acp @agentclientprotocol/claude-agent-acp
```

---

### Clone the Repository

```bash
git clone https://github.com/lucasnam101/multi-agents-chat-room.git

cd multi-agents-chat-room
```

---

### Install Dependencies

```bash
npm install
```

---

### Configure Environment

Create your local environment file:

```bash
cp .env.example .env
```

The default database configuration is:

```env
DATABASE_URL=postgres://agentchat:agentchat_dev@127.0.0.1:5433/agentchat
```

---

### Start PostgreSQL

Start the local PostgreSQL container:

```bash
docker compose up -d
```

PostgreSQL is exposed only on:

```text
127.0.0.1:5433
```

Database migrations are applied automatically when the application starts.

---

## 🛠️ Development

### Frontend

Start the Vite development server:

```bash
npm run dev
```

For full desktop development, the project includes a Windows development script:

```powershell
scripts\win-dev-start.ps1
```

This starts:

* PostgreSQL
* Vite
* Tauri/Rust application

To stop the development environment:

```powershell
scripts\win-dev-stop.ps1
```

The PostgreSQL data volume is preserved when the development environment is stopped.

---

## 🔍 Type Checking

Before building, it is recommended to run:

```bash
npx tsc --noEmit
```

and:

```bash
cd src-tauri
cargo check
```

This catches frontend and Rust compilation issues before creating a release build.

---

## 📦 Building a Release

Build the frontend and standalone Rust application with:

```bash
npm run build:release
```

Internally this performs:

```bash
npm run build
```

followed by:

```bash
cargo build --release --features custom-protocol
```

The `custom-protocol` feature is important for standalone builds because it embeds the compiled frontend into the Tauri binary.

Without it, the release binary may still try to load the UI from the Vite development server.

The resulting Windows binary is located at:

```text
src-tauri/target/release/agentchat.exe
```

---

## 🔄 How Agent Handoff Works

The central workflow is based on `@mentions`.

### Developer → Agent

```text
@claude Investigate why the login endpoint returns 401.
```

### Agent → Agent

Claude may then delegate:

```text
@codex Implement the fix and add regression tests.
```

Codex performs the implementation and can hand the result back:

```text
@claude Review the implementation and check the tests.
```

This creates a collaborative chain:

```text
Developer
    │
    ▼
 Claude
    │
    │ @codex
    ▼
 Codex
    │
    │ @claude
    ▼
 Claude
```

The system limits automatic handoff chains to **5 hops** to prevent runaway execution.

---

## 🧠 Context Compaction

Long conversations are handled using a rolling-summary strategy.

Instead of allowing every historical message to remain in the active context indefinitely, Agent Chat can compact older conversation history into a summary while preserving recent messages.

This allows a session to continue operating over long development tasks while keeping the active context within the configured budget.

---

## 🗃️ Database

Agent Chat uses PostgreSQL for persistent application state.

The schema is managed through SQLx migrations located in:

```text
src-tauri/migrations/
```

Migrations are automatically applied at application startup.

Current migrations cover areas including:

* rooms
* model settings
* orchestrator configuration
* sessions
* attachments
* chat preferences
* room ordering
* message model metadata

No manual migration command is required for normal development.

---

## 🖥️ Windows Development Notes

When developing on Windows, make sure an old release process is not still running before rebuilding the Rust binary.

A running `agentchat.exe` can keep the executable locked and cause build errors such as:

```text
Access is denied (os error 5)
```

If necessary, identify the process and terminate the specific PID before rebuilding.

The recommended build sequence is:

```text
1. TypeScript check
2. Cargo check
3. Stop previous Agent Chat process
4. Build frontend
5. Build Rust with custom-protocol
6. Launch the new binary
```

---

## 🗺️ Roadmap

Potential areas for future development:

* [ ] Support additional coding agents
* [ ] More sophisticated agent orchestration strategies
* [ ] Configurable agent roles
* [ ] Parallel agent execution
* [ ] Improved task delegation
* [ ] Agent performance and token usage analytics
* [ ] Conversation export/import
* [ ] Git-aware development workflows
* [ ] Cross-platform release automation
* [ ] More granular permissions for agent actions

---

## 🎯 Why Agent Chat?

Modern coding agents are becoming increasingly capable, but most developer workflows still treat each agent as an isolated assistant.

Agent Chat explores another model:

> **What if coding agents could work together like a software engineering team?**

One agent can investigate.

Another can implement.

Another can review.

And the developer can observe the entire process from one shared workspace.

The goal is not to hide the agents behind an opaque automation layer, but to make **multi-agent software development observable, controllable, and interactive**.

---

## ⚠️ Current Status

Agent Chat is an experimental project and is currently under active development.

The architecture and agent workflow may change as the project evolves.

Expect rough edges, especially around:

* CLI process lifecycle
* ACP compatibility
* long-running agent sessions
* agent-to-agent handoff
* context management
* platform-specific desktop behavior

Use it with projects where you can safely inspect and revert agent-generated changes.

---

## 📄 License

License information will be added as the project matures.
