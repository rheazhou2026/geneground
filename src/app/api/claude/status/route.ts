import { CLAUDE_MODEL, isClaudeApiConfigured } from "@/lib/claude/config";

/**
 * Reports whether Claude API mode is actually usable server-side — the UI's
 * "Claude API enabled" / "Mock mode" indicator reads this instead of trying
 * to infer it from a public env var (the API key itself is never sent to
 * the client).
 */
export async function GET() {
  const configured = isClaudeApiConfigured();
  return Response.json({
    configured,
    model: configured ? CLAUDE_MODEL : null,
    mode: configured ? "claude" : "mock",
  });
}
