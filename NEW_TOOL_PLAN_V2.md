# Plan v2: local multi-agent dev chat — native desktop app

> Handoff doc for an implementing agent (assume Codex-tier capability — be
> extremely literal and follow steps in order, do not improvise
> architecture decisions that aren't explicitly left open at the bottom).
> This supersedes `NEW_TOOL_PLAN.md` (v1). **v1 was implemented as a web
> app and is unusable — folder picking and reliable CLI subprocess
> management require a native desktop app, not a browser.** Start a fresh
> project; do not try to convert the v1 web code.

---

## 1. What this app does (product spec, final)

- **Room = one local folder** (a project directory on disk). Created via a
  native OS folder picker.
- Inside a room, the user chats in a single shared thread. Two agent
  "workers" can be tagged into a room: **Claude Code** and **Codex**, each
  driven via their CLI (subscription login — `claude login` / `codex
  login` — **no API keys** for these two).
- **Cross-agent `@mention` chaining**: any message — from the user *or*
  from an agent's own reply — that contains `@claude` or `@codex` triggers
  that agent to take the next turn, using context assembled by the
  orchestrator (see §6). Example: user writes
  `@claude hãy lên plan cho task X, sau đó mention codex vào thực hiện
  plan` → Claude replies with a plan and includes `@codex ...` in its own
  reply → Codex is automatically invoked next with that handoff.
- Each agent's own ACP session handles **its own internal context/turn
  history natively** — do not reimplement this. The app-level compaction
  problem (§6) is a *separate, smaller* thing: keeping a lightweight
  rolling summary of the room so handoffs between agents (and respawned
  sessions) have enough context without re-reading the whole raw history.
- **No "thinking"/reasoning sharing between agents** — explicitly out of
  scope (confirmed with the user, not needed).
- **Native desktop app, not a web app.** Non-negotiable: needed for a
  reliable native folder picker and robust child-process/stdio management
  for the ACP adapters.
- Runs **entirely locally**, single user, no networking/auth beyond what
  Claude/Codex's own CLI login requires.

---

## 2. Technology stack (do not substitute without a strong reason)

| Layer | Choice | Why |
|---|---|---|
| App shell | **Tauri 2** (Rust backend + React/TypeScript frontend) | Native window, native folder picker, full control over child-process stdio from Rust. This machine already has the Rust/Windows toolchain needed (Visual Studio 2022 Build Tools + `cmake`) from a prior project — reuse it, don't reinvent. |
| Frontend | React + TypeScript + Vite (Tauri's default template) | Standard, fast dev loop. |
| Styling | Tailwind CSS | Fast to build a clean chat UI without hand-writing CSS. |
| Markdown/code rendering | `react-markdown` + `remark-gfm` + `remark-breaks`, `shiki` for code blocks | `remark-breaks` matters: without it, real newlines in agent replies won't render as line breaks. |
| Backend logic | Rust, inside `src-tauri` | Process spawning, ACP JSON-RPC client, DB access, orchestrator calls all live here; frontend only renders and sends user actions via Tauri commands/events. |
| Database | **Postgres via Docker** | Per explicit request — same pattern as the reference app (Buzz) this was scoped from. |
| DB access (Rust) | `sqlx` crate, `postgres` + `runtime-tokio-rustls` features | Async, compile-time-checked queries, works well with Tauri's async command handlers. |
| ACP adapters | `codex-acp` and `claude-agent-acp` (npm packages) | Same adapters the reference app (Buzz) uses. Wrap the `codex` / `claude` CLIs respectively. |
| Orchestrator (compaction only) | **No API key, no external LLM API.** Routed through a dedicated Claude Code / Codex CLI **ACP session** (see §6.0) — same mechanism as the room agents, just a separate utility session. Model is **not hardcoded**: queried dynamically from the CLI each time (see §6.0). | Mention-routing itself needs **no LLM at all** (plain text matching) — only the rolling-summary compaction step needs a model call, and it goes through the CLI like everything else, per explicit user requirement: no API keys anywhere in this app. |

---

## 3. Project structure

Create a new folder (sibling to `buzz`, e.g. `D:\My projects\agent-chat`).
Scaffold with:

```bash
cd "D:\My projects"
npm create tauri-app@latest agent-chat -- --template react-ts
cd agent-chat
```

Target structure after scaffolding + this plan's additions:

```
agent-chat/
  src/                          # React frontend
    components/
      RoomList.tsx
      CreateRoomDialog.tsx      # folder picker
      ChatView.tsx              # message list + input + mention autocomplete
      MessageBubble.tsx         # renders chat / tool_call / tool_result / system_note
    lib/
      tauriApi.ts               # typed wrappers around invoke()/listen()
    App.tsx
  src-tauri/
    src/
      main.rs
      db.rs                     # sqlx pool setup, migrations runner
      acp/
        mod.rs
        client.rs               # ACP JSON-RPC client (stdio transport)
        process.rs              # spawn/kill codex-acp / claude-agent-acp child processes
      orchestrator/
        mod.rs
        mention_router.rs       # pure regex-based @mention parsing, no LLM
        compaction.rs           # rolling-summary compaction (calls the orchestrator ACP session)
      commands/
        rooms.rs                # #[tauri::command] fns: create_room, list_rooms
        chat.rs                 # send_message, list_messages
        agents.rs               # tag_agent_to_room, agent status
    migrations/
      0001_init.sql
    Cargo.toml
    tauri.conf.json
  docker-compose.yml
  .env.example
  scripts/
    win-dev-start.ps1
    win-dev-stop.ps1
    win-dev-start.bat
    win-dev-stop.bat
```

---

## 4. Database

### 4.1 `docker-compose.yml` (repo root)

```yaml
services:
  postgres:
    image: postgres:17-alpine
    container_name: agentchat-postgres
    environment:
      POSTGRES_USER: agentchat
      POSTGRES_PASSWORD: agentchat_dev
      POSTGRES_DB: agentchat
    ports:
      # 5433, not 5432 — this machine has had other local projects'
      # Postgres containers squatting on the default 5432 before.
      - "127.0.0.1:5433:5432"
    volumes:
      - agentchat-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U agentchat"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  agentchat-postgres-data:
    name: agentchat-postgres-data
```

Bring the DB up / down:

```bash
docker compose up -d          # start
docker compose stop           # stop, keep data
docker compose down           # stop and remove containers (volume/data survives)
```

Wait for healthy before connecting:

```bash
docker inspect --format '{{.State.Health.Status}}' agentchat-postgres
# must print "healthy" before the app tries to connect
```

### 4.2 `.env.example` (copy to `.env`, never commit `.env`)

```
DATABASE_URL=postgres://agentchat:agentchat_dev@127.0.0.1:5433/agentchat
```

**No API keys in this file, ever.** Every agent call — the room agents
(Claude Code, Codex) *and* the compaction orchestrator — goes through the
already-authenticated CLIs via ACP. There is no separate LLM API
credential anywhere in this app. The orchestrator's CLI choice (Claude or
Codex) is a user-facing **Settings** dropdown, persisted in the DB (see
§6.0), not an env var.

**Note the `127.0.0.1`, not `localhost`, in `DATABASE_URL`.** On this
Windows machine, `localhost` has previously resolved to `::1` (IPv6) in Rust
processes while a Docker-forwarded port was only reachable via the IPv4
loopback — using `127.0.0.1` explicitly avoided a real, confirmed connection
failure in a related project. Keep this pattern.

### 4.3 Schema — `src-tauri/migrations/0001_init.sql`

```sql
CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    folder_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Which agent kinds are tagged into which room, and whether their process
-- is currently alive. agent_kind is just 'claude' or 'codex' — no separate
-- agents table needed, there are only ever these two kinds.
CREATE TABLE room_agents (
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    agent_kind TEXT NOT NULL CHECK (agent_kind IN ('claude', 'codex')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    tagged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, agent_kind)
);

-- Full raw message log. Source of truth — never delete from this table.
CREATE TABLE messages (
    id BIGSERIAL PRIMARY KEY,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    author_kind TEXT NOT NULL CHECK (author_kind IN ('user', 'claude', 'codex', 'system')),
    message_type TEXT NOT NULL DEFAULT 'chat'
        CHECK (message_type IN ('chat', 'tool_call', 'tool_result', 'system_note')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_room_id_id_idx ON messages (room_id, id);

-- One row per room: the current rolling summary + how far compaction has
-- gotten. See section 6 for the compaction algorithm this backs.
CREATE TABLE compaction_state (
    room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    rolling_summary TEXT NOT NULL DEFAULT '',
    last_compacted_message_id BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Run migrations with `sqlx migrate run` (via the `sqlx-cli` tool: `cargo
install sqlx-cli --no-default-features --features postgres,rustls`), or
call `sqlx::migrate!().run(&pool).await` from `db.rs` at app startup so it's
automatic — **prefer the automatic in-code approach** so a user never has
to run a separate migration command by hand.

---

## 5. ACP integration (spawning and talking to Claude Code / Codex)

### 5.1 Install the adapters

```bash
npm install -g codex-acp claude-agent-acp
```

(Confirm these are on `PATH` afterward: `codex-acp --version`,
`claude-agent-acp --version`. If npm's global bin dir isn't on `PATH`,
either fix `PATH` or spawn via full path — resolve this before writing any
Rust code that depends on it.)

**Prerequisite the user already has done, don't re-explain to them:**
`claude login` and `codex login` must have been run once in a terminal so
the CLIs are authenticated via subscription. This app does not handle auth
for these two — it only spawns already-authenticated CLIs.

### 5.2 Reference implementation — read before writing the client

**A working Rust ACP client already exists on this machine** at
`D:\My projects\buzz\crates\buzz-acp\src\acp.rs` (and `pool.rs`,
`lib.rs` in the same crate). It is the calling side of exactly this same
protocol, against exactly these same two adapters, proven working. **Read
it first** for:
- the exact JSON-RPC message framing over the child process's stdio
  (whether it's newline-delimited JSON, `Content-Length`-header-framed
  like LSP, or something else — do not guess),
- the `initialize` / `session/new` / `session/prompt` / `session/update`
  message shapes and capability negotiation,
- how the `_meta.terminal-auth` extension is advertised (not needed for
  this app since login already happened, but useful to see the full
  handshake).

Do not copy Buzz's code wholesale (it's coupled to Buzz's own event/DB
model) — reimplement the transport and message handling fresh in
`src-tauri/src/acp/client.rs`, using `acp.rs` purely as a correctness
reference for wire format.

### 5.3 Process lifecycle

- Spawn one child process per `(room_id, agent_kind)` pair, with
  `.current_dir(room.folder_path)`, the first time that agent is
  `@mentioned` in that room (lazy start, not eagerly at room creation).
- Keep it alive while the room is open/active in the UI, so the CLI's own
  native context/turn history accumulates naturally across multiple
  mentions in the same room.
- Tear down a room's agent processes after an idle timeout (suggest 30
  minutes with no activity) to avoid accumulating unbounded background
  processes across many rooms. On next mention after teardown, respawn a
  fresh process and prime its first prompt with the room's
  `rolling_summary` (§6) plus the last ~10 raw messages, so it isn't
  starting from nothing.
- Store `is_active` in `room_agents` so the UI can show "Claude: running" /
  "Claude: idle" status per room.

---

## 6. Context management: asymmetric rolling-summary compaction

This is the specific design decision made for this app — **not** the same
as either CLI's own internal compaction (which you leave alone, per §1/§5).
This is purely about the *shared, cross-agent* context the app itself
constructs when handing a turn from one agent to another, or when
respawning an idle agent's process.

**Core idea, stated precisely:** when re-compacting, **lightly edit the
existing summary** (small changes only — fix inaccuracies, keep it
coherent) and **heavily compress the newly-added raw messages** since the
last compaction. Never fully regenerate the summary from scratch each
time — that wastes tokens and can drift/lose earlier detail unnecessarily.

### 6.0 The orchestrator session (no API key — goes through the CLI)

**Explicit requirement: no external LLM API, no API key, anywhere in this
app.** The compaction step is itself just another ACP turn, sent to a
dedicated **utility session** — separate from the room's own Claude/Codex
working sessions, so compaction calls never pollute a room's actual working
conversation history.

- **Which CLI runs the orchestrator (Claude or Codex) is a user setting**
  (Settings screen, §8), stored in a small app-config table or a
  single-row settings table in Postgres — not hardcoded, not an env var.
- **The model is never hardcoded either.** Each time the orchestrator
  session starts (or before the first compaction call), query the chosen
  CLI's ACP adapter for its actual list of available models — check the
  ACP `initialize`/`session/new` response schema (reference
  `D:\My projects\buzz\crates\buzz-acp\src\acp.rs` again, §5.2, for how
  Buzz surfaces available models — it already has to do this same
  capability negotiation for its own agent-config UI) and pick the
  cheapest/fastest tier the CLI actually reports as available *at call
  time*. Do not assume a fixed model name — CLIs update their available
  model lists over time and the app must always ask, not guess.
- Keep **one** orchestrator ACP session alive for the whole app lifetime
  (not one per room) — each compaction call is a self-contained one-shot
  prompt (§6.2 step 3 supplies everything the call needs: `S_old` +
  `B_new`), so the orchestrator session itself doesn't need to remember
  anything between calls. Reusing one session avoids repeatedly paying
  process-startup cost for every room's compaction.

### 6.1 Trigger

After every new message is inserted into `messages`, check: has more than
**20 new messages** OR an estimated **~3000 tokens** of new raw content
(cheap heuristic: `sum(char_length(content)) / 4`) accumulated since
`last_compacted_message_id`? If yes, run compaction for that room
(can run in the background, doesn't need to block the UI).

### 6.2 Algorithm

1. Load `compaction_state.rolling_summary` (call it `S_old`) and
   `last_compacted_message_id` for the room.
2. Fetch all rows from `messages` where `room_id = ?` and `id >
   last_compacted_message_id`, ordered by `id` (call this `B_new`).
3. Send this prompt to the orchestrator ACP session (§6.0) — the **only**
   other agent call in the whole app besides the room's own Claude/Codex
   working sessions, and it still goes through the CLI, not an API key:

   ```
   You maintain a running project-status summary for an ongoing
   multi-agent coding conversation in a shared project folder.

   Existing summary — keep its structure and content mostly intact, only
   make small edits for accuracy or coherence. Do NOT rewrite it from
   scratch:
   ---
   {S_old}
   ---

   New conversation since the last update — compress this heavily into a
   few bullet points capturing key decisions, tasks assigned to which
   agent, and outcomes. Discard small talk and verbose detail:
   ---
   {B_new formatted as "[claude] ...", "[codex] ...", "[user] ..." per line}
   ---

   Output ONLY the updated summary text (no preamble, no "Here is the
   summary:").
   ```

4. Store the model's output as the new `rolling_summary`, set
   `last_compacted_message_id` = the highest `id` in `B_new`, update
   `updated_at`.

### 6.3 Using the summary for handoffs

When routing a turn to an agent (fresh mention, or a respawned idle
process), construct its prompt as:

```
[Project summary so far]
{rolling_summary}

[Recent messages]
{last ~10 raw messages, verbatim, formatted with author tags}

[Current instruction]
{the actual @mention message text that triggered this turn}
```

---

## 7. Orchestrator: mention routing (no LLM needed)

Pure text logic in `src-tauri/src/orchestrator/mention_router.rs` — no
model call, this is just parsing:

- On every new message (from user or from an agent), scan `content` for
  case-insensitive word-boundary matches of `@claude` or `@codex`
  (regex: `\B@(claude|codex)\b`, case-insensitive).
- For each match found, enqueue a "turn" for that agent kind in that room:
  build its prompt per §6.3, send via the ACP client (§5), stream the
  reply back, insert it into `messages`, then re-run mention-scanning on
  *that* reply too (so chains keep working).
- **Guardrail — do not skip this:** cap automatic chain depth at **5 hops
  per user-initiated message** (i.e., user's message triggers hop 1; if
  that reply mentions another agent, that's hop 2; etc.). If the cap is
  hit, insert a `system_note` message telling the user the chain was
  stopped and asking them to continue manually, instead of looping
  silently forever.

---

## 8. Frontend UI (v1 scope, keep it plain)

- **Room list** (left sidebar): room name, folder path (truncated), which
  agents are tagged + their active/idle status.
- **Create room** dialog: name field + native folder picker
  (`@tauri-apps/plugin-dialog`'s `open({ directory: true })`).
- **Chat view**: scrollable message list (bubbles styled differently per
  `author_kind`), input box at the bottom with `@` autocomplete suggesting
  `claude`/`codex`. `message_type = 'tool_call'` / `'tool_result'` render
  as a visually distinct block (e.g. monospace, collapsible) so tool
  activity is easy to tell apart from chat prose at a glance — this is the
  "UI quan sát" requirement.
- **Settings** screen: **no API key field at all.** A dropdown "Orchestrator
  agent: Claude / Codex" (§6.0) persisted in the DB, plus a read-only
  "Claude CLI: logged in / not logged in", "Codex CLI: logged in / not
  logged in" status check (just run `claude --version` /
  `codex --version` or equivalent and show whether it succeeds — don't try
  to inspect actual login/session tokens).
- **Vietnamese-language user-facing text.** Any text the app shows *to the
  user* — clarifying questions the app asks (e.g. picking between Claude
  and Codex, confirming an ambiguous action), `system_note` messages (e.g.
  the mention-chain-depth-cap notice from §7), Settings labels, and any
  other prompt/dialog copy — must be written **in Vietnamese**, not
  English. This applies to app-generated UI copy only, not to the agents'
  own chat replies (Claude/Codex will reply in whatever language the user
  writes to them in).

---

## 9. Open questions — resolve with the user before/while implementing

1. **ACP wire framing** — confirmed by reading `buzz-acp/src/acp.rs`
   (§5.2) before writing the client; do not guess.
2. **How to query available models from the CLI dynamically** (§6.0) — the
   exact ACP method/field for this needs confirming against
   `codex-acp`/`claude-agent-acp`'s actual capability response (check their
   docs/source after installing, and cross-reference how Buzz's own
   agent-config UI does this — it has to solve the identical problem for
   its "LLM provider" picker, though Buzz's case is for API-key-based
   providers, not these two CLI-based ones specifically, so verify it
   applies before copying the approach).
3. Whether the two CLIs' ACP adapters support **resuming** a previous
   session by ID after the process has been killed (app restart, idle
   timeout teardown). If yes, prefer resuming over the
   rolling-summary-primed fresh session described in §5.3 — this would
   give better continuity. Verify by checking `codex-acp`/`claude-agent-acp`
   docs/source after installing them (§5.1).
4. Default orchestrator CLI (Claude or Codex) before the user picks one in
   Settings the first time — suggest defaulting to whichever the user
   expects to have more spare quota on (they mentioned using Codex less,
   so Codex may be the sensible default orchestrator agent, leaving
   Claude's quota for main working turns) — confirm with the user rather
   than assuming.

---

## 10. Build order (do these in order, verify each before moving on)

1. Scaffold the Tauri project (§3). Get an empty window running via
   `pnpm tauri dev` — confirm this actually opens a window and doesn't hang
   (a sibling project on this machine hit a real, reproducible hang in
   `pnpm tauri dev`'s own dev-server-readiness check; if that happens here
   too, start Vite separately first via `pnpm exec vite --port 1420
   --strictPort`, then run `cargo run` directly inside `src-tauri` instead
   of `pnpm tauri dev`).
2. Bring up Postgres via Docker Compose (§4.1), confirm `docker inspect`
   reports healthy, confirm you can connect with `psql` or any client using
   the `DATABASE_URL` from §4.2.
3. Wire `sqlx` migrations to run automatically on app startup; confirm the
   tables from §4.3 exist after a fresh app launch.
4. **Prove the ACP mechanism headless, before any UI work**: a standalone
   Rust binary (or `cargo test`/example) that spawns `codex-acp` pointed at
   a scratch test folder, sends `initialize` → `session/new` →
   `session/prompt` ("list the files in this folder"), and prints the
   streamed `session/update` output to the console. Don't proceed to the
   next step until this reliably works.
5. Wire the process manager + ACP client into `#[tauri::command]`
   functions + Tauri events, so the frontend can send a message and
   receive streamed agent output.
6. Build room list + create-room folder picker + persistence.
7. Build the chat view (message list + input + mention autocomplete +
   tool-call rendering).
8. Implement mention routing (§7) — test with a single agent first (no
   chaining) before testing two-hop chains.
9. Implement compaction (§6) — test by synthetically inserting >20 messages
   into a room and confirming `compaction_state` updates correctly.
10. Implement idle-timeout process teardown + respawn-with-summary-priming.
11. Package: `pnpm tauri build` produces a Windows installer under
    `src-tauri/target/release/bundle/` (`.msi` and/or `.exe` depending on
    bundler config) — running that installer creates a Start Menu entry
    and can create a Desktop shortcut automatically (Tauri's NSIS/WiX
    bundler supports a "create desktop shortcut" installer option; enable
    it in `tauri.conf.json`'s `bundle.windows` config). For day-to-day dev
    iteration (not the packaged installer), mirror the reference project's
    pattern: a `scripts/win-dev-start.ps1` (docker up → wait healthy →
    `cargo run` in `src-tauri`) and `scripts/win-dev-stop.ps1`, each with a
    `.bat` wrapper, plus Desktop shortcuts to those `.bat` files — copy the
    structure from `D:\My projects\buzz\scripts\win-dev-start.ps1` /
    `win-dev-stop.ps1` as a template (adjust paths/service names for this
    project).

---

## 11. Windows environment notes (carried over, still relevant)

- Visual Studio 2022 Build Tools (C++ workload) + `cmake` are already
  installed on this machine — no additional native toolchain setup should
  be needed, since this project has no heavy native deps (no voice/STT/TTS,
  no sherpa-onnx, no audiopus).
- If any Rust dependency here pulls in `rustls`, prefer the `ring` crypto
  backend over `aws_lc_rs` — the latter's build script was observed
  triggering a Windows Smart App Control block on its first execution in a
  fresh build directory on this machine.
- `tauri.conf.json`'s default `beforeDevCommand` pattern (`exec
  ./node_modules/.bin/vite`) uses POSIX `exec`, which `cmd.exe` cannot run.
  Either don't rely on `beforeDevCommand` (start Vite separately, per step
  1 above) or write a Windows-safe command instead from the start.
- Use `127.0.0.1` instead of `localhost` for the Postgres connection
  string (§4.2) and for any HTTP health-check polling — `localhost` has
  resolved to IPv6-only in places where the actual service only listened
  on IPv4 on this machine, causing confusing "not ready" failures for a
  service that was actually fine.
