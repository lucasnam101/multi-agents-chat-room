-- Multiple independent conversations per room (folder), like the Claude
-- Code VS Code extension's chat-session switcher. Each session gets its
-- own ACP process/session per agent kind and its own compaction state —
-- switching sessions must not bleed context between them.
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Cuộc trò chuyện',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_room_id_idx ON sessions (room_id, created_at);

-- Every existing room gets exactly one session, carrying its messages and
-- compaction state forward so nothing is lost by this migration.
INSERT INTO sessions (id, room_id, name, created_at, last_active_at)
SELECT gen_random_uuid(), id, 'Cuộc trò chuyện 1', created_at, now() FROM rooms;

ALTER TABLE messages ADD COLUMN session_id UUID REFERENCES sessions(id) ON DELETE CASCADE;
UPDATE messages m SET session_id = s.id FROM sessions s WHERE s.room_id = m.room_id;
ALTER TABLE messages ALTER COLUMN session_id SET NOT NULL;
DROP INDEX IF EXISTS messages_room_id_id_idx;
ALTER TABLE messages DROP COLUMN room_id;
CREATE INDEX messages_session_id_id_idx ON messages (session_id, id);

ALTER TABLE compaction_state ADD COLUMN session_id UUID REFERENCES sessions(id) ON DELETE CASCADE;
UPDATE compaction_state cs SET session_id = s.id FROM sessions s WHERE s.room_id = cs.room_id;
ALTER TABLE compaction_state ALTER COLUMN session_id SET NOT NULL;
ALTER TABLE compaction_state DROP CONSTRAINT compaction_state_pkey;
ALTER TABLE compaction_state ADD PRIMARY KEY (session_id);
ALTER TABLE compaction_state DROP COLUMN room_id;
