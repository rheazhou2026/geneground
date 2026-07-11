// Central Claude API configuration — the only place a model string should
// ever appear. Server-side only: never import this from a "use client" file.

/** Default model for all GeneGround Claude calls. Override via ANTHROPIC_MODEL. */
export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5";

/** Per-task default max_tokens — generous enough for one claim's worth of structured JSON, not open-ended. */
export const CLAUDE_MAX_TOKENS = {
  claim_extraction: 4096,
  agent_evaluation: 2048,
  final_rewrite: 1024,
  selection_chat: 1024,
  action_plan: 1536,
} as const;

/**
 * True only when a non-empty ANTHROPIC_API_KEY is present server-side. This
 * is the single source of truth for "is Claude API mode actually usable" —
 * every Claude-calling function and the /api/claude/status route both defer
 * to this rather than re-checking process.env themselves.
 */
export function isClaudeApiConfigured(): boolean {
  return typeof process.env.ANTHROPIC_API_KEY === "string" && process.env.ANTHROPIC_API_KEY.trim().length > 0;
}
