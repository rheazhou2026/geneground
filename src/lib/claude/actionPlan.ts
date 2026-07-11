// Step 11 — Claude-powered Review Action Plan proposal + deterministic
// validation. Server-side only. Claude only ever proposes; every taxonomy
// label and every claim_id/sentence_id/chunk_id reference is validated (and
// repaired/stripped if invalid) by validateReviewActionPlan before the plan
// is trusted, and status is always forced to awaiting_user_approval — no
// change is ever auto-applied.

import { z } from "zod";
import { callClaudeJson, lenientArray, type CallClaudeJsonResult, type ClaudeJsonToolSchema } from "./client";
import { CLAUDE_MAX_TOKENS } from "./config";
import { AGENT_TYPES, CHANGE_TYPES } from "../taxonomies";
import type { FinalClaimResult, ReviewActionPlan, ReviewRequestedAction, RetrievedChunk, TextSelectionContext } from "../schemas";

const ClaudeProposedChangeSchema = z.object({
  change_type: z.enum(CHANGE_TYPES),
  original_text: z.string(),
  proposed_text: z.string(),
  reason: z.string(),
});

const ClaudeActionPlanOutputSchema = z.object({
  agents_to_rerun: z.array(z.enum(AGENT_TYPES)),
  proposed_changes: lenientArray(ClaudeProposedChangeSchema),
  explanation: z.string(),
});
type ClaudeActionPlanOutput = z.infer<typeof ClaudeActionPlanOutputSchema>;

const ACTION_PLAN_INPUT_SCHEMA: ClaudeJsonToolSchema = {
  type: "object",
  properties: {
    agents_to_rerun: {
      type: "array",
      items: { type: "string", enum: [...AGENT_TYPES] },
      description: "Which of the four verification agents should be rerun if this plan is approved. Empty array if none need rerunning.",
    },
    proposed_changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          change_type: { type: "string", enum: [...CHANGE_TYPES] },
          original_text: { type: "string", description: "Exact text being replaced/annotated — must be a substring of the selected text or current rewritten claim." },
          proposed_text: { type: "string" },
          reason: { type: "string" },
        },
        required: ["change_type", "original_text", "proposed_text", "reason"],
      },
    },
    explanation: { type: "string", description: "One or two sentences summarizing the proposed plan for the user." },
  },
  required: ["agents_to_rerun", "proposed_changes", "explanation"],
};

function buildSystemPrompt(): string {
  return [
    "You draft a Review Action Plan for GeneGround, responding to a scientist's request about one selected span of an AI-generated interpretation.",
    "You only ever PROPOSE — nothing you return is applied automatically; a human always approves, edits, or cancels it afterward.",
    `change_type must be exactly one of: ${CHANGE_TYPES.join(", ")}.`,
    `agents_to_rerun entries must be exactly one of: ${AGENT_TYPES.join(", ")} (empty array if no agent needs rerunning).`,
    "original_text in each proposed change must be copied from the selected text or the claim's current rewritten text — do not invent text that isn't there.",
    "Ground every proposed_text in the linked claim's evidence and Reason — do not add unsupported claims.",
    "",
    "Call the return_action_plan tool exactly once with your proposal.",
  ].join("\n");
}

function buildUserPrompt(input: ProposeReviewActionPlanWithClaudeInput): string {
  const { selectionContext, requestedAction, claimResult, retrievedChunks, currentRewrittenText } = input;
  const chunkLines = retrievedChunks.length > 0 ? retrievedChunks.map((c) => `[${c.chunk_id}] ${c.text_for_embedding}`).join("\n") : "(no evidence chunks linked)";

  return [
    `User request: ${requestedAction}`,
    `Selected text: "${selectionContext.selected_text}"`,
    `Current rewritten text for this claim: "${currentRewrittenText}"`,
    claimResult
      ? [`final_verdict: ${claimResult.final_verdict}`, `Reason: ${claimResult.biologist_friendly_explanation}`, `Existing Rewritten_Claim: ${claimResult.safer_rewrite}`].join("\n")
      : "No linked claim result was found for this selection.",
    "",
    "Evidence chunks:",
    chunkLines,
  ].join("\n");
}

export interface ProposeReviewActionPlanWithClaudeInput {
  selectionContext: TextSelectionContext;
  requestedAction: ReviewRequestedAction;
  claimResult: FinalClaimResult | null;
  retrievedChunks: RetrievedChunk[];
  currentRewrittenText: string;
}

function buildDraftPlan(input: ProposeReviewActionPlanWithClaudeInput, output: ClaudeActionPlanOutput): ReviewActionPlan {
  const { selectionContext, requestedAction, claimResult } = input;
  return {
    action_plan_id: `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    selection_id: selectionContext.selection_id,
    requested_action: requestedAction,
    scope: selectionContext.selection_scope,
    affected_claim_ids: selectionContext.matched_claim_ids,
    affected_sentence_ids: selectionContext.matched_sentence_ids,
    evidence_to_reuse: claimResult ? claimResult.evidence_basis.evidence_chunk_ids : [],
    agents_to_rerun: output.agents_to_rerun,
    proposed_changes: output.proposed_changes.map((change, index) => ({
      change_id: `change-${index + 1}`,
      change_type: change.change_type,
      original_text: change.original_text,
      proposed_text: change.proposed_text,
      reason: change.reason,
      affected_span_start: selectionContext.span_start,
      affected_span_end: selectionContext.span_end,
    })),
    user_decision_options: ["approve", "cancel", "edit"],
    status: "awaiting_user_approval",
    explanation: output.explanation,
    warnings: [],
  };
}

export async function proposeReviewActionPlanWithClaude(input: ProposeReviewActionPlanWithClaudeInput): Promise<CallClaudeJsonResult<ReviewActionPlan>> {
  const result = await callClaudeJson({
    taskName: "action_plan",
    system: buildSystemPrompt(),
    prompt: buildUserPrompt(input),
    toolName: "return_action_plan",
    toolDescription: "Return the proposed action plan as structured JSON matching the required schema.",
    inputSchema: ACTION_PLAN_INPUT_SCHEMA,
    schema: ClaudeActionPlanOutputSchema,
    maxTokens: CLAUDE_MAX_TOKENS.action_plan,
  });

  if (!result.ok) return result;
  return { ok: true, data: buildDraftPlan(input, result.data), source: "claude" };
}

// ---------------------------------------------------------------------------
// Deterministic validation — always runs, whether the plan came from Claude
// or elsewhere. Taxonomy labels are already enum-constrained by the Zod
// parse above; this additionally verifies every ID reference actually
// exists and forces status back to awaiting_user_approval.
// ---------------------------------------------------------------------------

export interface ReviewActionPlanValidationContext {
  knownClaimIds: Set<string>;
  knownSentenceIds: Set<string>;
  knownChunkIds: Set<string>;
}

export interface ValidateReviewActionPlanResult {
  plan: ReviewActionPlan;
  warnings: string[];
}

export function validateReviewActionPlan(plan: ReviewActionPlan, context: ReviewActionPlanValidationContext): ValidateReviewActionPlanResult {
  const warnings: string[] = [];

  function filterKnown(ids: string[], known: Set<string>, label: string): string[] {
    return ids.filter((id) => {
      const ok = known.has(id);
      if (!ok) warnings.push(`Removed unknown ${label} '${id}' from action plan.`);
      return ok;
    });
  }

  const affected_claim_ids = filterKnown(plan.affected_claim_ids, context.knownClaimIds, "claim_id");
  const affected_sentence_ids = filterKnown(plan.affected_sentence_ids, context.knownSentenceIds, "sentence_id");
  const evidence_to_reuse = filterKnown(plan.evidence_to_reuse, context.knownChunkIds, "chunk_id");

  const validated: ReviewActionPlan = {
    ...plan,
    affected_claim_ids,
    affected_sentence_ids,
    evidence_to_reuse,
    // Never auto-apply — approval always required, regardless of what was proposed.
    status: "awaiting_user_approval",
    warnings: [...plan.warnings, ...warnings],
  };

  return { plan: validated, warnings };
}
