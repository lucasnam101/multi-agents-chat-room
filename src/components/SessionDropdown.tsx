import { useEffect, useRef, useState } from "react";
import type { Session } from "../lib/tauriApi";
import { IconChat, IconClose, IconPlus } from "./icons";

interface Props {
  sessions: Session[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, name: string) => void;
}

export function SessionDropdown({ sessions, activeSessionId, onSelect, onCreate, onDelete, onRename }: Props) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const active = sessions.find((s) => s.id === activeSessionId);

  function startEdit(s: Session) {
    setEditingId(s.id);
    setEditValue(s.name);
  }

  function commitEdit() {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  }

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-center border-b border-neutral-200/80 bg-neutral-50 px-3 py-1.5 dark:border-neutral-800 dark:bg-neutral-950/50">
      <button
        className="flex min-w-0 max-w-xs items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-900"
        onClick={() => setOpen((o) => !o)}
      >
        <IconChat className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
        <span className="truncate">{active?.name ?? "Chọn cuộc trò chuyện"}</span>
        <span className="text-neutral-400">({sessions.length})</span>
      </button>
      <button
        className="ml-1 flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-900"
        onClick={onCreate}
        title="Tạo cuộc trò chuyện mới"
      >
        <IconPlus className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute left-3 top-full z-20 mt-1 max-h-80 w-72 overflow-y-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
          {sessions.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-neutral-400">Chưa có cuộc trò chuyện nào.</div>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group flex items-center gap-1 px-2 py-1.5 text-sm ${
                s.id === activeSessionId ? "bg-indigo-50 dark:bg-indigo-500/10" : "hover:bg-neutral-100 dark:hover:bg-neutral-700"
              }`}
            >
              {editingId === s.id ? (
                <input
                  autoFocus
                  className="min-w-0 flex-1 rounded border border-indigo-400 bg-white px-1.5 py-0.5 text-sm outline-none dark:bg-neutral-900 dark:text-neutral-100"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={commitEdit}
                />
              ) : (
                <button
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => {
                    onSelect(s.id);
                    setOpen(false);
                  }}
                >
                  {s.name}
                </button>
              )}
              {editingId !== s.id && (
                <>
                  <button
                    className="rounded p-1 text-neutral-400 opacity-0 hover:bg-black/5 group-hover:opacity-100 dark:hover:bg-white/10"
                    title="Đổi tên"
                    onClick={() => startEdit(s)}
                  >
                    ✎
                  </button>
                  <button
                    className="rounded p-1 text-neutral-400 opacity-0 hover:bg-black/5 group-hover:opacity-100 dark:hover:bg-white/10"
                    title="Xóa cuộc trò chuyện"
                    onClick={() => onDelete(s.id)}
                  >
                    <IconClose className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
          <div className="mt-1 border-t border-neutral-100 pt-1 dark:border-neutral-700">
            <button
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-sm text-indigo-600 hover:bg-neutral-100 dark:text-indigo-400 dark:hover:bg-neutral-700"
              onClick={() => {
                onCreate();
                setOpen(false);
              }}
            >
              <IconPlus className="h-3.5 w-3.5" />
              Tạo cuộc trò chuyện mới
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
