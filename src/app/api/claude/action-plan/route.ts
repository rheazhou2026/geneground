import { z } from "zod";
import { proposeReviewActionPlanWithClaude, validateReviewActionPlan } from "@/lib/claude/actionPlan";
import { createMockActionPlan } from "@/lib/interactiveReviewMock";
import type { InterpretationClaimMap } from "@/lib/interactiveReviewMock";
import { FinalClaimResultSchema, FinalVerdictResultSchema, ReviewRequestedActionSchema, RetrievedChunkSchema, TextSelectionContextSchema } from "@/lib/schemas";

const InterpretationClaimMapSchema = z.object({
  interpretation_id: z.string(),
  full_text: z.string(),
  sentences: z.array(
    z.object({ sentence_id: z.string(), text: z.string(), span_start: z.number(), span_end: z.number(), claim_ids: z.array(z.string()) }),
  ),
  claims: z.array(
    z.object({ claim_id: z.string(), sentence_id: z.string(), original_text: z.string(), span_start: z.number().optional(), span_end: z.number().optional() }),
  ),
});

const RequestBodySchema = z.object({
  selectionContext: TextSelectionContextSchema,
  requestedAction: ReviewRequestedActionSchema,
  claimResult: FinalClaimResultSchema.nullable(),
  retrievedChunks: z.array(RetrievedChunkSchema),
  currentRewrittenText: z.string(),
  // Only needed for the deterministic mock fallback path.
  finalVerdictResult: FinalVerdictResultSchema,
  interpretationClaimMap: InterpretationClaimMapSchema,
});

/**
 * Step 11 — Review Action Plan. Claude proposes; validateReviewActionPlan
 * always re-checks every claim_id/sentence_id/chunk_id reference and forces
 * status back to awaiting_user_approval before anything is trusted. Falls
 * back to the deterministic mock action plan builder on any Claude failure.
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

  const { selectionContext, requestedAction, claimResult, retrievedChunks, currentRewrittenText, finalVerdictResult, interpretationClaimMap } = parsed.data;

  const validationContext = {
    knownClaimIds: new Set(finalVerdictResult.claim_results.map((c) => c.claim_id)),
    knownSentenceIds: new Set((interpretationClaimMap as InterpretationClaimMap).sentences.map((s) => s.sentence_id)),
    knownChunkIds: new Set(retrievedChunks.map((c) => c.chunk_id)),
  };

  const claudeResult = await proposeReviewActionPlanWithClaude({ selectionContext, requestedAction, claimResult, retrievedChunks, currentRewrittenText });
  if (claudeResult.ok) {
    const { plan, warnings } = validateReviewActionPlan(claudeResult.data, validationContext);
    return Response.json({ source: "claude", data: plan, repaired: warnings.length > 0 ? warnings : undefined });
  }

  const fallback = createMockActionPlan(selectionContext, requestedAction, finalVerdictResult, interpretationClaimMap as InterpretationClaimMap);
  return Response.json({ source: "mock", data: fallback, warning: claudeResult.reason });
}
