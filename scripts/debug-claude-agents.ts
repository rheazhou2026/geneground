import { extractClaimsMock } from "@/lib/claimExtractionMock";
import { categorizeBiologicalEntitiesMock } from "@/lib/entityCategorizationMock";
import { normalizeCategorizedEntities } from "@/lib/entityNormalization";
import { buildArtifactIndexesFromMockHandoff } from "@/lib/artifactIndexes";
import { buildAgentQueryPlansForInterpretation } from "@/lib/agentQueryPlan";
import { retrieveEvidenceForInterpretation } from "@/lib/evidenceRetrieval";
import { evaluateClaimAgentsWithClaude } from "@/lib/claude/agentEvaluation";
import { generateFinalReasonAndRewriteWithClaude } from "@/lib/claude/finalRewrite";
import { chooseFinalVerdict } from "@/lib/finalVerdictAggregator";
import { MOCK_HANDOFF_PROJECT } from "@/lib/mockHandoff";
import type { InterpretationInput } from "@/lib/schemas";

const DEFAULT_INTERPRETATION: InterpretationInput = {
  interpretation_id: "demo-interp-001",
  source_label: "Demo",
  full_text:
    "STAT1 knockdown suppresses interferon signaling in stimulated CD4+ T cells, suggesting STAT1 acts as a key regulator of inflammatory activation.",
  handoff_project_id: MOCK_HANDOFF_PROJECT.handoff_project_id,
  created_at: new Date().toISOString(),
};

async function main() {
  const extraction = extractClaimsMock(DEFAULT_INTERPRETATION);
  const categorization = categorizeBiologicalEntitiesMock(extraction.claims);
  const normalization = normalizeCategorizedEntities(extraction.claims, categorization.categorized_claims);
  const artifactIndexes = buildArtifactIndexesFromMockHandoff();
  const agentQueryPlanResult = buildAgentQueryPlansForInterpretation(normalization.normalized_claims, categorization.categorized_claims, extraction.claims);
  const evidenceRetrieval = retrieveEvidenceForInterpretation(agentQueryPlanResult, artifactIndexes);

  const claim = extraction.claims[0];
  const normalizedClaim = normalization.normalized_claims[0];
  const claimEvidence = evidenceRetrieval.retrieved_evidence_by_claim[0];

  console.log("=== Calling evaluateClaimAgentsWithClaude ===");
  const agentResult = await evaluateClaimAgentsWithClaude({ extractedClaim: claim, normalizedClaim, claimEvidence });
  console.log("ok:", agentResult.ok, agentResult.ok ? "" : agentResult.reason);
  if (agentResult.ok) {
    console.log(JSON.stringify(agentResult.data, null, 2));

    console.log("\n=== Deterministic final_verdict ===");
    const final_verdict = chooseFinalVerdict(agentResult.data.agent_results, {
      claim_type: claim.claim_type,
      original_claim_text: claim.original_text,
    });
    console.log(final_verdict);

    console.log("\n=== Calling generateFinalReasonAndRewriteWithClaude ===");
    const rewriteResult = await generateFinalReasonAndRewriteWithClaude({
      finalClaimResult: {
        claim_id: claim.claim_id,
        interpretation_id: claim.interpretation_id,
        original_claim_text: claim.original_text,
        claim_type: claim.claim_type,
        final_verdict,
        evidence_basis: { dataset_grounded: true, artifact_indexes_used: [], evidence_chunk_ids: [], chunk_ids_by_agent: { perturbation_evidence: [], pathway_signature: [], robustness_quality: [], language_causality: [] } },
        agent_verdicts: {
          perturbation_evidence: { agent_verdict: agentResult.data.agent_results.perturbation_evidence.agent_verdict },
          pathway_signature: { agent_verdict: agentResult.data.agent_results.pathway_signature.agent_verdict },
          robustness_quality: { agent_verdict: agentResult.data.agent_results.robustness_quality.agent_verdict },
          language_causality: { agent_verdict: agentResult.data.agent_results.language_causality.agent_verdict },
        },
        supported_parts: [],
        caveats: [],
        unsupported_or_overstated_parts: [],
        missing_evidence: [],
        risk_flags: [],
        recommended_action: "accept",
        safer_rewrite: "(fallback placeholder)",
        biologist_friendly_explanation: "(fallback placeholder)",
        trace: { sentence_id: claim.sentence_id, agent_query_id: [] },
      },
      claimAgentResults: agentResult.data,
    });
    console.log("ok:", rewriteResult.ok, rewriteResult.ok ? "" : rewriteResult.reason);
    if (rewriteResult.ok) console.log(JSON.stringify(rewriteResult.data, null, 2));
  }
}

main();
