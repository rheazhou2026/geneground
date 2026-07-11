"use client";

import { useState } from "react";
import type { AgentType, ClaimRetrievedEvidence, EvidenceRetrievalResult, FinalClaimResult, FinalVerdictResult } from "@/lib/schemas";
import { FinalVerdictBadge } from "./FinalVerdictBadge";
import { ClaimDetailModal } from "./ClaimDetailModal";
import { ChunkCard } from "./ChunkCard";
import { countDistinctGenes, rankChunksForDisplay, truncateText } from "@/lib/chunkDisplay";

const AGENT_ORDER: AgentType[] = ["perturbation_evidence", "pathway_signature", "robustness_quality", "language_causality"];
const AGENT_LABELS: Record<AgentType, string> = {
  perturbation_evidence: "Perturbation evidence",
  pathway_signature: "Pathway signature",
  robustness_quality: "Robustness quality",
  language_causality: "Language causality",
};
// Short form for the collapsed per-agent chunk-count summary row, e.g.
// "Perturbation 3 · Pathway 3 · Robustness 3 · Language 2".
const AGENT_SHORT_LABELS: Record<AgentType, string> = {
  perturbation_evidence: "Perturbation",
  pathway_signature: "Pathway",
  robustness_quality: "Robustness",
  language_causality: "Language",
};

const CLAIM_KEY_TRUNCATE_CHARS = 70;
const CLAIM_PREVIEW_TRUNCATE_CHARS = 90;
// Default per-agent evidence shown before "Show all retrieved chunks" — keeps
// the expanded view biology-first (a comp biologist scanning a claim shouldn't
// have to wade through every retrieved chunk to see what actually grounds it).
const TOP_EVIDENCE_DEFAULT_COUNT = 2;
// Upper bound on how far the default view grows to cover multiple genes —
// matches evidenceRetrieval.ts's own per-agent retrieval cap, so a claim
// whose retrieved evidence already spans 3 distinct genes (e.g. a "these
// knockdowns define distinct arms" summary claim mentioning NFKB2, GATA3,
// STAT1) shows one chunk per gene by default rather than truncating to just
// the first two and hiding a whole mentioned gene behind "Show all".
const MAX_DEFAULT_EVIDENCE_COUNT = 3;

function totalChunks(claimEvidence: ClaimRetrievedEvidence): number {
  return AGENT_ORDER.reduce((sum, agent) => sum + claimEvidence.agent_evidence[agent].retrieved_chunks.length, 0);
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The claim's own primary gene/condition for this agent query, used only to rank display order (never to filter). */
function primaryGeneAndCondition(filters: Record<string, unknown>): { gene?: string; condition?: string } {
  const gene = asOptionalString(filters.target_gene_symbol);
  const conditions = Array.isArray(filters.conditions) ? filters.conditions.filter((c): c is string => typeof c === "string") : [];
  return { gene, condition: conditions[0] };
}

/** Compact "what does claim_003 mean again?" key — every row opens the same claim popup used in Technical Pipeline. */
function ClaimKeyPanel({ claimResults, onSelectClaim }: { claimResults: FinalClaimResult[]; onSelectClaim: (claimId: string) => void }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <button type="button" onClick={() => setCollapsed((c) => !c)} className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Claim key ({claimResults.length})
        </span>
        <span className={`text-zinc-400 transition-transform dark:text-zinc-600 ${collapsed ? "" : "rotate-180"}`}>⌄</span>
      </button>
      {!collapsed && (
        <div className="grid gap-1.5 border-t border-zinc-100 p-3 dark:border-zinc-900 sm:grid-cols-2">
          {claimResults.map((c, i) => (
            <button
              key={c.claim_id}
              type="button"
              onClick={() => onSelectClaim(c.claim_id)}
              title={c.original_claim_text}
              className="flex items-center justify-between gap-2 rounded-lg border border-zinc-100 px-2.5 py-1.5 text-left hover:border-zinc-300 dark:border-zinc-900 dark:hover:border-zinc-700"
            >
              <span className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-600">Claim {i + 1}</span>
                <span className="block truncate text-[11px] text-zinc-700 dark:text-zinc-300">{truncateText(c.original_claim_text, CLAIM_KEY_TRUNCATE_CHARS)}</span>
              </span>
              <FinalVerdictBadge verdict={c.final_verdict} size="sm" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Perturbation 3 · Pathway 3 · Robustness 3 · Language 2" — a glanceable agent summary without opening the claim. */
function AgentChunkCountSummary({ claimEvidence }: { claimEvidence: ClaimRetrievedEvidence }) {
  return (
    <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
      {AGENT_ORDER.map((agent, i) => (
        <span key={agent}>
          {i > 0 && <span className="text-zinc-300 dark:text-zinc-700"> · </span>}
          {AGENT_SHORT_LABELS[agent]} {claimEvidence.agent_evidence[agent].retrieved_chunks.length}
        </span>
      ))}
    </span>
  );
}

export function EvidenceTracePanel({ finalVerdict, evidenceRetrieval }: { finalVerdict: FinalVerdictResult; evidenceRetrieval: EvidenceRetrievalResult }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [technicalIdsShownFor, setTechnicalIdsShownFor] = useState<Set<string>>(new Set());
  const [allChunksShownFor, setAllChunksShownFor] = useState<Set<string>>(new Set());
  const [modalClaimId, setModalClaimId] = useState<string | null>(null);
  const modalClaimResult = modalClaimId ? finalVerdict.claim_results.find((c) => c.claim_id === modalClaimId) : undefined;

  function toggle(claimId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(claimId)) next.delete(claimId);
      else next.add(claimId);
      return next;
    });
  }

  function toggleTechnicalIds(claimId: string) {
    setTechnicalIdsShownFor((prev) => {
      const next = new Set(prev);
      if (next.has(claimId)) next.delete(claimId);
      else next.add(claimId);
      return next;
    });
  }

  function toggleAllChunks(claimId: string) {
    setAllChunksShownFor((prev) => {
      const next = new Set(prev);
      if (next.has(claimId)) next.delete(claimId);
      else next.add(claimId);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
        Every claim traces back through its sentence, its four agent queries, and the specific evidence chunks each agent retrieved — so any
        verdict can be audited back to its source. The evidence index packages many individual evidence packets (one per gene/condition), not one
        combined source.
      </div>

      <ClaimKeyPanel claimResults={finalVerdict.claim_results} onSelectClaim={setModalClaimId} />

      {finalVerdict.claim_results.map((claimResult, index) => {
        const claimEvidence = evidenceRetrieval.retrieved_evidence_by_claim.find((e) => e.claim_id === claimResult.claim_id);
        if (!claimEvidence) return null;
        const expanded = expandedIds.has(claimResult.claim_id);
        const showTechnicalIds = technicalIdsShownFor.has(claimResult.claim_id);
        const showAllChunks = allChunksShownFor.has(claimResult.claim_id);
        const chunkCount = totalChunks(claimEvidence);

        return (
          <div key={claimResult.claim_id} className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div
              role="button"
              tabIndex={0}
              onClick={() => toggle(claimResult.claim_id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") toggle(claimResult.claim_id);
              }}
              className="flex w-full cursor-pointer flex-col gap-1.5 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Claim {index + 1}</span>
                <div className="flex items-center gap-2">
                  <FinalVerdictBadge verdict={claimResult.final_verdict} size="sm" />
                  <span aria-hidden="true" className={`shrink-0 text-zinc-400 transition-transform dark:text-zinc-600 ${expanded ? "rotate-180" : ""}`}>
                    ⌄
                  </span>
                </div>
              </div>
              <button
                type="button"
                title={claimResult.original_claim_text}
                onClick={(e) => {
                  e.stopPropagation();
                  setModalClaimId(claimResult.claim_id);
                }}
                className="w-fit text-left text-sm leading-relaxed text-zinc-800 hover:text-blue-600 hover:underline dark:text-zinc-200 dark:hover:text-blue-400"
              >
                {truncateText(claimResult.original_claim_text, CLAIM_PREVIEW_TRUNCATE_CHARS)}
              </button>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {chunkCount} evidence chunk{chunkCount === 1 ? "" : "s"}
                </span>
                <AgentChunkCountSummary claimEvidence={claimEvidence} />
              </div>
            </div>

            {expanded && (
              <div className="space-y-3 border-t border-zinc-100 px-4 py-3 dark:border-zinc-900">
                {claimResult.biologist_friendly_explanation && (
                  <p className="text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-300">{claimResult.biologist_friendly_explanation}</p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  {showTechnicalIds ? (
                    <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600">
                      {claimResult.claim_id} · sentence {claimResult.trace.sentence_id}
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-600">Evidence used</span>
                  )}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleAllChunks(claimResult.claim_id)}
                      className="text-[10px] font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      {showAllChunks ? "Show top evidence only" : "Show all retrieved chunks"}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleTechnicalIds(claimResult.claim_id)}
                      className="text-[10px] font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      {showTechnicalIds ? "Hide technical IDs" : "Show technical IDs"}
                    </button>
                  </div>
                </div>

                {AGENT_ORDER.map((agent) => {
                  const agentEvidence = claimEvidence.agent_evidence[agent];
                  const { gene: primaryGene, condition: primaryCondition } = primaryGeneAndCondition(agentEvidence.filters);
                  const ranked = rankChunksForDisplay(agentEvidence.retrieved_chunks, primaryGene, primaryCondition);
                  // A single-gene claim's default stays at TOP_EVIDENCE_DEFAULT_COUNT;
                  // a multi-gene claim's default grows just enough to cover every
                  // distinct gene present, capped at MAX_DEFAULT_EVIDENCE_COUNT.
                  const defaultVisibleCount = Math.min(Math.max(TOP_EVIDENCE_DEFAULT_COUNT, countDistinctGenes(ranked)), MAX_DEFAULT_EVIDENCE_COUNT);
                  const visibleChunks = showAllChunks ? ranked : ranked.slice(0, defaultVisibleCount);
                  const hiddenCount = ranked.length - visibleChunks.length;

                  return (
                    <div key={agent} className="rounded-lg border border-zinc-100 px-3 py-2 dark:border-zinc-900">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">{AGENT_LABELS[agent]}</span>
                        {showTechnicalIds && (
                          <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600">{agentEvidence.agent_query_id}</span>
                        )}
                      </div>

                      {visibleChunks.length === 0 ? (
                        <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-600">No chunks retrieved.</p>
                      ) : (
                        <div className="mt-1.5 space-y-1.5">
                          {visibleChunks.map((chunk) => (
                            <ChunkCard key={chunk.chunk_id} chunk={chunk} showTechnicalIds={showTechnicalIds} />
                          ))}
                        </div>
                      )}
                      {hiddenCount > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleAllChunks(claimResult.claim_id)}
                          className="mt-1.5 text-[10px] font-medium text-zinc-400 hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-300"
                        >
                          +{hiddenCount} more chunk{hiddenCount === 1 ? "" : "s"} retrieved
                        </button>
                      )}
                    </div>
                  );
                })}

                {claimEvidence.claim_retrieval_warnings.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                    {claimEvidence.claim_retrieval_warnings.map((w) => (
                      <p key={w}>{w}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {modalClaimResult && <ClaimDetailModal claimResult={modalClaimResult} onClose={() => setModalClaimId(null)} />}
    </div>
  );
}
