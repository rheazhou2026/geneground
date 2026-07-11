import { z } from "zod";
import { evaluateClaimAgentsWithClaude } from "@/lib/claude/agentEvaluation";
import { runFourMockAgentsForClaim } from "@/lib/mockAgents";
import { ClaimRetrievedEvidenceSchema, ExtractedClaimSchema, NormalizedClaimEntitiesSchema } from "@/lib/schemas";

const RequestBodySchema = z.object({
  extractedClaim: ExtractedClaimSchema,
  normalizedClaim: NormalizedClaimEntitiesSchema,
  claimEvidence: ClaimRetrievedEvidenceSchema,
});

/**
 * Step 7B — four-agent evaluation, one Claude call per claim. Falls back to
 * the deterministic mock agents (src/lib/mockAgents.ts) on any failure.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = RequestBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Request body did not match the expected schema.", issues: parsed.error.issues.slice(0, 10) }, { status: 400 });
  }

  const claudeResult = await evaluateClaimAgentsWithClaude(parsed.data);
  if (claudeResult.ok) {
    return Response.json({ source: "claude", data: claudeResult.data });
  }

  const fallback = runFourMockAgentsForClaim(parsed.data.claimEvidence);
  return Response.json({ source: "mock", data: fallback, warning: claudeResult.reason });
}
