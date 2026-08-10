//! Pure text @mention parsing — no model call. See NEW_TOOL_PLAN_V2.md §7.

use crate::acp::AgentKind;
use regex::Regex;
use std::sync::OnceLock;

fn mention_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\B@(claude|codex)\b").unwrap())
}

/// Distinct agent kinds mentioned in `content`, in first-occurrence order.
pub fn find_mentions(content: &str) -> Vec<AgentKind> {
    let mut seen = Vec::new();
    for cap in mention_re().captures_iter(content) {
        let kind = match cap[1].to_ascii_lowercase().as_str() {
            "claude" => AgentKind::Claude,
            "codex" => AgentKind::Codex,
            _ => continue,
        };
        if !seen.contains(&kind) {
            seen.push(kind);
        }
    }
    seen
}

pub const MAX_CHAIN_DEPTH: u32 = 5;
