"use client";

import type { FinalClaimResult } from "@/lib/schemas";
import { FinalVerdictBadge } from "./FinalVerdictBadge";

/**
 * Read-only claim lookup popup shared by Technical Pipeline's claim chips
 * and Evidence Trace's claim key — answers "what is claim_003 again?"
 * without dumping raw JSON. FinalClaimResult already carries every field
 * this needs (claim_id, original text, claim_type, sentence_id,
 * final_verdict, the concise Reason), so no extra data plumbing required.
 */
export function ClaimDetailModal({ claimResult, onClose }: { claimResult: FinalClaimResult; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <span className="font-mono text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{claimResult.claim_id}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        <p className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">{claimResult.original_claim_text}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FinalVerdictBadge verdict={claimResult.final_verdict} size="sm" />
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {claimResult.claim_type.replace(/_/g, " ")}
          </span>
          <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600">sentence {claimResult.trace.sentence_id}</span>
        </div>

        {claimResult.biologist_friendly_explanation && (
          <div className="mt-3">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Reason</span>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{claimResult.biologist_friendly_explanation}</p>
          </div>
        )}
      </div>
    </div>
  );
}
