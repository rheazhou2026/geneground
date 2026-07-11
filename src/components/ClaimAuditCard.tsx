"use client";

import type { FinalClaimResult } from "@/lib/schemas";
import { FinalVerdictBadge } from "./FinalVerdictBadge";
import { classifyRewriteMateriality } from "@/lib/claimRewriteDisplay";

const TOP_CHUNK_PREVIEW_COUNT = 2;

/**
 * Keeps the claim card concise: full four-agent rationale and per-chunk
 * retrieval_mode detail live in Evidence Trace / Technical Pipeline instead
 * — this card only ever shows a chunk count plus a couple of chunk IDs for
 * a quick sanity check.
 */
export function ClaimAuditCard({
  index,
  claimResult,
  expanded,
  onToggle,
}: {
  index: number;
  claimResult: FinalClaimResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  const chunkIds = claimResult.evidence_basis.evidence_chunk_ids;
  const evidenceCount = chunkIds.length;
  const topChunkIds = chunkIds.slice(0, TOP_CHUNK_PREVIEW_COUNT);
  const remainingChunkCount = evidenceCount - topChunkIds.length;
  const rewriteMateriality = classifyRewriteMateriality(claimResult.original_claim_text, claimResult.safer_rewrite);
  // rewrite_needed is set explicitly by the deterministic claimNeedsRewrite
  // gate (page.tsx); fall back to the materiality check for older results
  // that predate that field (e.g. mock fallback paths that don't set it).
  // Text that ended up identical always reads as "preserved" regardless of
  // what rewrite_needed said — nothing actually changed for the reader.
  const noRewriteNeeded = claimResult.rewrite_needed === false || rewriteMateriality === "identical";
  // rewrite_needed=true but the rewrite is only a trivial wording touch-up
  // (e.g. "response" -> "transcriptional response") — don't present this as
  // if GeneGround materially rewrote the claim.
  const isMinorClarification = !noRewriteNeeded && rewriteMateriality === "minor_clarification";

  return (
    <div
      className={`rounded-xl border bg-white shadow-sm transition-colors dark:bg-zinc-950 ${
        expanded ? "border-blue-300 dark:border-blue-500/40" : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <button type="button" onClick={onToggle} className="flex w-full flex-col gap-2 px-4 py-3 text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Claim {index + 1}
          </span>
          <div className="flex items-center gap-2">
            <FinalVerdictBadge verdict={claimResult.final_verdict} size="sm" />
            <span className={`text-zinc-400 transition-transform dark:text-zinc-600 ${expanded ? "rotate-180" : ""}`}>⌄</span>
          </div>
        </div>

        <p className={`text-sm leading-relaxed text-zinc-800 dark:text-zinc-200 ${expanded ? "" : "line-clamp-2"}`}>
          {claimResult.original_claim_text}
        </p>

        {!expanded && (
          <p className="line-clamp-1 text-[11px] italic text-zinc-500 dark:text-zinc-400">{claimResult.biologist_friendly_explanation}</p>
        )}
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-zinc-100 px-4 py-3 dark:border-zinc-900">
          {noRewriteNeeded ? (
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                Original wording preserved
              </span>
              <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{claimResult.biologist_friendly_explanation}</p>
              {evidenceCount > 0 && (
                <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-600">
                  Evidence reviewed: {evidenceCount} chunk{evidenceCount === 1 ? "" : "s"}
                </p>
              )}
            </div>
          ) : isMinorClarification ? (
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                Minor wording clarification
              </span>
              <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{claimResult.biologist_friendly_explanation}</p>
              <p className="mt-1 rounded-lg bg-zinc-50 px-2.5 py-2 text-xs leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                {claimResult.safer_rewrite}
              </p>
            </div>
          ) : (
            <>
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Why rewritten?</span>
                <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{claimResult.biologist_friendly_explanation}</p>
              </div>

              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Rewritten claim</span>
                <p className="mt-1 rounded-lg bg-zinc-50 px-2.5 py-2 text-xs leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  {claimResult.safer_rewrite}
                </p>
              </div>
            </>
          )}

          {claimResult.caveats.length > 0 && (
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Caveats</span>
              <ul className="mt-1 space-y-0.5">
                {claimResult.caveats.map((c) => (
                  <li key={c} className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                    · {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Evidence</span>
            {evidenceCount === 0 ? (
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">No evidence chunks retrieved.</p>
            ) : (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {topChunkIds.map((id) => (
                  <span
                    key={id}
                    className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  >
                    {id}
                  </span>
                ))}
                {remainingChunkCount > 0 && (
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-600">+{remainingChunkCount} more</span>
                )}
              </div>
            )}
            <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-600">See Evidence Trace for full per-agent detail.</p>
          </div>
        </div>
      )}
    </div>
  );
}
