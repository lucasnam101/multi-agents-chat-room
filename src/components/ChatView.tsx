import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { AgentUpdate, Attachment, ContextUsage, Message } from "../lib/tauriApi";
import { api, onAgentUpdate, onMessageInserted, onMessageUpdated } from "../lib/tauriApi";
import { MessageBubble, type TurnPhase } from "./MessageBubble";
import { ActivityThread } from "./ActivityThread";
import { InAppBrowser } from "./InAppBrowser";
import { formatTokens } from "./SettingsPanel";
import { IconClose, IconFolder, IconPause, IconPlay, IconSend } from "./icons";
import { useLang } from "../lib/i18n";

const AGENT_OPTIONS = ["claude", "codex"];
const MAX_SUGGESTIONS = 8;
const FILE_QUERY_DEBOUNCE_MS = 150;
const AGENT_AUTHOR_KINDS = new Set(["claude", "codex", "orchestrator"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

type Suggestion = { type: "agent"; value: string } | { type: "file"; value: string };

const COMPOSER_MAX_HEIGHT_PX = 160; // keep in sync with the max-h-40 class on the textarea

function baseName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

export function ChatView({
  sessionId,
  roomId,
  fontSizeClass = "prose-base",
}: {
  sessionId: string;
  roomId: string;
  fontSizeClass?: string;
}) {
  const { t } = useLang();
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolEvents, setToolEvents] = useState<Record<number, AgentUpdate[]>>({});
  const [phases, setPhases] = useState<Record<number, TurnPhase>>({});
  const [draft, setDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [fileSuggestions, setFileSuggestions] = useState<string[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [agentsRunning, setAgentsRunning] = useState(false);
  const [agentsBusy, setAgentsBusy] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileQueryDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileQuerySeq = useRef(0);
  // True right after a message's tool call, until its next text chunk —
  // mirrors the same bookkeeping the backend does when building the
  // persisted content, so live streaming reads the same way a reload would.
  const pendingRoundBreak = useRef<Record<number, boolean>>({});

  async function refreshContextUsage() {
    try {
      setContextUsage(await api.getRoomContextUsage(sessionId));
    } catch {
      setContextUsage(null);
    }
  }

  async function refreshAgentsRunning() {
    try {
      const statuses = await api.sessionAgentStatuses(sessionId);
      setAgentsRunning(statuses.some((s) => s.is_active));
    } catch {
      setAgentsRunning(false);
    }
  }

  async function toggleAgents() {
    setAgentsBusy(true);
    try {
      if (agentsRunning) {
        await api.stopSessionAgents(sessionId);
      } else {
        await api.ensureSessionAgents(sessionId);
      }
      await refreshAgentsRunning();
    } finally {
      setAgentsBusy(false);
    }
  }

  async function refresh() {
    setMessages(await api.listMessages(sessionId));
    setPhases({});
    setToolEvents({});
    setActiveThreadId(null);
    setBrowserUrl(null);
  }

  useEffect(() => {
    refresh();
    refreshContextUsage();
    refreshAgentsRunning();
    const interval = setInterval(() => {
      refreshContextUsage();
      refreshAgentsRunning();
    }, 15000);

    // A newly-inserted row (user message, or an agent's placeholder) becomes
    // visible immediately — this is also what makes streaming possible for
    // @mention turns: without the placeholder already in state, incoming
    // "agent-update" chunks below would have no matching message id to
    // attach to until the whole turn finished.
    const unlistenInserted = onMessageInserted((message) => {
      if (message.session_id !== sessionId) return;
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      if (AGENT_AUTHOR_KINDS.has(message.author_kind) && message.content === "") {
        setPhases((prev) => ({ ...prev, [message.id]: "thinking" }));
      }
      refreshContextUsage();
      refreshAgentsRunning();
    });

    // Fired exactly once per turn (success or failure) with the final text —
    // the authoritative signal that a turn is over, independent of whether
    // any chunk ever streamed in.
    const unlistenUpdated = onMessageUpdated((payload) => {
      if (payload.session_id !== sessionId) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === payload.id ? { ...m, content: payload.content } : m)),
      );
      setPhases((prev) => {
        const next = { ...prev };
        delete next[payload.id];
        return next;
      });
      refreshContextUsage();
    });

    const unlistenUpdate = onAgentUpdate((payload) => {
      if (payload.session_id !== sessionId) return;
      if (payload.update.kind === "message_chunk") {
        const chunk = payload.update.text;
        const needsBreak = pendingRoundBreak.current[payload.message_id];
        pendingRoundBreak.current[payload.message_id] = false;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === payload.message_id
              ? { ...m, content: m.content + (needsBreak && m.content !== "" ? "\n\n---\n\n" : "") + chunk }
              : m,
          ),
        );
        setPhases((prev) => ({ ...prev, [payload.message_id]: "streaming" }));
      } else if (payload.update.kind === "tool_call" || payload.update.kind === "tool_call_update") {
        pendingRoundBreak.current[payload.message_id] = true;
        setToolEvents((prev) => ({
          ...prev,
          [payload.message_id]: [...(prev[payload.message_id] ?? []), payload.update],
        }));
        setPhases((prev) =>
          prev[payload.message_id] === "streaming" ? prev : { ...prev, [payload.message_id]: "tool" },
        );
      }
    });

    return () => {
      clearInterval(interval);
      unlistenInserted.then((f) => f());
      unlistenUpdated.then((f) => f());
      unlistenUpdate.then((f) => f());
    };
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-grow the composer with content (up to a max height, then it
  // scrolls internally) instead of a fixed-size box — a plain `rows`
  // attribute doesn't respond to wrapped/typed lines at all.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
  }, [draft]);

  // Debounced file-path lookup for the "@" autocomplete (file half of it —
  // agent-name matches are computed synchronously, see `suggestions` below).
  useEffect(() => {
    if (mentionQuery === null) {
      setFileSuggestions([]);
      return;
    }
    if (fileQueryDebounce.current) clearTimeout(fileQueryDebounce.current);
    const seq = ++fileQuerySeq.current;
    fileQueryDebounce.current = setTimeout(async () => {
      try {
        const files = await api.listRoomFiles(roomId, mentionQuery);
        if (seq === fileQuerySeq.current) setFileSuggestions(files);
      } catch {
        if (seq === fileQuerySeq.current) setFileSuggestions([]);
      }
    }, FILE_QUERY_DEBOUNCE_MS);
    return () => {
      if (fileQueryDebounce.current) clearTimeout(fileQueryDebounce.current);
    };
  }, [roomId, mentionQuery]);

  function handleDraftChange(value: string) {
    setDraft(value);
    const match = /@([^\s@]*)$/.exec(value);
    setMentionQuery(match ? match[1] : null);
    setHighlightIndex(0);
  }

  function applySuggestion(s: Suggestion) {
    setDraft((prev) => prev.replace(/@([^\s@]*)$/, `@${s.value} `));
    setMentionQuery(null);
    setFileSuggestions([]);
    inputRef.current?.focus();
  }

  async function pickAttachments() {
    const selected = await open({ multiple: true });
    const paths = selected == null ? [] : Array.isArray(selected) ? selected : [selected];
    for (const path of paths) {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      if (IMAGE_EXTENSIONS.has(ext)) {
        try {
          const dataBase64 = await api.readFileAsBase64(path);
          setPendingAttachments((prev) => [
            ...prev,
            { kind: "image", name: baseName(path), mimeType: MIME_BY_EXTENSION[ext] ?? "image/png", dataBase64, path: null },
          ]);
        } catch {
          // Skip files that fail to read rather than blocking the rest.
        }
      } else {
        setPendingAttachments((prev) => [
          ...prev,
          { kind: "file", name: baseName(path), mimeType: null, dataBase64: null, path },
        ]);
      }
    }
  }

  function removeAttachment(index: number) {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  async function send() {
    const content = draft.trim();
    if (!content && pendingAttachments.length === 0) return;
    setDraft("");
    setMentionQuery(null);
    const attachments = pendingAttachments;
    setPendingAttachments([]);
    // Appended via the "message-inserted" event too, but doing it here as
    // well means the user's own bubble never waits on an event round-trip.
    const message = await api.sendMessage(sessionId, content, attachments);
    setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    refreshContextUsage();
  }

  const agentMatches: Suggestion[] =
    mentionQuery !== null
      ? AGENT_OPTIONS.filter((o) => o.startsWith(mentionQuery.toLowerCase())).map((value) => ({
          type: "agent" as const,
          value,
        }))
      : [];
  const fileMatches: Suggestion[] = fileSuggestions.map((value) => ({ type: "file" as const, value }));
  const suggestions = [...agentMatches, ...fileMatches].slice(0, MAX_SUGGESTIONS);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        applySuggestion(suggestions[Math.min(highlightIndex, suggestions.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        setFileSuggestions([]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const activeThreadMessage = messages.find((m) => m.id === activeThreadId);

  if (browserUrl) {
    return <InAppBrowser url={browserUrl} onClose={() => setBrowserUrl(null)} />;
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-neutral-50/50 dark:bg-neutral-950/40">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-1.5 text-[11px] text-neutral-400">
        <button
          className={`flex items-center gap-1.5 rounded-full px-2 py-1 font-medium transition ${
            agentsRunning
              ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25"
              : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          } disabled:opacity-50`}
          onClick={toggleAgents}
          disabled={agentsBusy}
          title={agentsRunning ? t("agents.stopTooltip") : t("agents.startTooltip")}
        >
          {agentsRunning ? <IconPause className="h-3 w-3" /> : <IconPlay className="h-3 w-3" />}
          {agentsRunning ? t("agents.running") : t("agents.paused")}
        </button>

        {contextUsage && (
          <div className="flex items-center gap-1.5">
            <span className="h-1 w-16 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <span
                className="block h-full rounded-full bg-indigo-400 transition-all"
                style={{
                  width: `${Math.min(100, (contextUsage.used_tokens / Math.max(1, contextUsage.budget_tokens)) * 100)}%`,
                }}
              />
            </span>
            {t("context.label")}: {formatTokens(contextUsage.used_tokens)}/{formatTokens(contextUsage.budget_tokens)}{" "}
            {t("context.tokens")}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-3">
        <div className="flex flex-col gap-3">
          {messages.length === 0 && (
            <div className="mt-16 text-center text-sm text-neutral-400">
              {t("chat.emptyLine1")} <span className="font-mono">@claude</span> {t("chat.emptyOr")}{" "}
              <span className="font-mono">@codex</span> {t("chat.emptySuffix")}
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              toolEvents={toolEvents[m.id]}
              phase={phases[m.id]}
              onOpenThread={() => setActiveThreadId(m.id)}
              onOpenLink={setBrowserUrl}
              fontSizeClass={fontSizeClass}
            />
          ))}
        </div>
        <div ref={bottomRef} />
      </div>

      <div className="relative shrink-0 border-t border-neutral-200/80 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
        <div>
          {suggestions.length > 0 && (
            <div className="absolute bottom-full left-3 mb-2 max-h-56 w-64 overflow-y-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
              {suggestions.map((s, i) => (
                <button
                  key={`${s.type}:${s.value}`}
                  className={`block w-full truncate px-3 py-1.5 text-left text-sm ${
                    i === highlightIndex
                      ? "bg-neutral-100 dark:bg-neutral-700"
                      : "hover:bg-neutral-100 dark:hover:bg-neutral-700"
                  }`}
                  onMouseEnter={() => setHighlightIndex(i)}
                  onClick={() => applySuggestion(s)}
                >
                  {s.type === "agent" ? "@" : "📄 "}
                  {s.value}
                </button>
              ))}
            </div>
          )}

          {pendingAttachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {pendingAttachments.map((a, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  {a.kind === "image" ? (
                    <img
                      src={`data:${a.mimeType};base64,${a.dataBase64}`}
                      className="h-5 w-5 rounded object-cover"
                      alt=""
                    />
                  ) : (
                    <IconFolder className="h-3.5 w-3.5" />
                  )}
                  <span className="max-w-32 truncate">{a.name}</span>
                  <button onClick={() => removeAttachment(i)} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-100">
                    <IconClose className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2 rounded-2xl border border-neutral-200 bg-neutral-50 p-1.5 shadow-sm focus-within:border-indigo-400 dark:border-neutral-700 dark:bg-neutral-800">
            <button
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
              onClick={pickAttachments}
              title={t("composer.attachTooltip")}
              aria-label={t("composer.attachTooltip")}
            >
              +
            </button>
            <textarea
              ref={inputRef}
              className="max-h-40 flex-1 resize-none overflow-y-auto bg-transparent px-2.5 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
              rows={1}
              value={draft}
              placeholder={t("composer.placeholder")}
              onChange={(e) => handleDraftChange(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition hover:bg-indigo-700 disabled:opacity-40"
              disabled={!draft.trim() && pendingAttachments.length === 0}
              onClick={send}
              aria-label={t("composer.send")}
            >
              <IconSend className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
    {activeThreadMessage && (
      <ActivityThread
        authorKind={activeThreadMessage.author_kind}
        events={toolEvents[activeThreadMessage.id] ?? []}
        phase={phases[activeThreadMessage.id]}
        onClose={() => setActiveThreadId(null)}
      />
    )}
    </div>
  );
}
