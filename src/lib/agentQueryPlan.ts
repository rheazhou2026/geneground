import datasetTermsRaw from "@/data/ontology-mini/dataset_terms.geneground.json";
import type {
  AgentQuery,
  AgentQueryPlan,
  AgentQueryPlanResult,
  CategorizedBiologicalEntities,
  ExtractedClaim,
  NormalizedClaimEntities,
  NormalizedGeneEntity,
} from "./schemas";

interface DatasetPerturbationAlias {
  normalized: string | null;
  warning: string | null;
  note: string | null;
}

interface DatasetTermsLite {
  perturbation_type_aliases: Record<string, DatasetPerturbationAlias>;
}

const DATASET_TERMS = datasetTermsRaw as unknown as DatasetTermsLite;

function formatConditionPhrase(conditions: string[]): string {
  if (conditions.length === 0) return "an unspecified condition";
  if (conditions.length === 1) return conditions[0];
  return `${conditions.slice(0, -1).join(", ")} or ${conditions[conditions.length - 1]}`;
}

function buildAmbiguousConditionWarning(raw: string, candidates: string[]): string {
  if (candidates.length === 2 && candidates.includes("Stim8hr") && candidates.includes("Stim48hr")) {
    return "Condition is ambiguous, so downstream retrieval should search both stimulated conditions.";
  }
  return `Condition '${raw}' is ambiguous — downstream retrieval should search all candidate dataset values (${candidates.join(", ")}).`;
}

/**
 * Aggregates every normalized condition on the claim into one dataset-value
 * filter list. Resolved and ambiguous conditions both contribute their
 * candidate values (ambiguity is preserved, not collapsed); unresolved
 * conditions contribute nothing and are flagged instead.
 */
function resolveClaimConditions(normalized: NormalizedClaimEntities, planWarnings: string[]): string[] {
  const values = new Set<string>();

  for (const condition of normalized.conditions) {
    if (condition.resolution === "resolved") {
      condition.candidate_dataset_values.forEach((v) => values.add(v));
    } else if (condition.resolution === "ambiguous") {
      condition.candidate_dataset_values.forEach((v) => values.add(v));
      planWarnings.push(buildAmbiguousConditionWarning(condition.raw, condition.candidate_dataset_values));
    } else {
      planWarnings.push(`Condition '${condition.raw}' could not be resolved to a dataset value; left out of retrieval filters.`);
    }
  }

  return Array.from(values);
}

function pickPrimaryGene(genes: NormalizedGeneEntity[], planWarnings: string[]): NormalizedGeneEntity | null {
  const resolved = genes.filter((g) => g.match_type !== "unresolved");

  if (resolved.length === 0) {
    planWarnings.push(
      genes.length > 0
        ? `${genes.length} gene mention(s) in this claim could not be resolved against the mini HGNC panel — perturbation, pathway, and robustness filters have no target gene.`
        : "Claim has no gene/perturbation target — perturbation evidence, pathway, and robustness filters are partial.",
    );
    return null;
  }

  if (resolved.length > 1) {
    planWarnings.push(
      `Claim mentions multiple resolved genes (${resolved.map((g) => g.normalized_symbol).join(", ")}); using '${resolved[0].normalized_symbol}' as the primary perturbation target for this plan.`,
    );
  }

  return resolved[0];
}

/**
 * The full set of genes retrieval is allowed to match for this claim, and
 * whether that constraint applies at all — this is what
 * evidenceRetrieval.ts's hard gene filter reads (docs/geneground-backend-logic.md
 * Step 6 gene-match-before-condition-match rule). Three cases:
 *  1. Claim names one or more genes that resolve — allowed set is exactly
 *     those genes (covers both single-gene claims and claims that
 *     explicitly name several, e.g. "NFKB2 and GATA3 knockdowns").
 *  2. Claim has no gene of its own at all (e.g. a broad claim like "these
 *     knockdowns begin to define distinct arms...", or any other claim type
 *     that just doesn't name a specific gene) — allowed set widens to every
 *     gene mentioned anywhere else in the interpretation, never to genes the
 *     interpretation never discusses (e.g. FOXP3/RELB/TBX21 sitting in the
 *     evidence index but never mentioned in this interpretation). Applied
 *     regardless of the exact claim_type label rather than only literal
 *     "summary_claim" — a real Claude-driven classifier won't reliably
 *     produce that exact label for every claim that reads as a broad one,
 *     and widening to the interpretation's own genes can only narrow
 *     retrieval relative to leaving it fully open, never introduce a wrong
 *     gene, so it's safe unconditionally here.
 *  3. Interpretation has no resolved genes anywhere (degenerate case) — no
 *     gene constraint at all, unchanged from prior behavior.
 * geneConstrained stays true even when allowedGeneSymbols ends up empty for
 * case 1 with only unresolved raw mentions — that's "claim clearly names a
 * gene we can't identify," which should block matching (return nothing)
 * rather than silently falling back to unconstrained retrieval.
 */
function resolveGeneConstraint(
  normalizedClaim: NormalizedClaimEntities,
  interpretationGeneSymbols: string[],
): { allowedGeneSymbols: string[]; geneConstrained: boolean } {
  const resolvedGeneSymbols = Array.from(
    new Set(
      normalizedClaim.genes
        .filter((g) => g.match_type !== "unresolved" && g.normalized_symbol)
        .map((g) => g.normalized_symbol as string),
    ),
  );

  if (resolvedGeneSymbols.length > 0) {
    return { allowedGeneSymbols: resolvedGeneSymbols, geneConstrained: true };
  }

  if (normalizedClaim.genes.length > 0) {
    // Raw gene mention(s) present but none resolved — constrained, but to
    // nothing we can identify.
    return { allowedGeneSymbols: [], geneConstrained: true };
  }

  if (interpretationGeneSymbols.length > 0) {
    return { allowedGeneSymbols: interpretationGeneSymbols, geneConstrained: true };
  }

  return { allowedGeneSymbols: [], geneConstrained: false };
}

function resolvePerturbationType(rawPerturbationTypes: string[], planWarnings: string[]): string | null {
  for (const raw of rawPerturbationTypes) {
    const alias = DATASET_TERMS.perturbation_type_aliases[raw.toLowerCase()];
    if (alias?.normalized) return alias.normalized;
    if (alias?.warning && alias.note && !planWarnings.includes(alias.note)) {
      planWarnings.push(alias.note);
    }
  }
  return rawPerturbationTypes[0] ?? null;
}

function buildPerturbationEvidenceQuery(params: {
  primaryGene: NormalizedGeneEntity | null;
  conditions: string[];
  normalizedClaim: NormalizedClaimEntities;
  perturbationType: string | null;
  agentQueryId: string;
  allowedGeneSymbols: string[];
  geneConstrained: boolean;
}): AgentQuery {
  const { primaryGene, conditions, normalizedClaim, perturbationType, agentQueryId, allowedGeneSymbols, geneConstrained } = params;
  const targetGenePhrase = primaryGene?.normalized_symbol ?? "the target gene";

  return {
    agent_type: "perturbation_evidence",
    agent_query_id: agentQueryId,
    index_type: "perturbation_evidence_index",
    filters: {
      target_gene_symbol: primaryGene?.normalized_symbol ?? null,
      allowed_gene_symbols: allowedGeneSymbols,
      gene_constrained: geneConstrained,
      conditions,
      normalized_direction: normalizedClaim.direction[0]?.normalized_direction ?? null,
      perturbation_type: perturbationType,
    },
    question: `Did ${targetGenePhrase} CRISPRi perturbation produce significant gene expression changes in ${formatConditionPhrase(conditions)} CD4+ T cells?`,
    evidence_fields_to_retrieve: [
      "n_total_de_genes",
      "n_up_genes",
      "n_down_genes",
      "top_upregulated_genes",
      "top_downregulated_genes",
      "ontarget_effect_size",
      "ontarget_significant",
      "adjusted_p_values",
      "zscores",
      "source_artifact",
    ],
  };
}

function buildPathwaySignatureQuery(params: {
  primaryGene: NormalizedGeneEntity | null;
  conditions: string[];
  normalizedClaim: NormalizedClaimEntities;
  planWarnings: string[];
  agentQueryId: string;
  allowedGeneSymbols: string[];
  geneConstrained: boolean;
}): AgentQuery {
  const { primaryGene, conditions, normalizedClaim, planWarnings, agentQueryId, allowedGeneSymbols, geneConstrained } = params;
  const pathways = normalizedClaim.pathways;

  if (pathways.some((p) => p.candidate_ids.length > 1)) {
    planWarnings.push("Pathway phrase maps to multiple candidate pathway/signature terms.");
  }
  if (pathways.length === 0) {
    planWarnings.push(
      "Claim has no pathway/process mention — pathway/signature query will retrieve general evidence from the gene/condition alone.",
    );
  }

  const primaryPathwayName = pathways[0]?.normalized_name ?? pathways[0]?.raw ?? "a relevant pathway or signature";
  const targetGenePhrase = primaryGene?.normalized_symbol ?? "the target gene";

  return {
    agent_type: "pathway_signature",
    agent_query_id: agentQueryId,
    index_type: "pathway_signature_index",
    filters: {
      target_gene_symbol: primaryGene?.normalized_symbol ?? null,
      allowed_gene_symbols: allowedGeneSymbols,
      gene_constrained: geneConstrained,
      pathway_keywords: pathways.map((p) => p.raw),
      pathway_candidate_ids: Array.from(new Set(pathways.flatMap((p) => p.candidate_ids))),
      conditions,
      normalized_direction: normalizedClaim.direction[0]?.normalized_direction ?? null,
    },
    question: `Did ${primaryPathwayName} change in the claimed direction after ${targetGenePhrase} perturbation under ${formatConditionPhrase(conditions)}?`,
    evidence_fields_to_retrieve: [
      "pathway_name",
      "candidate_ids",
      "direction",
      "enrichment_score",
      "adjusted_p_value",
      "overlap_genes",
      "source_artifact",
    ],
  };
}

function buildRobustnessQualityQuery(params: {
  primaryGene: NormalizedGeneEntity | null;
  conditions: string[];
  agentQueryId: string;
  allowedGeneSymbols: string[];
  geneConstrained: boolean;
}): AgentQuery {
  const { primaryGene, conditions, agentQueryId, allowedGeneSymbols, geneConstrained } = params;
  const targetGenePhrase = primaryGene?.normalized_symbol ?? "the target gene";

  return {
    agent_type: "robustness_quality",
    agent_query_id: agentQueryId,
    // Robustness may consult both robustness_quality_index and
    // provenance_index (docs Step 5) — listed in that priority order so
    // retrieveEvidenceForAgentQuery only dips into provenance_index for
    // leftover slots robustness_quality_index didn't fill, never displacing
    // a real gene-matched robustness chunk with an unrelated-gene
    // provenance one. provenance_index chunks carry no gene metadata at
    // all, so they're deliberately outside GENE_HARD_FILTERED_INDEXES.
    index_type: ["robustness_quality_index", "provenance_index"],
    filters: {
      target_gene_symbol: primaryGene?.normalized_symbol ?? null,
      allowed_gene_symbols: allowedGeneSymbols,
      gene_constrained: geneConstrained,
      conditions,
    },
    question: `Is the evidence for ${targetGenePhrase} under ${formatConditionPhrase(conditions)} robust across guides/donors and free of major quality flags?`,
    evidence_fields_to_retrieve: [
      "n_guides",
      "donor_score",
      "guide_score",
      "low_target_gex",
      "neighboring_gene_KD",
      "distal_offtarget_flag",
      "n_cells_target",
      "keep_for_DE",
      "provenance/caveat fields if available",
    ],
    retrieval_notes: ["May consult provenance_index for caveats and filtering thresholds."],
  };
}

function buildLanguageCausalityQuery(params: {
  extractedClaim: ExtractedClaim;
  normalizedClaim: NormalizedClaimEntities;
  agentQueryId: string;
}): AgentQuery {
  const { extractedClaim, normalizedClaim, agentQueryId } = params;
  const triggerWords = Array.from(
    new Set([...extractedClaim.language_flags.strength_words, ...extractedClaim.language_flags.causal_words]),
  );

  return {
    agent_type: "language_causality",
    agent_query_id: agentQueryId,
    index_type: "language_rules_index",
    filters: {
      claim_type: extractedClaim.claim_type,
      strength_words: extractedClaim.language_flags.strength_words,
      causal_words: extractedClaim.language_flags.causal_words,
      normalized_direction: normalizedClaim.direction[0]?.normalized_direction ?? null,
    },
    question:
      "Is the wording in this claim scientifically justified by transcriptomic/pathway evidence, or should it be softened?",
    evidence_fields_to_retrieve: [
      "trigger_word",
      "required_evidence",
      "risky_reason",
      "safer_rewrite_patterns",
      "severity",
      "example_warning",
    ],
    retrieval_notes:
      triggerWords.length > 0
        ? [`Prioritize language rule chunks for: ${triggerWords.join(", ")}.`]
        : [
            "No strength/causal trigger words detected in this claim; language rule retrieval may be skipped or used only for baseline phrasing checks.",
          ],
  };
}

/**
 * Builds the claim-level "work order" for the four verification agents:
 * which artifact index each should query, what filters to use, and what
 * question it's trying to answer. No retrieval happens here — this only
 * plans it.
 *
 * interpretationGeneSymbols is every gene resolved anywhere else in this
 * interpretation (see collectInterpretationGeneSymbols below) — the only
 * source a gene-less summary_claim is allowed to widen its gene constraint
 * from, so evidence retrieval can never pull in a gene the interpretation
 * itself never discusses.
 */
export function buildAgentQueryPlanForClaim(
  normalizedClaim: NormalizedClaimEntities,
  categorizedClaim: CategorizedBiologicalEntities,
  extractedClaim: ExtractedClaim,
  interpretationGeneSymbols: string[] = [],
): AgentQueryPlan {
  const planWarnings: string[] = [];

  const conditions = resolveClaimConditions(normalizedClaim, planWarnings);
  const primaryGene = pickPrimaryGene(normalizedClaim.genes, planWarnings);
  const perturbationType = resolvePerturbationType(categorizedClaim.perturbation_types, planWarnings);
  const { allowedGeneSymbols, geneConstrained } = resolveGeneConstraint(normalizedClaim, interpretationGeneSymbols);
  if (geneConstrained && allowedGeneSymbols.length > 1) {
    planWarnings.push(`Retrieval for this claim is constrained to genes: ${allowedGeneSymbols.join(", ")}.`);
  }

  // Formatted as "[claim number]__[agent categorization]", per docs/geneground-backend-logic.md Step 5.
  const agentQueryId = (agentType: string) => `${extractedClaim.claim_id}__${agentType}`;

  const agent_queries = {
    perturbation_evidence: buildPerturbationEvidenceQuery({
      primaryGene,
      conditions,
      normalizedClaim,
      perturbationType,
      agentQueryId: agentQueryId("perturbation_evidence"),
      allowedGeneSymbols,
      geneConstrained,
    }),
    pathway_signature: buildPathwaySignatureQuery({
      primaryGene,
      conditions,
      normalizedClaim,
      planWarnings,
      agentQueryId: agentQueryId("pathway_signature"),
      allowedGeneSymbols,
      geneConstrained,
    }),
    robustness_quality: buildRobustnessQualityQuery({
      primaryGene,
      conditions,
      agentQueryId: agentQueryId("robustness_quality"),
      allowedGeneSymbols,
      geneConstrained,
    }),
    language_causality: buildLanguageCausalityQuery({ extractedClaim, normalizedClaim, agentQueryId: agentQueryId("language_causality") }),
  };

  return {
    claim_id: extractedClaim.claim_id,
    interpretation_id: extractedClaim.interpretation_id,
    sentence_id: extractedClaim.sentence_id,
    original_claim_text: extractedClaim.original_text,
    claim_type: extractedClaim.claim_type,
    agent_queries,
    plan_warnings: planWarnings.length > 0 ? planWarnings : undefined,
  };
}

/** Every gene resolved anywhere across the interpretation's claims, deduped. */
function collectInterpretationGeneSymbols(normalizedClaims: NormalizedClaimEntities[]): string[] {
  const symbols = new Set<string>();
  for (const claim of normalizedClaims) {
    for (const gene of claim.genes) {
      if (gene.match_type !== "unresolved" && gene.normalized_symbol) symbols.add(gene.normalized_symbol);
    }
  }
  return Array.from(symbols);
}

export function buildAgentQueryPlansForInterpretation(
  normalizedClaims: NormalizedClaimEntities[],
  categorizedClaims: CategorizedBiologicalEntities[],
  extractedClaims: ExtractedClaim[],
): AgentQueryPlanResult {
  const categorizedById = new Map(categorizedClaims.map((c) => [c.claim_id, c]));
  const extractedById = new Map(extractedClaims.map((c) => [c.claim_id, c]));
  const interpretationId = extractedClaims[0]?.interpretation_id ?? normalizedClaims[0]?.interpretation_id ?? "";
  const interpretationGeneSymbols = collectInterpretationGeneSymbols(normalizedClaims);

  const plans = normalizedClaims
    .map((normalized) => {
      const categorized = categorizedById.get(normalized.claim_id);
      const extracted = extractedById.get(normalized.claim_id);
      if (!categorized || !extracted) return null;
      return buildAgentQueryPlanForClaim(normalized, categorized, extracted, interpretationGeneSymbols);
    })
    .filter((plan): plan is AgentQueryPlan => plan !== null);

  return { interpretation_id: interpretationId, plans };
}
