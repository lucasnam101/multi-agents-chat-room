ALTER TABLE app_settings ADD COLUMN grok_model TEXT;

ALTER TABLE room_agents DROP CONSTRAINT room_agents_agent_kind_check;
ALTER TABLE room_agents ADD CONSTRAINT room_agents_agent_kind_check
    CHECK (agent_kind IN ('claude', 'codex', 'grok'));

ALTER TABLE room_agent_settings DROP CONSTRAINT room_agent_settings_agent_kind_check;
ALTER TABLE room_agent_settings ADD CONSTRAINT room_agent_settings_agent_kind_check
    CHECK (agent_kind IN ('claude', 'codex', 'grok', 'orchestrator'));

ALTER TABLE messages DROP CONSTRAINT messages_author_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_author_kind_check
    CHECK (author_kind IN ('user', 'claude', 'codex', 'grok', 'system', 'orchestrator'));

INSERT INTO room_agents (room_id, agent_kind)
SELECT id, 'grok' FROM rooms
ON CONFLICT (room_id, agent_kind) DO NOTHING;
