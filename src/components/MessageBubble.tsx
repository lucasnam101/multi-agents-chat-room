import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { AgentUpdate, Message } from "../lib/tauriApi";
import { TypingIndicator } from "./TypingIndicator";
import { IconFolder, IconReply, IconWrench } from "./icons";
import { useLang } from "../lib/i18n";

export type TurnPhase = "thinking" | "tool" | "streaming";

// "Claude"/"Codex" are proper nouns, not translated. The rest (You/System/
// Assistant) are app-chrome labels.
export function useAuthorLabel(): Record<Message["author_kind"], string> {
  const { t } = useLang();
  return {
    user: t("author.you"),
    claude: "Claude",
    codex: "Codex",
    grok: "Grok",
    system: t("author.system"),
    orchestrator: t("author.orchestrator"),
  };
}

// One accent per author — carried through the avatar chip, the name label,
// and the bubble's left rule so a room with multiple agents stays scannable
// at a glance without re-reading the label every time.
const AUTHOR_ACCENT: Record<Message["author_kind"], string> = {
  user: "bg-indigo-500",
  claude: "bg-amber-500",
  codex: "bg-emerald-500",
  grok: "bg-sky-500",
  orchestrator: "bg-violet-500",
  system: "bg-neutral-400",
};

const AUTHOR_BUBBLE: Record<Message["author_kind"], string> = {
  user: "bg-indigo-600 text-white",
  claude: "bg-amber-50 text-neutral-900 dark:bg-amber-500/10 dark:text-neutral-100",
  codex: "bg-emerald-50 text-neutral-900 dark:bg-emerald-500/10 dark:text-neutral-100",
  grok: "bg-sky-50 text-neutral-900 dark:bg-sky-500/10 dark:text-neutral-100",
  orchestrator: "bg-violet-50 text-neutral-900 dark:bg-violet-500/10 dark:text-neutral-100",
  system: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400",
};

function Avatar({ authorKind, label }: { authorKind: Message["author_kind"]; label: string }) {
  const initial = label[0]?.toUpperCase() ?? "?";
  return (
    <div
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${AUTHOR_ACCENT[authorKind]}`}
    >
      {initial}
    </div>
  );
}

interface Props {
  message: Message;
  toolEvents?: AgentUpdate[];
  phase?: TurnPhase;
  onOpenThread?: (messageId: number) => void;
  onOpenLink?: (url: string) => void;
  onQuickReply?: (authorKind: "claude" | "codex" | "grok" | "orchestrator") => void;
  fontSizeClass?: string;
}

// Memoized: parsing markdown (react-markdown + remark-gfm/remark-breaks) is
// not cheap, and without this every keystroke in the composer (a state
// update in the parent ChatView) would re-render — and re-parse — every
// message bubble in the whole conversation, not just the one being typed
// into. Relies on the parent passing stable callback identities (see
// `onOpenThread`/`onOpenLink` usage in ChatView) — an inline arrow function
// recreated on every render defeats memoization just as surely as skipping
// it entirely.
export const MessageBubble = memo(function MessageBubble({
  message,
  toolEvents,
  phase,
  onOpenThread,
  onOpenLink,
  onQuickReply,
  fontSizeClass = "prose-base",
}: Props) {
  const { t } = useLang();
  const AUTHOR_LABEL = useAuthorLabel();
  const isToolActivity = message.message_type === "tool_call" || message.message_type === "tool_result";
  const isUser = message.author_kind === "user";
  const isSystem = message.author_kind === "system";

  if (isToolActivity) {
    return (
      <details className="max-w-[85%] self-start rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
        <summary className="cursor-pointer font-mono text-neutral-500 dark:text-neutral-400">
          {AUTHOR_LABEL[message.author_kind]} · {t("toolActivity.label")}
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-neutral-600 dark:text-neutral-300">
          {message.content}
        </pre>
      </details>
    );
  }

  if (isSystem) {
    return (
      <div className="self-center rounded-full bg-neutral-100 px-3 py-1 text-center text-xs italic text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400">
        {message.content}
      </div>
    );
  }

  return (
    <div className={`flex max-w-[75%] items-end gap-2 ${isUser ? "flex-row-reverse self-end" : "self-start"}`}>
      <Avatar authorKind={message.author_kind} label={AUTHOR_LABEL[message.author_kind]} />
      <div
        className={`flex min-w-0 flex-col overflow-x-hidden rounded-2xl px-3.5 py-2.5 ${AUTHOR_BUBBLE[message.author_kind]}`}
      >
        {!isUser && (
          <span className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold opacity-70">
            {AUTHOR_LABEL[message.author_kind]}
            {message.model && <span className="font-normal opacity-70">· {message.model}</span>}
          </span>
        )}

        {message.attachments.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {message.attachments.map((a, i) =>
              a.kind === "image" ? (
                <img
                  key={i}
                  src={`data:${a.mimeType};base64,${a.dataBase64}`}
                  alt={a.name}
                  className="h-24 w-24 rounded-lg object-cover"
                />
              ) : (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 bg-black/5 px-2 py-1 text-[11px] dark:border-white/10 dark:bg-white/5"
                >
                  <IconFolder className="h-3 w-3" />
                  {a.name}
                </span>
              ),
            )}
          </div>
        )}

        {!isUser && message.content === "" ? (
          // No text yet — true whether the agent hasn't started (thinking)
          // or is mid tool-call/subagent with no chunks emitted yet, so the
          // dots alone already cover both; the tool label below adds the
          // specific reason once we know it. Never applies to the user's own
          // messages — those can legitimately have empty text when the
          // message is attachment-only.
          <span className="opacity-60">
            <TypingIndicator />
          </span>
        ) : message.content !== "" ? (
          <div
            className={`prose ${fontSizeClass} max-w-none break-words [&_p]:my-1 [&_pre]:overflow-x-auto [&_hr]:my-3 [&_hr]:border-current [&_hr]:opacity-20`}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks]}
              components={{
                a: ({ href, children }) => (
                  <a
                    href={href}
                    onClick={(e) => {
                      // Keep link clicks inside the app's own main content
                      // area (an embedded browser panel) instead of handing
                      // off to the OS's external browser or navigating the
                      // webview itself away from the chat.
                      e.preventDefault();
                      if (href) onOpenLink?.(href);
                    }}
                    className="underline"
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
            {(phase === "streaming" || phase === "tool") && (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-current opacity-60" />
            )}
          </div>
        ) : null}

        {phase === "tool" && (
          <span className="mt-1 inline-flex items-center gap-1.5 text-[11px] opacity-70">
            <IconWrench className="h-3 w-3" />
            {t("tool.usingTool")}
            <TypingIndicator />
          </span>
        )}

        {toolEvents && toolEvents.length > 0 && (
          <button
            className="mt-1.5 inline-flex w-fit items-center gap-1.5 rounded-full border border-black/10 bg-black/5 px-2.5 py-1 text-[11px] font-medium opacity-80 transition hover:opacity-100 dark:border-white/10 dark:bg-white/5"
            onClick={() => onOpenThread?.(message.id)}
          >
            <IconWrench className="h-3 w-3" />
            {t("tool.viewDetails", { n: String(toolEvents.length) })}
          </button>
        )}
        {(phase !== undefined || (!isUser && !isSystem && (message.author_kind === "claude" || message.author_kind === "codex" || message.author_kind === "grok" || message.author_kind === "orchestrator"))) && <div className="mt-2 flex w-full items-center justify-end gap-2">
        {phase !== undefined && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-medium text-amber-700 dark:text-amber-300">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
            </span>
            {t("badge.running")}
            <TypingIndicator />
          </span>
        )}
        {!isUser && !isSystem && (message.author_kind === "claude" || message.author_kind === "codex" || message.author_kind === "grok" || message.author_kind === "orchestrator") && (
          <button
            onClick={() => onQuickReply?.(message.author_kind as "claude" | "codex" | "grok" | "orchestrator")}
            className="inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-1 text-[11px] opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
            title={`Reply to ${AUTHOR_LABEL[message.author_kind]}`}
            aria-label={`Reply to ${AUTHOR_LABEL[message.author_kind]}`}
          >
            <IconReply className="h-3 w-3" /> Reply
          </button>
        )}
        </div>}
      </div>
    </div>
  );
});
