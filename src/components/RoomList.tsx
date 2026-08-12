import { useEffect, useState } from "react";
import type { Room, RoomAgentStatus } from "../lib/tauriApi";
import { api } from "../lib/tauriApi";
import { IconChat, IconFolder, IconPlus, IconTrash } from "./icons";
import { ThemeToggle } from "./ThemeToggle";
import { useLang } from "../lib/i18n";

interface Props {
  rooms: Room[];
  activeRoomId: string | null;
  onSelect: (roomId: string) => void;
  onCreateClick: () => void;
  onTogglePin: (roomId: string) => void;
  onReorder: (roomIds: string[]) => void;
  onDelete: (roomId: string) => void;
  onOpenTerminal: (roomId: string) => void;
}

function AgentBadge({ status }: { status: RoomAgentStatus }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
      <span
        className={`h-1.5 w-1.5 rounded-full ${status.is_active ? "bg-emerald-500" : "bg-neutral-400 dark:bg-neutral-600"}`}
      />
      {status.agent_kind === "claude" ? "Claude" : status.agent_kind === "codex" ? "Codex" : "Grok"}
    </span>
  );
}

export function RoomList({ rooms, activeRoomId, onSelect, onCreateClick, onTogglePin, onReorder, onDelete, onOpenTerminal }: Props) {
  const { t } = useLang();
  const [statuses, setStatuses] = useState<Record<string, RoomAgentStatus[]>>({});
  const [draggedRoomId, setDraggedRoomId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ roomId: string; x: number; y: number } | null>(null);

  function moveRoom(roomId: string, direction: -1 | 1) {
    const index = rooms.findIndex((room) => room.id === roomId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= rooms.length) return;
    const next = [...rooms];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onReorder(next.map((room) => room.id));
  }

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const next: Record<string, RoomAgentStatus[]> = {};
      for (const room of rooms) {
        try {
          next[room.id] = await api.roomAgentStatuses(room.id);
        } catch {
          next[room.id] = [];
        }
      }
      if (!cancelled) setStatuses(next);
    }
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [rooms]);

  return (
    <div className="relative flex h-full w-72 shrink-0 flex-col border-r border-neutral-200/80 bg-white dark:border-neutral-800 dark:bg-neutral-950" onClick={() => setContextMenu(null)}>
      <div className="flex items-center justify-between px-4 py-3.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <IconChat className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Agent Chat</span>
        </div>
        <ThemeToggle />
      </div>

      <div className="px-3 pb-2">
        <button
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700"
          onClick={onCreateClick}
        >
          <IconPlus className="h-4 w-4" />
          {t("room.new")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {rooms.length === 0 && (
          <div className="mx-2 mt-6 rounded-xl border border-dashed border-neutral-200 p-4 text-center text-xs text-neutral-400 dark:border-neutral-800">
            {t("room.emptyLine1")}
            <br />
            {t("room.emptyLine2")}
          </div>
        )}
        {rooms.map((room, index) => {
          const active = activeRoomId === room.id;
          return (
            <div
              key={room.id}
              draggable
              onDragStart={() => setDraggedRoomId(room.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (!draggedRoomId || draggedRoomId === room.id) return;
                const from = rooms.findIndex((item) => item.id === draggedRoomId);
                const to = rooms.findIndex((item) => item.id === room.id);
                if (from < 0 || to < 0) return;
                const next = [...rooms]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved);
                onReorder(next.map((item) => item.id)); setDraggedRoomId(null);
              }}
              onDragEnd={() => setDraggedRoomId(null)}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({ roomId: room.id, x: event.clientX, y: event.clientY });
              }}
              className={`group mb-1 flex w-full items-start gap-1 rounded-xl px-1.5 py-1.5 text-left transition ${
                active
                  ? "bg-indigo-50 dark:bg-indigo-500/10"
                  : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
              }`}
            >
              <button onClick={() => onSelect(room.id)} className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" aria-current={active ? "page" : undefined}>
                <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? "bg-indigo-600 text-white" : "bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500"}`}>
                  <IconFolder className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-sm font-medium ${active ? "text-indigo-700 dark:text-indigo-300" : "text-neutral-800 dark:text-neutral-100"}`}>{room.name}</div>
                  <div className="truncate text-[11px] text-neutral-400">{room.folder_path}</div>
                  <div className="mt-1 flex gap-1">{(statuses[room.id] ?? []).map((s) => <AgentBadge key={s.agent_kind} status={s} />)}</div>
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-0.5 pt-1 opacity-60 transition group-hover:opacity-100 group-focus-within:opacity-100">
                <button onClick={() => onTogglePin(room.id)} className={`rounded p-1 text-xs ${room.pinned ? "text-indigo-600 dark:text-indigo-300" : "text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"}`} title={room.pinned ? t("room.unpin") : t("room.pin")} aria-label={room.pinned ? t("room.unpin") : t("room.pin")}>{room.pinned ? "★" : "☆"}</button>
                <button onClick={() => moveRoom(room.id, -1)} disabled={index === 0} className="rounded p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-30 dark:hover:text-neutral-200" title={t("room.moveUp")} aria-label={t("room.moveUp")}>↑</button>
                <button onClick={() => moveRoom(room.id, 1)} disabled={index === rooms.length - 1} className="rounded p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-30 dark:hover:text-neutral-200" title={t("room.moveDown")} aria-label={t("room.moveDown")}>↓</button>
                <button onClick={(e) => { e.stopPropagation(); onDelete(room.id); }} className="rounded p-1 text-neutral-400 hover:text-red-600 dark:hover:text-red-400" title={t("room.delete")} aria-label={t("room.delete")}>
                  <IconTrash className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {contextMenu && (
        <div className="fixed z-50 min-w-44 rounded-xl border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu">
          <button
            className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
            role="menuitem"
            onClick={() => { onOpenTerminal(contextMenu.roomId); setContextMenu(null); }}
          >
            Open terminal here
          </button>
        </div>
      )}
    </div>
  );
}
