import { useEffect, useRef } from "react";
import type { AgentUpdate, Message } from "../lib/tauriApi";
import type { TurnPhase } from "./MessageBubble";
import { useAuthorLabel } from "./MessageBubble";
import { TypingIndicator } from "./TypingIndicator";
import { IconClose, IconWrench } from "./icons";
import { useLang } from "../lib/i18n";

interface Props {
  authorKind: Message["author_kind"];
  events: AgentUpdate[];
  phase?: TurnPhase;
  onClose: () => void;
}

// Best-effort extraction of human-readable text out of an update's raw ACP
// payload — the wire shape varies by adapter/update type (see the acp_probe
// output this was checked against), so this tries the common fields before
// falling back to pretty-printed JSON.
function extractText(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const meta = obj._meta as Record<string, unknown> | undefined;
  const terminalDelta = meta?.terminal_output_delta as Record<string, unknown> | undefined;
  if (typeof terminalDelta?.data === "string") return terminalDelta.data;
  const rawOutput = obj.rawOutput as Record<string, unknown> | undefined;
  if (typeof rawOutput?.formatted_output === "string") return rawOutput.formatted_output;
  if (typeof obj.rawInput === "object" && obj.rawInput !== null) {
    const input = obj.rawInput as Record<string, unknown>;
    if (typeof input.command === "string") return input.command;
  }
  return null;
}

function ActivityEntry({ event, index }: { event: AgentUpdate; index: number }) {
  const { t } = useLang();
  if (event.kind === "tool_call") {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300">
          <IconWrench className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-mono">{event.title || t("tool.defaultName")}</span>
        </div>
      </div>
    );
  }

  if (event.kind === "tool_call_update") {
    const text = extractText(event.raw);
    return (
      <div className="rounded-lg border border-neutral-200 bg-neutral-900 px-3 py-2 dark:border-neutral-800">
        <pre className="max-h-52 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-neutral-200">
          {text ?? JSON.stringify(event.raw, null, 2)}
        </pre>
      </div>
    );
  }

  if (event.kind === "message_chunk") return null; // never pushed into a thread's events, but keeps the union exhaustive

  // "other" — session/usage bookkeeping, available-commands, etc. Collapsed
  // by default since it's rarely the thing a user is trying to observe, but
  // kept visible-on-demand rather than hidden entirely.
  return (
    <details className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-1.5 text-xs dark:border-neutral-800 dark:bg-neutral-900/60" key={index}>
      <summary className="cursor-pointer font-mono text-neutral-400">{event.update_type}</summary>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-neutral-500">
        {JSON.stringify(event.raw, null, 2)}
      </pre>
    </details>
  );
}

export function ActivityThread({ authorKind, events, phase, onClose }: Props) {
  const { t } = useLang();
  const AUTHOR_LABEL = useAuthorLabel();
  const bottomRef = useRef<HTMLDivElement>(null);
  const isRunning = phase !== undefined;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events, phase]);

  return (
    <div className="flex h-full w-96 shrink-0 flex-col border-l border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            {t("activity.titlePrefix")} {AUTHOR_LABEL[authorKind]}
            <span
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                isRunning
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? "bg-amber-500" : "bg-emerald-500"}`} />
              {isRunning ? t("activity.running") : t("activity.done")}
            </span>
          </h3>
          <p className="text-[11px] text-neutral-400">{t("activity.subtitle")}</p>
        </div>
        <button
          className="rounded-full p-1.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          <IconClose className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {events.length === 0 && !isRunning && (
          <div className="mt-8 text-center text-xs text-neutral-400">{t("activity.empty")}</div>
        )}
        {events.map((event, i) => (
          <ActivityEntry key={i} event={event} index={i} />
        ))}
        {isRunning && (
          <div className="flex items-center gap-2 px-1 text-xs text-neutral-400">
            <TypingIndicator />
            {phase === "thinking"
              ? t("activity.thinking")
              : phase === "tool"
                ? t("activity.runningTool")
                : t("activity.replying")}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
