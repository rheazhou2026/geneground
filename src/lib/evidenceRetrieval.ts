import { rankByTfIdfCosineSimilarity } from "./localVectorSearch";
import { expandGeneIdentifiers } from "./entityNormalization";
import type {
  AgentQuery,
  AgentQueryPlan,
  AgentQueryPlanResult,
  AgentRetrievedEvidence,
  ArtifactIndexes,
  ArtifactIndexType,
  ClaimRetrievedEvidence,
  EvidenceChunk,
  EvidenceRetrievalResult,
  RetrievalMode,
  RetrievedChunk,
} from "./schemas";

const TOP_N_CHUNKS_PER_AGENT = 3;

// Gene match is mandatory-before-condition only for the three indexes that
// actually carry per-gene evidence (docs/geneground-backend-logic.md Step 6).
// language_rules_index chunks are policy text, not gene-specific evidence —
// always considered regardless of the claim's gene(s). provenance_index
// chunks carry no gene metadata at all (see buildProvenanceIndex /
// buildProvenanceChunkFromPacket in artifactIndexes.ts) and exist for
// methodology caveats, not gene-specific findings — also left unfiltered,
// but retrieveEvidenceForAgentQuery still only reaches it for leftover
// slots after robustness_quality_index, so it never crowds out real
// gene-matched robustness chunks.
const GENE_HARD_FILTERED_INDEXES = new Set<ArtifactIndexType>(["perturbation_evidence_index", "pathway_signature_index", "robustness_quality_index"]);
// Above this many candidate filter dimensions matched, a chunk counts as an
// exact metadata match rather than partial (see classifyMetadataRetrievalMode).
const MATCH_REASON_PATTERNS: RegExp[] = [
  /^Matched target_gene_symbol/,
  /^Matched condition/,
  /^Matched pathway/,
  /^Matched direction/,
  /^Matched claim_type/,
  /^Matched language trigger word/,
];

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function isGeneConstrained(filters: Record<string, unknown>): boolean {
  return filters.gene_constrained === true;
}

/** Every symbol/alias/Ensembl ID a chunk's gene metadata could legitimately carry for the claim's allowed gene set, lowercased. */
function buildAllowedGeneIdentifierSet(allowedGeneSymbols: string[]): Set<string> {
  const identifiers = new Set<string>();
  for (const symbol of allowedGeneSymbols) {
    const { symbols, ensemblIds } = expandGeneIdentifiers(symbol);
    symbols.forEach((s) => identifiers.add(s.toLowerCase()));
    ensemblIds.forEach((e) => identifiers.add(e.toLowerCase()));
  }
  return identifiers;
}

function chunkMatchesGeneIdentifiers(chunk: EvidenceChunk, allowedIdentifiers: Set<string>): boolean {
  const chunkSymbol = asString(chunk.metadata.target_gene_symbol);
  const chunkEnsembl = asString(chunk.metadata.target_gene_ensembl);
  if (chunkSymbol && allowedIdentifiers.has(chunkSymbol.toLowerCase())) return true;
  if (chunkEnsembl && allowedIdentifiers.has(chunkEnsembl.toLowerCase())) return true;
  return false;
}

/**
 * Hard pre-filter (not scoring) — required so gene mismatch can never be
 * outweighed by a strong condition/pathway/direction score elsewhere (that
 * was the root cause of a claim about NFKB2/Stim8hr retrieving an unrelated
 * CD28/Stim8hr chunk: condition-match alone cleared the old score-only
 * baseline). Only applies within GENE_HARD_FILTERED_INDEXES; an empty result
 * for a gene-constrained index means "match nothing" — the caller must not
 * fall back to the unfiltered index.
 */
function filterChunksByGeneConstraint(chunks: EvidenceChunk[], filters: Record<string, unknown>, indexType: ArtifactIndexType): EvidenceChunk[] {
  if (!GENE_HARD_FILTERED_INDEXES.has(indexType) || !isGeneConstrained(filters)) return chunks;

  const allowedIdentifiers = buildAllowedGeneIdentifierSet(asStringArray(filters.allowed_gene_symbols));
  if (allowedIdentifiers.size === 0) return [];

  return chunks.filter((chunk) => chunkMatchesGeneIdentifiers(chunk, allowedIdentifiers));
}

/**
 * Deterministic metadata + keyword scorer. Presence-based: whichever filter
 * keys exist on the query determine which checks run, so one implementation
 * works across all four agent types without per-agent branching.
 */
export function scoreChunkAgainstFilters(
  chunk: EvidenceChunk,
  filters: Record<string, unknown>,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Baseline: this chunk already comes from the index the query targets.
  score += 10;
  reasons.push(`Source artifact appropriate for ${chunk.index_type}.`);

  const targetGeneFilter = asString(filters.target_gene_symbol);
  const allowedGeneSymbols = asStringArray(filters.allowed_gene_symbols);
  const chunkGene = asString(chunk.metadata.target_gene_symbol);
  const geneMatches =
    chunkGene !== null &&
    ((targetGeneFilter !== null && targetGeneFilter.toUpperCase() === chunkGene.toUpperCase()) ||
      allowedGeneSymbols.some((g) => g.toUpperCase() === chunkGene.toUpperCase()));
  if (geneMatches) {
    score += 50;
    reasons.push(`Matched target_gene_symbol = ${chunkGene}`);
  }

  const conditionFilters = asStringArray(filters.conditions);
  const chunkCondition = asString(chunk.metadata.culture_condition);
  if (conditionFilters.length > 0 && chunkCondition) {
    const matched = conditionFilters.some((c) => c.toLowerCase() === chunkCondition.toLowerCase());
    if (matched) {
      score += 30;
      reasons.push(`Matched condition = ${chunkCondition}`);
      if (conditionFilters.length > 1) {
        score -= 10;
        reasons.push(
          `Included because condition was ambiguous (candidates: ${conditionFilters.join(", ")}) and this chunk matches one of the candidate conditions (${chunkCondition}).`,
        );
      }
    }
  }

  const pathwayKeywords = asStringArray(filters.pathway_keywords);
  const chunkPathwayName = asString(chunk.metadata.pathway_name) ?? asString(chunk.structured_payload.pathway_name);
  if (pathwayKeywords.length > 0 && chunkPathwayName) {
    const matchedKeyword = pathwayKeywords.find((kw) => {
      const a = kw.toLowerCase();
      const b = chunkPathwayName.toLowerCase();
      return a === b || a.includes(b) || b.includes(a);
    });
    if (matchedKeyword) {
      score += 20;
      reasons.push(`Matched pathway keyword = ${matchedKeyword}`);
    }
  }

  const pathwayCandidateIds = asStringArray(filters.pathway_candidate_ids);
  const chunkPathwayId = asString(chunk.structured_payload.pathway_id);
  const chunkSignatureId = asString(chunk.structured_payload.signature_id);
  if (pathwayCandidateIds.length > 0) {
    const matchedId = pathwayCandidateIds.find((id) => id === chunkPathwayId || id === chunkSignatureId);
    if (matchedId) {
      score += 20;
      reasons.push(`Matched pathway candidate ID = ${matchedId}`);
    }
  }

  const directionFilter = asString(filters.normalized_direction);
  const chunkDirection = asString(chunk.metadata.direction) ?? asString(chunk.structured_payload.direction);
  if (directionFilter && chunkDirection && directionFilter.toLowerCase() === chunkDirection.toLowerCase()) {
    score += 15;
    reasons.push(`Matched direction = ${chunkDirection}`);
  }

  const claimTypeFilter = asString(filters.claim_type);
  const chunkClaimTypes = asStringArray(chunk.metadata.claim_types);
  if (claimTypeFilter && chunkClaimTypes.includes(claimTypeFilter)) {
    score += 10;
    reasons.push(`Matched claim_type = ${claimTypeFilter}`);
  }

  const triggerWordCandidates = [...asStringArray(filters.strength_words), ...asStringArray(filters.causal_words)];
  const chunkTriggerWord = asString(chunk.metadata.trigger_word);
  if (chunkTriggerWord && triggerWordCandidates.length > 0) {
    const matched = triggerWordCandidates.find((w) => w.toLowerCase() === chunkTriggerWord.toLowerCase());
    if (matched) {
      score += 10;
      reasons.push(`Matched language trigger word = ${matched}`);
    }
  }

  // Quality/confidence flags stay visible rather than filtered out — just
  // discounted, per the robustness-agent rule ("include even if flags exist").
  if (chunk.warnings && chunk.warnings.length > 0) {
    score -= 20;
    reasons.push(`Quality flag present: ${chunk.warnings[0]}`);
  }

  return { score, reasons };
}

/** How many of the query's filter dimensions were actually present (non-empty). */
function countPresentFilterDimensions(filters: Record<string, unknown>): number {
  let count = 0;
  if (asString(filters.target_gene_symbol) || asStringArray(filters.allowed_gene_symbols).length > 0) count += 1;
  if (asStringArray(filters.conditions).length > 0) count += 1;
  if (asStringArray(filters.pathway_keywords).length > 0 || asStringArray(filters.pathway_candidate_ids).length > 0) count += 1;
  if (asString(filters.normalized_direction)) count += 1;
  if (asString(filters.claim_type)) count += 1;
  if (asStringArray(filters.strength_words).length > 0 || asStringArray(filters.causal_words).length > 0) count += 1;
  return count;
}

/** How many distinct filter dimensions this chunk's retrieval_reasons actually matched. */
function countMatchedFilterDimensions(reasons: string[]): number {
  return MATCH_REASON_PATTERNS.filter((pattern) => reasons.some((reason) => pattern.test(reason))).length;
}

/** metadata_exact when every present filter dimension matched; metadata_partial otherwise. */
function classifyMetadataRetrievalMode(filters: Record<string, unknown>, reasons: string[]): RetrievalMode {
  const present = countPresentFilterDimensions(filters);
  const matched = countMatchedFilterDimensions(reasons);
  return present > 0 && matched >= present ? "metadata_exact" : "metadata_partial";
}

/**
 * Compact query text for local vector fallback — the guiding question plus
 * the query's own filter values (gene, conditions, pathway keywords,
 * direction, claim_type, strength/causal words). The last three only ever
 * appear on language_causality's filters; including them here is what lets
 * that agent's TF-IDF fallback actually find relevant language_rules_index
 * chunks when no chunk exact-matches a trigger word (e.g. curated policy
 * chunks that aren't tied to one specific trigger word). No manual alias
 * lookups here (kept intentionally simple).
 */
function buildVectorFallbackQueryText(agentQuery: AgentQuery): string {
  const filters = agentQuery.filters;
  const parts = [
    agentQuery.question,
    asString(filters.target_gene_symbol) ?? "",
    asStringArray(filters.allowed_gene_symbols).join(" "),
    asStringArray(filters.conditions).join(" "),
    asStringArray(filters.pathway_keywords).join(" "),
    asString(filters.normalized_direction) ?? "",
    asString(filters.claim_type) ?? "",
    asStringArray(filters.strength_words).join(" "),
    asStringArray(filters.causal_words).join(" "),
  ];
  return parts.filter((p) => p.length > 0).join(" ");
}

/**
 * Retrieves up to `limit` chunks from one already-gene-filtered candidate
 * pool for one index. Metadata-first: chunks are scored deterministically
 * against the query's filters (scoreChunkAgainstFilters). Only when no
 * chunk clears the metadata baseline does a local TF-IDF vector fallback
 * run — and only over this same (already gene-filtered) pool, never the
 * full unfiltered index, so a gene-constrained claim's fallback can't drift
 * onto an unrelated gene just because its prose happens to read similarly
 * (no external embeddings/vector DB either way).
 */
function retrieveFromChunkPool(
  poolChunks: EvidenceChunk[],
  agentQuery: AgentQuery,
  indexType: ArtifactIndexType,
  limit: number,
): { retrieved: RetrievedChunk[]; warnings: string[] } {
  if (limit <= 0 || poolChunks.length === 0) return { retrieved: [], warnings: [] };

  const scored = poolChunks.map((chunk) => ({ chunk, ...scoreChunkAgainstFilters(chunk, agentQuery.filters) })).sort((a, b) => b.score - a.score);
  const aboveBaseline = scored.filter((s) => s.score > 10);

  if (aboveBaseline.length > 0) {
    return {
      retrieved: aboveBaseline.slice(0, limit).map(({ chunk, score, reasons }) => ({
        chunk_id: chunk.chunk_id,
        index_type: chunk.index_type,
        chunk_type: chunk.chunk_type,
        source_file_name: chunk.source_file_name,
        retrieval_score: score,
        retrieval_mode: classifyMetadataRetrievalMode(agentQuery.filters, reasons),
        retrieval_reasons: reasons,
        metadata: chunk.metadata,
        structured_payload: chunk.structured_payload,
        text_for_embedding: chunk.text_for_embedding,
        warnings: chunk.warnings,
      })),
      warnings: [],
    };
  }

  // No chunk cleared the metadata baseline within this pool — local TF-IDF
  // vector similarity over Text_for_embedding, scoped to the same pool.
  const geneScoped = GENE_HARD_FILTERED_INDEXES.has(indexType) && isGeneConstrained(agentQuery.filters);
  const warnings = [
    `No chunks in ${indexType} matched the query filters beyond the baseline index match; using local TF-IDF vector fallback${
      geneScoped ? " within the gene-matched candidate pool" : ""
    }.`,
  ];

  const queryText = buildVectorFallbackQueryText(agentQuery);
  const similarities = rankByTfIdfCosineSimilarity(
    queryText,
    scored.map((s) => s.chunk.text_for_embedding),
  );

  const retrieved = scored
    .map((s, i) => ({ ...s, similarity: similarities[i] }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
    .map(({ chunk, score, reasons, similarity }) => {
      const hadSomeMetadataSignal = reasons.length > 1; // more than just the baseline reason
      const mode: RetrievalMode = hadSomeMetadataSignal ? "hybrid_metadata_and_local_vector" : "local_vector_fallback";
      const vectorReason =
        similarity > 0
          ? "Retrieved by local TF-IDF vector fallback using text_for_embedding"
          : "No exact metadata match; included as nearest available evidence";
      return {
        chunk_id: chunk.chunk_id,
        index_type: chunk.index_type,
        chunk_type: chunk.chunk_type,
        source_file_name: chunk.source_file_name,
        retrieval_score: score,
        retrieval_mode: mode,
        retrieval_reasons: [...reasons, vectorReason],
        metadata: chunk.metadata,
        structured_payload: chunk.structured_payload,
        text_for_embedding: chunk.text_for_embedding,
        warnings: chunk.warnings,
      };
    });

  return { retrieved, warnings };
}

/**
 * Runs one agent's query against its target index/indexes and returns the
 * top-scoring chunks, in strict order: A. index_type (which index/indexes
 * this agent queries at all) → B. gene hard filter, when the claim has
 * gene(s) and this is a gene-carrying index → C-E. condition/pathway/
 * direction scoring within that gene-narrowed pool (scoreChunkAgainstFilters)
 * → F. TF-IDF fallback, itself scoped to the same gene-narrowed pool. Each
 * index_type is processed in the order agentQuery.index_type lists them and
 * only consulted for whatever chunk slots the previous index didn't already
 * fill — this is what makes robustness_quality_index take priority over
 * provenance_index rather than the two being pooled and re-ranked together.
 */
export function retrieveEvidenceForAgentQuery(agentQuery: AgentQuery, artifactIndexes: ArtifactIndexes): AgentRetrievedEvidence {
  const indexTypes = Array.isArray(agentQuery.index_type) ? agentQuery.index_type : [agentQuery.index_type];
  const retrieval_warnings: string[] = [];
  const retrieved_chunks: RetrievedChunk[] = [];

  for (const indexType of indexTypes) {
    const remainingSlots = TOP_N_CHUNKS_PER_AGENT - retrieved_chunks.length;
    if (remainingSlots <= 0) break;

    const indexChunks = artifactIndexes.indexes[indexType]?.chunks ?? [];
    if (indexChunks.length === 0) {
      retrieval_warnings.push(`No chunks available in ${indexType}.`);
      continue;
    }

    const geneFilteredChunks = filterChunksByGeneConstraint(indexChunks, agentQuery.filters, indexType);
    if (geneFilteredChunks.length === 0 && GENE_HARD_FILTERED_INDEXES.has(indexType) && isGeneConstrained(agentQuery.filters)) {
      const allowedGeneSymbols = asStringArray(agentQuery.filters.allowed_gene_symbols);
      retrieval_warnings.push(
        allowedGeneSymbols.length > 0
          ? `No chunks in ${indexType} matched the required gene(s) (${allowedGeneSymbols.join(", ")}); index skipped for this claim rather than retrieving an unrelated gene's evidence.`
          : `This claim's gene mention could not be resolved to a known gene; ${indexType} skipped rather than retrieving ungated evidence.`,
      );
      continue; // do not fall through to scoring/TF-IDF over the unfiltered index
    }

    const { retrieved, warnings } = retrieveFromChunkPool(geneFilteredChunks, agentQuery, indexType, remainingSlots);
    retrieved_chunks.push(...retrieved);
    retrieval_warnings.push(...warnings);
  }

  return {
    agent_type: agentQuery.agent_type,
    agent_query_id: agentQuery.agent_query_id,
    index_type: agentQuery.index_type,
    question: agentQuery.question,
    filters: agentQuery.filters,
    retrieved_chunks,
    retrieval_warnings,
  };
}

export function retrieveEvidenceForClaim(agentQueryPlan: AgentQueryPlan, artifactIndexes: ArtifactIndexes): ClaimRetrievedEvidence {
  const perturbation_evidence = retrieveEvidenceForAgentQuery(agentQueryPlan.agent_queries.perturbation_evidence, artifactIndexes);
  const pathway_signature = retrieveEvidenceForAgentQuery(agentQueryPlan.agent_queries.pathway_signature, artifactIndexes);
  const robustness_quality = retrieveEvidenceForAgentQuery(agentQueryPlan.agent_queries.robustness_quality, artifactIndexes);
  const language_causality = retrieveEvidenceForAgentQuery(agentQueryPlan.agent_queries.language_causality, artifactIndexes);

  return {
    claim_id: agentQueryPlan.claim_id,
    interpretation_id: agentQueryPlan.interpretation_id,
    sentence_id: agentQueryPlan.sentence_id,
    original_claim_text: agentQueryPlan.original_claim_text,
    agent_evidence: { perturbation_evidence, pathway_signature, robustness_quality, language_causality },
    claim_retrieval_warnings: [
      ...perturbation_evidence.retrieval_warnings,
      ...pathway_signature.retrieval_warnings,
      ...robustness_quality.retrieval_warnings,
      ...language_causality.retrieval_warnings,
    ],
  };
}

export function retrieveEvidenceForInterpretation(
  agentQueryPlanResult: AgentQueryPlanResult,
  artifactIndexes: ArtifactIndexes,
): EvidenceRetrievalResult {
  return {
    interpretation_id: agentQueryPlanResult.interpretation_id,
    retrieved_evidence_by_claim: agentQueryPlanResult.plans.map((plan) => retrieveEvidenceForClaim(plan, artifactIndexes)),
  };
}

/**
 * Lightweight provenance preview — deliberately not a full retrieval.
 * Just reports whether audit context exists for the source files this
 * claim's evidence already came from, so the UI can show a small note
 * instead of flooding every claim with provenance chunks.
 */
export function retrieveProvenanceContextForClaim(
  claimEvidence: ClaimRetrievedEvidence,
  artifactIndexes: ArtifactIndexes,
): { available: boolean; chunkCount: number; sourceFiles: string[] } {
  const referencedFiles = new Set<string>();
  for (const agentEvidence of Object.values(claimEvidence.agent_evidence)) {
    for (const chunk of agentEvidence.retrieved_chunks) {
      referencedFiles.add(chunk.source_file_name);
    }
  }

  const relevantProvenanceChunks = artifactIndexes.indexes.provenance_index.chunks.filter((c) =>
    referencedFiles.has(c.source_file_name),
  );

  return {
    available: relevantProvenanceChunks.length > 0,
    chunkCount: relevantProvenanceChunks.length,
    sourceFiles: Array.from(referencedFiles),
  };
}
