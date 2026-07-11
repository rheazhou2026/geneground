"use client";

import type { FinalVerdictResult, InteractiveReviewThread, ReviewActionPlan, ReviewRequestedAction, TextSelectionContext } from "@/lib/schemas";
import { ReviewChatMock } from "./ReviewChatMock";
import { ReviewActionPlanCard } from "./ReviewActionPlanCard";
import { LinkedEvidenceMiniList } from "./LinkedEvidenceMiniList";

const QUICK_ACTIONS: { action: ReviewRequestedAction; label: string }[] = [
  { action: "explain_verdict", label: "Explain verdict" },
  { action: "show_evidence", label: "Show evidence" },
  { action: "rewrite_cautiously", label: "Rewrite cautiously" },
  { action: "reevaluate_selection", label: "Re-evaluate selection" },
  { action: "split_claim", label: "Split claim" },
];

export function SelectionReviewPopup({
  selectionContext,
  thread,
  plan,
  finalVerdictResult,
  onQuickAction,
  followupDraft,
  onFollowupChange,
  onFollowupSubmit,
  onApprove,
  onCancel,
  onEdit,
  onClose,
  chatLoading = false,
  planLoading = false,
}: {
  selectionContext: TextSelectionContext;
  thread: InteractiveReviewThread;
  plan: ReviewActionPlan | null;
  finalVerdictResult: FinalVerdictResult;
  onQuickAction: (action: ReviewRequestedAction) => void;
  followupDraft: string;
  onFollowupChange: (value: string) => void;
  onFollowupSubmit: () => void;
  onApprove: () => void;
  onCancel: () => void;
  onEdit: (newText: string) => void;
  onClose: () => void;
  chatLoading?: boolean;
  planLoading?: boolean;
}) {
  const linkedResults = finalVerdictResult.claim_results.filter((c) => selectionContext.matched_claim_ids.includes(c.claim_id));

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 sm:inset-y-4 sm:right-4 sm:h-[calc(100%-2rem)] sm:rounded-xl sm:border">
      <div className="flex items-start justify-between gap-2 border-b border-zinc-100 p-4 dark:border-zinc-900">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Review selection · {selectionContext.selection_scope.replace(/_/g, " ")}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-900 dark:text-zinc-100">&ldquo;{selectionContext.selected_text}&rdquo;</p>
          <p className="mt-1 font-mono text-[10px] text-zinc-400 dark:text-zinc-600">
            sentences: {selectionContext.matched_sentence_ids.join(", ") || "none"} · claims:{" "}
            {selectionContext.matched_claim_ids.join(", ") || "none"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          aria-label="Close review popup"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <LinkedEvidenceMiniList results={linkedResults} />

        <div className="flex flex-wrap items-center gap-1.5">
          {QUICK_ACTIONS.map(({ action, label }) => (
            <button
              key={action}
              type="button"
              onClick={() => onQuickAction(action)}
              disabled={planLoading}
              className="rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-zinc-100"
            >
              {label}
            </button>
          ))}
          {planLoading && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
              <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-300" />
              Drafting action plan…
            </span>
          )}
        </div>

        <ReviewChatMock thread={thread} draft={followupDraft} onDraftChange={onFollowupChange} onSubmit={onFollowupSubmit} loading={chatLoading} />

        {plan && <ReviewActionPlanCard plan={plan} onApprove={onApprove} onCancel={onCancel} onEdit={onEdit} />}
      </div>
    </div>
  );
}
