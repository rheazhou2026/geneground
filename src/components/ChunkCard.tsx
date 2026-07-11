"use client";

import { useState } from "react";
import type { EvidenceChunk, RetrievedChunk } from "@/lib/schemas";
import { INDEX_LABELS, chunkGeneCondition, chunkProvenanceLines, truncateText } from "@/lib/chunkDisplay";

// Structurally satisfied by both EvidenceChunk (all-indexed browsing) and
// RetrievedChunk (a specific run's retrieval) — retrieval_mode/reasons are
// only present for the latter, which is what drives the "retrieval_mode if
// it was retrieved" display rule.
type ChunkCardData = Pick<EvidenceChunk, "chunk_id" | "source_file_name" | "index_type" | "text_for_embedding" | "metadata" | "warnings"> & {
  retrieval_mode?: RetrievedChunk["retrieval_mode"];
  retrieval_reasons?: string[];
};

const SUMMARY_TRUNCATE_CHARS = 220;

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "none";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Concise, biology-first evidence card: gene · condition, index type, a
 * short evidence summary, retrieval_mode as a small secondary badge when
 * this chunk was actually retrieved, and a compact provenance line — with
 * chunk_id / full retrieval_reasons (the "technical IDs") hidden unless the
 * parent claim's "Show technical IDs" toggle is on, and the full metadata
 * key/value dump always behind its own "Show metadata" toggle regardless.
 * Reused by EvidenceTracePanel (retrieved chunks per claim) and
 * TechnicalPipelineDetail (both the "retrieved chunks" and "all indexed
 * chunks" browsers) so chunk presentation never drifts between the two.
 */
export function ChunkCard({ chunk, showTechnicalIds = false }: { chunk: ChunkCardData; showTechnicalIds?: boolean }) {
  const [showMetadata, setShowMetadata] = useState(false);
  const geneCondition = chunkGeneCondition(chunk);
  const metadataEntries = Object.entries(chunk.metadata).filter(([, v]) => v !== undefined && v !== null);
  const provenance = chunkProvenanceLines(chunk);

  return (
    <div className="rounded-lg border border-zinc-100 bg-white px-2.5 py-2 dark:border-zinc-900 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center gap-1.5">
        {showTechnicalIds && <span className="font-mono text-[10px] font-medium text-zinc-700 dark:text-zinc-200">{chunk.chunk_id}</span>}
        {geneCondition && <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">{geneCondition}</span>}
        <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {INDEX_LABELS[chunk.index_type]}
        </span>
        {chunk.retrieval_mode && (
          <span className="rounded-full bg-zinc-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-zinc-400 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-500 dark:ring-zinc-800">
            {chunk.retrieval_mode.replace(/_/g, " ")}
          </span>
        )}
      </div>

      <p className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">{truncateText(chunk.text_for_embedding, SUMMARY_TRUNCATE_CHARS)}</p>

      {showTechnicalIds && chunk.retrieval_reasons && chunk.retrieval_reasons.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {chunk.retrieval_reasons.map((reason) => (
            <li key={reason} className="text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">
              · {reason}
            </li>
          ))}
        </ul>
      )}

      {chunk.warnings && chunk.warnings.length > 0 && <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-400">! {chunk.warnings.join(" ")}</p>}

      <div className="mt-1.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[9px] text-zinc-500 dark:text-zinc-400">{provenance.primary}</p>
          {provenance.secondary && <p className="truncate text-[9px] text-zinc-400 dark:text-zinc-600">{provenance.secondary}</p>}
          {provenance.tertiary && <p className="truncate text-[9px] text-zinc-400 dark:text-zinc-600">{provenance.tertiary}</p>}
        </div>
        {metadataEntries.length > 0 && (
          <button
            type="button"
            onClick={() => setShowMetadata((s) => !s)}
            className="shrink-0 text-[9px] font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {showMetadata ? "Hide metadata" : "Show metadata"}
          </button>
        )}
      </div>

      {showMetadata && (
        <div className="mt-1.5 flex flex-wrap gap-1 border-t border-zinc-100 pt-1.5 dark:border-zinc-900">
          {metadataEntries.map(([k, v]) => (
            <span key={k} className="rounded bg-zinc-50 px-1 py-0.5 font-mono text-[10px] text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              {k}: {formatMetadataValue(v)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
