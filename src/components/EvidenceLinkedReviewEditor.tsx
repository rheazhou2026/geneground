"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import type {
  EvidenceRetrievalResult,
  ExtractedClaim,
  FinalClaimResult,
  FinalVerdictResult,
  InteractiveReviewThread,
  ReviewActionPlan,
  ReviewRequestedAction,
  RetrievedChunk,
  TextSelectionContext,
} from "@/lib/schemas";
import {
  appendMessageToThread,
  applyEditToDisplaySegments,
  applyGroundedRewriteEdit,
  buildDisplaySegments,
  buildInterpretationClaimMap,
  buildMockFollowupResponse,
  buildTextSegments,
  createMockActionPlan,
  createMockReviewThread,
  createSelectionContext,
  createSelectionContextFromMatches,
  groundedRewriteTextFromSegments,
  type DisplaySegment,
} from "@/lib/interactiveReviewMock";
import type { InterpretationClaimMap } from "@/lib/interactiveReviewMock";
import { SelectionReviewPopup } from "./SelectionReviewPopup";

// Client-visible toggle only — see .env.example and demo/page.tsx. Server
// still gates actual Claude usage on ANTHROPIC_API_KEY regardless.
const USE_CLAUDE_API = process.env.NEXT_PUBLIC_GENEGROUND_USE_CLAUDE_API !== "false";

async function postJson<TResponse>(url: string, body: unknown): Promise<TResponse | null> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return null;
    return (await res.json()) as TResponse;
  } catch {
    return null;
  }
}

async function runSelectionChatStep(
  selectionContext: TextSelectionContext,
  claimResult: FinalClaimResult | null,
  retrievedChunks: RetrievedChunk[],
  userQuestion: string,
  linkedResults: FinalClaimResult[],
): Promise<string> {
  const fallback = () => buildMockFollowupResponse(userQuestion, linkedResults);
  if (!USE_CLAUDE_API) return fallback();

  const response = await postJson<{ source: "claude" | "mock"; content: string; warning?: string }>("/api/claude/selection-chat", {
    selectionContext,
    claimResult,
    retrievedChunks,
    userQuestion,
  });
  return response ? response.content : fallback();
}

async function runActionPlanStep(
  selectionContext: TextSelectionContext,
  requestedAction: ReviewRequestedAction,
  claimResult: FinalClaimResult | null,
  retrievedChunks: RetrievedChunk[],
  currentRewrittenText: string,
  finalVerdictResult: FinalVerdictResult,
  interpretationClaimMap: InterpretationClaimMap,
): Promise<ReviewActionPlan> {
  const fallback = () => createMockActionPlan(selectionContext, requestedAction, finalVerdictResult, interpretationClaimMap);
  if (!USE_CLAUDE_API) return fallback();

  const response = await postJson<{ source: "claude" | "mock"; data: ReviewActionPlan; warning?: string }>("/api/claude/action-plan", {
    selectionContext,
    requestedAction,
    claimResult,
    retrievedChunks,
    currentRewrittenText,
    finalVerdictResult,
    interpretationClaimMap,
  });
  return response ? response.data : fallback();
}

/** Gathers all four agents' retrieved chunks (deduped) for the given claim IDs. */
function collectRetrievedChunks(claimIds: string[], evidenceRetrieval: EvidenceRetrievalResult | null): RetrievedChunk[] {
  if (!evidenceRetrieval || claimIds.length === 0) return [];
  const byId = new Map<string, RetrievedChunk>();
  for (const claimEvidence of evidenceRetrieval.retrieved_evidence_by_claim) {
    if (!claimIds.includes(claimEvidence.claim_id)) continue;
    for (const agentEvidence of Object.values(claimEvidence.agent_evidence)) {
      for (const chunk of agentEvidence.retrieved_chunks) byId.set(chunk.chunk_id, chunk);
    }
  }
  return Array.from(byId.values());
}

const VERDICT_HIGHLIGHT_CLASSES: Record<string, string> = {
  supported: "bg-emerald-100 dark:bg-emerald-500/20",
  supported_with_caveats: "bg-blue-100 dark:bg-blue-500/20",
  partially_supported: "bg-blue-100 dark:bg-blue-500/20",
  overstated: "bg-amber-100 dark:bg-amber-500/20",
  unsupported: "bg-red-100 dark:bg-red-500/20",
  insufficient_evidence: "bg-zinc-200 dark:bg-zinc-500/20",
  needs_review: "bg-purple-100 dark:bg-purple-500/20",
};

/**
 * What a claim segment displays initially: the deterministic final_verdict
 * aggregator's safer_rewrite for every verdict except unsupported, which
 * keeps the original wording (flagged red) rather than substituting in the
 * "no evidence-grounded rewrite" placeholder sentence, since that wouldn't
 * read as prose in place of the original claim. rewrite_needed === false
 * always wins regardless of what safer_rewrite happens to contain. Used only
 * once, to seed groundedRewriteSegments — after that, segment text is the
 * single source of truth and this is never consulted again for that segment.
 */
function resolveInitialDisplayText(claimId: string, originalText: string, finalVerdictResult: FinalVerdictResult): string {
  const result = finalVerdictResult.claim_results.find((c) => c.claim_id === claimId);
  if (!result || result.final_verdict === "unsupported" || result.rewrite_needed === false) return originalText;
  return result.safer_rewrite.trim().length > 0 ? result.safer_rewrite : originalText;
}

/** Walks up from a selection endpoint's DOM node to the nearest rendered segment, by its data-seg-index attribute. */
function closestSegIndex(node: Node | null): number | null {
  if (!node) return null;
  const el = node instanceof Element ? node : node.parentElement;
  const withAttr = el?.closest("[data-seg-index]");
  const raw = withAttr?.getAttribute("data-seg-index");
  if (raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Precise [start, end) into the CURRENT grounded rewrite text for a live browser selection, via Range start/endOffset relative to each segment's own single text node. */
function computeCurrentSpanFromSelection(sel: Selection, segments: DisplaySegment[]): { start: number; end: number } | null {
  if (sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const startSegIdx = closestSegIndex(range.startContainer);
  const endSegIdx = closestSegIndex(range.endContainer);
  if (startSegIdx === null || endSegIdx === null) return null;
  const startSeg = segments[startSegIdx];
  const endSeg = segments[endSegIdx];
  if (!startSeg || !endSeg) return null;
  const start = startSeg.spanStart + range.startOffset;
  const end = endSeg.spanStart + range.endOffset;
  const textLength = segments[segments.length - 1]?.spanEnd ?? 0;
  if (start >= end || end > textLength) return null;
  return { start, end };
}

/** Ordered, de-duplicated claimIds for every segment from startIdx..endIdx inclusive. */
function claimIdsTouchedBySegments(segments: DisplaySegment[], startIdx: number, endIdx: number): string[] {
  const ids: string[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    const id = segments[i]?.claimId;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export interface EvidenceLinkedReviewEditorHandle {
  /** Highlights (and scrolls to) the given claim's segment in the rendered text, or clears the highlight if null. */
  highlightClaim: (claimId: string | null) => void;
}

export const EvidenceLinkedReviewEditor = forwardRef<
  EvidenceLinkedReviewEditorHandle,
  {
    sourceText: string;
    extractedClaims: ExtractedClaim[];
    finalVerdictResult: FinalVerdictResult;
    evidenceRetrieval?: EvidenceRetrievalResult | null;
  }
>(function EvidenceLinkedReviewEditor({ sourceText, extractedClaims, finalVerdictResult, evidenceRetrieval }, ref) {
  const claimMap = useMemo(() => buildInterpretationClaimMap(sourceText, extractedClaims), [sourceText, extractedClaims]);
  const baseSegments = useMemo(() => buildTextSegments(sourceText, claimMap), [sourceText, claimMap]);

  // The Grounded Rewrite's single source of truth: live, editable segments in
  // CURRENT-text coordinates, seeded once from each claim's initial rewrite.
  const [groundedRewriteSegments, setGroundedRewriteSegments] = useState<DisplaySegment[]>(() =>
    buildDisplaySegments(baseSegments, (claimId, originalText) => resolveInitialDisplayText(claimId, originalText, finalVerdictResult)),
  );
  const groundedRewriteText = useMemo(() => groundedRewriteTextFromSegments(groundedRewriteSegments), [groundedRewriteSegments]);

  const [selectionContext, setSelectionContext] = useState<TextSelectionContext | null>(null);
  // Where an approved edit should actually be spliced — CURRENT grounded
  // rewrite text coordinates, resolved at selection time. Kept separate from
  // selectionContext.span_start/span_end (which several other call sites and
  // tests still treat as original-interpretation-text coordinates).
  const [currentRewriteSpan, setCurrentRewriteSpan] = useState<{ start: number; end: number } | null>(null);
  const [thread, setThread] = useState<InteractiveReviewThread | null>(null);
  const [plan, setPlan] = useState<ReviewActionPlan | null>(null);
  const [followupDraft, setFollowupDraft] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [highlightedClaimId, setHighlightedClaimId] = useState<string | null>(null);

  const [applyWarning, setApplyWarning] = useState<string | null>(null);
  const [appliedToast, setAppliedToast] = useState(false);
  const [flashSpan, setFlashSpan] = useState<{ start: number; end: number } | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<DisplaySegment[] | null>(null);

  useImperativeHandle(ref, () => ({
    highlightClaim(claimId: string | null) {
      setHighlightedClaimId(claimId);
      if (claimId && typeof document !== "undefined") {
        document.getElementById(`grounded-seg-${claimId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },
  }));

  // Auto-dismiss the "Applied edit" toast and the brief changed-span flash —
  // both are transient confirmations, not persistent UI state.
  useEffect(() => {
    if (!appliedToast) return;
    const t = window.setTimeout(() => setAppliedToast(false), 6000);
    return () => window.clearTimeout(t);
  }, [appliedToast]);

  useEffect(() => {
    if (!flashSpan) return;
    const t = window.setTimeout(() => setFlashSpan(null), 2200);
    return () => window.clearTimeout(t);
  }, [flashSpan]);

  function openReview(selectedText: string, matchedClaimIds: string[], currentSpan: { start: number; end: number } | null) {
    const ctx = createSelectionContextFromMatches(selectedText, matchedClaimIds, claimMap, currentSpan);
    setSelectionContext(ctx);
    setCurrentRewriteSpan(currentSpan);
    setThread(createMockReviewThread(ctx, finalVerdictResult));
    setPlan(null);
    setFollowupDraft("");
    setApplyWarning(null);
  }

  function openReviewForClaim(claimId: string) {
    const seg = groundedRewriteSegments.find((s) => s.claimId === claimId);
    if (!seg) return;
    setHighlightedClaimId(claimId);
    openReview(seg.text, [claimId], { start: seg.spanStart, end: seg.spanEnd });
  }

  /**
   * Handles a click on a claim segment. A drag-selection that ends with its
   * mouseup inside a claim <button> still fires that button's click event,
   * which would otherwise silently discard the user's exact selection and
   * treat it as if they'd clicked the whole claim. So: if there's a
   * non-empty live text selection at click time, honor exactly what the user
   * dragged (openReviewForBrowserSelection, which computes real span
   * boundaries and lets inferSelectionScope pick partial_claim/word_or_phrase
   * from the actual selected text) — only fall back to "whole claim" when
   * there's truly no active selection.
   */
  function handleSegmentClick(claimId: string) {
    const selected = typeof window !== "undefined" ? (window.getSelection()?.toString().trim() ?? "") : "";
    if (selected.length > 0) {
      openReviewForBrowserSelection();
      return;
    }
    openReviewForClaim(claimId);
  }

  function openReviewForBrowserSelection() {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    const text = sel?.toString().trim() ?? "";
    if (!text || !sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    const startSegIdx = closestSegIndex(range.startContainer);
    const endSegIdx = closestSegIndex(range.endContainer);

    // Selection isn't inside a tagged segment at all — fall back to the
    // fuzzy text-matching path against the original interpretation text.
    if (startSegIdx === null || endSegIdx === null) {
      const ctx = createSelectionContext(text, null, null, claimMap, finalVerdictResult);
      setSelectionContext(ctx);
      setCurrentRewriteSpan(null);
      setThread(createMockReviewThread(ctx, finalVerdictResult));
      setPlan(null);
      setFollowupDraft("");
      setApplyWarning(null);
      sel.removeAllRanges();
      return;
    }

    const minIdx = Math.min(startSegIdx, endSegIdx);
    const maxIdx = Math.max(startSegIdx, endSegIdx);
    const currentSpan = computeCurrentSpanFromSelection(sel, groundedRewriteSegments);
    const matchedClaimIds = claimIdsTouchedBySegments(groundedRewriteSegments, minIdx, maxIdx);

    openReview(text, matchedClaimIds, currentSpan);
    // Clear the native highlight after use so a later plain click on a claim
    // segment isn't misread as "there's still an active drag-selection".
    sel.removeAllRanges();
  }

  function closePopup() {
    setSelectionContext(null);
    setCurrentRewriteSpan(null);
    setThread(null);
    setPlan(null);
    setApplyWarning(null);
  }

  async function handleQuickAction(action: ReviewRequestedAction) {
    if (!selectionContext) return;
    const linkedResults = finalVerdictResult.claim_results.filter((c) => selectionContext.matched_claim_ids.includes(c.claim_id));
    const primaryResult = linkedResults[0] ?? null;
    const retrievedChunks = collectRetrievedChunks(selectionContext.matched_claim_ids, evidenceRetrieval ?? null);
    // Grounded in the CURRENT (possibly already manually-edited) text for
    // this claim, not the pipeline's original safer_rewrite — so a second
    // action plan proposed after an earlier approved edit builds on what the
    // user actually sees now, not stale pre-edit text.
    const activeSegment = primaryResult ? groundedRewriteSegments.find((s) => s.claimId === primaryResult.claim_id) : undefined;
    const currentRewrittenText = activeSegment?.text ?? primaryResult?.safer_rewrite ?? selectionContext.selected_text;

    setPlanLoading(true);
    try {
      const newPlan = await runActionPlanStep(selectionContext, action, primaryResult, retrievedChunks, currentRewrittenText, finalVerdictResult, claimMap);
      setPlan(newPlan);
      setThread((t) => (t ? appendMessageToThread(t, "assistant", newPlan.explanation) : t));
    } finally {
      setPlanLoading(false);
    }
  }

  async function handleFollowupSubmit() {
    if (!selectionContext || followupDraft.trim().length === 0) return;
    const question = followupDraft.trim();
    const linkedResults = finalVerdictResult.claim_results.filter((c) => selectionContext.matched_claim_ids.includes(c.claim_id));
    const primaryResult = linkedResults[0] ?? null;
    const retrievedChunks = collectRetrievedChunks(selectionContext.matched_claim_ids, evidenceRetrieval ?? null);

    setThread((t) => (t ? appendMessageToThread(t, "user", question) : t));
    setFollowupDraft("");
    setChatLoading(true);
    try {
      const response = await runSelectionChatStep(selectionContext, primaryResult, retrievedChunks, question, linkedResults);
      setThread((t) => (t ? appendMessageToThread(t, "assistant", response) : t));
    } finally {
      setChatLoading(false);
    }
  }

  function handleApprovePlan() {
    if (!plan) return;
    const change = plan.proposed_changes[0];

    if (!change || change.change_type === "no_change" || change.change_type === "split_sentence") {
      setPlan((p) => (p ? { ...p, status: "applied" } : p));
      setThread((t) => (t ? appendMessageToThread(t, "assistant", "Acknowledged — no text change to apply.") : t));
      return;
    }

    const result = applyGroundedRewriteEdit(groundedRewriteText, change, currentRewriteSpan);

    if (!result.ok) {
      setApplyWarning(result.reason);
      setThread((t) => (t ? appendMessageToThread(t, "assistant", result.reason) : t));
      return;
    }

    setUndoSnapshot(groundedRewriteSegments);
    setGroundedRewriteSegments((segs) => applyEditToDisplaySegments(segs, result.replacedRange.start, result.replacedRange.end, change.proposed_text));
    setPlan((p) => (p ? { ...p, status: "applied" } : p));
    setThread((t) => (t ? appendMessageToThread(t, "assistant", "Applied the edit to the Grounded Rewrite.") : t));
    setApplyWarning(null);
    setAppliedToast(true);
    setFlashSpan(result.changedSpan);
    // Keep the popup open (selectionContext/thread untouched) so the user can
    // keep chatting or propose another change against the now-updated text.
  }

  function handleUndoLastEdit() {
    if (!undoSnapshot) return;
    setGroundedRewriteSegments(undoSnapshot);
    setUndoSnapshot(null);
    setAppliedToast(false);
    setFlashSpan(null);
  }

  function handleCancelPlan() {
    setPlan((p) => (p ? { ...p, status: "cancelled" } : p));
  }

  function handleEditPlan(newText: string) {
    setPlan((p) =>
      p
        ? {
            ...p,
            status: "edited",
            proposed_changes: p.proposed_changes.map((c, i) => (i === 0 ? { ...c, proposed_text: newText } : c)),
          }
        : p,
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Grounded rewrite · click a highlighted claim or select text
          </span>
          <button
            type="button"
            onClick={openReviewForBrowserSelection}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            Review selection
          </button>
        </div>

        {appliedToast && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200">
            <span className="font-medium">Applied edit</span>
            <div className="flex items-center gap-3">
              {undoSnapshot && (
                <button type="button" onClick={handleUndoLastEdit} className="font-medium underline hover:no-underline">
                  Undo
                </button>
              )}
              <button
                type="button"
                onClick={() => setAppliedToast(false)}
                aria-label="Dismiss"
                className="text-emerald-600 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-100"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {applyWarning && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
            {applyWarning}
          </div>
        )}

        <p className="select-text text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
          {groundedRewriteSegments.map((seg, i) => {
            const isFlashing = flashSpan !== null && seg.spanStart === flashSpan.start && seg.spanEnd === flashSpan.end;
            if (!seg.claimId) {
              return (
                <span
                  key={i}
                  data-seg-index={i}
                  className={isFlashing ? "rounded bg-amber-200/70 transition-colors dark:bg-amber-400/30" : undefined}
                >
                  {seg.text}
                </span>
              );
            }
            const result = finalVerdictResult.claim_results.find((c) => c.claim_id === seg.claimId);
            const cls = result ? VERDICT_HIGHLIGHT_CLASSES[result.final_verdict] : "";
            const active = highlightedClaimId === seg.claimId;
            return (
              <button
                key={i}
                id={`grounded-seg-${seg.claimId}`}
                data-seg-index={i}
                type="button"
                onClick={() => handleSegmentClick(seg.claimId as string)}
                className={`cursor-pointer rounded px-0.5 text-left transition-all hover:ring-1 hover:ring-inset hover:ring-zinc-400 ${cls} ${
                  active ? "ring-2 ring-inset ring-blue-400 dark:ring-blue-400" : ""
                } ${isFlashing ? "bg-amber-200/70 ring-2 ring-inset ring-amber-400 dark:bg-amber-400/30" : ""}`}
                title={result ? `${seg.claimId} — ${result.final_verdict.replace(/_/g, " ")}` : (seg.claimId ?? undefined)}
              >
                {seg.text}
              </button>
            );
          })}
        </p>
      </div>

      {selectionContext && thread && (
        <SelectionReviewPopup
          selectionContext={selectionContext}
          thread={thread}
          plan={plan}
          finalVerdictResult={finalVerdictResult}
          onQuickAction={handleQuickAction}
          followupDraft={followupDraft}
          onFollowupChange={setFollowupDraft}
          onFollowupSubmit={handleFollowupSubmit}
          onApprove={handleApprovePlan}
          onCancel={handleCancelPlan}
          onEdit={handleEditPlan}
          onClose={closePopup}
          chatLoading={chatLoading}
          planLoading={planLoading}
        />
      )}
    </div>
  );
});
