// Shared display helpers for evidence chunks and claim previews — used by
// TechnicalPipelineDetail.tsx and EvidenceTracePanel.tsx so the two never
// drift into inconsistent chunk-card formatting or index labeling.

import type { ArtifactIndexType, EvidenceChunk, EvidenceRetrievalResult, RetrievalMode, RetrievedChunk } from "./schemas";

// demo_examples_index deliberately excluded everywhere this is used — it's
// an evaluation/demo fixture index (gold verdicts / canned example claims),
// not live evidence, and must never be presented alongside real evidence.
export const LIVE_INDEX_ORDER: ArtifactIndexType[] = [
  "perturbation_evidence_index",
  "pathway_signature_index",
  "robustness_quality_index",
  "language_rules_index",
  "provenance_index",
];

export const INDEX_LABELS: Record<ArtifactIndexType, string> = {
  perturbation_evidence_index: "Perturbation evidence",
  pathway_signature_index: "Pathway signature",
  robustness_quality_index: "Robustness quality",
  language_rules_index: "Language rules",
  provenance_index: "Provenance",
  demo_examples_index: "Demo examples",
};

export function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** "GENE · condition" summary from a chunk's own metadata, or undefined if neither is present. */
export function chunkGeneCondition(chunk: Pick<EvidenceChunk, "metadata">): string | undefined {
  const gene = typeof chunk.metadata.target_gene_symbol === "string" ? chunk.metadata.target_gene_symbol : undefined;
  const condition = typeof chunk.metadata.culture_condition === "string" ? chunk.metadata.culture_condition : undefined;
  const summary = [gene, condition].filter(Boolean).join(" · ");
  return summary.length > 0 ? summary : undefined;
}

// Friendlier display name for a processed bundle file — display-only, never
// affects indexing/retrieval, which still key off the real file name.
const FRIENDLY_PROCESSED_FILE_NAMES: Record<string, string> = {
  "geneground_evidence_bundle_v2.json": "GeneGround Evidence Bundle v2",
};

// The one file name every chunk's source_file_name falls back to under the
// real evidence-bundle path — using it as a per-chunk "specific file" detail
// is exactly the misleading "every chunk looks identical" bug this module
// exists to avoid, so a chunk whose only available file name is this one is
// treated as having no specific file on record for that purpose.
const GENERIC_BUNDLE_FILE_NAMES = new Set(["geneground_evidence_bundle_v2.json"]);

function friendlyFileName(fileName: string): string {
  return FRIENDLY_PROCESSED_FILE_NAMES[fileName] ?? fileName;
}

/** A chunk's own source_file_name, but only when it's a genuinely specific file — not the shared generic bundle file every chunk otherwise falls back to. */
function specificFileName(fileName: string): string | undefined {
  return GENERIC_BUNDLE_FILE_NAMES.has(fileName) ? undefined : fileName;
}

export interface ProvenanceLines {
  primary: string;
  secondary?: string;
  tertiary?: string;
}

const FALLBACK_PROVENANCE = (processedLabel: string): ProvenanceLines => ({
  primary: `Claude Science evidence packet · ${processedLabel}`,
});

/**
 * Index-type-aware provenance lines — perturbation, pathway, robustness,
 * language-rule, and provenance chunks each pulled from a different analysis
 * layer of the Claude Science handoff, so they must not all render the same
 * generic "processed via the bundle" line (that's what made every chunk look
 * like it came from one single source regardless of which packet/layer it
 * actually reflects). Each branch prefers the most specific field the bundle
 * actually supplied (see artifactIndexes.ts's bundleProvenanceField /
 * originalSourceFile), then a chunk's own specific file name, and only as a
 * last resort the processed bundle's own friendly name — but even then the
 * PRIMARY line keeps its layer-specific prefix ("Differential expression
 * evidence" / "Pathway/signature evidence" / etc.), so cards from different
 * agents never read as identical even when a real handoff bundle doesn't
 * populate every optional provenance.* field. The fully generic
 * "Claude Science evidence packet" line is reserved for a genuinely
 * unrecognized index_type (the default case), never for a known layer.
 */
export function chunkProvenanceLines(chunk: Pick<EvidenceChunk, "metadata" | "source_file_name" | "index_type">): ProvenanceLines {
  const processedLabel = friendlyFileName(chunk.source_file_name);
  const original = typeof chunk.metadata.original_source_file === "string" ? chunk.metadata.original_source_file : undefined;

  switch (chunk.index_type) {
    case "perturbation_evidence_index": {
      const file = original ?? specificFileName(chunk.source_file_name) ?? processedLabel;
      return {
        primary: `Differential expression evidence · ${file}`,
        // "Packaged in", not "Processed via" — GWCD4i.DE_stats.h5ad is the
        // underlying dataset this evidence was computed from; the bundle is
        // just the packaging, not a second processing step worth implying.
        secondary: file !== processedLabel ? `Packaged in ${processedLabel}` : undefined,
      };
    }

    case "pathway_signature_index": {
      const pathwayFile =
        (typeof chunk.metadata.pathway_results_source === "string" ? chunk.metadata.pathway_results_source : undefined) ??
        specificFileName(chunk.source_file_name) ??
        processedLabel;
      const enrichmentSources = typeof chunk.metadata.external_enrichment_sources === "string" ? chunk.metadata.external_enrichment_sources : undefined;
      const localSignatureSource = typeof chunk.metadata.local_signature_source === "string" ? chunk.metadata.local_signature_source : undefined;
      // "Underlying DE source" — names GWCD4i.DE_stats.h5ad as the shared
      // upstream dataset the pathway call was computed from, not this card's
      // own evidence file, so repeating it across perturbation/pathway/
      // robustness cards reads as "same underlying dataset", not "this is
      // the only evidence behind this pathway result". Falls back to
      // enrichment sources when no original upstream file is on record.
      const secondary = original ? `Underlying DE source: ${original}` : enrichmentSources ? `Enrichment sources: ${enrichmentSources}` : undefined;
      return {
        primary: `Pathway/signature evidence · ${pathwayFile}`,
        secondary,
        tertiary: localSignatureSource ? `Also uses ${localSignatureSource}` : undefined,
      };
    }

    case "robustness_quality_index": {
      const robustnessFile =
        (typeof chunk.metadata.robustness_packets_source === "string" ? chunk.metadata.robustness_packets_source : undefined) ??
        specificFileName(chunk.source_file_name) ??
        processedLabel;
      return {
        primary: `Robustness/QC evidence · ${robustnessFile}`,
        secondary: original ? `Underlying DE source: ${original}` : undefined,
      };
    }

    case "language_rules_index":
      return {
        primary: `Claim wording policy · ${processedLabel}`,
        secondary: "Checks causal, mechanistic, knockout, and therapeutic wording",
      };

    case "provenance_index": {
      const datasetName = (typeof chunk.metadata.dataset_name === "string" ? chunk.metadata.dataset_name : undefined) ?? processedLabel;
      return {
        primary: `Dataset provenance · ${datasetName}`,
        secondary: original ? `Original source: ${original}` : undefined,
      };
    }

    default:
      return FALLBACK_PROVENANCE(processedLabel);
  }
}

// ---------------------------------------------------------------------------
// Display-layer chunk ranking (Evidence Trace / Technical Pipeline only —
// never affects which chunks were retrieved, only the order they render in).
// ---------------------------------------------------------------------------

const RETRIEVAL_MODE_PRIORITY: Record<RetrievalMode, number> = {
  metadata_exact: 0,
  metadata_partial: 1,
  hybrid_metadata_and_local_vector: 2,
  local_vector_fallback: 3,
  not_retrieved: 4,
  manual_demo: 4,
};

/** 0 when the chunk's own gene/condition metadata matches the claim's primary gene/condition, else 1 — used purely to break ties within a retrieval_mode tier. */
function claimMatchRank(chunk: RetrievedChunk, primaryGene?: string | null, primaryCondition?: string | null): number {
  const chunkGene = typeof chunk.metadata.target_gene_symbol === "string" ? chunk.metadata.target_gene_symbol : undefined;
  const chunkCondition = typeof chunk.metadata.culture_condition === "string" ? chunk.metadata.culture_condition : undefined;
  const geneMatches = !primaryGene || (chunkGene !== undefined && chunkGene.toUpperCase() === primaryGene.toUpperCase());
  const conditionMatches = !primaryCondition || (chunkCondition !== undefined && chunkCondition.toLowerCase() === primaryCondition.toLowerCase());
  return geneMatches && conditionMatches ? 0 : 1;
}

function chunkGeneKey(chunk: RetrievedChunk): string {
  return typeof chunk.metadata.target_gene_symbol === "string" ? chunk.metadata.target_gene_symbol.toUpperCase() : "__no_gene__";
}

/**
 * Round-robin re-interleave by gene: one chunk per distinct gene before any
 * gene contributes a second chunk, each gene's own bucket otherwise keeping
 * its incoming (already score-ranked) order. A no-op when 0 or 1 distinct
 * genes are present, which is what keeps a normal single-gene claim's
 * ordering (e.g. NFKB2/Stim8hr-first) completely unaffected — this only
 * changes anything for a multi-gene summary claim whose retrieved chunks
 * span more than one gene, where it stops several timepoints of whichever
 * gene scored highest from crowding out the other mentioned genes.
 */
function interleaveByGeneCoverage(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const buckets = new Map<string, RetrievedChunk[]>();
  const bucketOrder: string[] = [];
  for (const chunk of chunks) {
    const key = chunkGeneKey(chunk);
    if (!buckets.has(key)) {
      buckets.set(key, []);
      bucketOrder.push(key);
    }
    buckets.get(key)?.push(chunk);
  }
  if (bucketOrder.length <= 1) return chunks;

  const result: RetrievedChunk[] = [];
  for (let round = 0; result.length < chunks.length; round++) {
    for (const key of bucketOrder) {
      const bucket = buckets.get(key);
      if (bucket && round < bucket.length) result.push(bucket[round]);
    }
  }
  return result;
}

/**
 * Orders already-retrieved chunks for display only: metadata_exact before
 * metadata_partial before hybrid before local-vector-fallback; within each
 * tier, chunks matching the claim's own primary gene/condition before chunks
 * that don't (e.g. an interpretation-wide gene-fallback claim shouldn't
 * visually bury its own gene/condition's evidence under an unrelated
 * timepoint just because both cleared the same retrieval tier); and within
 * that, gene-coverage interleaving so a multi-gene summary claim (e.g. "these
 * knockdowns define distinct arms") surfaces one chunk per mentioned gene
 * before a second timepoint for any single gene. Stable otherwise — never
 * reorders retrieval itself, never changes which chunks were retrieved or
 * how many.
 */
export function rankChunksForDisplay(chunks: RetrievedChunk[], primaryGene?: string | null, primaryCondition?: string | null): RetrievedChunk[] {
  const sorted = chunks
    .map((chunk, originalIndex) => ({ chunk, originalIndex }))
    .sort((a, b) => {
      const modeDiff = RETRIEVAL_MODE_PRIORITY[a.chunk.retrieval_mode] - RETRIEVAL_MODE_PRIORITY[b.chunk.retrieval_mode];
      if (modeDiff !== 0) return modeDiff;
      const matchDiff = claimMatchRank(a.chunk, primaryGene, primaryCondition) - claimMatchRank(b.chunk, primaryGene, primaryCondition);
      if (matchDiff !== 0) return matchDiff;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ chunk }) => chunk);

  const tiers: RetrievedChunk[][] = [];
  let currentTier = -1;
  for (const chunk of sorted) {
    const tier = RETRIEVAL_MODE_PRIORITY[chunk.retrieval_mode];
    if (tier !== currentTier) {
      tiers.push([]);
      currentTier = tier;
    }
    tiers[tiers.length - 1].push(chunk);
  }

  return tiers.flatMap((tier) => interleaveByGeneCoverage(tier));
}

/** Count of distinct genes among these (already-ranked) chunks — used to size the default "top evidence" slice so a multi-gene summary claim's default view still covers every mentioned gene, not just however many chunks a fixed count happens to show. */
export function countDistinctGenes(chunks: RetrievedChunk[]): number {
  return new Set(chunks.map(chunkGeneKey)).size;
}

/**
 * Flattens every chunk actually retrieved for any claim/agent in this run
 * into a per-index map, deduped by chunk_id — the "Show retrieved chunks"
 * view in Technical Pipeline only ever needs to show what the live run
 * actually pulled, not the full indexed set.
 */
export function collectRetrievedChunksByIndex(evidenceRetrieval: EvidenceRetrievalResult): Partial<Record<ArtifactIndexType, RetrievedChunk[]>> {
  const seen = new Set<string>();
  const byIndex: Partial<Record<ArtifactIndexType, RetrievedChunk[]>> = {};

  for (const claimEvidence of evidenceRetrieval.retrieved_evidence_by_claim) {
    for (const agentEvidence of Object.values(claimEvidence.agent_evidence)) {
      for (const chunk of agentEvidence.retrieved_chunks) {
        const key = `${chunk.index_type}::${chunk.chunk_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        (byIndex[chunk.index_type] ??= []).push(chunk);
      }
    }
  }

  return byIndex;
}
