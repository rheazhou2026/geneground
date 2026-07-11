import perturbationRecordsRaw from "@/data/mock-handoff/perturbation_evidence_packets.json";
import pathwayRecordsRaw from "@/data/mock-handoff/pathway_enrichment_packets.json";
import robustnessRecordsRaw from "@/data/mock-handoff/pseudobulk_robustness_summary.json";
import datasetSchemaMapRaw from "@/data/mock-handoff/dataset_schema_map.json";
import goldClaimsRaw from "@/data/mock-handoff/demo_claims_gold_verdicts.json";
import languageRulesRaw from "@/data/language_rules.geneground.json";
import { MOCK_HANDOFF_PROJECT } from "./mockHandoff";
import { discoverArtifactsFromHandoffImport } from "./artifactDiscovery";
import { PARQUET_DEFERRED_WARNING, type ParsedTable, type ParsedText } from "./handoffImport";
import type {
  ArtifactDiscoveryResult,
  ArtifactIndex,
  ArtifactIndexes,
  ArtifactIndexType,
  EvidenceChunk,
  EvidenceChunkType,
  HandoffImportFile,
  HandoffImportResult,
} from "./schemas";

// ---------------------------------------------------------------------------
// Lightweight structural types for the mock handoff JSON files. Not
// Zod-validated — these are our own local mock data, not external input.
// ---------------------------------------------------------------------------

interface PerturbationRecord {
  target_gene_symbol: string;
  culture_condition: string;
  n_total_de_genes: number;
  n_up_genes: number;
  n_down_genes: number;
  ontarget_effect_size: number;
  ontarget_significant: boolean;
  top_upregulated_genes: string[];
  top_downregulated_genes: string[];
  adjusted_p_value_summary: string;
}

interface PathwayRecord {
  target_gene_symbol: string;
  culture_condition: string;
  pathway_name: string;
  pathway_id: string | null;
  signature_id: string | null;
  direction: string;
  overlap_genes: string[];
  adjusted_p_value: number;
}

interface RobustnessRecord {
  target_gene_symbol: string;
  culture_condition: string;
  n_guides: number;
  donor_robustness_score: number;
  guide_robustness_score: number;
  low_target_expression_flag: boolean;
  offtarget_flags: string[];
  low_confidence_flag: boolean;
}

interface DatasetSchemaMap {
  dataset_label: string;
  filtering_thresholds: Record<string, unknown>;
  caveats: string[];
}

interface GoldClaimRecord {
  claim_id: string;
  claim_text: string;
  expected_verdict: string;
  supported_parts: string[];
  safer_rewrite: string;
}

interface LanguageRuleRecord {
  trigger_word: string;
  claim_types: string[];
  severity: "low" | "medium" | "high";
  required_evidence: string;
  risky_reason: string;
  safer_rewrite_patterns: string[];
  example_warning: string;
}

const PERTURBATION_RECORDS = perturbationRecordsRaw as unknown as PerturbationRecord[];
const PATHWAY_RECORDS = pathwayRecordsRaw as unknown as PathwayRecord[];
const ROBUSTNESS_RECORDS = robustnessRecordsRaw as unknown as RobustnessRecord[];
const DATASET_SCHEMA_MAP = datasetSchemaMapRaw as unknown as DatasetSchemaMap;
const GOLD_CLAIMS = goldClaimsRaw as unknown as GoldClaimRecord[];
const LANGUAGE_RULES = languageRulesRaw as unknown as LanguageRuleRecord[];

const ARTIFACT_TYPE_BY_FILE = new Map(MOCK_HANDOFF_PROJECT.artifacts.map((a) => [a.name, a.artifact_type]));

function artifactId(fileName: string): string {
  return fileName.replace(/\.json$/, "");
}

function formatGeneList(genes: string[]): string {
  return genes.length > 0 ? genes.join(", ") : "none prominently affected";
}

function slug(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function paddedIndex(n: number): string {
  return String(n).padStart(3, "0");
}

const SESSION_NAME = `session-${MOCK_HANDOFF_PROJECT.handoff_project_id}-${MOCK_HANDOFF_PROJECT.generated_at.slice(0, 10)}`;

// ---------------------------------------------------------------------------
// 1. Perturbation evidence index — "What happened when a gene was perturbed?"
// ---------------------------------------------------------------------------

export function buildPerturbationEvidenceIndex(): ArtifactIndex {
  const sourceFile = "perturbation_evidence_packets.json";
  const chunks: EvidenceChunk[] = PERTURBATION_RECORDS.map((record, i) => {
    const direction = record.ontarget_effect_size < 0 ? "down" : record.ontarget_effect_size > 0 ? "up" : "changed";
    return {
      chunk_id: `${record.target_gene_symbol}_${record.culture_condition}_DE_${paddedIndex(i + 1)}`,
      chunk_type: "perturbation_de_summary",
      source_artifact_id: artifactId(sourceFile),
      source_file_name: sourceFile,
      index_type: "perturbation_evidence_index",
      text_for_embedding: `${record.target_gene_symbol} CRISPRi perturbation in ${record.culture_condition} CD4+ T cells produced ${record.n_total_de_genes} differentially expressed genes. Top upregulated genes include ${formatGeneList(record.top_upregulated_genes)}. Top downregulated genes include ${formatGeneList(record.top_downregulated_genes)}. On-target effect was ${record.ontarget_effect_size}, significant = ${record.ontarget_significant}.`,
      metadata: {
        target_gene_symbol: record.target_gene_symbol,
        culture_condition: record.culture_condition,
        evidence_type: "differential_expression",
        direction,
        source_artifact: sourceFile,
        dataset_name: DATASET_SCHEMA_MAP.dataset_label,
      },
      structured_payload: {
        n_total_de_genes: record.n_total_de_genes,
        n_up_genes: record.n_up_genes,
        n_down_genes: record.n_down_genes,
        ontarget_effect_size: record.ontarget_effect_size,
        ontarget_significant: record.ontarget_significant,
        top_upregulated_genes: record.top_upregulated_genes,
        top_downregulated_genes: record.top_downregulated_genes,
        adjusted_p_value_summary: record.adjusted_p_value_summary,
      },
    };
  });

  return {
    index_name: "perturbation_evidence_index",
    plain_english_question: "What happened when a gene was perturbed?",
    source_artifact_ids: [artifactId(sourceFile)],
    chunks,
  };
}

// ---------------------------------------------------------------------------
// 2. Pathway / signature index — "Did a pathway/signature change?"
// ---------------------------------------------------------------------------

export function buildPathwaySignatureIndex(): ArtifactIndex {
  const sourceFile = "pathway_enrichment_packets.json";
  const chunks: EvidenceChunk[] = PATHWAY_RECORDS.map((record, i) => ({
    chunk_id: `${record.target_gene_symbol}_${record.culture_condition}_PATHWAY_${paddedIndex(i + 1)}`,
    chunk_type: "pathway_signature_summary",
    source_artifact_id: artifactId(sourceFile),
    source_file_name: sourceFile,
    index_type: "pathway_signature_index",
    text_for_embedding: `${record.target_gene_symbol} knockdown in ${record.culture_condition} CD4+ T cells shows ${record.direction}-enrichment of ${record.pathway_name}. Overlap genes include ${formatGeneList(record.overlap_genes)}. Adjusted p-value ≈ ${formatPValue(record.adjusted_p_value)}. ${PATHWAY_SIGNATURE_CAVEAT}`,
    metadata: {
      target_gene_symbol: record.target_gene_symbol,
      culture_condition: record.culture_condition,
      pathway_name: record.pathway_name,
      direction: record.direction,
      source_artifact: sourceFile,
      dataset_name: DATASET_SCHEMA_MAP.dataset_label,
    },
    structured_payload: {
      pathway_name: record.pathway_name,
      pathway_id: record.pathway_id,
      signature_id: record.signature_id,
      direction: record.direction,
      overlap_genes: record.overlap_genes,
      adjusted_p_value: record.adjusted_p_value,
    },
    warnings:
      record.pathway_id === null && record.signature_id !== null
        ? ["Sourced from a curated immune signature, not a formal Reactome pathway ID — treat as illustrative, not evidence-grade."]
        : undefined,
  }));

  return {
    index_name: "pathway_signature_index",
    plain_english_question: "Did a pathway/signature change?",
    source_artifact_ids: [artifactId(sourceFile)],
    chunks,
  };
}

// ---------------------------------------------------------------------------
// 3. Robustness / quality index — "Is this evidence reliable?"
// ---------------------------------------------------------------------------

export function buildRobustnessQualityIndex(): ArtifactIndex {
  const sourceFile = "pseudobulk_robustness_summary.json";
  const chunks: EvidenceChunk[] = ROBUSTNESS_RECORDS.map((record, i) => ({
    chunk_id: `${record.target_gene_symbol}_${record.culture_condition}_ROBUST_${paddedIndex(i + 1)}`,
    chunk_type: "robustness_quality_summary",
    source_artifact_id: artifactId(sourceFile),
    source_file_name: sourceFile,
    index_type: "robustness_quality_index",
    text_for_embedding: `${record.target_gene_symbol} perturbation in ${record.culture_condition} has ${record.n_guides} guide support, donor robustness ${record.donor_robustness_score}, guide robustness ${record.guide_robustness_score}, low target expression flag ${record.low_target_expression_flag}, off-target flags ${record.offtarget_flags.length > 0 ? record.offtarget_flags.join("; ") : "none"}.`,
    metadata: {
      target_gene_symbol: record.target_gene_symbol,
      culture_condition: record.culture_condition,
      low_confidence_flag: record.low_confidence_flag,
      source_artifact: sourceFile,
      dataset_name: DATASET_SCHEMA_MAP.dataset_label,
    },
    structured_payload: {
      n_guides: record.n_guides,
      donor_robustness_score: record.donor_robustness_score,
      guide_robustness_score: record.guide_robustness_score,
      low_target_expression_flag: record.low_target_expression_flag,
      offtarget_flags: record.offtarget_flags,
      low_confidence_flag: record.low_confidence_flag,
    },
    warnings: record.low_confidence_flag
      ? [`${record.target_gene_symbol} in ${record.culture_condition} is flagged low-confidence (${record.n_guides} guides, low target expression) — treat downstream claims about this gene/condition cautiously.`]
      : undefined,
  }));

  return {
    index_name: "robustness_quality_index",
    plain_english_question: "Is this evidence reliable?",
    source_artifact_ids: [artifactId(sourceFile)],
    chunks,
  };
}

// ---------------------------------------------------------------------------
// 4. Language rules index — "Is the wording too strong?"
// ---------------------------------------------------------------------------

export function buildLanguageRulesIndex(): ArtifactIndex {
  const sourceFile = "language_rules.geneground.json";
  const chunks: EvidenceChunk[] = LANGUAGE_RULES.map((rule) => ({
    chunk_id: `LANG_RULE_${slug(rule.trigger_word)}`,
    chunk_type: "language_rule",
    source_artifact_id: artifactId(sourceFile),
    source_file_name: sourceFile,
    index_type: "language_rules_index",
    text_for_embedding: `Claims using '${rule.trigger_word}' require ${rule.required_evidence} If evidence is insufficient, use safer wording such as ${rule.safer_rewrite_patterns.join(" / ")}.`,
    metadata: {
      trigger_word: rule.trigger_word,
      claim_types: rule.claim_types,
      severity: rule.severity,
    },
    structured_payload: {
      required_evidence: rule.required_evidence,
      risky_reason: rule.risky_reason,
      safer_rewrite_patterns: rule.safer_rewrite_patterns,
      example_warning: rule.example_warning,
    },
  }));

  return {
    index_name: "language_rules_index",
    plain_english_question: "Is the wording too strong?",
    source_artifact_ids: [artifactId(sourceFile)],
    chunks,
  };
}

// ---------------------------------------------------------------------------
// 5. Provenance index — "Where did this evidence come from?"
// ---------------------------------------------------------------------------

export function buildProvenanceIndex(): ArtifactIndex {
  const dataFiles: { fileName: string; recordCount: number }[] = [
    { fileName: "perturbation_evidence_packets.json", recordCount: PERTURBATION_RECORDS.length },
    { fileName: "pathway_enrichment_packets.json", recordCount: PATHWAY_RECORDS.length },
    { fileName: "pseudobulk_robustness_summary.json", recordCount: ROBUSTNESS_RECORDS.length },
    { fileName: "dataset_schema_map.json", recordCount: 1 },
    { fileName: "demo_claims_gold_verdicts.json", recordCount: GOLD_CLAIMS.length },
  ];

  const thresholds = Object.entries(DATASET_SCHEMA_MAP.filtering_thresholds)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
  const caveats = DATASET_SCHEMA_MAP.caveats.join(" ");

  const chunks: EvidenceChunk[] = dataFiles.map((file) => ({
    chunk_id: `PROVENANCE_${artifactId(file.fileName).toUpperCase()}`,
    chunk_type: "provenance_record",
    source_artifact_id: artifactId(file.fileName),
    source_file_name: file.fileName,
    index_type: "provenance_index",
    text_for_embedding: `This evidence was generated from ${file.fileName} during Claude Science session ${SESSION_NAME}. Filtering used ${thresholds}. Caveats include ${caveats}`,
    metadata: {
      source_file: file.fileName,
      artifact_type: ARTIFACT_TYPE_BY_FILE.get(file.fileName) ?? "Unknown",
      session_name: SESSION_NAME,
    },
    structured_payload: {
      source_file: file.fileName,
      session_name: SESSION_NAME,
      record_count: file.recordCount,
      filtering_thresholds: DATASET_SCHEMA_MAP.filtering_thresholds,
      caveats: DATASET_SCHEMA_MAP.caveats,
    },
  }));

  return {
    index_name: "provenance_index",
    plain_english_question: "Where did this evidence come from?",
    source_artifact_ids: dataFiles.map((f) => artifactId(f.fileName)),
    chunks,
    warnings: [
      "Not used by the four biology agents for every claim — mainly consulted by the provenance/audit UI, the final report UI, the robustness agent (for caveats), and other agents only rarely.",
    ],
  };
}

// ---------------------------------------------------------------------------
// 6. Demo examples index — "What are example claims/verdicts?"
// ---------------------------------------------------------------------------

export function buildDemoExamplesIndex(): ArtifactIndex {
  const sourceFile = "demo_claims_gold_verdicts.json";
  const chunks: EvidenceChunk[] = GOLD_CLAIMS.map((gold) => ({
    chunk_id: `DEMO_${gold.claim_id.toUpperCase()}`,
    chunk_type: "demo_example",
    source_artifact_id: artifactId(sourceFile),
    source_file_name: sourceFile,
    index_type: "demo_examples_index",
    text_for_embedding: `Example claim '${gold.claim_text}' has expected verdict ${gold.expected_verdict}. Supported parts: ${gold.supported_parts.length > 0 ? gold.supported_parts.join(" ") : "none"}. Safer rewrite: ${gold.safer_rewrite}`,
    metadata: {
      claim_id: gold.claim_id,
      expected_verdict: gold.expected_verdict,
    },
    structured_payload: {
      claim_text: gold.claim_text,
      expected_verdict: gold.expected_verdict,
      supported_parts: gold.supported_parts,
      safer_rewrite: gold.safer_rewrite,
    },
  }));

  return {
    index_name: "demo_examples_index",
    plain_english_question: "What are example claims/verdicts?",
    source_artifact_ids: [artifactId(sourceFile)],
    chunks,
    warnings: ["This index is mainly for MVP/demo/testing and can be removed once real verification agents are wired up."],
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Builds all six typed artifact indexes from the mock Claude Science
 * handoff. This is Step 5: organizing evidence into labeled, retrievable
 * "filing cabinets" — no retrieval logic and no agents read from these
 * indexes yet.
 */
export function buildArtifactIndexesFromMockHandoff(): ArtifactIndexes {
  return {
    project_id: MOCK_HANDOFF_PROJECT.handoff_project_id,
    created_at: MOCK_HANDOFF_PROJECT.generated_at,
    indexes: {
      perturbation_evidence_index: buildPerturbationEvidenceIndex(),
      pathway_signature_index: buildPathwaySignatureIndex(),
      robustness_quality_index: buildRobustnessQualityIndex(),
      language_rules_index: buildLanguageRulesIndex(),
      provenance_index: buildProvenanceIndex(),
      demo_examples_index: buildDemoExamplesIndex(),
    },
    global_warnings: [
      "All evidence in these indexes is mock/demo data for the GeneGround MVP — not real Claude Science output.",
      "Indexes are built once from the handoff; no retrieval, ranking, or agent consumption is implemented yet.",
    ],
  };
}

/**
 * Conceptual bridge from Step 10's Artifact Discovery file-classification
 * manifest to index building. A full implementation would iterate
 * `discoveryResult.artifact_manifest`, group entries by `use_for_indexes`,
 * and parse each file's contents into chunks. The compact mock-handoff JSON
 * files are already known and the builders above already work correctly, so
 * for now this delegates to that proven path rather than duplicating it —
 * the discovery manifest is what *would* drive this construction once real
 * per-file parsing exists.
 */
export function buildArtifactIndexesFromDiscovery(discoveryResult: ArtifactDiscoveryResult): ArtifactIndexes {
  void discoveryResult;
  return buildArtifactIndexesFromMockHandoff();
}

// ---------------------------------------------------------------------------
// Real handoff zip import (Step 12) -> typed Artifact Indexes
// ---------------------------------------------------------------------------

const MAX_CHUNKS_PER_FILE = 200;

const INDEX_QUESTIONS: Record<ArtifactIndexType, string> = {
  perturbation_evidence_index: "What happened when a gene was perturbed?",
  pathway_signature_index: "Did a pathway/signature change?",
  robustness_quality_index: "Is this evidence reliable?",
  language_rules_index: "Is the wording too strong?",
  provenance_index: "Where did this evidence come from?",
  demo_examples_index: "What are example claims/verdicts?",
};

const CHUNK_TYPE_BY_INDEX: Record<ArtifactIndexType, EvidenceChunkType> = {
  perturbation_evidence_index: "perturbation_de_summary",
  pathway_signature_index: "pathway_signature_summary",
  robustness_quality_index: "robustness_quality_summary",
  language_rules_index: "language_rule",
  provenance_index: "provenance_record",
  demo_examples_index: "demo_example",
};

function emptyIndex(indexType: ArtifactIndexType): ArtifactIndex {
  return {
    index_name: indexType,
    plain_english_question: INDEX_QUESTIONS[indexType],
    source_artifact_ids: [],
    chunks: [],
  };
}

function artifactIdFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
}

// ---------------------------------------------------------------------------
// Evidence bundle (geneground_evidence_bundle_v2.json-shaped) chunk building
// ---------------------------------------------------------------------------
//
// A handoff can include one compact bundle file shaped like:
//   { bundle_name, dataset_name?, evidence_packets: [...], claim_wording_policy?, demo_layer? }
// Each entry in evidence_packets is one gene/condition's worth of evidence
// (perturbation, pathway, robustness, provenance all in one record). The
// generic buildChunksForImportedFile below would otherwise fold a file like
// this into a single oversized "record" chunk (bundle.evidence_packets isn't
// a keyed collection of records — it sits alongside a plain bundle_name
// string field, so the keyed-collection heuristic doesn't fire and the file
// falls through to the single-giant-chunk fallback). That's wrong: this
// section fans one bundle file out into real per-packet chunks across FOUR
// evidence indexes plus language_rules_index, bypassing both the generic
// single-chunk fallback and whatever single index Artifact Discovery's
// keyword classifier happened to assign the file to.
//
// bundle.demo_layer is intentionally never read here — demo/evaluation
// fixtures (gold verdicts, claim variants, canned demo claims) must not
// become live evidence or live claims in the main app run.

function isPlainRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStr(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asNum(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStrArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** First defined value among several candidate keys — tolerant of the bundle using a slightly different field name than expected. */
function firstOf(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

/** Best-effort count from a field that might be a plain number, an array (use its length), or an object with a count-like sub-field. */
function extractCount(value: unknown, ...countKeys: string[]): number | undefined {
  const direct = asNum(value);
  if (direct !== undefined) return direct;
  if (Array.isArray(value)) return value.length;
  if (isPlainRecordValue(value)) {
    for (const key of countKeys) {
      const n = asNum(value[key]);
      if (n !== undefined) return n;
      if (Array.isArray(value[key])) return (value[key] as unknown[]).length;
    }
  }
  return undefined;
}

/** True for a JSON value shaped like { ..., evidence_packets: [...] } — the schema this whole section exists to handle. */
export function isEvidenceBundleShape(content: unknown): content is Record<string, unknown> {
  return isPlainRecordValue(content) && Array.isArray(content.evidence_packets);
}

/**
 * Reads bundle.provenance.<key> — a manifest section naming which specific
 * upstream file or external source contributed to each analysis layer (e.g.
 * provenance.pathway_enrichment_results = "pathway_enrichment_results.csv",
 * provenance.external_enrichment_api = "MSigDB Hallmark, ..."). Distinct
 * from the packet-level source_file below: this describes the bundle as a
 * whole, not one packet.
 */
function bundleProvenanceField(bundle: Record<string, unknown>, key: string): string | undefined {
  const provenance = isPlainRecordValue(bundle.provenance) ? bundle.provenance : undefined;
  return provenance ? asStr(provenance[key]) : undefined;
}

/**
 * The raw upstream file a packet was computed from (e.g. an .h5ad matrix),
 * as distinct from sourceFileName (the processed bundle file GeneGround
 * actually read, e.g. geneground_evidence_bundle_v2.json) — packet-level,
 * bundle-level, and the bundle's own provenance.gene_level_de_evidence
 * manifest entry are all honored, in that order, so a bundle that only
 * states it once (at any of those three places) still applies. Falls back
 * to undefined (not sourceFileName) when truly absent, so callers can tell
 * "no original file on record" apart from "same as the processed file".
 */
function originalSourceFile(packet: Record<string, unknown>, bundle: Record<string, unknown>): string | undefined {
  return asStr(packet.source_file) ?? asStr(firstOf(bundle, "source_file", "bundle_name")) ?? bundleProvenanceField(bundle, "gene_level_de_evidence");
}

function datasetName(packet: Record<string, unknown>, bundle: Record<string, unknown>): string | undefined {
  return asStr(packet.dataset_name) ?? asStr(firstOf(bundle, "dataset_name", "dataset_label"));
}

function buildPerturbationChunkFromPacket(
  packet: Record<string, unknown>,
  bundle: Record<string, unknown>,
  sourceFileName: string,
  sourceArtifactId: string,
): EvidenceChunk | null {
  const packetId = asStr(packet.evidence_packet_id);
  if (!packetId) return null;

  const gene = asStr(packet.perturbation_target_gene) ?? "the target gene";
  const ensembl = asStr(packet.perturbation_target_ensembl);
  const condition = asStr(packet.culture_condition) ?? "an unspecified condition";
  const perturbationType = asStr(packet.perturbation_type) ?? "CRISPRi knockdown";
  const nTotalDe = asNum(packet.n_total_de_genes);
  const nUp = asNum(packet.n_up_genes);
  const nDown = asNum(packet.n_down_genes);
  const effectSize = asNum(packet.ontarget_effect_size);
  const significant = asBool(packet.ontarget_significant);
  const topUp = asStrArray(packet.top_upregulated_genes);
  const topDown = asStrArray(packet.top_downregulated_genes);
  const confidenceFlags = asStrArray(packet.confidence_flags);
  const direction = effectSize === undefined ? "changed" : effectSize < 0 ? "down" : effectSize > 0 ? "up" : "changed";

  const sentences = [
    `${gene} ${perturbationType} in ${condition} CD4+ T cells`,
    effectSize !== undefined ? `shows on-target effect ${effectSize}` : undefined,
    nTotalDe !== undefined ? `${nTotalDe} DE genes${nUp !== undefined && nDown !== undefined ? `, ${nUp} up, ${nDown} down` : ""}` : undefined,
  ]
    .filter((p): p is string => Boolean(p))
    .join(", ");
  const textParts = [
    `${sentences}.`,
    topUp.length > 0 ? `Top upregulated genes include ${topUp.slice(0, 5).join(", ")}.` : undefined,
    topDown.length > 0 ? `Top downregulated genes include ${topDown.slice(0, 5).join(", ")}.` : undefined,
  ].filter((p): p is string => Boolean(p));

  return {
    chunk_id: `${packetId}__perturbation`,
    chunk_type: "perturbation_de_summary",
    source_artifact_id: sourceArtifactId,
    source_file_name: sourceFileName,
    index_type: "perturbation_evidence_index",
    text_for_embedding: textParts.join(" "),
    metadata: {
      target_gene_symbol: gene,
      target_gene_ensembl: ensembl,
      culture_condition: condition,
      perturbation_type: perturbationType,
      evidence_type: "differential_expression",
      direction,
      source_artifact: sourceFileName,
      original_source_file: originalSourceFile(packet, bundle),
      dataset_name: datasetName(packet, bundle),
      evidence_packet_id: packetId,
    },
    structured_payload: {
      n_total_de_genes: nTotalDe,
      n_up_genes: nUp,
      n_down_genes: nDown,
      ontarget_effect_size: effectSize,
      ontarget_significant: significant,
      top_upregulated_genes: topUp,
      top_downregulated_genes: topDown,
      confidence_flags: confidenceFlags,
    },
    warnings: confidenceFlags.length > 0 ? confidenceFlags : undefined,
  };
}

function extractPathwayHits(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isPlainRecordValue) : [];
}

function pathwayHitName(hit: Record<string, unknown>): string | undefined {
  return asStr(firstOf(hit, "pathway_name", "signature_name", "name", "term", "gene_set_name"));
}

function pathwayHitOverlapGenes(hit: Record<string, unknown>): string[] {
  return asStrArray(firstOf(hit, "overlap_genes", "leading_edge_genes", "genes"));
}

function pathwayHitPValue(hit: Record<string, unknown>): number | undefined {
  return asNum(firstOf(hit, "adj_p_value", "padj", "adjusted_p_value", "p_adj", "fdr"));
}

function formatPValue(p: number | undefined): string | undefined {
  if (p === undefined) return undefined;
  return p < 0.001 ? p.toExponential(1) : p.toFixed(3);
}

const PATHWAY_SIGNATURE_CAVEAT = "This supports pathway/signature-level interpretation, not direct mechanism.";

/**
 * Summarizes one direction's worth of pathway/signature hits into a natural
 * clause — only when at least one hit resolves a real name via
 * pathwayHitName. Returns undefined otherwise (hits present, but nothing to
 * name) rather than inventing a "an unnamed enriched gene set (N)"
 * placeholder — that read as unprofessional and, worse, implied a specific
 * gene set that was never actually identified. A group with no resolvable
 * name still contributes its overlap genes/p-values to the packet-level
 * fallback sentence (see buildPathwayChunkFromPacket) — it just doesn't get
 * its own named clause.
 */
function summarizeHitGroup(hits: Record<string, unknown>[], label: "up" | "down" | "local"): { clause: string } | undefined {
  const names = hits.map(pathwayHitName).filter((n): n is string => Boolean(n));
  if (names.length === 0) return undefined;

  const displayNames = names.slice(0, 3).join(", ");
  if (label === "local") return { clause: `${displayNames} local signature enrichment` };
  return { clause: `${displayNames} enrichment among ${label === "up" ? "upregulated" : "downregulated"} genes` };
}

/** "upregulated and downregulated genes" / "upregulated genes" / "genes matched by a local signature" — for the no-resolvable-name fallback sentence. */
function genericEnrichmentDirectionPhrase(hasUp: boolean, hasDown: boolean, hasLocal: boolean): string {
  const directions = [hasUp ? "upregulated" : null, hasDown ? "downregulated" : null].filter((d): d is string => d !== null);
  if (directions.length > 0) return `${directions.join(" and ")} genes`;
  if (hasLocal) return "genes matched by a local signature";
  return "changed genes";
}

function buildPathwayChunkFromPacket(
  packet: Record<string, unknown>,
  bundle: Record<string, unknown>,
  sourceFileName: string,
  sourceArtifactId: string,
): EvidenceChunk | null {
  const packetId = asStr(packet.evidence_packet_id);
  if (!packetId) return null;

  const gene = asStr(packet.perturbation_target_gene) ?? "the target gene";
  const condition = asStr(packet.culture_condition) ?? "an unspecified condition";
  const pathwayEvidence = isPlainRecordValue(packet.pathway_evidence) ? packet.pathway_evidence : {};
  const upHits = extractPathwayHits(firstOf(pathwayEvidence, "external_enrichment_up_top", "enrichment_up_top", "up_top"));
  const downHits = extractPathwayHits(firstOf(pathwayEvidence, "external_enrichment_down_top", "enrichment_down_top", "down_top"));
  const localHits = extractPathwayHits(firstOf(pathwayEvidence, "local_signature_enrichment", "local_enrichment"));

  if (upHits.length === 0 && downHits.length === 0 && localHits.length === 0) return null;

  const upSummary = summarizeHitGroup(upHits, "up");
  const downSummary = summarizeHitGroup(downHits, "down");
  const localSummary = summarizeHitGroup(localHits, "local");
  const namedClauses = [upSummary?.clause, downSummary?.clause, localSummary?.clause].filter((c): c is string => Boolean(c));

  const allHits = [...upHits, ...downHits, ...localHits];
  const overlapGenes = Array.from(new Set(allHits.flatMap(pathwayHitOverlapGenes)));
  const pValues = allHits.map(pathwayHitPValue).filter((p): p is number => p !== undefined);
  const bestPValue = pValues.length > 0 ? Math.min(...pValues) : undefined;

  // Rich, always-populated summary — target gene, condition, top pathway/
  // signature names, direction, overlap genes and p-value when available,
  // and the pathway-vs-mechanism caveat always appended. Never the sparse
  // "GENE knockdown in CONDITION." alone, and never a fabricated "unnamed
  // enriched gene set" placeholder when hits exist but nothing resolves a
  // name — that case gets the clean, honest fallback clause instead.
  const textParts = [
    `${gene} knockdown in ${condition} CD4+ T cells`,
    namedClauses.length > 0
      ? `shows ${namedClauses.join(" and ")}`
      : `shows pathway/signature enrichment among ${genericEnrichmentDirectionPhrase(upHits.length > 0, downHits.length > 0, localHits.length > 0)}; see metadata for enrichment records`,
  ];
  let text_for_embedding = `${textParts.join(" ")}.`;
  if (overlapGenes.length > 0) text_for_embedding += ` Overlap genes include ${overlapGenes.slice(0, 6).join(", ")}.`;
  if (bestPValue !== undefined) text_for_embedding += ` Adjusted p-value ≈ ${formatPValue(bestPValue)}.`;
  text_for_embedding += ` ${PATHWAY_SIGNATURE_CAVEAT}`;

  const upNames = upHits.map(pathwayHitName).filter((n): n is string => Boolean(n));
  const downNames = downHits.map(pathwayHitName).filter((n): n is string => Boolean(n));
  const localNames = localHits.map(pathwayHitName).filter((n): n is string => Boolean(n));
  const primaryName = upNames[0] ?? downNames[0] ?? localNames[0];
  const primaryDirection = upNames[0] ? "up" : downNames[0] ? "down" : undefined;

  return {
    chunk_id: `${packetId}__pathway`,
    chunk_type: "pathway_signature_summary",
    source_artifact_id: sourceArtifactId,
    source_file_name: sourceFileName,
    index_type: "pathway_signature_index",
    text_for_embedding,
    metadata: {
      target_gene_symbol: gene,
      culture_condition: condition,
      pathway_name: primaryName,
      direction: primaryDirection,
      source_artifact: sourceFileName,
      original_source_file: originalSourceFile(packet, bundle),
      dataset_name: datasetName(packet, bundle),
      evidence_packet_id: packetId,
      pathway_results_source: bundleProvenanceField(bundle, "pathway_enrichment_results"),
      external_enrichment_sources: bundleProvenanceField(bundle, "external_enrichment_api"),
      local_signature_source: localHits.length > 0 ? bundleProvenanceField(bundle, "local_signature_sets") : undefined,
    },
    structured_payload: {
      external_enrichment_up_top: upHits,
      external_enrichment_down_top: downHits,
      local_signature_enrichment: localHits,
      overlap_genes: Array.from(new Set(allHits.flatMap(pathwayHitOverlapGenes))),
      adjusted_p_values: allHits.map(pathwayHitPValue).filter((p): p is number => p !== undefined),
    },
  };
}

function buildRobustnessChunkFromPacket(
  packet: Record<string, unknown>,
  bundle: Record<string, unknown>,
  sourceFileName: string,
  sourceArtifactId: string,
): EvidenceChunk | null {
  const packetId = asStr(packet.evidence_packet_id);
  if (!packetId) return null;

  const gene = asStr(packet.perturbation_target_gene) ?? "the target gene";
  const condition = asStr(packet.culture_condition) ?? "an unspecified condition";
  const nCellsTarget = asNum(packet.n_cells_target);
  const robustnessContext = isPlainRecordValue(packet.robustness_context) ? packet.robustness_context : {};
  const robustnessScore = asNum(firstOf(robustnessContext, "robustness_score", "score"));
  const nDonors = extractCount(firstOf(robustnessContext, "donor_evidence", "donors"), "n_donors", "count");
  const nGuides = extractCount(firstOf(robustnessContext, "guide_evidence", "guides"), "n_guides", "count") ?? asNum(packet.n_guides);
  const pseudobulkInfo = firstOf(robustnessContext, "pseudobulk_support", "pseudobulk_evidence", "pseudobulk_qc");
  const pseudobulkPass = isPlainRecordValue(pseudobulkInfo) ? asNum(firstOf(pseudobulkInfo, "n_pass", "pass_count", "passing")) : undefined;
  const pseudobulkTotal = isPlainRecordValue(pseudobulkInfo) ? asNum(firstOf(pseudobulkInfo, "n_total", "total_count", "total")) : undefined;
  const cautionFlags = Array.from(
    new Set([...asStrArray(firstOf(robustnessContext, "caution_flags", "quality_flags")), ...asStrArray(packet.confidence_flags)]),
  );
  const keepForDe = firstOf(robustnessContext, "keep_for_DE", "keep_for_de", "keep_for_de_qc");

  const robustnessLevel = robustnessScore === undefined ? undefined : robustnessScore >= 0.75 ? "high" : robustnessScore >= 0.5 ? "moderate" : "low";

  const parts = [
    `${gene} ${condition} evidence has ${robustnessLevel ? `${robustnessLevel} robustness` : "robustness evidence recorded"}`,
    nDonors !== undefined && nGuides !== undefined
      ? `across ${nDonors} donor${nDonors === 1 ? "" : "s"} and ${nGuides} guide${nGuides === 1 ? "" : "s"}`
      : undefined,
  ].filter((p): p is string => Boolean(p));
  let text_for_embedding = parts.join(" ");
  if (pseudobulkPass !== undefined && pseudobulkTotal !== undefined) {
    text_for_embedding += pseudobulkPass === pseudobulkTotal ? `, all ${pseudobulkTotal} pseudobulks pass DE QC` : `, ${pseudobulkPass} of ${pseudobulkTotal} pseudobulks pass DE QC`;
  }
  text_for_embedding += ".";

  return {
    chunk_id: `${packetId}__robustness`,
    chunk_type: "robustness_quality_summary",
    source_artifact_id: sourceArtifactId,
    source_file_name: sourceFileName,
    index_type: "robustness_quality_index",
    text_for_embedding,
    metadata: {
      target_gene_symbol: gene,
      culture_condition: condition,
      low_confidence_flag: cautionFlags.length > 0,
      source_artifact: sourceFileName,
      original_source_file: originalSourceFile(packet, bundle),
      dataset_name: datasetName(packet, bundle),
      evidence_packet_id: packetId,
      robustness_packets_source: bundleProvenanceField(bundle, "robustness_packets"),
    },
    structured_payload: {
      n_cells_target: nCellsTarget,
      n_guides: nGuides,
      n_donors: nDonors,
      robustness_score: robustnessScore,
      pseudobulk_pass: pseudobulkPass,
      pseudobulk_total: pseudobulkTotal,
      caution_flags: cautionFlags,
      keep_for_DE: keepForDe,
    },
    warnings: cautionFlags.length > 0 ? cautionFlags : undefined,
  };
}

function buildProvenanceChunkFromPacket(
  packet: Record<string, unknown>,
  bundle: Record<string, unknown>,
  sourceFileName: string,
  sourceArtifactId: string,
): EvidenceChunk | null {
  const packetId = asStr(packet.evidence_packet_id);
  if (!packetId) return null;

  const datasetName = asStr(packet.dataset_name) ?? asStr(firstOf(bundle, "dataset_name", "dataset_label"));
  const sourceFile = asStr(packet.source_file) ?? asStr(firstOf(bundle, "source_file", "bundle_name")) ?? sourceFileName;
  const sourceUri = asStr(packet.source_uri) ?? asStr(firstOf(bundle, "source_uri"));
  const analysisType = asStr(packet.analysis_type) ?? asStr(firstOf(bundle, "analysis_type"));
  const perturbationType = asStr(packet.perturbation_type);
  const caveats = asStrArray(packet.caveats);

  const textParts = [
    `Evidence packet ${packetId}`,
    datasetName ? `from dataset ${datasetName}` : undefined,
    sourceFile ? `(source: ${sourceFile})` : undefined,
    analysisType ? `analysis type ${analysisType}` : undefined,
    caveats.length > 0 ? `Caveats: ${caveats.join(" ")}` : undefined,
  ].filter((p): p is string => Boolean(p));

  return {
    chunk_id: `${packetId}__provenance`,
    chunk_type: "provenance_record",
    source_artifact_id: sourceArtifactId,
    source_file_name: sourceFileName,
    index_type: "provenance_index",
    text_for_embedding: `${textParts.join(", ")}.`,
    metadata: {
      source_file: sourceFile,
      // Same field name/contract the other three builders use (undefined,
      // not the generic bundle file, when nothing more specific is on
      // record) — chunkDisplay.ts's chunkProvenanceLines reads this key
      // uniformly across index types, so provenance_index chunks need it
      // too even though this builder's own `source_file` above predates
      // that convention and falls back differently (to sourceFileName).
      original_source_file: originalSourceFile(packet, bundle),
      dataset_name: datasetName,
      analysis_type: analysisType,
      perturbation_type: perturbationType,
      evidence_packet_id: packetId,
    },
    structured_payload: {
      dataset_name: datasetName,
      source_file: sourceFile,
      source_uri: sourceUri,
      analysis_type: analysisType,
      perturbation_type: perturbationType,
      caveats,
      evidence_packet_id: packetId,
    },
  };
}

// Standard GeneGround wording-policy rules — always emitted (with fixed,
// taxonomy-aligned content) so the language_causality agent always has
// something to retrieve, then enriched with whatever phrases/caveats the
// bundle's own claim_wording_policy actually supplies, when present.
const FIXED_LANGUAGE_POLICY_RULES: { id: string; severity: "low" | "medium" | "high"; claimTypes?: string[]; text: string; policyKeys: string[] }[] = [
  {
    id: "LANG_SAFE_ASSOCIATIONAL_WORDING",
    severity: "low",
    text: 'Prefer associational wording ("is associated with", "is consistent with", "suggests") over causal or mechanistic claims when evidence is limited to differential expression and enrichment.',
    policyKeys: ["safe_associational_wording", "safe_wording", "safe_phrases", "preferred_phrases"],
  },
  {
    id: "LANG_AVOID_CAUSAL_WORDING",
    severity: "high",
    text: 'Avoid causal wording ("drives", "causes", "controls", "master regulator") unless supported by evidence beyond differential expression and pathway enrichment alone.',
    policyKeys: ["avoid_without_stronger_evidence", "avoid_causal_wording", "high_risk_phrases", "avoid_phrases"],
  },
  {
    id: "LANG_CRISPRI_NOT_KNOCKOUT",
    severity: "medium",
    claimTypes: ["perturbation_effect", "gene_expression_effect"],
    text: "This dataset uses CRISPRi knockdown, not a full genetic knockout — claims should not use knockout/deletion language for CRISPRi perturbations.",
    policyKeys: ["crispri_not_knockout", "crispri_vs_knockout_note"],
  },
  {
    id: "LANG_PATHWAY_SIGNATURE_NOT_MECHANISM",
    severity: "medium",
    claimTypes: ["causal_mechanism", "pathway_effect"],
    text: "Pathway or signature enrichment shows a transcriptomic association, not a proven mechanism — avoid claiming mechanism from enrichment evidence alone.",
    policyKeys: ["pathway_signature_not_mechanism", "pathway_not_mechanism_note"],
  },
  {
    id: "LANG_THERAPEUTIC_TARGET_REQUIRES_EXTRA_EVIDENCE",
    severity: "high",
    claimTypes: ["therapeutic_relevance"],
    text: "Therapeutic target or drug target claims require validation evidence beyond differential expression and pathway enrichment.",
    policyKeys: ["therapeutic_target_requires_extra_evidence", "therapeutic_target_note"],
  },
];

function buildLanguagePolicyChunks(policy: Record<string, unknown>, sourceFileName: string, sourceArtifactId: string): EvidenceChunk[] {
  const globalCaveats = asStrArray(firstOf(policy, "global_caveats", "caveats"));

  return FIXED_LANGUAGE_POLICY_RULES.map((rule) => {
    const extra = asStrArray(firstOf(policy, ...rule.policyKeys));
    const extraText = extra.length > 0 ? ` Bundle guidance: ${extra.join("; ")}.` : "";
    const caveatText = globalCaveats.length > 0 ? ` ${globalCaveats.join(" ")}` : "";

    return {
      chunk_id: rule.id,
      chunk_type: "language_rule",
      source_artifact_id: sourceArtifactId,
      source_file_name: sourceFileName,
      index_type: "language_rules_index",
      text_for_embedding: `${rule.text}${extraText}${caveatText}`,
      metadata: {
        severity: rule.severity,
        claim_types: rule.claimTypes,
        rule_kind: rule.id,
      },
      structured_payload: {
        rule_text: rule.text,
        bundle_phrases: extra,
        global_caveats: globalCaveats,
      },
    } satisfies EvidenceChunk;
  });
}

/**
 * Fans one evidence-bundle JSON file (geneground_evidence_bundle_v2.json
 * shape) out into real per-packet chunks across perturbation/pathway/
 * robustness/provenance, plus language-rule chunks from
 * bundle.claim_wording_policy. bundle.demo_layer is never read (see module
 * comment above) — those are evaluation fixtures, not live evidence.
 */
export function buildChunksFromEvidenceBundle(
  bundle: Record<string, unknown>,
  sourceFileName: string,
  sourceArtifactId: string,
): Partial<Record<ArtifactIndexType, EvidenceChunk[]>> {
  const packets = (Array.isArray(bundle.evidence_packets) ? bundle.evidence_packets : []).filter(isPlainRecordValue);

  const perturbation: EvidenceChunk[] = [];
  const pathway: EvidenceChunk[] = [];
  const robustness: EvidenceChunk[] = [];
  const provenance: EvidenceChunk[] = [];

  for (const packet of packets) {
    const p = buildPerturbationChunkFromPacket(packet, bundle, sourceFileName, sourceArtifactId);
    if (p) perturbation.push(p);
    const pw = buildPathwayChunkFromPacket(packet, bundle, sourceFileName, sourceArtifactId);
    if (pw) pathway.push(pw);
    const r = buildRobustnessChunkFromPacket(packet, bundle, sourceFileName, sourceArtifactId);
    if (r) robustness.push(r);
    const prov = buildProvenanceChunkFromPacket(packet, bundle, sourceFileName, sourceArtifactId);
    if (prov) provenance.push(prov);
  }

  const policy = isPlainRecordValue(bundle.claim_wording_policy) ? bundle.claim_wording_policy : {};
  const language = buildLanguagePolicyChunks(policy, sourceFileName, sourceArtifactId);

  return {
    perturbation_evidence_index: perturbation,
    pathway_signature_index: pathway,
    robustness_quality_index: robustness,
    provenance_index: provenance,
    language_rules_index: language,
  };
}

// Metadata keys deliberately match what evidenceRetrieval.ts's
// scoreChunkAgainstFilters already reads (target_gene_symbol,
// culture_condition, pathway_name, direction) — not the capitalized names
// shown in docs/geneground-backend-logic.md's Step 6 example, which is an
// illustrative JSON shape. Internal snake_case keeps chunks from real
// uploads retrievable by the existing (unmodified) scorer; a documented-JSON
// serializer (src/lib/documentedJson.ts's toDocumentedArtifactIndex) already
// passes `metadata` through under the `Metadata` key for doc-shaped output.
interface DetectedMetadataSignals {
  target_gene_symbol?: string;
  culture_condition?: string;
  pathway_name?: string;
  direction?: string;
  [key: string]: string | undefined;
}

const GENE_KEY_PATTERN = /^(target[_ ]?gene[_ ]?symbol|target[_ ]?gene|gene[_ ]?symbol|gene)$/i;
const CONDITION_KEY_PATTERN = /^(culture[_ ]?condition|condition|timepoint|stim(ulation)?[_ ]?condition)$/i;
const PATHWAY_KEY_PATTERN = /^(pathway[_ ]?name|pathway|signature[_ ]?name|signature)$/i;
const DIRECTION_KEY_PATTERN = /^(direction|change[_ ]?direction|dir)$/i;

/** Best-effort signal extraction from a structured (JSON/CSV) record's own field names — no free-text NLP. */
function detectMetadataSignals(record: Record<string, unknown>): DetectedMetadataSignals {
  const signals: DetectedMetadataSignals = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
    const str = String(value).trim();
    if (str.length === 0) continue;
    if (!signals.target_gene_symbol && GENE_KEY_PATTERN.test(key)) signals.target_gene_symbol = str;
    else if (!signals.culture_condition && CONDITION_KEY_PATTERN.test(key)) signals.culture_condition = str;
    else if (!signals.pathway_name && PATHWAY_KEY_PATTERN.test(key)) signals.pathway_name = str;
    else if (!signals.direction && DIRECTION_KEY_PATTERN.test(key)) signals.direction = str;
  }
  return signals;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeRecordText(record: Record<string, unknown>, maxChars = 400): string {
  const text = Object.entries(record)
    .map(([key, value]) => `${key}: ${typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)}`)
    .join(", ");
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/**
 * Builds evidence chunks from one accepted, already-parsed HandoffImportFile
 * for one target index, per the Step 6 chunking rules: one chunk per
 * JSON array element (or per top-level key for a keyed-collection object),
 * one chunk per CSV/TSV row, one chunk per MD/HTML heading section, and a
 * single metadata-only chunk for parquet (deferred parsing). Visualization
 * files never reach here — inferTargetIndexes never routes them to an index.
 */
function buildChunksForImportedFile(file: HandoffImportFile, indexType: ArtifactIndexType, sourceArtifactId: string): EvidenceChunk[] {
  const chunkType = CHUNK_TYPE_BY_INDEX[indexType];
  const chunks: EvidenceChunk[] = [];

  function pushChunk(idSuffix: string, text: string, metadata: Record<string, unknown>, payload: Record<string, unknown>, warnings?: string[]) {
    if (chunks.length >= MAX_CHUNKS_PER_FILE) return;
    chunks.push({
      chunk_id: `${sourceArtifactId}_${idSuffix}`,
      chunk_type: chunkType,
      source_artifact_id: sourceArtifactId,
      source_file_name: file.file_name,
      index_type: indexType,
      text_for_embedding: text,
      metadata,
      structured_payload: payload,
      warnings,
    });
  }

  if (file.parsed_kind === "json") {
    const content = file.parsed_content;
    if (Array.isArray(content)) {
      content.slice(0, MAX_CHUNKS_PER_FILE).forEach((item, i) => {
        if (isPlainRecord(item)) {
          pushChunk(String(i + 1).padStart(3, "0"), summarizeRecordText(item), detectMetadataSignals(item), item);
        } else {
          pushChunk(String(i + 1).padStart(3, "0"), String(item), {}, { value: item });
        }
      });
    } else if (isPlainRecord(content)) {
      const entries = Object.entries(content);
      const looksLikeKeyedCollection = entries.length > 0 && entries.every(([, value]) => isPlainRecord(value) || Array.isArray(value));
      if (looksLikeKeyedCollection) {
        entries.slice(0, MAX_CHUNKS_PER_FILE).forEach(([key, value]) => {
          const record = isPlainRecord(value) ? value : { value };
          pushChunk(key.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40), `${key}: ${summarizeRecordText(record)}`, detectMetadataSignals(record), record);
        });
      } else {
        pushChunk("record", summarizeRecordText(content), detectMetadataSignals(content), content);
      }
    }
  } else if (file.parsed_kind === "table") {
    const table = file.parsed_content as ParsedTable | undefined;
    table?.rows.slice(0, MAX_CHUNKS_PER_FILE).forEach((row, i) => {
      pushChunk(String(i + 1).padStart(3, "0"), summarizeRecordText(row), detectMetadataSignals(row), row);
    });
  } else if (file.parsed_kind === "text" || file.parsed_kind === "html_text") {
    const parsedText = file.parsed_content as ParsedText | undefined;
    parsedText?.sections.slice(0, MAX_CHUNKS_PER_FILE).forEach((section, i) => {
      const text = section.heading ? `${section.heading}: ${section.body}` : section.body;
      const truncated = text.length > 500 ? `${text.slice(0, 500)}…` : text;
      pushChunk(String(i + 1).padStart(3, "0"), truncated, {}, { heading: section.heading, body: section.body });
    });
  } else if (file.parsed_kind === "parquet") {
    pushChunk("meta", file.content_preview ?? PARQUET_DEFERRED_WARNING, {}, (file.parsed_content as Record<string, unknown>) ?? {}, [PARQUET_DEFERRED_WARNING]);
  }
  // "visualization" intentionally produces no chunks here — visualization
  // files are listed in the Artifact Discovery manifest for provenance/audit
  // display only, never as core evidence (inferTargetIndexes already routes
  // them to no index, so this branch is never reached for them in practice).

  return chunks;
}

/**
 * Builds typed Artifact Indexes from an ArtifactDiscoveryResult, using each
 * accepted file's already-parsed content (from importResult, when supplied)
 * to construct real chunks instead of the mock JSON records. Falls back to
 * registering source artifacts with no chunks if importResult isn't
 * supplied or a given file has no parsed_content (e.g. parquet without
 * deep parsing, or a discovery result built without a matching import).
 */
export function buildArtifactIndexesFromDiscoveryResult(discoveryResult: ArtifactDiscoveryResult, importResult?: HandoffImportResult): ArtifactIndexes {
  const filesByName = new Map((importResult?.files ?? []).map((file) => [file.file_name, file]));

  const indexes: ArtifactIndexes["indexes"] = {
    perturbation_evidence_index: emptyIndex("perturbation_evidence_index"),
    pathway_signature_index: emptyIndex("pathway_signature_index"),
    robustness_quality_index: emptyIndex("robustness_quality_index"),
    language_rules_index: emptyIndex("language_rules_index"),
    provenance_index: emptyIndex("provenance_index"),
    demo_examples_index: emptyIndex("demo_examples_index"),
  };

  for (const entry of discoveryResult.artifact_manifest) {
    const importedFile = filesByName.get(entry.file_name);
    const sourceArtifactId = artifactIdFromFileName(entry.file_name);

    // Evidence-bundle JSON (geneground_evidence_bundle_v2.json shape) fans
    // out to all five relevant indexes regardless of which single index
    // Artifact Discovery's keyword classifier happened to assign the file
    // to — see buildChunksFromEvidenceBundle above.
    if (importedFile?.parsed_kind === "json" && isEvidenceBundleShape(importedFile.parsed_content)) {
      const bundleChunksByIndex = buildChunksFromEvidenceBundle(importedFile.parsed_content, entry.file_name, sourceArtifactId);
      for (const [indexType, chunks] of Object.entries(bundleChunksByIndex) as [ArtifactIndexType, EvidenceChunk[]][]) {
        if (chunks.length === 0) continue;
        const index = indexes[indexType];
        if (!index.source_artifact_ids.includes(sourceArtifactId)) index.source_artifact_ids.push(sourceArtifactId);
        index.chunks.push(...chunks);
      }
      continue;
    }

    for (const indexType of entry.use_for_indexes) {
      const index = indexes[indexType];
      if (!index.source_artifact_ids.includes(sourceArtifactId)) index.source_artifact_ids.push(sourceArtifactId);
      if (!importedFile || importedFile.parsed_content === undefined) continue;
      index.chunks.push(...buildChunksForImportedFile(importedFile, indexType, sourceArtifactId));
    }
  }

  const global_warnings: string[] = [];
  if (!importResult) {
    global_warnings.push(
      "No parsed handoff import files were supplied — indexes were built from Artifact Discovery's manifest only (source artifacts registered, no chunks).",
    );
  }
  global_warnings.push(
    "Chunks are built from lightweight parsing (JSON/CSV/TSV/Markdown/HTML headings) — no embeddings, and parquet files are metadata-only in this MVP.",
  );

  return {
    project_id: discoveryResult.project_id,
    created_at: discoveryResult.created_at,
    indexes,
    global_warnings,
  };
}

/**
 * End-to-end real handoff import -> Artifact Discovery -> typed Artifact
 * Indexes, for a user-uploaded Claude Science handoff zip
 * (src/lib/handoffImport.ts's importClaudeScienceHandoffZip output).
 */
export function buildArtifactIndexesFromHandoffImport(importResult: HandoffImportResult): ArtifactIndexes {
  const discoveryResult = discoverArtifactsFromHandoffImport(importResult);
  return buildArtifactIndexesFromDiscoveryResult(discoveryResult, importResult);
}
