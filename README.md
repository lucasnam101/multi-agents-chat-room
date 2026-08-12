# Agent Chat

> A local-first desktop workspace for orchestrating Claude Code, Codex, and Grok across real local projects.

**Agent Chat** is a native desktop application that brings multiple AI coding agents into one shared workspace.

Instead of running separate terminals and manually moving context between agents, you can connect a room to a local project, create independent conversations, assign work to different agents, let agents hand work to each other, and observe their activity in real time.

Currently supported agents:

* **Claude Code**
* **OpenAI Codex**
* **Grok**

The project is built around a simple idea:

> **What if AI coding agents could work together like a software engineering team?**

One agent can investigate. Another can implement. Another can review. Another can fix the result.

And the developer can observe and control the entire workflow from one desktop workspace.

---

## ✨ Features

### 🤖 Multi-Agent Workspace

Run multiple coding agents against the same local project.

```text
┌───────────────────────────────────────────────┐
│                 Agent Chat                    │
│                                               │
│  Project: my-project                          │
│                                               │
│  @claude   Analyze the authentication flow    │
│  @codex    Implement the required changes    │
│  @grok     Review the implementation          │
│                                               │
└───────────────────────────────────────────────┘
```

Each agent operates through its own CLI/runtime while Agent Chat provides the shared coordination layer.

---

### 🧑‍💻 Project-Aware Rooms

Every room is connected to a real folder on your machine.

```text
Room
├── Project folder
├── Sessions
├── Messages
├── Agent configuration
├── Model configuration
└── Shared context
```

This means agents work directly with the actual project instead of an isolated chat environment.

Typical use cases include:

* Feature implementation
* Bug investigation
* Refactoring
* Code review
* Test generation
* Debugging
* Architecture analysis
* Research → implementation workflows
* Having one agent review another agent's changes

---

### 💬 Multiple Sessions per Project

A single project can contain multiple independent conversations.

For example:

```text
my-project
│
└── Agent Chat
    ├── Authentication
    ├── Checkout
    ├── Performance investigation
    ├── Bug #142
    └── Refactoring
```

Sessions can be:

* Created
* Renamed
* Deleted
* Independently configured
* Resumed after agent process restarts

Sessions are automatically titled from the initial conversation.

---

### 🔄 Persistent Agent Sessions

Agent Chat keeps track of the **native ACP session** created by each agent.

This means an application session can be associated with different underlying agent sessions:

```text
Agent Chat Session
│
├── Claude → ACP Session A
├── Codex  → ACP Session B
└── Grok   → ACP Session C
```

When an agent process is restarted, or an idle process is torn down, Agent Chat can attempt to restore the previous native session using `session/load`.

```text
Existing session
       │
       ▼
  Process restart
       │
       ▼
  session/load
       │
   ┌───┴────┐
   │        │
Success   Failure
   │        │
Resume   session/new
```

If the underlying adapter cannot resume the session, Agent Chat falls back to creating a new session.

This keeps the application's conversation history separate from the agent runtime while still allowing native agent sessions to survive process lifecycle events.

---

### 🔀 Agent Handoff

Agents can delegate work to each other using `@mentions`.

For example:

```text
You
 │
 │ @claude Analyze the authentication flow
 ▼
Claude
 │
 │ @codex Implement the fix and add tests
 ▼
Codex
 │
 │ @grok Review the implementation
 ▼
Grok
 │
 │ @claude Fix the issues found in the review
 ▼
Claude
```

This enables workflows such as:

```text
Research
   ↓
Implement
   ↓
Review
   ↓
Fix
   ↓
Test
```

The developer can explicitly control which agent receives each task.

Agent-to-agent handoff chains are limited to prevent accidental infinite loops.

---

### 🧠 Automatic Orchestration

Messages without an explicit agent mention can be routed through an orchestrator.

For example:

```text
You:
"Find the cause of the checkout bug and fix it."
```

Instead of requiring the developer to choose an agent manually, the orchestrator can determine which agent should handle the request.

Conceptually:

```text
                    User
                      │
                      ▼
               ┌─────────────┐
               │ Orchestrator│
               └──────┬──────┘
                      │
             ┌────────┼────────┐
             ▼        ▼        ▼
          Claude    Codex     Grok
```

The orchestrator is implemented as part of the agent workflow rather than requiring a separate hosted LLM service.

---

### ⚡ Real-Time Agent Activity

Agent responses are streamed into the application as they happen.

Agent activity can include:

* Streaming responses
* Tool calls
* Tool results
* Subagent activity
* Intermediate execution events
* Agent status changes

A dedicated activity view keeps execution details visible without making the main conversation difficult to follow.

---

### 🧰 Tool-Aware Conversations

The application is designed around coding agents rather than simple text-only chat.

Agents can perform real development work through their underlying CLI environments, including operations such as:

```text
Read files
Write files
Run commands
Inspect project structure
Run tests
Modify source code
Review changes
```

Agent Chat acts as the coordination and visualization layer around those capabilities.

---

### 🗜️ Context Compaction

Long-running coding sessions can eventually become too large for an agent's context window.

Agent Chat supports configurable context budgets and rolling-summary compaction.

```text
Original conversation
│
├── Message 1
├── Message 2
├── Message 3
├── ...
├── Message 100
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

Older conversation history can be summarized while keeping recent messages available to the agent.

This allows long-running development sessions to continue without continuously expanding the active context.

---

### 📎 Attachments

Messages can include additional project context.

Supported attachment flows include:

* Images
* Files
* Resource references

Images can be passed as multimodal content while files can be exposed to agents as resources.

---

### 🎛️ Agent & Model Configuration

Agent behavior can be configured at multiple levels.

The application supports configuration for:

* Agent defaults
* Room-level models
* Session-level models
* Orchestrator models
* Chat preferences

Each room can therefore have its own agent configuration without affecting other projects.

---

### 🎨 Native Desktop Experience

Agent Chat is designed as a desktop developer tool rather than a browser-only chat application.

The UI includes:

* Room sidebar
* Session switcher
* Streaming chat
* Agent indicators
* Activity panel
* Settings
* Light/dark themes
* Adjustable chat font size
* Native project/folder selection

The frontend runs inside a Tauri desktop application.

---

# 🤖 Supported Agents

| Agent       | Runtime          | Integration |
| ----------- | ---------------- | ----------- |
| Claude Code | Claude CLI       | ACP         |
| Codex       | Codex CLI        | ACP         |
| Grok        | Grok CLI / Build | ACP         |

Agent integrations are intentionally isolated so additional coding agents can be added without redesigning the entire application.

---

# 🏗️ Architecture

Agent Chat uses a hybrid **React + TypeScript + Rust + Tauri** architecture.

```text
┌─────────────────────────────────────────────────────────┐
│                     Agent Chat                          │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │              React + TypeScript                   │  │
│  │                                                   │  │
│  │  Rooms · Sessions · Chat · Settings · Activity   │  │
│  └───────────────────────┬───────────────────────────┘  │
│                          │                              │
│                       Tauri IPC                         │
│                          │                              │
│  ┌───────────────────────▼───────────────────────────┐  │
│  │                    Rust / Tauri                   │  │
│  │                                                   │  │
│  │  Commands                                         │  │
│  │  ACP Client                                       │  │
│  │  Process Manager                                  │  │
│  │  Orchestrator                                     │  │
│  │  Database                                          │  │
│  │  System Context                                    │  │
│  └───────────────┬───────────────┬───────────────────┘  │
│                  │               │                      │
│                  │ ACP           │                      │
│                  │               │                      │
│          ┌───────▼──────┐ ┌─────▼──────┐               │
│          │ Claude Code  │ │   Codex    │               │
│          │     CLI      │ │    CLI     │               │
│          └──────────────┘ └────────────┘               │
│                  │                                      │
│                  │                                      │
│          ┌───────▼──────┐                               │
│          │     Grok     │                               │
│          │     CLI      │                               │
│          └──────────────┘                               │
│                                                         │
│                ┌────────────────┐                       │
│                │   PostgreSQL   │                       │
│                │     Docker     │                       │
│                └────────────────┘                       │
└─────────────────────────────────────────────────────────┘
```

---

## Agent Communication

Agent Chat does not directly implement the model APIs for each provider.

Instead, it communicates with coding agents through the **Agent Client Protocol (ACP)** and their CLI runtimes.

```text
                    Agent Chat
                        │
              ┌─────────┼─────────┐
              │         │         │
              ▼         ▼         ▼
           Claude     Codex      Grok
            ACP        ACP       ACP
              │         │         │
              ▼         ▼         ▼
           Claude     Codex      Grok
            CLI        CLI       CLI
```

This approach keeps provider-specific runtime logic outside the React application.

---

## ACP Compatibility

Different agent adapters can expose different ACP versions and capabilities.

Agent Chat keeps those differences inside the ACP layer.

For example, the current Grok integration uses a different initialization/authentication flow from Claude and Codex, so the Grok handshake is isolated from the standard ACP initialization path.

Model discovery also handles different locations used by adapters to expose available models.

This makes the ACP layer responsible for normalizing provider-specific behavior before exposing it to the rest of the application.

---

# 🔐 Authentication

Agent Chat is designed to work with the agents' existing authentication mechanisms.

### Claude Code

Authenticate through the Claude CLI:

```bash
claude login
```

### Codex

Authenticate through the Codex CLI:

```bash
codex login
```

### Grok

Authenticate through the Grok CLI:

```bash
grok login
```

Grok can also use an `XAI_API_KEY` when the available authentication method supports it.

Agent Chat does not require users to paste provider credentials into the chat interface.

Provider-specific authentication is handled by the underlying agent CLI / ACP adapter.

---

# 🧱 Tech Stack

## Frontend

* React 19
* TypeScript
* Vite
* Tailwind CSS
* React Markdown
* Shiki

## Desktop

* Tauri 2
* Rust
* WebView

## Backend

* Rust
* Tokio
* Tauri Commands
* Agent Client Protocol
* JSON-RPC

## Database

* PostgreSQL
* SQLx
* Docker Compose
* SQL migrations

## AI Agents

* Claude Code
* OpenAI Codex
* Grok

---

# 📁 Project Structure

```text
multi-agents-chat-room/
│
├── src/
│   ├── assets/
│   │
│   ├── components/
│   │   ├── ActivityThread.tsx
│   │   ├── ChatView.tsx
│   │   ├── CreateRoomDialog.tsx
│   │   ├── InAppBrowser.tsx
│   │   ├── MessageBubble.tsx
│   │   ├── Modal.tsx
│   │   ├── RoomList.tsx
│   │   ├── RoomSettingsPanel.tsx
│   │   ├── SessionDropdown.tsx
│   │   ├── SettingsPanel.tsx
│   │   ├── ThemeToggle.tsx
│   │   ├── TypingIndicator.tsx
│   │   └── icons.tsx
│   │
│   ├── lib/
│   │   ├── i18n.tsx
│   │   ├── imageCompression.ts
│   │   ├── tauriApi.ts
│   │   └── useTheme.ts
│   │
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
│
├── src-tauri/
│   │
│   ├── src/
│   │   ├── acp/
│   │   │   ├── client.rs
│   │   │   └── process.rs
│   │   │
│   │   ├── commands/
│   │   │   ├── agents.rs
│   │   │   ├── chat.rs
│   │   │   └── rooms.rs
│   │   │
│   │   ├── orchestrator/
│   │   │   └── mention_router.rs
│   │   │
│   │   ├── db.rs
│   │   ├── system_context.rs
│   │   ├── lib.rs
│   │   └── main.rs
│   │
│   ├── migrations/
│   │   ├── 0001_init.sql
│   │   ├── 0002_model_settings.sql
│   │   ├── ...
│   │   ├── 0010_message_model.sql
│   │   ├── 0011_grok_agent.sql
│   │   └── 0012_agent_session_resume.sql
│   │
│   ├── capabilities/
│   ├── icons/
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── scripts/
│   ├── win-dev-start.ps1
│   ├── win-dev-stop.ps1
│   └── run-app.ps1
│
├── skills/
│   └── image-compression/
│
├── public/
│
├── .env.example
├── docker-compose.yml
├── index.html
├── package.json
├── postcss.config.js
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
└── README.md
```

### Frontend

The `src/` directory contains the React application.

The main responsibilities are:

* Room management
* Session management
* Chat rendering
* Agent state
* Activity visualization
* Settings
* Theme
* Tauri API integration

The frontend communicates with the Rust backend through Tauri IPC.

### Rust Backend

The `src-tauri/src/` directory contains the desktop application's backend.

| Module              | Responsibility                                |
| ------------------- | --------------------------------------------- |
| `acp/`              | ACP communication and agent process lifecycle |
| `commands/`         | Tauri commands exposed to the frontend        |
| `orchestrator/`     | Agent routing, mentions and orchestration     |
| `db.rs`             | PostgreSQL access                             |
| `system_context.rs` | Project/system context                        |
| `lib.rs`            | Tauri application setup                       |
| `main.rs`           | Application entry point                       |

### Database

Database migrations are stored under:

```text
src-tauri/migrations/
```

The schema contains persistent application state for:

* Rooms
* Sessions
* Messages
* Agent configuration
* Model configuration
* Attachments
* Chat preferences
* Room ordering
* Orchestrator configuration
* Native ACP session mappings

---

# 🚀 Getting Started

## Prerequisites

Install the following:

* Node.js
* npm
* Rust stable
* Docker Desktop
* Platform-specific Rust build tools
* Claude Code CLI
* Codex CLI
* Grok CLI

### Windows

Windows development also requires:

* Visual Studio Build Tools
* C++ workload
* CMake

---

## 1. Clone the repository

```bash
git clone https://github.com/lucasnam101/multi-agents-chat-room.git

cd multi-agents-chat-room
```

---

## 2. Install dependencies

```bash
npm install
```

---

## 3. Configure environment

Create a local environment file:

```bash
cp .env.example .env
```

The default local database is configured for:

```text
DATABASE_URL=postgres://agentchat:agentchat_dev@127.0.0.1:5433/agentchat
```

---

## 4. Start PostgreSQL

Start the local database:

```bash
docker compose up -d
```

PostgreSQL is exposed locally on:

```text
127.0.0.1:5433
```

Database migrations are applied automatically when the application starts.

---

## 5. Authenticate your agents

Authenticate the coding agents you want to use.

```bash
claude login
codex login
grok login
```

You do not necessarily need all three agents enabled to run the application.

---

## 6. Install ACP adapters

Install the Claude Code and Codex ACP adapters:

```bash
npm install -g @agentclientprotocol/codex-acp @agentclientprotocol/claude-agent-acp
```

Grok uses its own CLI/ACP integration.

---

# 🛠️ Development

## Start the frontend

```bash
npm run dev
```

For full desktop development, use the Windows development script:

```powershell
scripts\win-dev-start.ps1
```

This starts the required local services and the Tauri application.

To stop the development environment:

```powershell
scripts\win-dev-stop.ps1
```

The PostgreSQL volume is preserved when the development environment is stopped.

---

# 🔍 Type Checking

Before creating a release build, run:

```bash
npx tsc --noEmit
```

Then check the Rust backend:

```bash
cd src-tauri

cargo check
```

This catches most frontend and Rust compilation issues before the final build.

---

# 📦 Production Build

Build the application with:

```bash
npm run build:release
```

The release build performs the frontend build and creates the standalone Tauri application.

The Rust release build uses:

```text
--features custom-protocol
```

The `custom-protocol` feature is important for standalone Tauri builds because it embeds the compiled frontend into the desktop binary.

On Windows, the resulting executable is generated under:

```text
src-tauri/target/release/
```

---

# 🪟 Windows Development Notes

When rebuilding the Rust application on Windows, make sure an old `agentchat.exe` process is not still running.

A running executable can lock the binary and cause errors such as:

```text
Access is denied (os error 5)
```

Recommended development sequence:

```text
1. TypeScript check
2. Cargo check
3. Stop previous Agent Chat process
4. Build frontend
5. Build Rust with custom-protocol
6. Launch the new binary
```

---

# 🗃️ Database

Agent Chat uses PostgreSQL for persistent local application state.

Migrations are located at:

```text
src-tauri/migrations/
```

Migrations are automatically applied during application startup.

The schema currently covers areas including:

* Rooms
* Sessions
* Messages
* Model settings
* Agent configuration
* Orchestrator configuration
* Attachments
* Chat preferences
* Room ordering
* Agent ACP sessions

The ACP session mapping is particularly important for native session resume:

```text
agent_acp_sessions
│
├── session_id
├── agent_kind
├── acp_session_id
└── updated_at
```

This allows one Agent Chat session to maintain the native session identifier of each agent.

---

# 🔄 Example Workflow

A typical development workflow could look like this:

```text
┌──────────┐
│ Developer│
└────┬─────┘
     │
     │ "Investigate the checkout bug"
     ▼
┌──────────┐
│  Claude  │
└────┬─────┘
     │
     │ @codex
     │ "Implement the fix"
     ▼
┌──────────┐
│  Codex   │
└────┬─────┘
     │
     │ @grok
     │ "Review the implementation"
     ▼
┌──────────┐
│   Grok   │
└────┬─────┘
     │
     │ @claude
     │ "Fix the review findings"
     ▼
┌──────────┐
│  Claude  │
└────┬─────┘
     │
     ▼
  Developer
```

The agents share the same project workspace while maintaining their own underlying sessions.

---

# 🧠 Design Principles

Agent Chat is built around several principles.

### 1. Agents are collaborators, not isolated chatbots

The application treats coding agents as participants in a software engineering workflow.

### 2. The project is the source of truth

Agents operate against the real local project rather than a simulated workspace.

### 3. The developer stays in control

Agent execution remains visible and interactive.

The goal is not to hide automation behind a black box.

### 4. Provider-specific logic stays isolated

Claude, Codex and Grok have different runtimes and ACP behavior.

The ACP/process layer handles those differences so the rest of the application can work with a common agent model.

### 5. Sessions should survive process lifecycle events

The application stores the native ACP session identifier when possible and attempts to resume it when an agent process is recreated.

---

# 🗺️ Roadmap

Potential future directions include:

* [ ] Additional coding agents
* [ ] Parallel agent execution
* [ ] More sophisticated orchestration
* [ ] Configurable agent roles
* [ ] Custom agent workflows
* [ ] Better task delegation
* [ ] Agent performance analytics
* [ ] Token / cost tracking
* [ ] Conversation export/import
* [ ] Git-aware workflows
* [ ] Git diff integration
* [ ] Cross-platform release automation
* [ ] More granular agent permissions
* [ ] Improved multi-agent planning
* [ ] Agent workflow visualization

---

# ⚠️ Current Status

Agent Chat is an **experimental project under active development**.

The architecture and agent integrations may change as the project evolves.

Potential rough edges include:

* ACP compatibility between different agent versions
* CLI process lifecycle
* Native session resume
* Agent-to-agent handoff
* Long-running sessions
* Context compaction
* Provider authentication differences
* Platform-specific desktop behavior

Use it with projects where you can safely inspect and revert AI-generated changes.

---

# 💡 Why Agent Chat?

Modern coding agents are becoming increasingly capable.

But the typical workflow still looks like this:

```text
Terminal 1 → Claude
Terminal 2 → Codex
Terminal 3 → Grok
Terminal 4 → Developer
```

The developer becomes the communication layer between the agents.

Agent Chat explores a different approach:

```text
                    Developer
                        │
                        ▼
                ┌───────────────┐
                │  Agent Chat   │
                └───────┬───────┘
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
       Claude          Codex         Grok
          │             │             │
          └─────────────┼─────────────┘
                        │
                  Same project
```

The application becomes the coordination layer.

One agent can investigate.

One can implement.

One can review.

One can fix.

The developer can see the entire process.

That is the core idea behind Agent Chat:

> **Make multi-agent software development collaborative, observable, and controllable.**

---

# 📄 License

License information will be added as the project matures.

---

## Project

**Agent Chat**
A local-first desktop workspace for multi-agent software development.

Supported agents:

**Claude Code · OpenAI Codex · Grok**
