-- Distinct author_kind for the orchestrator's own conversational fallback
-- replies (when no agent was @mentioned), separate from 'system' which is
-- reserved for meta/system_note housekeeping messages (chain-depth-cap
-- notices, error notes).
ALTER TABLE messages DROP CONSTRAINT messages_author_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_author_kind_check
    CHECK (author_kind IN ('user', 'claude', 'codex', 'system', 'orchestrator'));
