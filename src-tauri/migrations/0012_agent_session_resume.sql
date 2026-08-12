-- Persist the underlying ACP session id per (app session, agent kind) so
-- that reopening a conversation (after an app restart or an idle-teardown)
-- can resume the agent's own native session via `session/load` instead of
-- always starting a brand-new one. See ProcessManager::ensure_running.
CREATE TABLE agent_acp_sessions (
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    agent_kind TEXT NOT NULL,
    acp_session_id TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, agent_kind)
);
