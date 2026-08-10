-- Allow a room to also override the orchestrator's model (in addition to
-- claude/codex), on top of the global default in app_settings.
ALTER TABLE room_agent_settings DROP CONSTRAINT room_agent_settings_agent_kind_check;
ALTER TABLE room_agent_settings ADD CONSTRAINT room_agent_settings_agent_kind_check
    CHECK (agent_kind IN ('claude', 'codex', 'orchestrator'));
