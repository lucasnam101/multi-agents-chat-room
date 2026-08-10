-- Global default model per agent kind + orchestrator model, and a
-- configurable context budget used both for the "used/budget" display and
-- as the compaction trigger threshold.
ALTER TABLE app_settings ADD COLUMN claude_model TEXT;
ALTER TABLE app_settings ADD COLUMN codex_model TEXT;
ALTER TABLE app_settings ADD COLUMN orchestrator_model TEXT;
ALTER TABLE app_settings ADD COLUMN context_budget_tokens BIGINT NOT NULL DEFAULT 300000;

-- Per-room override of the global default model for a given agent kind.
-- Absence of a row (or a NULL model) means "use the global default".
CREATE TABLE room_agent_settings (
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    agent_kind TEXT NOT NULL CHECK (agent_kind IN ('claude', 'codex')),
    model TEXT,
    PRIMARY KEY (room_id, agent_kind)
);
