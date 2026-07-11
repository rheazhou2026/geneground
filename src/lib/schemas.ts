import { z } from "zod";
import {
  ACTION_PLAN_STATUSES,
  AGENT_TYPES,
  ARTIFACT_PRIORITIES,
  ARTIFACT_TYPES,
  CHANGE_TYPES,
  CLAIM_TYPES,
  CONDITION_RESOLUTIONS,
  CORRESPONDING_INDEXES,
  FINAL_VERDICTS,
  GENE_SOURCES,
  INTERNAL_AGENT_VERDICTS,
  NORMALIZED_DIRECTIONS,
  PATHWAY_SOURCES,
  REQUESTED_ACTIONS,
  RETRIEVAL_MODES,
  SELECTION_SCOPES,
} from "./taxonomies";

// --- Raw claim extraction (Step 1-2: interpretation input -> extracted claims) ---

export const ClaimTypeSchema = z.enum(CLAIM_TYPES);
export type ClaimType = z.infer<typeof ClaimTypeSchema>;

export const InterpretationInputSchema = z.object({
  interpretation_id: z.string(),
  source_label: z.string(),
  full_text: z.string(),
  handoff_project_id: z.string().optional(),
  created_at: z.string(),
});
export type InterpretationInput = z.infer<typeof InterpretationInputSchema>;

export const RawEntitiesSchema = z.object({
  genes: z.array(z.string()),
  pathways: z.array(z.string()),
  cell_context: z.array(z.string()),
  conditions: z.array(z.string()),
  direction: z.array(z.string()),
});
export type RawEntities = z.infer<typeof RawEntitiesSchema>;

export const LanguageFlagsSchema = z.object({
  strength_words: z.array(z.string()),
  causal_words: z.array(z.string()),
});
export type LanguageFlags = z.infer<typeof LanguageFlagsSchema>;

export const ExtractedClaimSchema = z.object({
  claim_id: z.string(),
  interpretation_id: z.string(),
  sentence_id: z.string(),
  original_text: z.string(),
  claim_type: ClaimTypeSchema,
  raw_entities: RawEntitiesSchema,
  language_flags: LanguageFlagsSchema,
  extraction_notes: z.array(z.string()).optional(),
});
export type ExtractedClaim = z.infer<typeof ExtractedClaimSchema>;

export const ClaimExtractionResultSchema = z.object({
  interpretation_id: z.string(),
  source_text: z.string(),
  claims: z.array(ExtractedClaimSchema),
});
export type ClaimExtractionResult = z.infer<typeof ClaimExtractionResultSchema>;

// --- Biological entity categorization (Step 3: organize claim text into search-ready categories) ---

export const BiologicalEntityCategorySchema = z.enum([
  "gene",
  "pathway_or_process",
  "cell_context",
  "condition",
  "perturbation_type",
  "direction",
  "unknown",
]);
export type BiologicalEntityCategory = z.infer<typeof BiologicalEntityCategorySchema>;

export const CategorizedBiologicalEntitiesSchema = z.object({
  claim_id: z.string(),
  interpretation_id: z.string(),
  genes: z.array(z.string()),
  pathways_or_processes: z.array(z.string()),
  cell_contexts: z.array(z.string()),
  conditions: z.array(z.string()),
  perturbation_types: z.array(z.string()),
  directions: z.array(z.string()),
  uncategorized_terms: z.array(z.string()),
  categorization_notes: z.array(z.string()),
});
export type CategorizedBiologicalEntities = z.infer<typeof CategorizedBiologicalEntitiesSchema>;

export const EntityCategorizationResultSchema = z.object({
  interpretation_id: z.string(),
  categorized_claims: z.array(CategorizedBiologicalEntitiesSchema),
});
export type EntityCategorizationResult = z.infer<typeof EntityCategorizationResultSchema>;

// --- Mini ontology normalization (Step 4: resolve categorized raw text to canonical genes/pathways/cell types/dataset terms) ---
// Category-specific schemas on purpose — genes, pathways, conditions, cell
// context, and direction each resolve differently and can each preserve
// ambiguity (multiple candidates) instead of forcing one answer.

export const GeneMatchTypeSchema = z.enum([
  "exact_symbol",
  "alias_symbol",
  "previous_symbol",
  "manual_alias_override",
  "unresolved",
]);
export type GeneMatchType = z.infer<typeof GeneMatchTypeSchema>;

// Source = which reference layer produced the mapping (HGNC vs. manual
// alias override vs. unresolved) — distinct from match_type, which
// describes how the raw text matched within that reference layer.
export const GeneSourceSchema = z.enum(GENE_SOURCES);
export type GeneSourceValue = z.infer<typeof GeneSourceSchema>;

export const NormalizedGeneEntitySchema = z.object({
  raw: z.string(),
  normalized_symbol: z.string().nullable(),
  source: GeneSourceSchema,
  source_id: z.string().nullable(),
  match_type: GeneMatchTypeSchema,
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});
export type NormalizedGeneEntity = z.infer<typeof NormalizedGeneEntitySchema>;

export const PathwayMatchTypeSchema = z.enum(["exact_name", "alias", "keyword", "curated_fallback", "unresolved"]);
export type PathwayMatchType = z.infer<typeof PathwayMatchTypeSchema>;

export const PathwaySourceSchema = z.enum(PATHWAY_SOURCES);
export type PathwaySource = z.infer<typeof PathwaySourceSchema>;

export const NormalizedPathwayEntitySchema = z.object({
  raw: z.string(),
  normalized_name: z.string().nullable(),
  candidate_ids: z.array(z.string()),
  source: PathwaySourceSchema,
  match_type: PathwayMatchTypeSchema,
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});
export type NormalizedPathwayEntity = z.infer<typeof NormalizedPathwayEntitySchema>;

export const ConditionResolutionSchema = z.enum(CONDITION_RESOLUTIONS);
export type ConditionResolution = z.infer<typeof ConditionResolutionSchema>;

export const NormalizedConditionEntitySchema = z.object({
  raw: z.string(),
  candidate_dataset_values: z.array(z.string()),
  resolution: ConditionResolutionSchema,
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});
export type NormalizedConditionEntity = z.infer<typeof NormalizedConditionEntitySchema>;

export const CellTypeMatchTypeSchema = z.enum(["exact_label", "synonym", "curated_fallback", "unresolved"]);
export type CellTypeMatchType = z.infer<typeof CellTypeMatchTypeSchema>;

export const NormalizedCellTypeEntitySchema = z.object({
  normalized_name: z.string().nullable(),
  id_system: z.literal("Cell Ontology"),
  source_id: z.string().nullable(),
  match_type: CellTypeMatchTypeSchema,
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});
export type NormalizedCellTypeEntity = z.infer<typeof NormalizedCellTypeEntitySchema>;

export const NormalizedCellContextSchema = z.object({
  raw: z.string(),
  cell_type: NormalizedCellTypeEntitySchema,
  condition_candidates: z.array(z.string()),
});
export type NormalizedCellContext = z.infer<typeof NormalizedCellContextSchema>;

export const NormalizedDirectionValueSchema = z.enum(NORMALIZED_DIRECTIONS);
export type NormalizedDirectionValue = z.infer<typeof NormalizedDirectionValueSchema>;

export const DirectionMatchTypeSchema = z.enum(["curated_direction_dictionary", "ambiguous", "unresolved"]);
export type DirectionMatchType = z.infer<typeof DirectionMatchTypeSchema>;

export const NormalizedDirectionEntitySchema = z.object({
  raw: z.string(),
  normalized_direction: NormalizedDirectionValueSchema,
  match_type: DirectionMatchTypeSchema,
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});
export type NormalizedDirectionEntity = z.infer<typeof NormalizedDirectionEntitySchema>;

export const NormalizedClaimEntitiesSchema = z.object({
  claim_id: z.string(),
  interpretation_id: z.string(),
  genes: z.array(NormalizedGeneEntitySchema),
  pathways: z.array(NormalizedPathwayEntitySchema),
  conditions: z.array(NormalizedConditionEntitySchema),
  // Arrays per docs/geneground-backend-logic.md Step 3B — a claim can
  // mention more than one cell-context phrase or direction word.
  cell_context: z.array(NormalizedCellContextSchema),
  direction: z.array(NormalizedDirectionEntitySchema),
  normalization_warnings: z.array(z.string()),
});
export type NormalizedClaimEntities = z.infer<typeof NormalizedClaimEntitiesSchema>;

export const EntityNormalizationResultSchema = z.object({
  interpretation_id: z.string(),
  normalized_claims: z.array(NormalizedClaimEntitiesSchema),
});
export type EntityNormalizationResult = z.infer<typeof EntityNormalizationResultSchema>;

// --- Artifact indexes (Step 5: organize handoff artifacts into typed, retrievable evidence chunks) ---
// Labeled "filing cabinets" — no retrieval logic yet, just building and
// displaying the indexes themselves.

export const ArtifactIndexTypeSchema = z.enum(CORRESPONDING_INDEXES);
export type ArtifactIndexType = z.infer<typeof ArtifactIndexTypeSchema>;

export const EvidenceChunkTypeSchema = z.enum([
  "perturbation_de_summary",
  "pathway_signature_summary",
  "robustness_quality_summary",
  "language_rule",
  "provenance_record",
  "demo_example",
]);
export type EvidenceChunkType = z.infer<typeof EvidenceChunkTypeSchema>;

export const EvidenceChunkSchema = z.object({
  chunk_id: z.string(),
  chunk_type: EvidenceChunkTypeSchema,
  source_artifact_id: z.string(),
  source_file_name: z.string(),
  index_type: ArtifactIndexTypeSchema,
  // Short natural-language description for future embedding search — no
  // embeddings are generated yet, this field just reserves the slot.
  text_for_embedding: z.string(),
  // Labels used to find/filter the chunk (not the evidence itself).
  metadata: z.record(z.string(), z.unknown()),
  // The actual evidence data used to judge a claim.
  structured_payload: z.record(z.string(), z.unknown()),
  warnings: z.array(z.string()).optional(),
});
export type EvidenceChunk = z.infer<typeof EvidenceChunkSchema>;

export const ArtifactIndexSchema = z.object({
  index_name: ArtifactIndexTypeSchema,
  plain_english_question: z.string(),
  source_artifact_ids: z.array(z.string()),
  chunks: z.array(EvidenceChunkSchema),
  warnings: z.array(z.string()).optional(),
});
export type ArtifactIndex = z.infer<typeof ArtifactIndexSchema>;

export const ArtifactIndexesSchema = z.object({
  project_id: z.string(),
  created_at: z.string(),
  indexes: z.object({
    perturbation_evidence_index: ArtifactIndexSchema,
    pathway_signature_index: ArtifactIndexSchema,
    robustness_quality_index: ArtifactIndexSchema,
    language_rules_index: ArtifactIndexSchema,
    provenance_index: ArtifactIndexSchema,
    demo_examples_index: ArtifactIndexSchema,
  }),
  global_warnings: z.array(z.string()).optional(),
});
export type ArtifactIndexes = z.infer<typeof ArtifactIndexesSchema>;

// --- Artifact Discovery Agent (Step 10: classify handoff files into artifact types and target indexes) ---
// Conceptually runs before Step 5 (Artifact Indexes) in the real pipeline —
// the file classification manifest is what would drive index construction.
// Verification agents never pick files directly; they only ever query the
// typed indexes this classification feeds.

export const ArtifactTypeSchema = z.enum(ARTIFACT_TYPES);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const ArtifactPrioritySchema = z.enum(ARTIFACT_PRIORITIES);
export type ArtifactPriority = z.infer<typeof ArtifactPrioritySchema>;

export const IgnoredFileActionSchema = z.enum([
  "ignored_for_web_mvp",
  "ignored_too_large",
  "ignored_unsupported_type",
  "ignored_irrelevant",
  "needs_manual_review",
  // Added for real handoff zip import (Step 12) — junk/system files and
  // blocked unsafe paths are import-layer safety concerns the mock handoff
  // path never encountered.
  "ignored_junk_file",
  "ignored_unsafe_path",
]);
export type IgnoredFileAction = z.infer<typeof IgnoredFileActionSchema>;

export const ArtifactManifestEntrySchema = z.object({
  file_name: z.string(),
  file_path: z.string(),
  file_extension: z.string(),
  artifact_type: ArtifactTypeSchema,
  use_for_indexes: z.array(ArtifactIndexTypeSchema),
  priority: ArtifactPrioritySchema,
  reason: z.string(),
  detected_signals: z.array(z.string()),
  size_bytes: z.number().optional(),
  warnings: z.array(z.string()).optional(),
});
export type ArtifactManifestEntry = z.infer<typeof ArtifactManifestEntrySchema>;

export const IgnoredFileEntrySchema = z.object({
  file_name: z.string(),
  file_path: z.string(),
  file_extension: z.string(),
  reason: z.string(),
  action_taken: IgnoredFileActionSchema,
  size_bytes: z.number().optional(),
  warnings: z.array(z.string()).optional(),
});
export type IgnoredFileEntry = z.infer<typeof IgnoredFileEntrySchema>;

export const ArtifactDiscoverySummarySchema = z.object({
  total_files_scanned: z.number(),
  classified_files: z.number(),
  ignored_files: z.number(),
  high_priority_files: z.number(),
  medium_priority_files: z.number(),
  low_priority_files: z.number(),
  files_by_artifact_type: z.record(z.string(), z.number()),
  files_by_index: z.record(z.string(), z.number()),
});
export type ArtifactDiscoverySummary = z.infer<typeof ArtifactDiscoverySummarySchema>;

export const ArtifactDiscoveryResultSchema = z.object({
  project_id: z.string(),
  created_at: z.string(),
  artifact_manifest: z.array(ArtifactManifestEntrySchema),
  ignored_files: z.array(IgnoredFileEntrySchema),
  summary: ArtifactDiscoverySummarySchema,
  manifest_warnings: z.array(z.string()),
});
export type ArtifactDiscoveryResult = z.infer<typeof ArtifactDiscoveryResultSchema>;

// --- Claude Science handoff zip import (Step 12: real user-uploaded handoff, feeds Artifact Discovery) ---
// This is the untrusted-input boundary: a user-uploaded .zip is unzipped,
// filtered, and lightly parsed here before anything touches Artifact
// Discovery or the Artifact Indexes. Nothing from the zip is ever executed.

export const HandoffImportParsedKindSchema = z.enum([
  "json",
  "table",
  "text",
  "visualization",
  "parquet",
  "html_text",
  "raw_omics_ignored",
  "unsupported",
  "junk",
  "unsafe",
]);
export type HandoffImportParsedKind = z.infer<typeof HandoffImportParsedKindSchema>;

export const HandoffImportFileSchema = z.object({
  file_name: z.string(),
  file_path: z.string(),
  file_extension: z.string(),
  size_bytes: z.number(),
  accepted: z.boolean(),
  ignored: z.boolean(),
  ignore_reason: z.string().optional(),
  parsed_kind: HandoffImportParsedKindSchema,
  content_preview: z.string().optional(),
  parsed_content: z.unknown().optional(),
  warnings: z.array(z.string()).optional(),
});
export type HandoffImportFile = z.infer<typeof HandoffImportFileSchema>;

export const HandoffImportResultSchema = z.object({
  project_id: z.string(),
  created_at: z.string(),
  total_files_seen: z.number(),
  accepted_files_count: z.number(),
  ignored_files_count: z.number(),
  files: z.array(HandoffImportFileSchema),
  warnings: z.array(z.string()),
});
export type HandoffImportResult = z.infer<typeof HandoffImportResultSchema>;

export const HandoffImportConfigSchema = z.object({
  accepted_extensions: z.array(z.string()),
  raw_omics_extensions: z.array(z.string()),
  junk_file_patterns: z.array(z.string()),
  max_file_size_bytes: z.number(),
  max_total_unzipped_bytes: z.number(),
});
export type HandoffImportConfig = z.infer<typeof HandoffImportConfigSchema>;

// --- AgentQueryPlan (Step 6: claim-level work order for the four verification agents) ---
// No retrieval yet — this only decides which index each agent should query,
// what filters to use, and what question it's trying to answer.

export const AgentTypeSchema = z.enum(AGENT_TYPES);
export type AgentType = z.infer<typeof AgentTypeSchema>;

// index_type is usually a single index, but robustness_quality queries both
// robustness_quality_index and provenance_index (docs/geneground-backend-logic.md Step 5).
export const AgentQueryIndexTypeSchema = z.union([ArtifactIndexTypeSchema, z.array(ArtifactIndexTypeSchema)]);
export type AgentQueryIndexType = z.infer<typeof AgentQueryIndexTypeSchema>;

export const AgentQuerySchema = z.object({
  agent_type: AgentTypeSchema,
  // Formatted as "[claim number]_[agent categorization]", e.g. "claim_001__perturbation_evidence".
  agent_query_id: z.string(),
  index_type: AgentQueryIndexTypeSchema,
  filters: z.record(z.string(), z.unknown()),
  question: z.string(),
  evidence_fields_to_retrieve: z.array(z.string()),
  retrieval_notes: z.array(z.string()).optional(),
});
export type AgentQuery = z.infer<typeof AgentQuerySchema>;

export const AgentQueryPlanSchema = z.object({
  claim_id: z.string(),
  interpretation_id: z.string(),
  // Traces this plan back to Step 2's InterpretationClaimMap.
  sentence_id: z.string(),
  original_claim_text: z.string(),
  claim_type: z.string(),
  agent_queries: z.object({
    perturbation_evidence: AgentQuerySchema,
    pathway_signature: AgentQuerySchema,
    robustness_quality: AgentQuerySchema,
    language_causality: AgentQuerySchema,
  }),
  plan_warnings: z.array(z.string()).optional(),
});
export type AgentQueryPlan = z.infer<typeof AgentQueryPlanSchema>;

export const AgentQueryPlanResultSchema = z.object({
  interpretation_id: z.string(),
  plans: z.array(AgentQueryPlanSchema),
});
export type AgentQueryPlanResult = z.infer<typeof AgentQueryPlanResultSchema>;

// --- Evidence retrieval preview (Step 7: use each AgentQueryPlan to pull matching chunks from the indexes) ---
// Deterministic metadata + keyword scoring only — no embeddings, no agents
// reading the results yet, just a preview of what each agent would receive.

// Step 7 retrieval mode — metadata-first, with local TF-IDF vector fallback.
// retrieval_score stays internal-only ranking metadata (not a documented
// output field); no similarity_score is ever exposed anywhere.
export const RetrievalModeSchema = z.enum(RETRIEVAL_MODES);
export type RetrievalMode = z.infer<typeof RetrievalModeSchema>;

export const RetrievedChunkSchema = z.object({
  chunk_id: z.string(),
  index_type: ArtifactIndexTypeSchema,
  chunk_type: EvidenceChunkTypeSchema,
  source_file_name: z.string(),
  retrieval_score: z.number(),
  retrieval_mode: RetrievalModeSchema,
  retrieval_reasons: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
  structured_payload: z.record(z.string(), z.unknown()),
  text_for_embedding: z.string(),
  warnings: z.array(z.string()).optional(),
});
export type RetrievedChunk = z.infer<typeof RetrievedChunkSchema>;

export const AgentRetrievedEvidenceSchema = z.object({
  agent_type: AgentTypeSchema,
  agent_query_id: z.string(),
  index_type: AgentQueryIndexTypeSchema,
  question: z.string(),
  filters: z.record(z.string(), z.unknown()),
  retrieved_chunks: z.array(RetrievedChunkSchema),
  retrieval_warnings: z.array(z.string()),
});
export type AgentRetrievedEvidence = z.infer<typeof AgentRetrievedEvidenceSchema>;

export const ClaimRetrievedEvidenceSchema = z.object({
  claim_id: z.string(),
  interpretation_id: z.string(),
  sentence_id: z.string(),
  original_claim_text: z.string(),
  agent_evidence: z.object({
    perturbation_evidence: AgentRetrievedEvidenceSchema,
    pathway_signature: AgentRetrievedEvidenceSchema,
    robustness_quality: AgentRetrievedEvidenceSchema,
    language_causality: AgentRetrievedEvidenceSchema,
  }),
  claim_retrieval_warnings: z.array(z.string()),
});
export type ClaimRetrievedEvidence = z.infer<typeof ClaimRetrievedEvidenceSchema>;

export const EvidenceRetrievalResultSchema = z.object({
  interpretation_id: z.string(),
  retrieved_evidence_by_claim: z.array(ClaimRetrievedEvidenceSchema),
});
export type EvidenceRetrievalResult = z.infer<typeof EvidenceRetrievalResultSchema>;

// --- Four mock agent verdicts (Step 8: each agent inspects only its own retrieved chunks) ---
// Intermediate, per-agent judgments — not the final claim-level verdict.
// The aggregator that combines these comes later.

// Agent-level verdicts include not_applicable (unlike FinalVerdictLabelSchema).
export const AgentVerdictLabelSchema = z.enum(INTERNAL_AGENT_VERDICTS);
export type AgentVerdictLabel = z.infer<typeof AgentVerdictLabelSchema>;

export const AgentResultSchema = z.object({
  agent_type: AgentTypeSchema,
  agent_query_id: z.string(),
  claim_id: z.string(),
  agent_verdict: AgentVerdictLabelSchema,
  confidence: z.number().min(0).max(1),
  evidence_chunk_ids: z.array(z.string()),
  supporting_points: z.array(z.string()),
  weak_points: z.array(z.string()),
  missing_evidence: z.array(z.string()),
  risk_flags: z.array(z.string()),
  suggested_language_change: z.string().optional(),
  agent_reasoning_summary: z.string(),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;

export const ClaimAgentResultsSchema = z.object({
  claim_id: z.string(),
  interpretation_id: z.string(),
  sentence_id: z.string(),
  original_claim_text: z.string(),
  claim_type: z.string(),
  agent_results: z.object({
    perturbation_evidence: AgentResultSchema,
    pathway_signature: AgentResultSchema,
    robustness_quality: AgentResultSchema,
    language_causality: AgentResultSchema,
  }),
  warnings: z.array(z.string()).optional(),
});
export type ClaimAgentResults = z.infer<typeof ClaimAgentResultsSchema>;

export const AgentVerdictResultSchema = z.object({
  interpretation_id: z.string(),
  claim_agent_results: z.array(ClaimAgentResultsSchema),
});
export type AgentVerdictResult = z.infer<typeof AgentVerdictResultSchema>;

// --- Final verdict aggregator (Step 9: combine the four mock agent judgments into one dataset-grounded verdict) ---
// Still dataset-grounded only — literature/MCP grounding is later, secondary context.

// Final claim-level verdicts must NOT include not_applicable (unlike AgentVerdictLabelSchema).
export const FinalVerdictLabelSchema = z.enum(FINAL_VERDICTS);
export type FinalVerdictLabel = z.infer<typeof FinalVerdictLabelSchema>;

export const RecommendedActionSchema = z.enum([
  "accept",
  "soften_wording",
  "add_caveat",
  "specify_condition",
  "split_claim",
  "reject_or_rewrite",
  "request_more_evidence",
  "human_review",
]);
export type RecommendedAction = z.infer<typeof RecommendedActionSchema>;

export const ChunkIdsByAgentSchema = z.object({
  perturbation_evidence: z.array(z.string()),
  pathway_signature: z.array(z.string()),
  robustness_quality: z.array(z.string()),
  language_causality: z.array(z.string()),
});
export type ChunkIdsByAgent = z.infer<typeof ChunkIdsByAgentSchema>;

export const FinalEvidenceBasisSchema = z.object({
  dataset_grounded: z.boolean(),
  artifact_indexes_used: z.array(ArtifactIndexTypeSchema),
  evidence_chunk_ids: z.array(z.string()),
  // Per-agent breakdown of evidence_chunk_ids, per docs/geneground-backend-logic.md Step 8.
  chunk_ids_by_agent: ChunkIdsByAgentSchema,
});
export type FinalEvidenceBasis = z.infer<typeof FinalEvidenceBasisSchema>;

// Agent-level verdict label only — no numeric confidence. Per
// docs/geneground-taxonomies.md + geneground-backend-logic.md, confidence
// scores are not part of user-facing output; numeric agent confidence stays
// internal to AgentResultSchema (src/lib/mockAgents.ts) for deterministic
// scoring only, and is never threaded into FinalClaimResult.
export const AgentVerdictSummarySchema = z.object({
  agent_verdict: AgentVerdictLabelSchema,
});
export type AgentVerdictSummary = z.infer<typeof AgentVerdictSummarySchema>;

export const FinalClaimResultSchema = z.object({
  claim_id: z.string(),
  interpretation_id: z.string(),
  original_claim_text: z.string(),
  claim_type: z.string(),
  final_verdict: FinalVerdictLabelSchema,
  // No confidence field: docs/geneground-taxonomies.md + geneground-backend-logic.md
  // state final user-facing output should not include confidence scores.
  evidence_basis: FinalEvidenceBasisSchema,
  agent_verdicts: z.object({
    perturbation_evidence: AgentVerdictSummarySchema,
    pathway_signature: AgentVerdictSummarySchema,
    robustness_quality: AgentVerdictSummarySchema,
    language_causality: AgentVerdictSummarySchema,
  }),
  supported_parts: z.array(z.string()),
  caveats: z.array(z.string()),
  unsupported_or_overstated_parts: z.array(z.string()),
  missing_evidence: z.array(z.string()),
  risk_flags: z.array(z.string()),
  recommended_action: RecommendedActionSchema,
  safer_rewrite: z.string(),
  // Short, user-facing "Reason" shown by default in claim cards (~1-2
  // sentences, clamped by src/lib/reasonSummary.ts's shortenReason).
  biologist_friendly_explanation: z.string(),
  // Optional longer-form rationale (joined per-agent summaries) — never
  // shown in the default claim card, only in Evidence Trace / Technical
  // Pipeline detail views.
  detailed_reason: z.string().optional(),
  // True once a rewrite was actually attempted (Claude or deterministic
  // fallback) for this claim; false means safer_rewrite intentionally
  // equals original_claim_text because no rewrite was needed.
  rewrite_needed: z.boolean().optional(),
  // Traces this result back to Step 2 (sentence_id) and Step 5 (the four
  // agent_query_ids used) — docs/geneground-backend-logic.md Step 8.
  trace: z.object({
    sentence_id: z.string(),
    agent_query_id: z.array(z.string()),
  }),
});
export type FinalClaimResult = z.infer<typeof FinalClaimResultSchema>;

export const FinalVerdictSummarySchema = z.object({
  total_claims: z.number(),
  supported: z.number(),
  supported_with_caveats: z.number(),
  partially_supported: z.number(),
  overstated: z.number(),
  unsupported: z.number(),
  insufficient_evidence: z.number(),
  needs_review: z.number(),
});
export type FinalVerdictSummary = z.infer<typeof FinalVerdictSummarySchema>;

export const FinalVerdictResultSchema = z.object({
  interpretation_id: z.string(),
  summary: FinalVerdictSummarySchema,
  claim_results: z.array(FinalClaimResultSchema),
  global_warnings: z.array(z.string()),
});
export type FinalVerdictResult = z.infer<typeof FinalVerdictResultSchema>;

// --- Evidence-Linked Review Editor (Step 11: interactive selection -> evidence-linked chat/rewrite mock) ---
// Deterministic mock interaction layer — no Claude API, no real agent
// re-runs, no server persistence. Selecting text maps back to sentence IDs,
// claim IDs, evidence chunks, and final verdicts already computed upstream.

export const SelectionScopeSchema = z.enum(SELECTION_SCOPES);
export type SelectionScope = z.infer<typeof SelectionScopeSchema>;

export const TextSelectionContextSchema = z.object({
  selection_id: z.string(),
  interpretation_id: z.string(),
  selected_text: z.string(),
  span_start: z.number().nullable(),
  span_end: z.number().nullable(),
  selection_scope: SelectionScopeSchema,
  matched_sentence_ids: z.array(z.string()),
  matched_claim_ids: z.array(z.string()),
  match_confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});
export type TextSelectionContext = z.infer<typeof TextSelectionContextSchema>;

export const ReviewChatMessageSchema = z.object({
  message_id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  created_at: z.string(),
});
export type ReviewChatMessage = z.infer<typeof ReviewChatMessageSchema>;

export const InteractiveReviewThreadSchema = z.object({
  thread_id: z.string(),
  selection_id: z.string(),
  linked_claim_ids: z.array(z.string()),
  linked_evidence_chunk_ids: z.array(z.string()),
  messages: z.array(ReviewChatMessageSchema),
  thread_status: z.enum(["open", "closed"]),
});
export type InteractiveReviewThread = z.infer<typeof InteractiveReviewThreadSchema>;

// ask_followup and apply_existing_safer_rewrite are legacy pre-taxonomy
// values kept for backward compatibility (used by interactiveReviewMock.ts
// and the review UI); the taxonomy doc's REQUESTED_ACTIONS uses
// apply_existing_rewrite instead and treats follow-up questions as free
// chat rather than a structured action. Reconciling this is a UI-layer
// change, deferred.
export const ReviewRequestedActionSchema = z.enum([...REQUESTED_ACTIONS, "ask_followup", "apply_existing_safer_rewrite"] as const);
export type ReviewRequestedAction = z.infer<typeof ReviewRequestedActionSchema>;

// "edited" is a legacy pre-taxonomy value kept for backward compatibility
// (used by EvidenceLinkedReviewEditor.tsx); the taxonomy doc's
// ACTION_PLAN_STATUSES uses edited_before_apply instead. Reconciling this
// is a UI-layer change, deferred.
export const ReviewActionPlanStatusSchema = z.enum([...ACTION_PLAN_STATUSES, "edited"] as const);
export type ReviewActionPlanStatus = z.infer<typeof ReviewActionPlanStatusSchema>;

export const ReviewProposedChangeTypeSchema = z.enum(CHANGE_TYPES);
export type ReviewProposedChangeType = z.infer<typeof ReviewProposedChangeTypeSchema>;

export const ReviewProposedChangeSchema = z.object({
  change_id: z.string(),
  change_type: ReviewProposedChangeTypeSchema,
  original_text: z.string(),
  proposed_text: z.string(),
  reason: z.string(),
  affected_span_start: z.number().nullable(),
  affected_span_end: z.number().nullable(),
});
export type ReviewProposedChange = z.infer<typeof ReviewProposedChangeSchema>;

export const ReviewActionPlanSchema = z.object({
  action_plan_id: z.string(),
  selection_id: z.string(),
  requested_action: ReviewRequestedActionSchema,
  scope: SelectionScopeSchema,
  affected_claim_ids: z.array(z.string()),
  affected_sentence_ids: z.array(z.string()),
  evidence_to_reuse: z.array(z.string()),
  agents_to_rerun: z.array(AgentTypeSchema),
  proposed_changes: z.array(ReviewProposedChangeSchema),
  user_decision_options: z.array(z.string()),
  status: ReviewActionPlanStatusSchema,
  explanation: z.string(),
  warnings: z.array(z.string()),
});
export type ReviewActionPlan = z.infer<typeof ReviewActionPlanSchema>;

export const InteractiveReviewResultSchema = z.object({
  interpretation_id: z.string(),
  selection_contexts: z.array(TextSelectionContextSchema),
  review_threads: z.array(InteractiveReviewThreadSchema),
  action_plans: z.array(ReviewActionPlanSchema),
});
export type InteractiveReviewResult = z.infer<typeof InteractiveReviewResultSchema>;

// --- Claude Science project handoff (mock status source, no real zip ingest yet) ---

export const HandoffArtifactSchema = z.object({
  name: z.string(),
  artifact_type: z.string(),
});
export type HandoffArtifact = z.infer<typeof HandoffArtifactSchema>;

export const HandoffProjectSchema = z.object({
  handoff_project_id: z.string(),
  project_name: z.string(),
  dataset_label: z.string(),
  status: z.enum(["ready", "processing", "error"]),
  generated_at: z.string(),
  artifacts: z.array(HandoffArtifactSchema),
});
export type HandoffProject = z.infer<typeof HandoffProjectSchema>;
