// Regression checks for this turn's fixes:
//   1. Approved action-plan edits apply to the CURRENT grounded rewrite text
//      (not the original interpretation text), via a safe priority order:
//      DOM anchor -> validated current span -> exact single-occurrence text
//      match -> refuse (src/lib/interactiveReviewMock.ts).
//   2. Segment splicing after an edit keeps every untouched claim segment's
//      identity/offsets correct, so claim-click behavior survives an edit.
//   3. A malformed (dangling-clause) result is rejected rather than applied.
//   4. Each claim gets its own biologist_friendly_explanation, built from its
//      OWN wording — a methodological-caveat claim no longer falls through
//      to a different claim's low-support-signal reason
//      (src/lib/finalVerdictAggregator.ts).
//   5. A trivial wording touch-up is classified as non-material, not a full
//      rewrite (src/lib/claimRewriteDisplay.ts).
// Run via `npm run test`. No gold verdicts, no hardcoded claim IDs.

import {
  applyEditToDisplaySegments,
  applyGroundedRewriteEdit,
  buildDisplaySegments,
  groundedRewriteTextFromSegments,
  looksLikeSafeSentenceStart,
  resolveGroundedRewriteReplacementRange,
  type DisplaySegment,
} from "@/lib/interactiveReviewMock";
import type { TextSegment } from "@/lib/interactiveReviewMock";
import { buildBiologistFriendlyExplanation } from "@/lib/finalVerdictAggregator";
import { classifyRewriteMateriality } from "@/lib/claimRewriteDisplay";
import type { AgentResult, AgentType, AgentVerdictLabel, ReviewProposedChange } from "@/lib/schemas";

let passCount = 0;
const failures: string[] = [];

function check(name: string, condition: boolean) {
  if (condition) {
    passCount += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

function change(overrides: Partial<ReviewProposedChange> = {}): Pick<ReviewProposedChange, "original_text" | "proposed_text" | "affected_span_start" | "affected_span_end"> {
  return {
    original_text: "",
    proposed_text: "",
    affected_span_start: null,
    affected_span_end: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Safe replacement resolution priority order
// ---------------------------------------------------------------------------

section("1. resolveGroundedRewriteReplacementRange follows the required priority order");

const currentText = "NFKB2 knockdown is associated with an inflammatory signature using single-timepoint data with fewer cells than the full cohort.";

// Priority 1 — a DOM anchor is trusted even if affected_span_start/end (stale, original-text coordinates) point somewhere else entirely.
const domSpan = { start: currentText.indexOf("single-timepoint data with fewer cells"), end: currentText.indexOf("single-timepoint data with fewer cells") + "single-timepoint data with fewer cells".length };
const domResolved = resolveGroundedRewriteReplacementRange(currentText, change({ original_text: "irrelevant stale text", affected_span_start: 0, affected_span_end: 5 }), domSpan);
check("a valid DOM anchor is used even when affected_span_start/end point elsewhere", domResolved.ok && domResolved.source === "dom_anchor" && domResolved.start === domSpan.start);

// Priority 2 — affected_span_start/end are trusted only when they actually match original_text in the CURRENT text.
const validCurrentSpanStart = currentText.indexOf("inflammatory signature");
const validCurrentSpanEnd = validCurrentSpanStart + "inflammatory signature".length;
const currentSpanResolved = resolveGroundedRewriteReplacementRange(
  currentText,
  change({ original_text: "inflammatory signature", affected_span_start: validCurrentSpanStart, affected_span_end: validCurrentSpanEnd }),
  null,
);
check("affected_span_start/end are used when they demonstrably refer to the current text", currentSpanResolved.ok && currentSpanResolved.source === "current_span");

// Stale span (original-interpretation-text coordinates that no longer line up with the current text) must NOT be trusted blindly.
const staleSpanResolved = resolveGroundedRewriteReplacementRange(
  currentText,
  change({ original_text: "single-timepoint data with fewer cells", affected_span_start: 0, affected_span_end: 5 }),
  null,
);
check("a stale affected_span_start/end that doesn't match original_text in the current text is rejected", staleSpanResolved.ok && staleSpanResolved.source === "exact_text_match");

// Priority 3 — exact, single-occurrence original_text match, with no span info at all.
const exactMatchResolved = resolveGroundedRewriteReplacementRange(currentText, change({ original_text: "single-timepoint data with fewer cells" }), null);
check(
  "an exact single-occurrence original_text match is used when no span is available",
  exactMatchResolved.ok && exactMatchResolved.source === "exact_text_match" && exactMatchResolved.start === currentText.indexOf("single-timepoint data with fewer cells"),
);

// Priority 4 — ambiguous (multiple occurrences) must refuse, not guess.
const ambiguousText = "the cells the cells the cells";
const ambiguousResolved = resolveGroundedRewriteReplacementRange(ambiguousText, change({ original_text: "the cells" }), null);
check("multiple occurrences of original_text are refused rather than silently applied", !ambiguousResolved.ok);
check("the refusal message matches the required warning text", !ambiguousResolved.ok && ambiguousResolved.reason === "Could not safely apply edit. Please reselect the text.");

// No occurrence at all must also refuse.
const noMatchResolved = resolveGroundedRewriteReplacementRange(currentText, change({ original_text: "text that never appears anywhere" }), null);
check("no occurrence of original_text is refused rather than silently applied", !noMatchResolved.ok);

// ---------------------------------------------------------------------------
// 2. applyGroundedRewriteEdit: end-to-end apply + malformed-text guardrail
// ---------------------------------------------------------------------------

section("2. applyGroundedRewriteEdit applies safely and guards against malformed results");

const claim9Text =
  "This is a transcriptional association using single-timepoint data with fewer cells than the confirmatory cohort, so we avoid claiming mechanism.";
const editResult = applyGroundedRewriteEdit(
  claim9Text,
  change({ original_text: "single-timepoint data with fewer cells", proposed_text: "cross-timepoint data with matched cell counts" }),
  { start: claim9Text.indexOf("single-timepoint data with fewer cells"), end: claim9Text.indexOf("single-timepoint data with fewer cells") + "single-timepoint data with fewer cells".length },
);
check("a well-formed edit applies successfully", editResult.ok);
check(
  "the resulting text still begins with the original sentence's normal start, not cut off",
  editResult.ok && editResult.newText.startsWith("This is a transcriptional association"),
);
check(
  "the resulting text contains the newly applied phrase",
  editResult.ok && editResult.newText.includes("cross-timepoint data with matched cell counts"),
);

// A replacement that would truncate the leading portion of the text (e.g. a
// bad offset landing mid-sentence) must be rejected, not silently applied.
const malformedResult = applyGroundedRewriteEdit(claim9Text, change({ original_text: "irrelevant", proposed_text: "irrelevant" }), { start: 0, end: 30 });
check("a replacement that would leave a dangling lowercase clause at the very start is rejected", !malformedResult.ok);

check("looksLikeSafeSentenceStart accepts a normal capitalized sentence", looksLikeSafeSentenceStart("NFKB2 knockdown is associated with..."));
check("looksLikeSafeSentenceStart rejects a dangling lowercase clause", !looksLikeSafeSentenceStart("cells than the full cohort, consistent with..."));

// ---------------------------------------------------------------------------
// 3. applyEditToDisplaySegments preserves untouched segment identity/offsets
// ---------------------------------------------------------------------------

section("3. applyEditToDisplaySegments splices in place and keeps other claims' segments intact");

function seg(text: string, claimId: string | null, spanStart: number): DisplaySegment {
  return { text, claimId, spanStart, spanEnd: spanStart + text.length };
}

const segA = seg("Claim one text. ", "claim-1", 0);
const segB = seg("Claim two has single-timepoint data with fewer cells here. ", "claim-2", segA.spanEnd);
const segC = seg("Claim three text.", "claim-3", segB.spanEnd);
const initialSegments = [segA, segB, segC];
const initialText = groundedRewriteTextFromSegments(initialSegments);

const editStart = initialText.indexOf("single-timepoint data with fewer cells");
const editEnd = editStart + "single-timepoint data with fewer cells".length;
const newSegments = applyEditToDisplaySegments(initialSegments, editStart, editEnd, "cross-timepoint data with matched cell counts");

check("the edit only touches claim-2's segment", newSegments.find((s) => s.claimId === "claim-2")?.text.includes("cross-timepoint data with matched cell counts") === true);
check("claim-1's segment text is untouched", newSegments.find((s) => s.claimId === "claim-1")?.text === segA.text);
check("claim-3's segment text is untouched", newSegments.find((s) => s.claimId === "claim-3")?.text === segC.text);
check(
  "claim-3's offsets are shifted to match the new (longer) text, so a later click on it still resolves correctly",
  newSegments.find((s) => s.claimId === "claim-3")?.spanStart === groundedRewriteTextFromSegments(newSegments).indexOf("Claim three text."),
);
check("the joined post-edit text round-trips through the new segments consistently", groundedRewriteTextFromSegments(newSegments).includes("cross-timepoint data with matched cell counts"));

// buildDisplaySegments correctly seeds initial offsets from a resolver function.
const baseSegs: TextSegment[] = [
  { text: "Intro. ", claimId: null, spanStart: 0, spanEnd: 7 },
  { text: "original claim text", claimId: "claim-x", spanStart: 7, spanEnd: 27 },
];
const built = buildDisplaySegments(baseSegs, (claimId, original) => (claimId === "claim-x" ? "a much longer rewritten claim text" : original));
check("buildDisplaySegments substitutes the resolved text for claim segments", built[1].text === "a much longer rewritten claim text");
check("buildDisplaySegments recomputes cumulative offsets from the resolved (possibly different-length) text", built[1].spanStart === 7 && built[1].spanEnd === 7 + "a much longer rewritten claim text".length);

// ---------------------------------------------------------------------------
// 4. Claim-card reason mapping: each claim gets its own reason
// ---------------------------------------------------------------------------

section("4. Each claim's biologist_friendly_explanation is built from its own wording, never leaked from another claim");

function agentResult(agentType: AgentType, verdict: AgentVerdictLabel, overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    agent_type: agentType,
    agent_query_id: `q-${agentType}`,
    claim_id: "c-synthetic",
    agent_verdict: verdict,
    confidence: 0.6,
    evidence_chunk_ids: ["chunk-1"],
    supporting_points: [],
    weak_points: [],
    missing_evidence: [],
    risk_flags: [],
    agent_reasoning_summary: `${agentType} reasoning summary.`,
    ...overrides,
  };
}

const genericAgents = {
  perturbation_evidence: agentResult("perturbation_evidence", "supports_with_caveats"),
  pathway_signature: agentResult("pathway_signature", "supports_with_caveats"),
  robustness_quality: agentResult("robustness_quality", "supports_with_caveats"),
  language_causality: agentResult("language_causality", "supports_with_caveats"),
};

// Claim 9-style: a methodological caveat claim with low-support-looking
// caveats attached (the exact condition that previously let it fall through
// to the low-support-signal branch and pick up a DIFFERENT claim's reason).
const claim9OriginalText =
  "These are transcriptional associations; CRISPRi represses rather than fully knocks out the target, so this does not establish a causal mechanism.";
const claim9Result = {
  final_verdict: "supported_with_caveats" as const,
  supported_parts: [] as string[],
  caveats: ["Evidence has low donor support (2 donors) and a single guide."],
  missing_evidence: [] as string[],
  recommended_action: "accept" as const,
};
const claim9Reason = buildBiologistFriendlyExplanation(claim9Result, genericAgents, claim9OriginalText);

check(
  "Claim 9's reason matches the expected methodological-caveat text exactly",
  claim9Reason ===
    "This claim is already an appropriate methodological caveat: it frames the results as transcriptional associations, notes that CRISPRi is knockdown rather than knockout, and avoids claiming causal mechanism.",
);
check("Claim 9's reason never mentions BATF or another gene's low-cell-support wording", !/BATF/i.test(claim9Reason) && !/low cell support/i.test(claim9Reason));

// Claim 7-style: a plain BATF exploratory-result claim with genuinely low
// support and NO self-cautioning methodological wording of its own.
const claim7OriginalText = "BATF perturbation shows an exhaustion-like signature shift in stimulated CD4+ T cells.";
const claim7Result = {
  final_verdict: "supported_with_caveats" as const,
  supported_parts: [] as string[],
  caveats: ["Low guide and donor support (2 guides, low target expression flag)."],
  missing_evidence: [] as string[],
  recommended_action: "accept" as const,
};
const claim7Reason = buildBiologistFriendlyExplanation(claim7Result, genericAgents, claim7OriginalText);

check(
  "Claim 7's reason matches the expected BATF exploratory text exactly",
  claim7Reason ===
    "The BATF result is appropriately labeled exploratory because the evidence has low cell support. GeneGround preserves the caveat rather than strengthening the claim.",
);
check("Claim 7's reason never mentions the methodological-caveat framing", !/methodological caveat/i.test(claim7Reason));

// ---------------------------------------------------------------------------
// 5. Rewrite materiality classification
// ---------------------------------------------------------------------------

section("5. classifyRewriteMateriality distinguishes identical / minor clarification / material rewrites");

check(
  "identical text (case/whitespace differences only) classifies as identical",
  classifyRewriteMateriality("NFKB2 knockdown increases signaling.", "  NFKB2 knockdown increases signaling.  ") === "identical",
);
check(
  "a single inserted qualifying word classifies as a minor clarification",
  classifyRewriteMateriality(
    "IRF4 perturbation shows a perturbation-linked response in stimulated cells.",
    "IRF4 perturbation shows a perturbation-linked transcriptional response in stimulated cells.",
  ) === "minor_clarification",
);
check(
  "a softened verb and restructured wording classifies as material",
  classifyRewriteMateriality(
    "STAT1 knockdown drives inflammatory activation as a master regulator.",
    "STAT1 knockdown is associated with increased inflammatory activation; this is transcriptomic-level evidence, not a confirmed mechanism.",
  ) === "material",
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passCount} passed, ${failures.length} failed.`);
if (failures.length > 0) {
  console.log("\nFailed checks:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
