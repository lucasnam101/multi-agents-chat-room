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
-- gotten. See NEW_TOOL_PLAN_V2.md section 6 for the compaction algorithm this backs.
CREATE TABLE compaction_state (
    room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    rolling_summary TEXT NOT NULL DEFAULT '',
    last_compacted_message_id BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-row app settings table (orchestrator CLI choice, etc).
CREATE TABLE app_settings (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
    orchestrator_agent_kind TEXT NOT NULL DEFAULT 'codex' CHECK (orchestrator_agent_kind IN ('claude', 'codex')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO app_settings (id) VALUES (true);
