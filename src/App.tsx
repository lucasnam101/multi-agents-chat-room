import { useEffect, useState } from "react";
import { RoomList } from "./components/RoomList";
import { CreateRoomDialog } from "./components/CreateRoomDialog";
import { ChatView } from "./components/ChatView";
import { SettingsPanel } from "./components/SettingsPanel";
import { RoomSettingsPanel } from "./components/RoomSettingsPanel";
import { SessionDropdown } from "./components/SessionDropdown";
import { fontSizeToProseClass } from "./components/SettingsPanel";
import { IconFolder, IconSliders, IconSettings } from "./components/icons";
import type { Room, Session } from "./lib/tauriApi";
import { api, onApprovalRequest, onSessionRenamed, type ApprovalRequest } from "./lib/tauriApi";
import { useLang } from "./lib/i18n";

function App() {
  const { t } = useLang();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRoomSettings, setShowRoomSettings] = useState(false);
  const [fontSize, setFontSize] = useState<"sm" | "base" | "lg">("base");
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);

  async function refreshRooms() {
    const list = await api.listRooms();
    setRooms(list);
    if (!activeRoomId && list.length > 0) setActiveRoomId(list[0].id);
  }

  async function handleTogglePin(roomId: string) {
    const room = rooms.find((item) => item.id === roomId);
    if (!room) return;
    setRooms((prev) => prev.map((item) => item.id === roomId ? { ...item, pinned: !item.pinned } : item));
    await api.setRoomPinned(roomId, !room.pinned);
    await refreshRooms();
  }

  async function handleReorder(roomIds: string[]) {
    const byId = new Map(rooms.map((room) => [room.id, room]));
    setRooms(roomIds.map((id) => byId.get(id)).filter((room): room is Room => Boolean(room)));
    await api.reorderRooms(roomIds);
  }

  async function handleDeleteRoom(roomId: string) {
    if (!window.confirm(t("app.confirm.deleteRoom"))) return;
    await api.deleteRoom(roomId);
    setRooms((prev) => {
      const next = prev.filter((room) => room.id !== roomId);
      if (activeRoomId === roomId) {
        setActiveRoomId(next.length > 0 ? next[0].id : null);
      }
      return next;
    });
  }

  useEffect(() => {
    refreshRooms();
    api.getChatFontSize().then(setFontSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unlisten = onApprovalRequest((request) => setApproval(request));
    return () => { unlisten.then((f) => f()); };
  }, []);

  // The orchestrator auto-titles a session from its first user message
  // (like ChatGPT/Claude's web UI) — this event is how that rename reaches
  // the dropdown without a manual refresh.
  useEffect(() => {
    const unlisten = onSessionRenamed((payload) => {
      setSessions((prev) => prev.map((s) => (s.id === payload.session_id ? { ...s, name: payload.name } : s)));
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // A room can hold several independent conversations (sessions), like the
  // Claude Code VS Code extension's chat switcher — load them whenever the
  // room in view changes, and default to the most recent one.
  useEffect(() => {
    if (!activeRoomId) {
      setSessions([]);
      setActiveSessionId(null);
      return;
    }
    api.listSessions(activeRoomId).then((list) => {
      setSessions(list);
      setActiveSessionId(list.length > 0 ? list[list.length - 1].id : null);
    });
  }, [activeRoomId]);

  async function handleCreateRoom(name: string, folderPath: string) {
    const room = await api.createRoom(name, folderPath);
    await api.tagAgent(room.id, "claude");
    await api.tagAgent(room.id, "codex");
    await api.tagAgent(room.id, "grok");
    setShowCreate(false);
    await refreshRooms();
    setActiveRoomId(room.id);
  }

  async function handleCreateSession() {
    if (!activeRoomId) return;
    const session = await api.createSession(activeRoomId);
    setSessions((prev) => [...prev, session]);
    setActiveSessionId(session.id);
  }

  async function handleDeleteSession(sessionId: string) {
    if (!window.confirm(t("app.confirm.deleteSession"))) return;
    await api.deleteSession(sessionId);
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      if (activeSessionId === sessionId) {
        setActiveSessionId(next.length > 0 ? next[next.length - 1].id : null);
      }
      return next;
    });
  }

  async function handleRenameSession(sessionId: string, name: string) {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, name } : s)));
    await api.renameSession(sessionId, name);
  }

  const activeRoom = rooms.find((r) => r.id === activeRoomId);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <RoomList
        rooms={rooms}
        activeRoomId={activeRoomId}
        onSelect={setActiveRoomId}
        onCreateClick={() => setShowCreate(true)}
        onTogglePin={handleTogglePin}
        onReorder={handleReorder}
        onOpenTerminal={(roomId) => api.openTerminal(roomId)}
        onDelete={handleDeleteRoom}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-200/80 bg-white px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex min-w-0 items-center gap-2">
            <IconFolder className="h-4 w-4 shrink-0 text-neutral-400" />
            <span className="truncate text-sm font-medium text-neutral-700 dark:text-neutral-300">
              {activeRoom?.name ?? t("app.header.noRoomSelected")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {activeRoomId && (
              <button
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                onClick={() => setShowRoomSettings(true)}
                title={t("app.header.roomSettingsTitle")}
              >
                <IconSliders className="h-3.5 w-3.5" />
                {t("app.header.room")}
              </button>
            )}
            <button
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              onClick={() => setShowSettings(true)}
              title={t("app.header.generalSettingsTitle")}
            >
              <IconSettings className="h-3.5 w-3.5" />
              {t("app.header.general")}
            </button>
          </div>
        </div>

        {activeRoomId && (
          <SessionDropdown
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelect={setActiveSessionId}
            onCreate={handleCreateSession}
            onDelete={handleDeleteSession}
            onRename={handleRenameSession}
          />
        )}

        {activeRoomId && activeSessionId ? (
          <ChatView
            key={activeSessionId}
            sessionId={activeSessionId}
            roomId={activeRoomId}
            fontSizeClass={fontSizeToProseClass(fontSize)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-400">
            {activeRoomId ? t("app.empty.noSessions") : t("app.empty.noRoom")}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateRoomDialog onCreate={handleCreateRoom} onClose={() => setShowCreate(false)} />
      )}
      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} onFontSizeChange={setFontSize} />
      )}
      {showRoomSettings && activeRoomId && (
        <RoomSettingsPanel roomId={activeRoomId} onClose={() => setShowRoomSettings(false)} />
      )}
      {approval && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="approval-title">
          <div className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-indigo-600">{approval.agent_kind}</div>
            <h2 id="approval-title" className="text-base font-semibold text-neutral-900 dark:text-white">{approval.title}</h2>
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{t("approval.subtitle")}</p>
            <div className="mt-4 grid gap-2">
              {approval.options.map((option) => (
                <button key={option.optionId} onClick={() => { api.resolveApproval(approval.request_id, option.optionId); setApproval(null); }} className="rounded-xl border border-neutral-200 px-3 py-2 text-left transition hover:border-indigo-400 hover:bg-indigo-50 dark:border-neutral-700 dark:hover:bg-indigo-500/10">
                  <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{option.name ?? option.optionId}</div>
                  {option.description && <div className="mt-0.5 text-xs text-neutral-500">{option.description}</div>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
