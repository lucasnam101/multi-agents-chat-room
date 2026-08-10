import { useEffect, useState } from "react";
import type { Room, RoomAgentStatus } from "../lib/tauriApi";
import { api } from "../lib/tauriApi";
import { IconChat, IconFolder, IconPlus } from "./icons";
import { ThemeToggle } from "./ThemeToggle";
import { useLang } from "../lib/i18n";

interface Props {
  rooms: Room[];
  activeRoomId: string | null;
  onSelect: (roomId: string) => void;
  onCreateClick: () => void;
}

function AgentBadge({ status }: { status: RoomAgentStatus }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
      <span
        className={`h-1.5 w-1.5 rounded-full ${status.is_active ? "bg-emerald-500" : "bg-neutral-400 dark:bg-neutral-600"}`}
      />
      {status.agent_kind === "claude" ? "Claude" : "Codex"}
    </span>
  );
}

export function RoomList({ rooms, activeRoomId, onSelect, onCreateClick }: Props) {
  const { t } = useLang();
  const [statuses, setStatuses] = useState<Record<string, RoomAgentStatus[]>>({});

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
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-neutral-200/80 bg-white dark:border-neutral-800 dark:bg-neutral-950">
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
        {rooms.map((room) => {
          const active = activeRoomId === room.id;
          return (
            <button
              key={room.id}
              onClick={() => onSelect(room.id)}
              className={`mb-1 flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition ${
                active
                  ? "bg-indigo-50 dark:bg-indigo-500/10"
                  : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
              }`}
            >
              <div
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                  active
                    ? "bg-indigo-600 text-white"
                    : "bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500"
                }`}
              >
                <IconFolder className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-sm font-medium ${
                    active ? "text-indigo-700 dark:text-indigo-300" : "text-neutral-800 dark:text-neutral-100"
                  }`}
                >
                  {room.name}
                </div>
                <div className="truncate text-[11px] text-neutral-400">{room.folder_path}</div>
                <div className="mt-1 flex gap-1">
                  {(statuses[room.id] ?? []).map((s) => (
                    <AgentBadge key={s.agent_kind} status={s} />
                  ))}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
