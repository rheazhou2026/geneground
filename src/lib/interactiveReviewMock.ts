import type {
  AgentType,
  ExtractedClaim,
  FinalClaimResult,
  FinalVerdictResult,
  InteractiveReviewThread,
  ReviewActionPlan,
  ReviewActionPlanStatus,
  ReviewProposedChange,
  ReviewRequestedAction,
  SelectionScope,
  TextSelectionContext,
} from "./schemas";

// ---------------------------------------------------------------------------
// InterpretationClaimMap — internal bridging structure, not Zod-validated
// (built purely from data we already trust: the source text + extracted
// claims). Preserves sentence <-> claim <-> character-span relationships so
// a browser text selection can be mapped back to claim/sentence IDs.
// ---------------------------------------------------------------------------

export interface InterpretationSentence {
  sentence_id: string;
  text: string;
  span_start: number;
  span_end: number;
  claim_ids: string[];
}

export interface InterpretationClaimRef {
  claim_id: string;
  sentence_id: string;
  original_text: string;
  span_start?: number;
  span_end?: number;
}

export interface InterpretationClaimMap {
  interpretation_id: string;
  full_text: string;
  sentences: InterpretationSentence[];
  claims: InterpretationClaimRef[];
}

interface Span {
  start: number;
  end: number;
}

function findSpan(haystack: string, needle: string, searchFrom = 0): Span | null {
  if (needle.length === 0) return null;
  const idx = haystack.indexOf(needle, searchFrom);
  if (idx !== -1) return { start: idx, end: idx + needle.length };

  // Step 2's therapeutic-split fragments capitalize their first letter,
  // which can differ from the source text's original casing.
  const lowerHaystack = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const idxCI = lowerHaystack.indexOf(lowerNeedle, searchFrom);
  return idxCI !== -1 ? { start: idxCI, end: idxCI + needle.length } : null;
}

function spansOverlap(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Reconstructs sentence/claim character spans from the original
 * interpretation text and the (already-split) extracted claims. Each
 * sentence's span is the union of its claim fragments' spans — fragments
 * from a split sentence are contiguous, so this recovers the full sentence
 * including the connecting words between fragments.
 */
export function buildInterpretationClaimMap(fullText: string, extractedClaims: ExtractedClaim[]): InterpretationClaimMap {
  const interpretation_id = extractedClaims[0]?.interpretation_id ?? "";

  const sentenceOrder: string[] = [];
  const claimsBySentence = new Map<string, ExtractedClaim[]>();
  for (const claim of extractedClaims) {
    if (!claimsBySentence.has(claim.sentence_id)) {
      claimsBySentence.set(claim.sentence_id, []);
      sentenceOrder.push(claim.sentence_id);
    }
    claimsBySentence.get(claim.sentence_id)?.push(claim);
  }

  const sentences: InterpretationSentence[] = [];
  const claims: InterpretationClaimRef[] = [];
  let searchCursor = 0;

  for (const sentenceId of sentenceOrder) {
    const sentenceClaims = claimsBySentence.get(sentenceId) ?? [];
    const claimSpans = sentenceClaims.map((claim) => ({
      claim,
      span: findSpan(fullText, claim.original_text, searchCursor),
    }));

    const validSpans = claimSpans.filter((c): c is { claim: ExtractedClaim; span: Span } => c.span !== null);
    const sentenceStart = validSpans.length > 0 ? Math.min(...validSpans.map((c) => c.span.start)) : searchCursor;
    const sentenceEnd = validSpans.length > 0 ? Math.max(...validSpans.map((c) => c.span.end)) : searchCursor;

    sentences.push({
      sentence_id: sentenceId,
      text: fullText.slice(sentenceStart, sentenceEnd),
      span_start: sentenceStart,
      span_end: sentenceEnd,
      claim_ids: sentenceClaims.map((c) => c.claim_id),
    });

    for (const { claim, span } of claimSpans) {
      claims.push({
        claim_id: claim.claim_id,
        sentence_id: claim.sentence_id,
        original_text: claim.original_text,
        span_start: span?.start,
        span_end: span?.end,
      });
    }

    if (sentenceEnd > searchCursor) searchCursor = sentenceEnd;
  }

  return { interpretation_id, full_text: fullText, sentences, claims };
}

/**
 * Flat left-to-right segments of the source text, each tagged with the claim
 * it belongs to (or null for connective text between claims). Used to render
 * claim highlights inline. spanStart/spanEnd are always original-source-text
 * coordinates (from InterpretationClaimMap) — stable even when a caller
 * chooses to *display* different text for a segment (e.g. a claim's
 * rewritten text instead of seg.text), which is what makes it possible to
 * compute a real span for a browser text selection by walking rendered
 * segment DOM nodes rather than fuzzy-matching selected text content.
 */
export interface TextSegment {
  text: string;
  claimId: string | null;
  spanStart: number;
  spanEnd: number;
}

export function buildTextSegments(fullText: string, claimMap: InterpretationClaimMap): TextSegment[] {
  const claimsWithSpans = claimMap.claims
    .filter((c): c is InterpretationClaimRef & { span_start: number; span_end: number } => c.span_start !== undefined && c.span_end !== undefined)
    .sort((a, b) => a.span_start - b.span_start);

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const claim of claimsWithSpans) {
    if (claim.span_start < cursor) continue; // overlapping fragment — skip defensively
    if (claim.span_start > cursor) segments.push({ text: fullText.slice(cursor, claim.span_start), claimId: null, spanStart: cursor, spanEnd: claim.span_start });
    segments.push({ text: fullText.slice(claim.span_start, claim.span_end), claimId: claim.claim_id, spanStart: claim.span_start, spanEnd: claim.span_end });
    cursor = claim.span_end;
  }
  if (cursor < fullText.length) segments.push({ text: fullText.slice(cursor), claimId: null, spanStart: cursor, spanEnd: fullText.length });
  return segments;
}

// ---------------------------------------------------------------------------
// Matching (Step 11 §4: span overlap first, text-substring fallback)
// ---------------------------------------------------------------------------

export function findMatchedSentences(selectionRange: Span | null, interpretationClaimMap: InterpretationClaimMap): string[] {
  if (!selectionRange) return [];
  return interpretationClaimMap.sentences
    .filter((s) => spansOverlap(selectionRange, { start: s.span_start, end: s.span_end }))
    .map((s) => s.sentence_id);
}

export function findMatchedClaims(
  selectionRange: Span | null,
  interpretationClaimMap: InterpretationClaimMap,
  finalVerdictResult?: FinalVerdictResult,
): string[] {
  if (!selectionRange) return [];
  const matched = interpretationClaimMap.claims
    .filter((c) => c.span_start !== undefined && c.span_end !== undefined)
    .filter((c) => spansOverlap(selectionRange, { start: c.span_start as number, end: c.span_end as number }))
    .map((c) => c.claim_id);

  if (matched.length === 0 || !finalVerdictResult) return matched;
  const validIds = new Set(finalVerdictResult.claim_results.map((c) => c.claim_id));
  return matched.filter((id) => validIds.has(id));
}

function findMatchedSentencesWithFallback(range: Span | null, selectedText: string, map: InterpretationClaimMap): string[] {
  const bySpan = findMatchedSentences(range, map);
  if (bySpan.length > 0) return bySpan;
  const lower = selectedText.toLowerCase();
  if (!lower) return [];
  return map.sentences.filter((s) => s.text.toLowerCase().includes(lower) || lower.includes(s.text.toLowerCase())).map((s) => s.sentence_id);
}

function findMatchedClaimsWithFallback(
  range: Span | null,
  selectedText: string,
  map: InterpretationClaimMap,
  finalVerdictResult?: FinalVerdictResult,
): string[] {
  const bySpan = findMatchedClaims(range, map, finalVerdictResult);
  if (bySpan.length > 0) return bySpan;
  const lower = selectedText.toLowerCase();
  if (!lower) return [];
  let matched = map.claims.filter((c) => c.original_text.toLowerCase().includes(lower) || lower.includes(c.original_text.toLowerCase())).map((c) => c.claim_id);
  if (matched.length > 0 && finalVerdictResult) {
    const validIds = new Set(finalVerdictResult.claim_results.map((c) => c.claim_id));
    matched = matched.filter((id) => validIds.has(id));
  }
  return matched;
}

function normalizeForCompare(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!?,;:]+$/, "");
}

export function inferSelectionScope(selectionContext: TextSelectionContext, interpretationClaimMap: InterpretationClaimMap): SelectionScope {
  const { selected_text, matched_sentence_ids, matched_claim_ids } = selectionContext;
  if (selected_text.trim().length === 0) return "unknown";
  if (matched_sentence_ids.length > 1) return "multi_sentence";

  if (matched_sentence_ids.length === 1) {
    const sentence = interpretationClaimMap.sentences.find((s) => s.sentence_id === matched_sentence_ids[0]);
    if (sentence && normalizeForCompare(sentence.text) === normalizeForCompare(selected_text)) return "sentence";
  }

  if (matched_claim_ids.length === 1) {
    const claim = interpretationClaimMap.claims.find((c) => c.claim_id === matched_claim_ids[0]);
    if (claim) {
      const a = normalizeForCompare(claim.original_text);
      const b = normalizeForCompare(selected_text);
      if (a === b) return "full_claim";
      if (b.length >= a.length * 0.85 && (a.includes(b) || b.includes(a))) return "full_claim";
      if (a.includes(b)) return "partial_claim";
    }
  } else if (matched_claim_ids.length > 1) {
    return "partial_claim";
  }

  const wordCount = selected_text.trim().split(/\s+/).length;
  if (wordCount <= 6) return "word_or_phrase";
  return matched_claim_ids.length > 0 || matched_sentence_ids.length > 0 ? "partial_claim" : "unknown";
}

let selectionCounter = 0;

export function createSelectionContext(
  selectedText: string,
  spanStart: number | null,
  spanEnd: number | null,
  interpretationClaimMap: InterpretationClaimMap,
  finalVerdictResult?: FinalVerdictResult,
): TextSelectionContext {
  selectionCounter += 1;
  const selection_id = `sel-${selectionCounter}`;
  const warnings: string[] = [];
  const trimmed = selectedText.trim();
  if (trimmed.length === 0) warnings.push("Selected text was empty after trimming.");

  let range: Span | null = null;
  if (spanStart !== null && spanEnd !== null && spanStart < spanEnd) {
    range = { start: spanStart, end: spanEnd };
  } else {
    range = findSpan(interpretationClaimMap.full_text, trimmed);
    if (!range) warnings.push("Could not locate the selected text's exact position; matched by text content only.");
  }

  const matched_sentence_ids = findMatchedSentencesWithFallback(range, trimmed, interpretationClaimMap);
  const matched_claim_ids = findMatchedClaimsWithFallback(range, trimmed, interpretationClaimMap, finalVerdictResult);

  const match_confidence = range && (matched_claim_ids.length > 0 || matched_sentence_ids.length > 0) ? 0.85 : matched_claim_ids.length > 0 ? 0.55 : 0.2;

  const draft: TextSelectionContext = {
    selection_id,
    interpretation_id: interpretationClaimMap.interpretation_id,
    selected_text: trimmed,
    span_start: range?.start ?? null,
    span_end: range?.end ?? null,
    selection_scope: "unknown",
    matched_sentence_ids,
    matched_claim_ids,
    match_confidence,
    warnings,
  };

  return { ...draft, selection_scope: inferSelectionScope(draft, interpretationClaimMap) };
}

// ---------------------------------------------------------------------------
// Chat thread + mock responses
// ---------------------------------------------------------------------------

let threadCounter = 0;
let messageCounter = 0;

function nextMessageId(): string {
  messageCounter += 1;
  return `msg-${messageCounter}`;
}

function linkedResultsFor(selectionContext: TextSelectionContext, finalVerdictResult: FinalVerdictResult): FinalClaimResult[] {
  return finalVerdictResult.claim_results.filter((c) => selectionContext.matched_claim_ids.includes(c.claim_id));
}

function buildGreetingMessage(selectionContext: TextSelectionContext, linkedResults: FinalClaimResult[]): string {
  if (linkedResults.length === 0) {
    return `I couldn't confidently link "${selectionContext.selected_text}" to a specific claim yet. You can still ask a follow-up, but evidence-linked actions may be limited.`;
  }
  if (linkedResults.length === 1) {
    const r = linkedResults[0];
    return `You selected: "${selectionContext.selected_text}". This overlaps claim ${r.claim_id}, currently rated ${r.final_verdict.replace(/_/g, " ")}. Ask me to explain the verdict, show evidence, suggest a cautious rewrite, or re-evaluate this selection.`;
  }
  return `You selected: "${selectionContext.selected_text}". This overlaps ${linkedResults.length} claims (${linkedResults.map((r) => r.claim_id).join(", ")}). I can explain verdicts, show evidence, propose a cautious rewrite, or re-evaluate — results may cover multiple claims.`;
}

export function createMockReviewThread(selectionContext: TextSelectionContext, finalVerdictResult: FinalVerdictResult): InteractiveReviewThread {
  threadCounter += 1;
  const linkedResults = linkedResultsFor(selectionContext, finalVerdictResult);
  const linked_evidence_chunk_ids = Array.from(new Set(linkedResults.flatMap((c) => c.evidence_basis.evidence_chunk_ids)));

  return {
    thread_id: `thread-${threadCounter}`,
    selection_id: selectionContext.selection_id,
    linked_claim_ids: selectionContext.matched_claim_ids,
    linked_evidence_chunk_ids,
    messages: [
      {
        message_id: nextMessageId(),
        role: "assistant",
        content: buildGreetingMessage(selectionContext, linkedResults),
        created_at: new Date().toISOString(),
      },
    ],
    thread_status: "open",
  };
}

export function appendMessageToThread(thread: InteractiveReviewThread, role: "user" | "assistant", content: string): InteractiveReviewThread {
  return {
    ...thread,
    messages: [...thread.messages, { message_id: nextMessageId(), role, content, created_at: new Date().toISOString() }],
  };
}

export function buildMockFollowupResponse(userQuestion: string, linkedResults: FinalClaimResult[]): string {
  void userQuestion;
  if (linkedResults.length === 0) {
    return "I don't have a linked claim to answer against yet — try selecting text that overlaps a specific claim first.";
  }
  const r = linkedResults[0];
  return `Based on the dataset-grounded verdict for claim ${r.claim_id} (${r.final_verdict.replace(/_/g, " ")}): ${r.biologist_friendly_explanation} (This is a deterministic mock response — Claude API integration will power real follow-up answers later.)`;
}

// ---------------------------------------------------------------------------
// Action plans (Step 11 §8)
// ---------------------------------------------------------------------------

let planCounter = 0;
let changeCounter = 0;

function nextChangeId(): string {
  changeCounter += 1;
  return `change-${changeCounter}`;
}

export function createMockActionPlan(
  selectionContext: TextSelectionContext,
  requestedAction: ReviewRequestedAction,
  finalVerdictResult: FinalVerdictResult,
  interpretationClaimMap: InterpretationClaimMap,
): ReviewActionPlan {
  planCounter += 1;
  const action_plan_id = `plan-${planCounter}`;

  const linkedResults = linkedResultsFor(selectionContext, finalVerdictResult);
  const primaryResult = linkedResults[0];
  const affected_claim_ids = selectionContext.matched_claim_ids;
  const affected_sentence_ids = selectionContext.matched_sentence_ids;
  const evidence_to_reuse = Array.from(new Set(linkedResults.flatMap((r) => r.evidence_basis.evidence_chunk_ids)));

  const warnings: string[] = [];
  let agents_to_rerun: AgentType[] = [];
  let proposed_changes: ReviewProposedChange[] = [];
  let explanation = "";
  let user_decision_options: string[] = ["acknowledge"];
  const status: ReviewActionPlanStatus = "awaiting_user_approval";

  switch (requestedAction) {
    case "explain_verdict": {
      explanation = !primaryResult
        ? "No linked claim with a final verdict was found for this selection."
        : [
            `Final verdict: ${primaryResult.final_verdict.replace(/_/g, " ")}.`,
            `Evidence basis: ${primaryResult.evidence_basis.evidence_chunk_ids.length} chunk(s) from ${primaryResult.evidence_basis.artifact_indexes_used.join(", ") || "no indexes"}.`,
            primaryResult.caveats.length > 0 ? `Caveats: ${primaryResult.caveats.join(" ")}` : "No caveats recorded.",
            primaryResult.risk_flags.length > 0 ? `Risk flags: ${primaryResult.risk_flags.join(", ")}.` : "No major risk flags.",
          ].join(" ");
      break;
    }

    case "show_evidence": {
      evidence_to_reuse.push(...(primaryResult?.evidence_basis.evidence_chunk_ids ?? []));
      explanation = !primaryResult
        ? "No linked claim/evidence found for this selection."
        : `Linked evidence chunks: ${primaryResult.evidence_basis.evidence_chunk_ids.join(", ") || "none"}. Indexes used: ${primaryResult.evidence_basis.artifact_indexes_used.join(", ") || "none"}.`;
      break;
    }

    case "rewrite_cautiously": {
      agents_to_rerun = ["language_causality"];
      if (!primaryResult) {
        explanation = "No linked claim found to generate a safer rewrite for.";
        warnings.push("No linked claim — rewrite suggestion unavailable.");
      } else {
        explanation = `Proposed a cautious rewrite for claim ${primaryResult.claim_id} based on its recommended action (${primaryResult.recommended_action.replace(/_/g, " ")}).`;
        proposed_changes = [
          {
            change_id: nextChangeId(),
            change_type: "replace_span",
            original_text: selectionContext.selected_text,
            proposed_text: primaryResult.safer_rewrite,
            reason: primaryResult.caveats[0] ?? "Softer wording better matches the dataset-grounded evidence.",
            affected_span_start: selectionContext.span_start,
            affected_span_end: selectionContext.span_end,
          },
        ];
        user_decision_options = ["approve", "cancel", "edit"];
      }
      break;
    }

    case "reevaluate_selection": {
      agents_to_rerun =
        selectionContext.selection_scope === "sentence" || selectionContext.selection_scope === "multi_sentence"
          ? ["perturbation_evidence", "pathway_signature", "robustness_quality", "language_causality"]
          : ["language_causality"];
      explanation =
        "Mock re-evaluation would re-run the relevant agents over this selected span and its linked evidence. For now, GeneGround identifies the affected claims and evidence.";
      proposed_changes = [
        {
          change_id: nextChangeId(),
          change_type: "no_change",
          original_text: selectionContext.selected_text,
          proposed_text: selectionContext.selected_text,
          reason: "Re-evaluation is not yet wired to live agents; no change proposed.",
          affected_span_start: selectionContext.span_start,
          affected_span_end: selectionContext.span_end,
        },
      ];
      break;
    }

    case "split_claim": {
      const sentenceId = affected_sentence_ids[0];
      const sentence = sentenceId ? interpretationClaimMap.sentences.find((s) => s.sentence_id === sentenceId) : undefined;
      const sentenceClaimIds = sentence?.claim_ids ?? [];

      if (sentenceClaimIds.length > 1) {
        const sentenceClaims = finalVerdictResult.claim_results.filter((c) => sentenceClaimIds.includes(c.claim_id));
        explanation = `Sentence ${sentenceId} already resolves to ${sentenceClaimIds.length} separate claims (${sentenceClaimIds.join(", ")}). Proposing to review them independently rather than as one merged statement.`;
        proposed_changes = sentenceClaims.map((c) => ({
          change_id: nextChangeId(),
          change_type: "split_sentence",
          original_text: sentence?.text ?? selectionContext.selected_text,
          proposed_text: c.original_claim_text,
          reason: `Extracted as claim ${c.claim_id} (${c.final_verdict.replace(/_/g, " ")}).`,
          affected_span_start: sentence?.span_start ?? null,
          affected_span_end: sentence?.span_end ?? null,
        }));
      } else {
        explanation = "No multiple-claim sentence detected.";
        warnings.push("No multiple-claim sentence detected.");
      }
      break;
    }

    case "ask_followup": {
      explanation = "Use the chat box below to ask a follow-up question about this selection.";
      break;
    }

    case "apply_existing_safer_rewrite": {
      if (!primaryResult) {
        explanation = "No linked claim with an existing safer rewrite was found.";
      } else {
        explanation = `Applying claim ${primaryResult.claim_id}'s existing safer rewrite from the final verdict aggregator.`;
        proposed_changes = [
          {
            change_id: nextChangeId(),
            change_type: "replace_span",
            original_text: selectionContext.selected_text,
            proposed_text: primaryResult.safer_rewrite,
            reason: "Reusing the final-verdict safer rewrite as-is.",
            affected_span_start: selectionContext.span_start,
            affected_span_end: selectionContext.span_end,
          },
        ];
        user_decision_options = ["approve", "cancel", "edit"];
      }
      break;
    }

    default:
      explanation = "Unrecognized action.";
  }

  return {
    action_plan_id,
    selection_id: selectionContext.selection_id,
    requested_action: requestedAction,
    scope: selectionContext.selection_scope,
    affected_claim_ids,
    affected_sentence_ids,
    evidence_to_reuse: Array.from(new Set(evidence_to_reuse)),
    agents_to_rerun,
    proposed_changes,
    user_decision_options,
    status,
    explanation,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Grounded Rewrite display segments — the single source of truth for the
// live-editable Grounded Rewrite text (Step 11 §8 apply). Distinct from
// TextSegment above: TextSegment.spanStart/spanEnd are ORIGINAL
// interpretation-text coordinates (used for claim/sentence matching, which
// must stay stable regardless of edits); DisplaySegment.spanStart/spanEnd are
// coordinates into the CURRENT, possibly-already-edited grounded rewrite
// text. The two coordinate systems diverge as soon as a rewrite differs in
// length from its original claim text — applying an approved edit using the
// wrong one is what previously cut off the beginning of the rewrite.
// ---------------------------------------------------------------------------

export interface DisplaySegment {
  text: string;
  claimId: string | null;
  spanStart: number;
  spanEnd: number;
}

/** Lays TextSegments out with fresh cumulative offsets, substituting each claim segment's initial display text (resolveText) for its raw original text. */
export function buildDisplaySegments(baseSegments: TextSegment[], resolveText: (claimId: string, originalText: string) => string): DisplaySegment[] {
  let cursor = 0;
  return baseSegments.map((seg) => {
    const text = seg.claimId ? resolveText(seg.claimId, seg.text) : seg.text;
    const spanStart = cursor;
    cursor += text.length;
    return { text, claimId: seg.claimId, spanStart, spanEnd: cursor };
  });
}

export function groundedRewriteTextFromSegments(segments: DisplaySegment[]): string {
  return segments.map((s) => s.text).join("");
}

/**
 * Splices [start, end) of the current grounded-rewrite text with
 * proposedText, at the DisplaySegment level, so claim-click behavior keeps
 * working for every segment the edit didn't touch. A replacement spanning
 * one or more segments collapses them into a single merged segment (taking
 * on the identity of whichever segment the edit starts in); every segment
 * after the edit has its spanStart/spanEnd shifted by the resulting length
 * delta.
 */
export function applyEditToDisplaySegments(segments: DisplaySegment[], start: number, end: number, proposedText: string): DisplaySegment[] {
  const before = segments.filter((s) => s.spanEnd <= start);
  const after = segments.filter((s) => s.spanStart >= end);
  const overlapping = segments.filter((s) => s.spanStart < end && s.spanEnd > start);
  if (overlapping.length === 0) return segments;

  const first = overlapping[0];
  const last = overlapping[overlapping.length - 1];
  const prefix = first.text.slice(0, Math.max(0, start - first.spanStart));
  const suffix = last.text.slice(Math.max(0, end - last.spanStart));
  const mergedText = `${prefix}${proposedText}${suffix}`;
  const merged: DisplaySegment = { text: mergedText, claimId: first.claimId, spanStart: first.spanStart, spanEnd: first.spanStart + mergedText.length };

  const delta = merged.spanEnd - last.spanEnd;
  const shiftedAfter = after.map((s) => ({ ...s, spanStart: s.spanStart + delta, spanEnd: s.spanEnd + delta }));

  return [...before, merged, ...shiftedAfter];
}

// ---------------------------------------------------------------------------
// Safe replacement resolution (Step 11 §8 apply). Priority order:
//   1. A precise DOM-anchored span into the CURRENT grounded rewrite text.
//   2. The proposed change's own affected_span_start/end, only if they
//      demonstrably refer to the current text (validated by content match,
//      never trusted blindly — they may be stale original-text coordinates
//      from an older selection).
//   3. An exact, single-occurrence match of original_text within the
//      current text.
//   4. Refuse rather than guess.
// ---------------------------------------------------------------------------

function isValidRange(text: string, start: number, end: number): boolean {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= text.length && start < end;
}

export type ReplacementResolution =
  | { ok: true; start: number; end: number; source: "dom_anchor" | "current_span" | "exact_text_match" }
  | { ok: false; reason: string };

const UNSAFE_APPLY_WARNING = "Could not safely apply edit. Please reselect the text.";

export function resolveGroundedRewriteReplacementRange(
  currentText: string,
  change: Pick<ReviewProposedChange, "original_text" | "affected_span_start" | "affected_span_end">,
  domSpan: { start: number; end: number } | null,
): ReplacementResolution {
  if (domSpan && isValidRange(currentText, domSpan.start, domSpan.end)) {
    return { ok: true, start: domSpan.start, end: domSpan.end, source: "dom_anchor" };
  }

  const { affected_span_start, affected_span_end, original_text } = change;
  if (affected_span_start !== null && affected_span_end !== null && isValidRange(currentText, affected_span_start, affected_span_end)) {
    const slice = currentText.slice(affected_span_start, affected_span_end);
    if (normalizeForCompare(slice) === normalizeForCompare(original_text)) {
      return { ok: true, start: affected_span_start, end: affected_span_end, source: "current_span" };
    }
  }

  if (original_text && original_text.trim().length > 0) {
    const first = currentText.indexOf(original_text);
    if (first !== -1) {
      const second = currentText.indexOf(original_text, first + 1);
      if (second === -1) return { ok: true, start: first, end: first + original_text.length, source: "exact_text_match" };
    }
  }

  return { ok: false, reason: UNSAFE_APPLY_WARNING };
}

/** A normal sentence start: a capital letter, digit, opening quote/paren — never a dangling lowercase continuation clause. Guards against a silent offset bug re-surfacing as garbled leading text. */
export function looksLikeSafeSentenceStart(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.length > 0 && /^[A-Z0-9"'“(]/.test(trimmed);
}

export type ApplyGroundedRewriteEditResult =
  | {
      ok: true;
      newText: string;
      /** [start, end) that was consumed in currentText — feed straight into applyEditToDisplaySegments. */
      replacedRange: { start: number; end: number };
      /** Where the newly-applied text now sits in newText — for a brief highlight. */
      changedSpan: { start: number; end: number };
      source: "dom_anchor" | "current_span" | "exact_text_match";
    }
  | { ok: false; reason: string };

export function applyGroundedRewriteEdit(
  currentText: string,
  change: Pick<ReviewProposedChange, "original_text" | "proposed_text" | "affected_span_start" | "affected_span_end">,
  domSpan: { start: number; end: number } | null,
): ApplyGroundedRewriteEditResult {
  const resolved = resolveGroundedRewriteReplacementRange(currentText, change, domSpan);
  if (!resolved.ok) return resolved;

  const { start, end } = resolved;
  const newText = currentText.slice(0, start) + change.proposed_text + currentText.slice(end);
  if (!looksLikeSafeSentenceStart(newText)) {
    return { ok: false, reason: "This edit would produce malformed text and was not applied. Please reselect the text." };
  }

  return {
    ok: true,
    newText,
    replacedRange: { start, end },
    changedSpan: { start, end: start + change.proposed_text.length },
    source: resolved.source,
  };
}

// ---------------------------------------------------------------------------
// Selection context built directly from segments already known to be touched
// (e.g. via DOM data-seg-index lookups) — bypasses span-overlap matching
// against the original interpretation text entirely, so it can't drift once
// the grounded rewrite's segment text/offsets differ from the original
// (createSelectionContext above remains unchanged and is still used for the
// whole-claim-click and no-tagged-segment fallback paths, where original-text
// coordinates are still exactly correct).
// ---------------------------------------------------------------------------

export function createSelectionContextFromMatches(
  selectedText: string,
  matchedClaimIds: string[],
  interpretationClaimMap: InterpretationClaimMap,
  currentSpan: { start: number; end: number } | null,
): TextSelectionContext {
  selectionCounter += 1;
  const selection_id = `sel-${selectionCounter}`;
  const warnings: string[] = [];
  const trimmed = selectedText.trim();
  if (trimmed.length === 0) warnings.push("Selected text was empty after trimming.");

  const matched_sentence_ids = Array.from(
    new Set(
      matchedClaimIds
        .map((id) => interpretationClaimMap.claims.find((c) => c.claim_id === id)?.sentence_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const match_confidence = matchedClaimIds.length > 0 ? 0.85 : 0.2;

  const draft: TextSelectionContext = {
    selection_id,
    interpretation_id: interpretationClaimMap.interpretation_id,
    selected_text: trimmed,
    span_start: currentSpan?.start ?? null,
    span_end: currentSpan?.end ?? null,
    selection_scope: "unknown",
    matched_sentence_ids,
    matched_claim_ids: matchedClaimIds,
    match_confidence,
    warnings,
  };

  return { ...draft, selection_scope: inferSelectionScope(draft, interpretationClaimMap) };
}
