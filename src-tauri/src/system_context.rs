//! Shared system-context text injected into every agent (and orchestrator)
//! session's priming prompt, so Claude/Codex always know: (1) what this app
//! is, (2) that `@claude`/`@codex` in their own reply is a real, working
//! hand-off mechanism (not just chat decoration), and (3) to reply concisely.
//! Kept as a checked-in file rather than an inline string so it's easy to
//! tweak without hunting through code.

pub const SYSTEM_CONTEXT: &str = include_str!("../APP_CONTEXT.md");
