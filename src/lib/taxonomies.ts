// Single source of truth for GeneGround taxonomy labels and deterministic
// rules, transcribed from docs/geneground-taxonomies.md.
//
// Every value here must trace back to that document — do not add labels
// that aren't listed there. Where current pipeline code (claimExtractionMock.ts,
// mockAgents.ts, interactiveReviewMock.ts, etc.) hasn't been updated to
// produce/consume a given value yet, that's intentional: this file only
// establishes the taxonomy layer, not pipeline behavior.

// ---------------------------------------------------------------------------
// Claim type (used by the language_causality agent and AgentQueryPlan)
// ---------------------------------------------------------------------------

export const CLAIM_TYPES = [
  "perturbation_effect",
  "gene_expression_effect",
  "pathway_effect",
  "cell_state_effect",
  "condition_specific_effect",
  "regulatory_role",
  "causal_mechanism",
  "therapeutic_relevance",
  "robustness_claim",
  "comparative_claim",
  "novelty_claim",
  "summary_claim",
  "unsupported_generalization",
  "method_or_data_claim",
  "unknown",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

// ---------------------------------------------------------------------------
// Strength word dictionary (language_causality agent)
// ---------------------------------------------------------------------------

export const STRENGTH_WORDS_LOW_RISK = [
  "associated with",
  "consistent with",
  "suggests",
  "may",
  "candidate",
  "linked to",
  "correlated with",
  "appears to",
  "observed",
  "shows evidence of",
] as const;

export const STRENGTH_WORDS_MEDIUM_RISK = [
  "affects",
  "modulates",
  "alters",
  "shifts",
  "reduces",
  "increases",
  "suppresses",
  "activates",
  "enriches",
  "depletes",
  "promotes",
  "impairs",
  "regulates",
] as const;

export const STRENGTH_WORDS_HIGH_RISK = [
  "drives",
  "controls",
  "determines",
  "establishes",
  "reprograms",
  "rescues",
  "confirms",
  "validates",
  "proves",
  "demonstrates",
  "master regulator",
  "central regulator",
  "key regulator",
  "therapeutic target",
  "drug target",
  "mechanism",
  "causal mechanism",
] as const;

export type StrengthWordRiskTier = "low_risk" | "medium_risk" | "high_risk";

// ---------------------------------------------------------------------------
// Causal word dictionary (language_causality agent)
// ---------------------------------------------------------------------------

export const CAUSAL_WORDS = [
  "causes",
  "drives",
  "leads to",
  "results in",
  "is required for",
  "is necessary for",
  "is sufficient for",
  "controls",
  "determines",
  "mediates",
  "through",
  "via",
  "mechanism",
  "mechanistically",
  "reprograms",
  "rescues",
  "restores",
  "establishes",
  "proves",
] as const;

export const CAUSAL_PHRASE_PATTERNS = [
  "X is required for Y",
  "X is sufficient to induce Y",
  "X acts through Y",
  "X mediates Y",
  "X controls Y",
  "X establishes Y state",
  "X proves Y mechanism",
] as const;

// ---------------------------------------------------------------------------
// Direction (entity normalization)
// ---------------------------------------------------------------------------

export const NORMALIZED_DIRECTIONS = ["up", "down", "changed", "ambiguous", "unresolved"] as const;
export type NormalizedDirection = (typeof NORMALIZED_DIRECTIONS)[number];

// ---------------------------------------------------------------------------
// Source (entity normalization — Genes and Pathways only; see
// docs/geneground-taxonomies.md's "Source Taxonomy for Genes and Pathways".
// Do not add Source to Cell_context.)
// ---------------------------------------------------------------------------

export const GENE_SOURCES = ["HGNC", "manual_alias_override", "unresolved"] as const;
export type GeneSource = (typeof GENE_SOURCES)[number];

export const PATHWAY_SOURCES = ["Reactome", "curated_immune_signature", "Reactome + curated_immune_signature", "unresolved"] as const;
export type PathwaySource = (typeof PATHWAY_SOURCES)[number];

// ---------------------------------------------------------------------------
// Retrieval mode (Step 7 `retrieval_mode` — metadata-first, with local
// TF-IDF vector fallback; see docs/geneground-taxonomies.md's "Retrieval
// Mode Taxonomy for Chunk Retrieval". No similarity_score is ever exposed.)
// ---------------------------------------------------------------------------

export const RETRIEVAL_MODES = [
  "metadata_exact",
  "metadata_partial",
  "local_vector_fallback",
  "hybrid_metadata_and_local_vector",
  "not_retrieved",
  "manual_demo",
] as const;
export type RetrievalMode = (typeof RETRIEVAL_MODES)[number];

// ---------------------------------------------------------------------------
// Condition resolution (entity normalization)
// ---------------------------------------------------------------------------

export const CONDITION_RESOLUTIONS = ["resolved", "ambiguous", "resolved_multiple", "unresolved"] as const;
export type ConditionResolution = (typeof CONDITION_RESOLUTIONS)[number];

// ---------------------------------------------------------------------------
// Artifact type + corresponding index (Artifact Discovery Agent)
// ---------------------------------------------------------------------------

export const ARTIFACT_TYPES = [
  "perturbation_evidence",
  "pathway_evidence",
  "robustness_evidence",
  "language_rules",
  "provenance",
  "demo_claims",
  "ontology_reference",
  "raw_omics_data",
  "visualization",
  "report",
  "unsupported",
  "irrelevant",
  "unknown",
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

// Do not rename language_rules_index — referenced by name in
// docs/geneground-backend-logic.md and docs/geneground-taxonomies.md.
export const CORRESPONDING_INDEXES = [
  "perturbation_evidence_index",
  "pathway_signature_index",
  "robustness_quality_index",
  "language_rules_index",
  "provenance_index",
  "demo_examples_index",
] as const;
export type CorrespondingIndex = (typeof CORRESPONDING_INDEXES)[number];

export const ARTIFACT_PRIORITIES = ["high", "medium", "low"] as const;
export type ArtifactPriority = (typeof ARTIFACT_PRIORITIES)[number];

// ---------------------------------------------------------------------------
// Agent type
// ---------------------------------------------------------------------------

// Do not rename language_causality — referenced by name in
// docs/geneground-backend-logic.md and docs/geneground-taxonomies.md.
export const AGENT_TYPES = ["perturbation_evidence", "pathway_signature", "robustness_quality", "language_causality"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

// Agent-level verdicts may include not_applicable (an agent's evidence type
// can be irrelevant to a given claim).
export const INTERNAL_AGENT_VERDICTS = [
  "supports",
  "supports_with_caveats",
  "weak_support",
  "contradicts",
  "insufficient_evidence",
  "not_applicable",
  "needs_review",
] as const;
export type InternalAgentVerdict = (typeof INTERNAL_AGENT_VERDICTS)[number];

// Final claim-level verdicts must NOT include not_applicable — every claim
// gets a real final verdict, even if it's insufficient_evidence.
export const FINAL_VERDICTS = [
  "supported",
  "supported_with_caveats",
  "partially_supported",
  "overstated",
  "unsupported",
  "insufficient_evidence",
  "needs_review",
] as const;
export type FinalVerdict = (typeof FINAL_VERDICTS)[number];

// ---------------------------------------------------------------------------
// Interactive review (Steps 9-11)
// ---------------------------------------------------------------------------

export const SELECTION_SCOPES = ["word_or_phrase", "partial_claim", "full_claim", "sentence", "multi_sentence", "paragraph", "unknown"] as const;
export type SelectionScope = (typeof SELECTION_SCOPES)[number];

export const REQUESTED_ACTIONS = [
  "explain_verdict",
  "show_evidence",
  "rewrite_cautiously",
  "reevaluate_selection",
  "split_claim",
  "check_literature_grounding",
  "apply_existing_rewrite",
  "compare_original_and_rewrite",
] as const;
export type RequestedAction = (typeof REQUESTED_ACTIONS)[number];

// Rerun targets go beyond the four AGENT_TYPES — final_aggregator and
// literature_grounding are processes, not verification agents.
export const AGENTS_TO_RERUN = [
  "perturbation_evidence",
  "pathway_signature",
  "robustness_quality",
  "language_causality",
  "final_aggregator",
  "literature_grounding",
] as const;
export type AgentOrProcessToRerun = (typeof AGENTS_TO_RERUN)[number];

export const CHANGE_TYPES = ["replace_span", "replace_sentence", "add_caveat", "specify_condition", "split_sentence", "remove_claim", "no_change"] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const ACTION_PLAN_STATUSES = ["awaiting_user_approval", "approved", "edited_before_apply", "applied", "cancelled", "reverted", "failed"] as const;
export type ActionPlanStatus = (typeof ACTION_PLAN_STATUSES)[number];

// Options presented to the user for a single proposed change (Step 11
// user_decision_options) — distinct from ACTION_PLAN_STATUSES, which is the
// state of the plan itself.
export const USER_DECISION_OPTIONS = ["approve", "cancel", "edit_before_apply"] as const;
export type UserDecisionOption = (typeof USER_DECISION_OPTIONS)[number];

// =============================================================================
// Mapping / rule objects
// =============================================================================

// ---------------------------------------------------------------------------
// Artifact type -> keywords, corresponding index, priority rule
// (User-Inputted Handoff Folder File Artifact Type table)
// ---------------------------------------------------------------------------

export type ArtifactTypeRule = {
  keywords: readonly string[];
  corresponding_index: CorrespondingIndex | null;
  secondary_index?: CorrespondingIndex;
  priority_rule: string;
};

export const ARTIFACT_TYPE_RULES: Record<ArtifactType, ArtifactTypeRule> = {
  perturbation_evidence: {
    keywords: ["perturbation", "DE_stats", "differential_expression", "gene_level_de", "log_fc", "adj_p_value", "zscore", "top_changed_genes", "ontarget"],
    corresponding_index: "perturbation_evidence_index",
    priority_rule:
      "High if compact structured evidence file such as .json, .csv, .tsv, or .parquet. Medium if report text summarizes DE evidence but is not row-structured. Low if only a figure/plot. Ignored if huge .h5ad/matrix file intended for Claude Science processing rather than web MVP.",
  },
  pathway_evidence: {
    keywords: ["pathway", "signature", "enrichment", "Reactome", "Hallmark", "interferon", "NF-kB", "overlap_genes", "padj"],
    corresponding_index: "pathway_signature_index",
    priority_rule:
      "High if compact pathway/signature enrichment table or packet, especially .json, .csv, .tsv, .gmt, or .parquet. Medium if analysis/report text contains pathway evidence. Low if visualization only. Ignored if huge pathway database dump or unsupported binary.",
  },
  robustness_evidence: {
    keywords: [
      "robustness",
      "guide",
      "donor",
      "pseudobulk",
      "low_target_gex",
      "neighboring_gene_KD",
      "distal_offtarget_flag",
      "n_cells_target",
      "keep_for_DE",
      "QC",
    ],
    corresponding_index: "robustness_quality_index",
    priority_rule:
      "High if compact guide/donor/QC/robustness summary file. Medium if QC report text or provenance report describes caveats. Low if only a QC visualization. Ignored if raw pseudobulk matrix is huge and not already summarized.",
  },
  language_rules: {
    keywords: ["language_rules", "claim_language", "causal_words", "strength_words", "safer_rewrites", "master regulator", "therapeutic target", "mechanism"],
    corresponding_index: "language_rules_index",
    priority_rule:
      "High if structured JSON/TSV/CSV rules or curated rule file. Medium if rules are embedded in a report or markdown note. Low if incomplete scratch notes. Usually never ignored unless irrelevant or unreadable, because language rules are small and directly useful.",
  },
  provenance: {
    keywords: ["provenance", "manifest", "import_log", "dataset_inventory", "schema_map", "source_files", "processing_report", "thresholds", "caveats"],
    corresponding_index: "provenance_index",
    priority_rule:
      "High if it contains schema maps, dataset inventory, source file mapping, thresholds, or processing caveats needed for auditability. Medium if general import/session report. Low if vague notes with little machine-readable content. Ignored only if irrelevant or duplicate.",
  },
  demo_claims: {
    keywords: ["demo_claims", "gold_verdicts", "example_claims", "expected_verdicts", "demo_examples"],
    corresponding_index: "demo_examples_index",
    priority_rule:
      "Medium by default because useful for MVP testing but not biological evidence. High only in demo/dev mode if needed to populate examples. Low if outdated or incomplete. Ignored in production mode or once real Claude Science evidence is available.",
  },
  ontology_reference: {
    keywords: ["hgnc", "cell_ontology", "cl-basic", "reactome", "ontology", "dataset_terms"],
    corresponding_index: null, // no artifact evidence index; used for normalization
    priority_rule:
      "High for normalization if compact/current mini ontology or dataset terms file. Medium if full ontology/source reference that needs preprocessing. Low if outdated, duplicate, or too broad. Ignored for artifact evidence indexes because ontology files support entity normalization, not claim evidence verdicts. Not placed into an artifact evidence index.",
  },
  raw_omics_data: {
    keywords: [".h5ad", ".h5mu", ".loom", ".mtx", "raw_cell", "assigned_guide", "huge matrix"],
    corresponding_index: null, // ignored for web MVP
    priority_rule:
      "Ignored for web MVP if large raw matrix. Low only if tiny toy/demo matrix. Medium only in a backend/offline processing mode. Never High for the browser-facing artifact index flow because raw omics data should be processed in Claude Science first and exported as compact evidence packets.",
  },
  visualization: {
    keywords: [".png", ".jpg", ".svg", "plot", "figure", "UMAP"],
    corresponding_index: null, // usually none
    secondary_index: "provenance_index", // sometimes provenance_index
    priority_rule:
      "Low by default because figures are hard to chunk into structured evidence. Medium if figure has a paired caption/report or is important for provenance/audit display. Ignored if decorative, duplicate, or not machine-readable. Not High unless figure OCR/vision parsing is added later, which should be avoided for MVP.",
  },
  report: {
    keywords: [".md", ".txt", ".pdf", "summary", "analysis_report", "final_report"],
    corresponding_index: "provenance_index", // usually; optionally an evidence index if structured content is detected
    priority_rule:
      "Medium by default. High if the report contains structured tables, explicit thresholds, caveats, or summarized evidence that can be parsed into chunks. Low if narrative-only or redundant. Ignored if unrelated, outdated, or impossible to parse safely.",
  },
  unsupported: {
    keywords: ["unsupported file type"],
    corresponding_index: null,
    priority_rule: "Ignored. Use ignored_unsupported_type or needs_manual_review.",
  },
  irrelevant: {
    keywords: ["unrelated file"],
    corresponding_index: null,
    priority_rule: "Ignored. Use ignored_irrelevant.",
  },
  unknown: {
    keywords: ["insufficient signals"],
    corresponding_index: null,
    priority_rule:
      "Low if potentially relevant but unclear. Ignored / needs_manual_review if no useful signals. Do not assign High unless the Artifact Discovery Agent finds strong content signals after previewing the file.",
  },
};

// ---------------------------------------------------------------------------
// Artifact Index Placement Guidelines table (dedicated placement lookup,
// separate from ARTIFACT_TYPE_RULES so callers that only need placement
// don't have to destructure the fuller keyword/priority rule object)
// ---------------------------------------------------------------------------

export const ARTIFACT_INDEX_PLACEMENT_RULES: Record<ArtifactType, CorrespondingIndex | null> = Object.fromEntries(
  ARTIFACT_TYPES.map((type) => [type, ARTIFACT_TYPE_RULES[type].corresponding_index]),
) as Record<ArtifactType, CorrespondingIndex | null>;

// ---------------------------------------------------------------------------
// Priority rule text, keyed by artifact type (same source as
// ARTIFACT_TYPE_RULES — kept as its own export because priority is decided
// by both index and artifact type, per Step 4's notes).
// ---------------------------------------------------------------------------

export const ARTIFACT_PRIORITY_RULES: Record<ArtifactType, string> = Object.fromEntries(
  ARTIFACT_TYPES.map((type) => [type, ARTIFACT_TYPE_RULES[type].priority_rule]),
) as Record<ArtifactType, string>;

// ---------------------------------------------------------------------------
// Agent-to-Index Mapping table
// ---------------------------------------------------------------------------

export const AGENT_TO_INDEX_MAP: Record<AgentType, CorrespondingIndex | CorrespondingIndex[]> = {
  perturbation_evidence: "perturbation_evidence_index",
  pathway_signature: "pathway_signature_index",
  robustness_quality: "robustness_quality_index",
  // language_causality queries both language_rules_index and provenance_index.
  language_causality: ["language_rules_index", "provenance_index"],
};

// ---------------------------------------------------------------------------
// Claim type priority order
//
// The taxonomy doc does not define an explicit ordering — this is a
// defensible default for a future deterministic classification cascade:
// the most specific / highest-signal claim types are checked first, generic
// or fallback types last. Not wired into claimExtractionMock.ts yet.
// ---------------------------------------------------------------------------

export const CLAIM_TYPE_PRIORITY_ORDER: readonly ClaimType[] = [
  "causal_mechanism",
  "unsupported_generalization",
  "therapeutic_relevance",
  "regulatory_role",
  "robustness_claim",
  "comparative_claim",
  "novelty_claim",
  "condition_specific_effect",
  "cell_state_effect",
  "pathway_effect",
  "gene_expression_effect",
  "perturbation_effect",
  "method_or_data_claim",
  "summary_claim",
  "unknown",
];

// ---------------------------------------------------------------------------
// Claim type -> which agents' evidence is relevant
//
// Grounded in the agent-level "not_applicable" notes in
// docs/geneground-taxonomies.md: pathway_signature is not_applicable for
// gene-level/method-only claims; robustness_quality is rarely not_applicable
// (method-only claims); language_causality is "very rare" not_applicable.
// Everything else defaults to all four agents being relevant.
// ---------------------------------------------------------------------------

export const CLAIM_TYPE_TO_AGENT_RELEVANCE: Record<ClaimType, readonly AgentType[]> = {
  perturbation_effect: ["perturbation_evidence", "pathway_signature", "robustness_quality", "language_causality"],
  gene_expression_effect: ["perturbation_evidence", "robustness_quality", "language_causality"], // gene-level: pathway_signature not_applicable
  pathway_effect: ["perturbation_evidence", "pathway_signature", "robustness_quality", "language_causality"],
  cell_state_effect: ["perturbation_evidence", "pathway_signature", "robustness_quality", "language_causality"],
  condition_specific_effect: ["perturbation_evidence", "pathway_signature", "robustness_quality", "language_causality"],
  regulatory_role: ["perturbation_evidence", "pathway_signature", "robustness_quality", "language_causality"],
  causal_mechanism: ["perturbation_evidence", "pathway_signature", "robustness_quality", "language_causality"],
  therapeutic_relevance: ["perturbation_evidence", "pathway_signature", "robustness_quality", "language_causality"],
  robustness_claim: ["perturbation_evidence", "pathway_signature", "robustness_quality", "language_causality"],
  comparative_claim: ["perturbation_evidence", "pathway_signature", "robustness_quality", "language_causality"],
  novelty_claim: ["perturbation_evidence", "pathway_signature", "robustness_quality", "language_causality"],
  summary_claim: ["perturbation_evidence", "pathway_signature", "robustness_quality", "language_causality"],
  unsupported_generalization: ["perturbation_evidence", "pathway_signature", "robustness_quality", "language_causality"],
  method_or_data_claim: ["language_causality"], // method/data claim: perturbation, pathway, robustness not_applicable
  unknown: ["perturbation_evidence", "pathway_signature", "robustness_quality", "language_causality"], // can't rule anything out
};

// ---------------------------------------------------------------------------
// Claim-Level Verdict Guidelines table
// ---------------------------------------------------------------------------

export const FINAL_VERDICT_AGGREGATION_RULES: Record<FinalVerdict, { meaning: string; agent_level_pattern: string }> = {
  supported: {
    meaning: "Dataset evidence supports the claim and wording is appropriately cautious.",
    agent_level_pattern: "Perturbation = supports; pathway = supports or not_applicable; robustness = supports; language = supports.",
  },
  supported_with_caveats: {
    meaning: "Core claim is supported, but there are robustness, ambiguity, condition, pathway, or wording caveats.",
    agent_level_pattern: "Biology agents mostly supports / supports_with_caveats; robustness or language has supports_with_caveats; no agent contradicts.",
  },
  partially_supported: {
    meaning: "Some parts are supported, but other parts are missing, too broad, or too strong.",
    agent_level_pattern:
      "At least one biology agent supports, but another key biology agent is weak_support or insufficient_evidence; language may be supports_with_caveats or weak_support.",
  },
  overstated: {
    meaning: "Evidence points in the same general direction, but wording is stronger than the data supports.",
    agent_level_pattern:
      'Perturbation/pathway are supports, supports_with_caveats, or weak_support, but language = weak_support or insufficient_evidence due to high-risk words like "master regulator," "therapeutic target," "causes," "proves," "mechanism."',
  },
  unsupported: {
    meaning: "Retrieved evidence does not support the claim or points against it.",
    agent_level_pattern: "Perturbation or pathway = contradicts; or key evidence directly conflicts with claimed direction/object.",
  },
  insufficient_evidence: {
    meaning: "Not enough relevant evidence was retrieved.",
    agent_level_pattern: "Perturbation and pathway are both insufficient_evidence, or most relevant agents are insufficient_evidence; no clear contradiction.",
  },
  needs_review: {
    meaning: "Conflicting/ambiguous results require human review.",
    agent_level_pattern: "Strong conflict between agents, mixed condition-specific findings, contradictory chunks, or agent verdicts include needs_review.",
  },
};

// ---------------------------------------------------------------------------
// Direction Dictionary for Normalization Step (flat raw-word -> direction
// lookup, expanded from the grouped table)
// ---------------------------------------------------------------------------

export const DIRECTION_NORMALIZATION_DICTIONARY: Record<string, NormalizedDirection> = {
  up: "up",
  increased: "up",
  increase: "up",
  upregulated: "up",
  higher: "up",
  elevated: "up",
  induced: "up",
  induces: "up",
  activates: "up",
  enhances: "up",
  promotes: "up",
  enriched: "up",

  down: "down",
  decreased: "down",
  decrease: "down",
  downregulated: "down",
  lower: "down",
  reduced: "down",
  reduces: "down",
  suppressed: "down",
  suppresses: "down",
  inhibits: "down",
  depleted: "down",
  attenuated: "down",

  altered: "changed",
  changed: "changed",
  modulated: "changed",
  affected: "changed",
  shifted: "changed",
  perturbed: "changed",
  rewired: "changed",

  // Ambiguous: causal/control words used without a clear up/down direction.
  drives: "ambiguous",
  causes: "ambiguous",
  controls: "ambiguous",
  regulates: "ambiguous",
  reprograms: "ambiguous",
  rescues: "ambiguous",
};

// ---------------------------------------------------------------------------
// Condition Mapping Rules table
// ---------------------------------------------------------------------------

export type ConditionNormalizationEntry = {
  candidate_dataset_values: readonly string[];
  resolution: ConditionResolution;
};

// Any raw condition text not found here falls back to the "no condition"
// row: { candidate_dataset_values: [], resolution: "unresolved" }.
export const CONDITION_NORMALIZATION_DICTIONARY: Record<string, ConditionNormalizationEntry> = {
  Rest: { candidate_dataset_values: ["Rest"], resolution: "resolved" },
  rest: { candidate_dataset_values: ["Rest"], resolution: "resolved" },
  resting: { candidate_dataset_values: ["Rest"], resolution: "resolved" },
  unstimulated: { candidate_dataset_values: ["Rest"], resolution: "resolved" },

  Stim8hr: { candidate_dataset_values: ["Stim8hr"], resolution: "resolved" },
  "8hr": { candidate_dataset_values: ["Stim8hr"], resolution: "resolved" },
  "8 hour": { candidate_dataset_values: ["Stim8hr"], resolution: "resolved" },
  "early stimulation": { candidate_dataset_values: ["Stim8hr"], resolution: "resolved" },

  Stim48hr: { candidate_dataset_values: ["Stim48hr"], resolution: "resolved" },
  "48hr": { candidate_dataset_values: ["Stim48hr"], resolution: "resolved" },
  "48 hour": { candidate_dataset_values: ["Stim48hr"], resolution: "resolved" },
  "late stimulation": { candidate_dataset_values: ["Stim48hr"], resolution: "resolved" },

  stimulated: { candidate_dataset_values: ["Stim8hr", "Stim48hr"], resolution: "ambiguous" },
  "after stimulation": { candidate_dataset_values: ["Stim8hr", "Stim48hr"], resolution: "ambiguous" },
  "stimulated conditions": { candidate_dataset_values: ["Stim8hr", "Stim48hr"], resolution: "ambiguous" },

  "early and late stimulation": { candidate_dataset_values: ["Stim8hr", "Stim48hr"], resolution: "resolved_multiple" },
};

export const CONDITION_NO_MATCH_ENTRY: ConditionNormalizationEntry = {
  candidate_dataset_values: [],
  resolution: "unresolved",
};

// ---------------------------------------------------------------------------
// Language risk rules (strength word tiers + causal words/phrases combined)
// ---------------------------------------------------------------------------

export const LANGUAGE_RISK_RULES = {
  low_risk: STRENGTH_WORDS_LOW_RISK,
  medium_risk: STRENGTH_WORDS_MEDIUM_RISK,
  high_risk: STRENGTH_WORDS_HIGH_RISK,
  causal_words: CAUSAL_WORDS,
  causal_phrase_patterns: CAUSAL_PHRASE_PATTERNS,
} as const;

// ---------------------------------------------------------------------------
// Rewrite Rule Taxonomy for Revised Omics Analysis
// ---------------------------------------------------------------------------

export const REWRITE_RULES: Record<string, string> = {
  drives: "is associated with",
  causes: "is consistent with / is associated with",
  proves: "is consistent with",
  "master regulator": "candidate regulator",
  "key regulator": "candidate regulator or potential regulator",
  "therapeutic target": "candidate for further study",
  mechanism: "possible mechanism or remove",
  suppresses: "is associated with decreased",
  activates: "is associated with increased",
  reprograms: "is associated with changes in",
  rescues: "partially restores only if directly supported; otherwise soften",
};
