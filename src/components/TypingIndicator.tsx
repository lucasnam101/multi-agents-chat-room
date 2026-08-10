export function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 py-0.5">
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-current" style={{ animationDelay: "0ms" }} />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-current" style={{ animationDelay: "160ms" }} />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-current" style={{ animationDelay: "320ms" }} />
    </span>
  );
}
