"use client";

import { useState } from "react";
import type { AgentQueryPlanResult, AgentType, ArtifactIndexes, ArtifactIndexType, ClaimExtractionResult, EvidenceChunk, EvidenceRetrievalResult, FinalVerdictResult, RetrievedChunk } from "@/lib/schemas";
import type { InterpretationSource } from "./DemoComposer";
import type { PipelineSources } from "./TechnicalPipelinePanel";
import { ClaimDetailModal } from "./ClaimDetailModal";
import { ChunkCard } from "./ChunkCard";
import { INDEX_LABELS, LIVE_INDEX_ORDER, collectRetrievedChunksByIndex, truncateText } from "@/lib/chunkDisplay";

export interface TechnicalPipelineData {
  extraction: ClaimExtractionResult;
  agentQueryPlan: AgentQueryPlanResult;
  evidenceRetrieval: EvidenceRetrievalResult;
  finalVerdict: FinalVerdictResult;
  artifactIndexes: ArtifactIndexes;
}

const AGENT_ORDER: AgentType[] = ["perturbation_evidence", "pathway_signature", "robustness_quality", "language_causality"];
const AGENT_LABELS: Record<AgentType, string> = {
  perturbation_evidence: "Perturbation",
  pathway_signature: "Pathway",
  robustness_quality: "Robustness",
  language_causality: "Language",
};

const CLAIM_PREVIEW_TRUNCATE_CHARS = 70;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="font-mono text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-600">{title}</h4>
      {children}
    </section>
  );
}

function SourceChip({ source }: { source: "claude" | "mock" | "skipped" }) {
  const style =
    source === "claude"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30"
      : source === "mock"
        ? "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/30"
        : "bg-zinc-100 text-zinc-500 ring-zinc-400/20 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-600/30";
  const label = source === "claude" ? "claude" : source === "mock" ? "mock/fallback" : "skipped — not needed";

  return <span className={`whitespace-nowrap rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ring-1 ring-inset ${style}`}>{label}</span>;
}

/**
 * Renders one card grid per live index from a chunk map — used for both the
 * "retrieved chunks" view (Partial<Record<..., RetrievedChunk[]>>, only what
 * this run actually pulled) and the "all indexed chunks" view
 * (Record<..., EvidenceChunk[]>, the full index contents). Same ChunkCard
 * either way so the two views never drift in formatting.
 */
function ChunkGrid({
  chunksByIndex,
  emptyLabel,
  showTechnicalIds,
}: {
  chunksByIndex: Partial<Record<ArtifactIndexType, (EvidenceChunk | RetrievedChunk)[]>>;
  emptyLabel: string;
  showTechnicalIds: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {LIVE_INDEX_ORDER.map((indexType) => {
        const chunks = chunksByIndex[indexType] ?? [];
        return (
          <div key={indexType} className="rounded-lg border border-zinc-100 p-2 dark:border-zinc-900">
            <p className="mb-1.5 text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">
              {INDEX_LABELS[indexType]} <span className="font-normal text-zinc-400 dark:text-zinc-600">({chunks.length})</span>
            </p>
            {chunks.length === 0 ? (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-600">{emptyLabel}</p>
            ) : (
              <div className="space-y-1.5">
                {chunks.map((chunk) => (
                  <ChunkCard key={chunk.chunk_id} chunk={chunk} showTechnicalIds={showTechnicalIds} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Compact, structured technical trace — reused by both the inline expanded
 * panel (TechnicalPipelinePanel) and the fullscreen modal (FullPipelineModal)
 * so the two never drift out of sync. No raw bundle JSON, no unconditional
 * per-chunk metadata/text_for_embedding dumps — those only appear once a
 * user explicitly opens "Show chunk details" (per-index, per-chunk) or
 * "Show raw JSON".
 */
export function TechnicalPipelineDetail({
  data,
  pipelineSources,
  pipelineWarnings,
  submittedAttachments,
  interpretationSource,
  showRawJson,
}: {
  data: TechnicalPipelineData;
  pipelineSources: PipelineSources;
  pipelineWarnings: string[];
  submittedAttachments: { name: string; size: number }[];
  interpretationSource: InterpretationSource;
  showRawJson: boolean;
}) {
  // Chunk details are collapsed by default; expanding always lands on
  // "retrieved" first (what this run actually pulled) — "all" (every indexed
  // chunk, up to ~45 in the live demo) is a deliberate secondary step, never
  // shown by default.
  const [chunkView, setChunkView] = useState<"collapsed" | "retrieved" | "all">("collapsed");
  // Single panel-wide toggle: claim_id/sentence_id in Claims & Retrieval
  // summary, and chunk_id/retrieval_reasons on chunk cards, all stay in
  // subdued monospace behind this rather than shown by default — the
  // biology-first labels (claim number + preview) are the default view.
  const [showTechnicalIds, setShowTechnicalIds] = useState(false);
  const [modalClaimId, setModalClaimId] = useState<string | null>(null);
  const modalClaimResult = modalClaimId ? data.finalVerdict.claim_results.find((c) => c.claim_id === modalClaimId) : undefined;

  const agentEvalClaudeCount = Object.values(pipelineSources.perClaim).filter((s) => s.agentEval === "claude").length;
  const rewriteClaudeCount = Object.values(pipelineSources.perClaim).filter((s) => s.rewrite === "claude").length;
  const rewriteSkippedCount = Object.values(pipelineSources.perClaim).filter((s) => s.rewrite === "skipped").length;
  const totalClaims = data.finalVerdict.claim_results.length;

  const retrievedChunksByIndex = collectRetrievedChunksByIndex(data.evidenceRetrieval);
  const retrievedChunkCount = Object.values(retrievedChunksByIndex).reduce((sum, chunks) => sum + (chunks?.length ?? 0), 0);
  const allIndexedChunksByIndex = Object.fromEntries(LIVE_INDEX_ORDER.map((t) => [t, data.artifactIndexes.indexes[t].chunks])) as Record<
    ArtifactIndexType,
    EvidenceChunk[]
  >;
  const allIndexedChunkCount = LIVE_INDEX_ORDER.reduce((sum, t) => sum + allIndexedChunksByIndex[t].length, 0);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowTechnicalIds((s) => !s)}
          className="text-[11px] font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {showTechnicalIds ? "Hide technical IDs" : "Show technical IDs"}
        </button>
      </div>

      <Section title="1. Input">
        <div className="space-y-1 text-xs text-zinc-600 dark:text-zinc-300">
          <p>
            Interpretation source:{" "}
            <span className="font-medium text-zinc-800 dark:text-zinc-100">
              {interpretationSource === "loaded_from_handoff" ? "Loaded from handoff" : "Pasted manually"}
            </span>
          </p>
          <p>
            Attached handoff:{" "}
            {submittedAttachments.length > 0 ? (
              <span className="font-mono text-zinc-800 dark:text-zinc-100">{submittedAttachments.map((f) => f.name).join(", ")}</span>
            ) : (
              <span className="text-zinc-400 dark:text-zinc-600">none — built-in demo handoff used</span>
            )}
          </p>
        </div>
      </Section>

      <Section title="2. Claims">
        <div className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-300">
          <p>{data.extraction.claims.length} claim(s) extracted — click a claim for details</p>
          <div className="space-y-1">
            {data.extraction.claims.map((c, i) => (
              <button
                key={c.claim_id}
                type="button"
                onClick={() => setModalClaimId(c.claim_id)}
                title={c.original_text}
                className="block w-full rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-left hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600"
              >
                <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">Claim {i + 1}</span>
                <span className="ml-1.5 text-[11px] text-zinc-700 dark:text-zinc-300">
                  — &ldquo;{truncateText(c.original_text, CLAIM_PREVIEW_TRUNCATE_CHARS)}&rdquo;
                </span>
                {showTechnicalIds && <span className="ml-1.5 font-mono text-[10px] text-zinc-400 dark:text-zinc-600">{c.claim_id}</span>}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="3. Evidence index summary">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {LIVE_INDEX_ORDER.map((indexType) => (
            <div key={indexType} className="rounded border border-zinc-100 px-2 py-1.5 text-[11px] dark:border-zinc-900">
              <span className="text-zinc-500 dark:text-zinc-400">{INDEX_LABELS[indexType]}</span>
              <span className="ml-1 font-mono font-semibold text-zinc-800 dark:text-zinc-100">
                {data.artifactIndexes.indexes[indexType].chunks.length}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="4. Retrieval summary">
        <div className="space-y-1.5">
          {data.finalVerdict.claim_results.map((c, i) => (
            <div key={c.claim_id} className="rounded-lg border border-zinc-100 px-3 py-2 text-xs dark:border-zinc-900">
              <button
                type="button"
                onClick={() => setModalClaimId(c.claim_id)}
                title={c.original_claim_text}
                className="block text-left hover:text-blue-600 dark:hover:text-blue-400"
              >
                <span className="font-semibold text-zinc-700 dark:text-zinc-200">Claim {i + 1}</span>
                <span className="ml-1.5 text-zinc-500 dark:text-zinc-400">
                  — &ldquo;{truncateText(c.original_claim_text, CLAIM_PREVIEW_TRUNCATE_CHARS)}&rdquo;
                </span>
              </button>
              {showTechnicalIds && (
                <p className="mt-1 font-mono text-[10px] text-zinc-400 dark:text-zinc-600">
                  {c.claim_id} · sentence {c.trace.sentence_id}
                </p>
              )}
              <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                {AGENT_ORDER.map((agent, j) => (
                  <span key={agent}>
                    {j > 0 && <span className="text-zinc-300 dark:text-zinc-700"> · </span>}
                    {AGENT_LABELS[agent]} {c.evidence_basis.chunk_ids_by_agent[agent].length}
                  </span>
                ))}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="5. Claude API usage">
        <div className="space-y-1 text-xs text-zinc-600 dark:text-zinc-300">
          <p className="flex items-center gap-1.5">
            Extract claims: <SourceChip source={pipelineSources.extraction} />
          </p>
          <p className="flex items-center gap-1.5">
            Agent evaluation: {agentEvalClaudeCount}/{totalClaims} claims via <SourceChip source="claude" />
          </p>
          <p className="flex items-center gap-1.5">
            Final rewrite: {rewriteClaudeCount}/{totalClaims} claims via <SourceChip source="claude" />
            {rewriteSkippedCount > 0 && (
              <>
                , {rewriteSkippedCount} <SourceChip source="skipped" />
              </>
            )}
          </p>
        </div>
      </Section>

      <Section title="6. Warnings / fallbacks">
        {pipelineWarnings.length === 0 ? (
          <p className="text-xs text-zinc-400 dark:text-zinc-600">None — every step used its primary (Claude API) path.</p>
        ) : (
          <ul className="space-y-1">
            {pipelineWarnings.map((w, i) => (
              <li key={i} className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                ! {w}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="border-t border-zinc-100 pt-3 dark:border-zinc-900">
        {chunkView === "collapsed" ? (
          <button
            type="button"
            onClick={() => setChunkView("retrieved")}
            className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            Show chunk details
          </button>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setChunkView("retrieved")}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    chunkView === "retrieved"
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  }`}
                >
                  Retrieved chunks ({retrievedChunkCount})
                </button>
                <button
                  type="button"
                  onClick={() => setChunkView("all")}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    chunkView === "all"
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  }`}
                >
                  Show all indexed chunks ({allIndexedChunkCount})
                </button>
              </div>
              <button
                type="button"
                onClick={() => setChunkView("collapsed")}
                className="text-[11px] font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Hide chunk details
              </button>
            </div>
            <div className="mt-3">
              {chunkView === "retrieved" ? (
                <ChunkGrid
                  chunksByIndex={retrievedChunksByIndex}
                  emptyLabel="No chunks retrieved for this index in this run."
                  showTechnicalIds={showTechnicalIds}
                />
              ) : (
                <ChunkGrid chunksByIndex={allIndexedChunksByIndex} emptyLabel="No chunks." showTechnicalIds={showTechnicalIds} />
              )}
            </div>
          </>
        )}
      </div>

      {showRawJson && (
        <Section title="Raw JSON">
          <pre className="max-h-96 overflow-auto rounded-lg bg-zinc-900 p-3 text-[10px] leading-relaxed text-zinc-100">
            {JSON.stringify(data, null, 2)}
          </pre>
        </Section>
      )}

      {modalClaimResult && <ClaimDetailModal claimResult={modalClaimResult} onClose={() => setModalClaimId(null)} />}
    </div>
  );
}
