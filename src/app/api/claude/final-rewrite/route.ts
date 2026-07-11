import { z } from "zod";
import { checkRewriteEntityExpansion, generateFinalReasonAndRewriteWithClaude } from "@/lib/claude/finalRewrite";
import { getArchitectureOverstatedReason } from "@/lib/finalVerdictAggregator";
import { shortenReason } from "@/lib/reasonSummary";
import { ClaimAgentResultsSchema, FinalClaimResultSchema } from "@/lib/schemas";

const RequestBodySchema = z.object({
  finalClaimResult: FinalClaimResultSchema,
  claimAgentResults: ClaimAgentResultsSchema,
});

/**
 * Step 8, hybrid — Reason + Rewritten_Claim only. final_verdict is passed in
 * already decided (deterministic) and is never changed here. Falls back to
 * the deterministic biologist_friendly_explanation/safer_rewrite already on
 * finalClaimResult (src/lib/finalVerdictAggregator.ts) on any failure.
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

  const claudeResult = await generateFinalReasonAndRewriteWithClaude(parsed.data);
  if (claudeResult.ok) {
    const { original_claim_text } = parsed.data.finalClaimResult;
    const expansionCheck = checkRewriteEntityExpansion(original_claim_text, claudeResult.data.Rewritten_Claim);
    // Reject the whole rewrite rather than trying to surgically remove the
    // new entity — a mid-sentence excise is likely to leave broken grammar.
    // Fall back to the deterministic safer_rewrite already computed during
    // aggregation (src/lib/finalVerdictAggregator.ts), which only ever
    // substitutes trigger words/phrases and can't invent new entities. The
    // evidence index itself carries genes (FOXP3, RELB, ...) far beyond
    // whatever a single live-demo interpretation actually discusses, so this
    // check is what keeps a rewrite from "borrowing" one of them.
    const safer_rewrite = expansionCheck.hasNewEntities ? parsed.data.finalClaimResult.safer_rewrite : claudeResult.data.Rewritten_Claim;

    const newEntityLabel = [...expansionCheck.newGenes, ...expansionCheck.newPathways, ...expansionCheck.newConditions].join(", ");

    // Architecture/network-family overstated claims ("define distinct arms",
    // "regulatory network", ...) always get the same fixed, pre-verified
    // reason, overriding whatever Claude generated — a free-generated reason
    // for this claim shape previously invented specifics like "only two
    // genes were perturbed" that weren't grounded in the claim/entities/
    // chunks at all. See getArchitectureOverstatedReason.
    const architectureReason = getArchitectureOverstatedReason(parsed.data.finalClaimResult.final_verdict, original_claim_text);

    return Response.json({
      source: expansionCheck.hasNewEntities ? "mock" : "claude",
      data: {
        ...parsed.data.finalClaimResult,
        // Clamped to ~1-2 sentences for the claim card regardless of how
        // long Claude's own Reason came back — detailed_reason (already set
        // deterministically from the four agents' own rationales) is left
        // untouched as the longer-form text for Evidence Trace/Technical Pipeline.
        biologist_friendly_explanation: architectureReason ?? shortenReason(claudeResult.data.Reason),
        safer_rewrite,
      },
      // Only ever surfaced in Technical Pipeline's Warnings/fallbacks section
      // (src/app/demo/page.tsx pushes this into pipelineWarnings, which
      // TechnicalPipelineDetail is the only consumer of) — never shown on the
      // main claim card, so an entity-expansion rejection stays a quiet,
      // technical-only signal.
      warning: expansionCheck.hasNewEntities
        ? `Claude's rewrite introduced entities not present in the original claim (${newEntityLabel}) — used the deterministic rewrite instead.`
        : undefined,
    });
  }

  return Response.json({ source: "mock", data: parsed.data.finalClaimResult, warning: claudeResult.reason });
}
