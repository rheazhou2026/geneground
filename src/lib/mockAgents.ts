import type {
  AgentResult,
  AgentType,
  AgentVerdictLabel,
  AgentVerdictResult,
  ClaimAgentResults,
  ClaimRetrievedEvidence,
  EvidenceRetrievalResult,
  RetrievedChunk,
} from "./schemas";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round2(n: number): number {
  return Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;
}

function buildInsufficientEvidenceResult(agentType: AgentType, agentQueryId: string, claimId: string, reason: string): AgentResult {
  return {
    agent_type: agentType,
    agent_query_id: agentQueryId,
    claim_id: claimId,
    agent_verdict: "insufficient_evidence",
    confidence: 0.15,
    evidence_chunk_ids: [],
    supporting_points: [],
    weak_points: [],
    missing_evidence: [reason],
    risk_flags: [],
    agent_reasoning_summary: reason,
  };
}

/** Every agent independently sees the language_causality agent's claim_type filter — the one place claim_type is carried through Step 6/7. */
function getClaimType(claimEvidence: ClaimRetrievedEvidence): string | null {
  return asString(claimEvidence.agent_evidence.language_causality.filters.claim_type);
}

// ---------------------------------------------------------------------------
// 1. Perturbation evidence agent
// ---------------------------------------------------------------------------

export function runPerturbationEvidenceMockAgent(claimEvidence: ClaimRetrievedEvidence): AgentResult {
  const agentEvidence = claimEvidence.agent_evidence.perturbation_evidence;
  const chunks = agentEvidence.retrieved_chunks;
  const claimedGene = asString(agentEvidence.filters.target_gene_symbol);
  const claimedDirection = asString(agentEvidence.filters.normalized_direction);

  if (chunks.length === 0) {
    return buildInsufficientEvidenceResult(
      "perturbation_evidence",
      agentEvidence.agent_query_id,
      claimEvidence.claim_id,
      "No perturbation evidence chunks were retrieved for this claim's gene/condition.",
    );
  }

  const primaryChunk = chunks[0];
  const payload = primaryChunk.structured_payload;
  const primaryGene = asString(primaryChunk.metadata.target_gene_symbol);
  const geneMatches = claimedGene !== null && primaryGene !== null && claimedGene.toUpperCase() === primaryGene.toUpperCase();
  const ontargetSignificant = payload.ontarget_significant === true;
  const chunkDirection = asString(primaryChunk.metadata.direction);
  const nTotalDe = asNumber(payload.n_total_de_genes);
  const topUp = asStringArray(payload.top_upregulated_genes);
  const topDown = asStringArray(payload.top_downregulated_genes);

  const supporting_points: string[] = [];
  const weak_points: string[] = [];
  const missing_evidence: string[] = [];
  const risk_flags: string[] = [];

  let verdict: AgentVerdictLabel;
  let confidence: number;

  if (!geneMatches) {
    verdict = "insufficient_evidence";
    confidence = 0.25;
    missing_evidence.push(`No perturbation evidence chunk exactly matches the claimed gene (${claimedGene ?? "unspecified"}).`);
  } else if (ontargetSignificant) {
    verdict = "supports";
    confidence = 0.85;
    supporting_points.push(
      `${primaryGene} perturbation in ${asString(primaryChunk.metadata.culture_condition) ?? "the tested condition"} produced a significant on-target effect (${payload.ontarget_effect_size}).`,
    );
  } else {
    verdict = "weak_support";
    confidence = 0.45;
    weak_points.push(`${primaryGene} perturbation evidence was retrieved, but the on-target effect was not flagged significant.`);
  }

  if (geneMatches) {
    if (nTotalDe !== null && (topUp.length > 0 || topDown.length > 0)) {
      const changedGenes = topDown.length > 0 ? topDown : topUp;
      supporting_points.push(`${nTotalDe} differentially expressed genes detected, including ${changedGenes.join(", ")}.`);
    } else if (nTotalDe !== null) {
      missing_evidence.push("Top changed genes were not listed in the retrieved chunk.");
    }

    if (claimedDirection && chunkDirection) {
      if (claimedDirection.toLowerCase() === chunkDirection.toLowerCase()) {
        supporting_points.push(`Claimed direction (${claimedDirection}) matches the retrieved on-target direction (${chunkDirection}).`);
      } else {
        weak_points.push(`Claimed direction (${claimedDirection}) does not match the retrieved on-target direction (${chunkDirection}).`);
        verdict = verdict === "supports" ? "contradicts" : "weak_support";
        confidence = Math.min(confidence, 0.3);
      }
    } else if (claimedDirection && !chunkDirection) {
      missing_evidence.push("Claimed direction could not be checked against retrieved evidence (chunk has no direction field).");
    }
  }

  if (primaryChunk.warnings && primaryChunk.warnings.length > 0) {
    risk_flags.push(...primaryChunk.warnings);
    confidence = Math.max(confidence - 0.15, 0.1);
    if (verdict === "supports") verdict = "supports_with_caveats";
  }

  for (const w of agentEvidence.retrieval_warnings) {
    if (!missing_evidence.includes(w)) missing_evidence.push(w);
  }

  return {
    agent_type: "perturbation_evidence",
    agent_query_id: agentEvidence.agent_query_id,
    claim_id: claimEvidence.claim_id,
    agent_verdict: verdict,
    confidence: round2(confidence),
    evidence_chunk_ids: chunks.map((c: RetrievedChunk) => c.chunk_id),
    supporting_points,
    weak_points,
    missing_evidence,
    risk_flags,
    agent_reasoning_summary: `${primaryGene ?? "The claimed gene"} perturbation evidence: ${verdict.replace(/_/g, " ")}. ${
      ontargetSignificant ? "On-target effect was statistically significant." : "On-target effect was not confirmed significant."
    }`,
  };
}

// ---------------------------------------------------------------------------
// 2. Pathway / signature agent
// ---------------------------------------------------------------------------

export function runPathwaySignatureMockAgent(claimEvidence: ClaimRetrievedEvidence): AgentResult {
  const agentEvidence = claimEvidence.agent_evidence.pathway_signature;
  const chunks = agentEvidence.retrieved_chunks;
  const claimedGene = asString(agentEvidence.filters.target_gene_symbol);
  const claimedDirection = asString(agentEvidence.filters.normalized_direction);
  const pathwayCandidateIds = asStringArray(agentEvidence.filters.pathway_candidate_ids);
  const conditionFilters = asStringArray(agentEvidence.filters.conditions);
  const claimType = getClaimType(claimEvidence);

  if (chunks.length === 0) {
    return buildInsufficientEvidenceResult(
      "pathway_signature",
      agentEvidence.agent_query_id,
      claimEvidence.claim_id,
      "No pathway/signature evidence chunks were retrieved for this claim.",
    );
  }

  const primaryChunk = chunks[0];
  const primaryGene = asString(primaryChunk.metadata.target_gene_symbol);
  const geneMatches = claimedGene !== null && primaryGene !== null && claimedGene.toUpperCase() === primaryGene.toUpperCase();
  const chunkCondition = asString(primaryChunk.metadata.culture_condition);
  const conditionMatches =
    conditionFilters.length === 0 || (chunkCondition !== null && conditionFilters.some((c) => c.toLowerCase() === chunkCondition.toLowerCase()));
  const chunkDirection = asString(primaryChunk.metadata.direction);
  const directionStated = claimedDirection !== null;
  const directionMatches = directionStated && chunkDirection !== null && claimedDirection.toLowerCase() === chunkDirection.toLowerCase();
  const directionContradicts = directionStated && chunkDirection !== null && !directionMatches;
  const pathwayName = asString(primaryChunk.metadata.pathway_name) ?? "This pathway/signature";
  const multipleCandidates = pathwayCandidateIds.length > 1;

  const supporting_points: string[] = [];
  const weak_points: string[] = [];
  const missing_evidence: string[] = [];
  const risk_flags: string[] = [];

  let verdict: AgentVerdictLabel;
  let confidence: number;

  if (!geneMatches) {
    verdict = "insufficient_evidence";
    confidence = 0.25;
    missing_evidence.push(`No pathway/signature chunk exactly matches the claimed gene (${claimedGene ?? "unspecified"}).`);
  } else if (!conditionMatches) {
    verdict = "weak_support";
    confidence = 0.4;
    weak_points.push(`${pathwayName} evidence exists for ${primaryGene}, but not confirmed in the claimed condition (${conditionFilters.join(", ") || "unspecified"}).`);
  } else if (directionContradicts) {
    verdict = "contradicts";
    confidence = 0.3;
    weak_points.push(`${pathwayName} shows ${chunkDirection} enrichment, which does not match the claimed direction (${claimedDirection}).`);
  } else if (multipleCandidates || !directionStated) {
    verdict = "supports_with_caveats";
    confidence = 0.55;
    supporting_points.push(`${pathwayName} enrichment found for ${primaryGene} in ${chunkCondition}.`);
    weak_points.push(
      multipleCandidates
        ? "Pathway phrase maps to multiple candidate pathways/signatures, so the exact match is uncertain."
        : "No specific direction was claimed to confirm against the retrieved enrichment direction.",
    );
  } else {
    verdict = "supports";
    confidence = 0.8;
    supporting_points.push(`${pathwayName} shows ${chunkDirection} enrichment in ${chunkCondition}, matching the claimed direction.`);
  }

  if (claimType === "causal_mechanism") {
    weak_points.push("Pathway enrichment supports a signature-level interpretation but does not prove mechanism.");
    if (verdict === "supports") verdict = "supports_with_caveats";
    confidence = Math.min(confidence, 0.6);
  }

  if (primaryChunk.warnings && primaryChunk.warnings.length > 0) {
    risk_flags.push(...primaryChunk.warnings);
    confidence = Math.max(confidence - 0.1, 0.1);
  }

  for (const w of agentEvidence.retrieval_warnings) {
    if (!missing_evidence.includes(w)) missing_evidence.push(w);
  }

  return {
    agent_type: "pathway_signature",
    agent_query_id: agentEvidence.agent_query_id,
    claim_id: claimEvidence.claim_id,
    agent_verdict: verdict,
    confidence: round2(confidence),
    evidence_chunk_ids: chunks.map((c) => c.chunk_id),
    supporting_points,
    weak_points,
    missing_evidence,
    risk_flags,
    agent_reasoning_summary: `${pathwayName} for ${primaryGene ?? "the claimed gene"}: ${verdict.replace(/_/g, " ")}${
      multipleCandidates ? " (multiple candidate pathway/signature IDs)" : ""
    }.`,
  };
}

// ---------------------------------------------------------------------------
// 3. Robustness / quality agent — evaluates evidence reliability, not biology
// ---------------------------------------------------------------------------

export function runRobustnessQualityMockAgent(claimEvidence: ClaimRetrievedEvidence): AgentResult {
  const agentEvidence = claimEvidence.agent_evidence.robustness_quality;
  const chunks = agentEvidence.retrieved_chunks;

  if (chunks.length === 0) {
    return buildInsufficientEvidenceResult(
      "robustness_quality",
      agentEvidence.agent_query_id,
      claimEvidence.claim_id,
      "No robustness/quality evidence chunks were retrieved for this claim's gene/condition.",
    );
  }

  const primaryChunk = chunks[0];
  const payload = primaryChunk.structured_payload;
  const nGuides = asNumber(payload.n_guides);
  const donorScore = asNumber(payload.donor_robustness_score);
  const guideScore = asNumber(payload.guide_robustness_score);
  const lowTargetGex = payload.low_target_expression_flag === true;
  const offtargetFlags = asStringArray(payload.offtarget_flags);
  const lowConfidence = payload.low_confidence_flag === true;
  const gene = asString(primaryChunk.metadata.target_gene_symbol) ?? "the target gene";
  const condition = asString(primaryChunk.metadata.culture_condition) ?? "the claimed condition";

  const risk_flags: string[] = [];
  const supporting_points: string[] = [];
  const weak_points: string[] = [];
  const missing_evidence: string[] = [
    "Robustness agent may also consult provenance_index for filtering thresholds and caveats (not retrieved in this preview).",
  ];

  if (nGuides !== null && nGuides <= 1) risk_flags.push("single_guide");
  if (lowTargetGex) risk_flags.push("low_target_gex");
  if (offtargetFlags.length > 0) {
    risk_flags.push("distal_offtarget_flag");
    if (offtargetFlags.some((f) => /knockdown of/i.test(f))) risk_flags.push("neighboring_gene_KD");
  }
  if (donorScore !== null && donorScore < 0.7) risk_flags.push("weak_donor_support");
  if (guideScore !== null && guideScore < 0.7) risk_flags.push("weak_guide_support");
  if (lowConfidence && risk_flags.length === 0) risk_flags.push("low_confidence_flag");

  const goodRobustness = nGuides !== null && nGuides >= 2 && donorScore !== null && donorScore >= 0.7 && guideScore !== null && guideScore >= 0.7;

  let verdict: AgentVerdictLabel;
  let confidence: number;

  if (goodRobustness && offtargetFlags.length === 0 && !lowTargetGex) {
    verdict = "supports";
    confidence = 0.85;
    supporting_points.push(`${nGuides} guides, donor robustness ${donorScore}, guide robustness ${guideScore}, no major quality flags.`);
  } else if (goodRobustness && (offtargetFlags.length > 0 || lowTargetGex)) {
    // Donor/guide robustness scores say "good" while an off-target/low-expression
    // flag says "bad" for the same chunk — QC/provenance signals conflict.
    verdict = "needs_review";
    confidence = 0.4;
    weak_points.push(
      `Donor/guide robustness metrics look strong (${nGuides} guides, donor ${donorScore}, guide ${guideScore}), but conflicting quality flag(s) are present (${risk_flags.join(", ")}) — QC signals disagree and require manual review.`,
    );
  } else if (risk_flags.filter((f) => f === "single_guide" || f === "low_target_gex" || f === "distal_offtarget_flag" || f === "neighboring_gene_KD").length >= 2) {
    verdict = "weak_support";
    confidence = 0.35;
    weak_points.push(`Multiple quality flags present (${risk_flags.join(", ")}) meaningfully reduce confidence in this evidence, independent of the underlying biology.`);
  } else if (risk_flags.length > 0) {
    verdict = "supports_with_caveats";
    confidence = 0.55;
    weak_points.push(`Quality flag(s) present (${risk_flags.join(", ")}) reduce confidence in this evidence, independent of the underlying biology.`);
  } else {
    verdict = "supports_with_caveats";
    confidence = 0.65;
    weak_points.push("Robustness metrics are moderate; not a clean pass.");
  }

  if (donorScore !== null) supporting_points.push(`Donor robustness score: ${donorScore}.`);
  if (guideScore !== null) supporting_points.push(`Guide robustness score: ${guideScore}.`);

  for (const w of agentEvidence.retrieval_warnings) {
    if (!missing_evidence.includes(w)) missing_evidence.push(w);
  }

  return {
    agent_type: "robustness_quality",
    agent_query_id: agentEvidence.agent_query_id,
    claim_id: claimEvidence.claim_id,
    agent_verdict: verdict,
    confidence: round2(confidence),
    evidence_chunk_ids: chunks.map((c) => c.chunk_id),
    supporting_points,
    weak_points,
    missing_evidence,
    risk_flags,
    agent_reasoning_summary: `Robustness check for ${gene} in ${condition}: ${verdict.replace(/_/g, " ")}, based on guide count, donor/guide robustness scores, and quality flags. This agent evaluates evidence reliability, not biological truth.`,
  };
}

// ---------------------------------------------------------------------------
// 4. Language / causality agent
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

export function runLanguageCausalityMockAgent(claimEvidence: ClaimRetrievedEvidence): AgentResult {
  const agentEvidence = claimEvidence.agent_evidence.language_causality;
  const chunks = agentEvidence.retrieved_chunks;
  const strengthWords = asStringArray(agentEvidence.filters.strength_words);
  const causalWords = asStringArray(agentEvidence.filters.causal_words);
  const triggerWords = [...strengthWords, ...causalWords];
  const claimedDirection = asString(agentEvidence.filters.normalized_direction);

  if (triggerWords.length === 0) {
    return {
      agent_type: "language_causality",
      agent_query_id: agentEvidence.agent_query_id,
      claim_id: claimEvidence.claim_id,
      agent_verdict: "not_applicable",
      confidence: 0.9,
      evidence_chunk_ids: [],
      supporting_points: ["Claim does not use notable strength or causal language; no wording risk to evaluate."],
      weak_points: [],
      missing_evidence: [],
      risk_flags: [],
      agent_reasoning_summary: "No strength or causal trigger words were detected in this claim, so the language/causality check is not applicable.",
    };
  }

  if (chunks.length === 0) {
    return buildInsufficientEvidenceResult(
      "language_causality",
      agentEvidence.agent_query_id,
      claimEvidence.claim_id,
      `Trigger word(s) (${triggerWords.join(", ")}) were detected, but no matching language rule chunks were retrieved.`,
    );
  }

  const matchedRuleChunks = chunks.filter((c) => {
    const tw = asString(c.metadata.trigger_word);
    return tw !== null && triggerWords.some((w) => w.toLowerCase() === tw.toLowerCase());
  });
  const relevantChunks = matchedRuleChunks.length > 0 ? matchedRuleChunks : chunks;
  const primaryChunk = [...relevantChunks].sort((a, b) => {
    const sa = SEVERITY_RANK[asString(a.metadata.severity) ?? ""] ?? 0;
    const sb = SEVERITY_RANK[asString(b.metadata.severity) ?? ""] ?? 0;
    return sb - sa;
  })[0];

  const triggerWord = asString(primaryChunk.metadata.trigger_word) ?? "flagged wording";
  const severity = asString(primaryChunk.metadata.severity) ?? "medium";
  const payload = primaryChunk.structured_payload;
  const riskyReason = asString(payload.risky_reason);
  const requiredEvidence = asString(payload.required_evidence);
  const saferPatterns = asStringArray(payload.safer_rewrite_patterns);
  const exampleWarning = asString(payload.example_warning);

  const supporting_points: string[] = [];
  const weak_points: string[] = [];
  const missing_evidence: string[] = [];
  const risk_flags: string[] = [];
  let suggested_language_change: string | undefined;
  let verdict: AgentVerdictLabel;
  let confidence: number;

  if (severity === "high") {
    verdict = "weak_support";
    confidence = 0.4;
    if (riskyReason) weak_points.push(riskyReason);
    if (requiredEvidence) missing_evidence.push(`Requires: ${requiredEvidence}`);
    risk_flags.push(`high_severity_language:${triggerWord}`);
    suggested_language_change = saferPatterns[0];
  } else if (severity === "medium") {
    if (claimedDirection) {
      verdict = "supports_with_caveats";
      confidence = 0.55;
    } else {
      verdict = "weak_support";
      confidence = 0.4;
    }
    if (riskyReason) weak_points.push(riskyReason);
    risk_flags.push(`medium_severity_language:${triggerWord}`);
    suggested_language_change = saferPatterns[0];
  } else {
    if (claimedDirection) {
      verdict = "supports";
      confidence = 0.75;
      supporting_points.push(`'${triggerWord}' is acceptable because the claim is directionally supported (${claimedDirection}).`);
    } else {
      verdict = "supports_with_caveats";
      confidence = 0.5;
      weak_points.push(`'${triggerWord}' is only acceptable if directionally supported; no confirmed direction was found for this claim.`);
      suggested_language_change = saferPatterns[0];
    }
  }

  if (exampleWarning) missing_evidence.push(exampleWarning);

  for (const w of agentEvidence.retrieval_warnings) {
    if (!missing_evidence.includes(w)) missing_evidence.push(w);
  }

  return {
    agent_type: "language_causality",
    agent_query_id: agentEvidence.agent_query_id,
    claim_id: claimEvidence.claim_id,
    agent_verdict: verdict,
    confidence: round2(confidence),
    evidence_chunk_ids: chunks.map((c) => c.chunk_id),
    supporting_points,
    weak_points,
    missing_evidence,
    risk_flags,
    suggested_language_change,
    agent_reasoning_summary: `Claim uses '${triggerWord}' (${severity} severity).${riskyReason ? ` ${riskyReason}` : ""}${
      requiredEvidence ? ` Required evidence: ${requiredEvidence}` : ""
    }`,
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Runs all four mock agents against one claim's retrieved evidence (Step 7
 * output). Each agent only sees its own retrieved chunks and filters — these
 * are intermediate, per-agent judgments, not the final claim-level verdict.
 */
export function runFourMockAgentsForClaim(claimRetrievedEvidence: ClaimRetrievedEvidence): ClaimAgentResults {
  return {
    claim_id: claimRetrievedEvidence.claim_id,
    interpretation_id: claimRetrievedEvidence.interpretation_id,
    sentence_id: claimRetrievedEvidence.sentence_id,
    original_claim_text: claimRetrievedEvidence.original_claim_text,
    claim_type: getClaimType(claimRetrievedEvidence) ?? "unknown",
    agent_results: {
      perturbation_evidence: runPerturbationEvidenceMockAgent(claimRetrievedEvidence),
      pathway_signature: runPathwaySignatureMockAgent(claimRetrievedEvidence),
      robustness_quality: runRobustnessQualityMockAgent(claimRetrievedEvidence),
      language_causality: runLanguageCausalityMockAgent(claimRetrievedEvidence),
    },
    warnings: claimRetrievedEvidence.claim_retrieval_warnings.length > 0 ? claimRetrievedEvidence.claim_retrieval_warnings : undefined,
  };
}

export function runFourMockAgentsForInterpretation(evidenceRetrievalResult: EvidenceRetrievalResult): AgentVerdictResult {
  return {
    interpretation_id: evidenceRetrievalResult.interpretation_id,
    claim_agent_results: evidenceRetrievalResult.retrieved_evidence_by_claim.map(runFourMockAgentsForClaim),
  };
}
