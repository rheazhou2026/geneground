import { extractClaimsMock } from "@/lib/claimExtractionMock";
import { categorizeBiologicalEntitiesMock } from "@/lib/entityCategorizationMock";
import { normalizeCategorizedEntities } from "@/lib/entityNormalization";
import { buildInterpretationClaimMap } from "@/lib/interactiveReviewMock";
import { discoverArtifactsFromMockHandoff } from "@/lib/artifactDiscovery";
import { buildAgentQueryPlansForInterpretation } from "@/lib/agentQueryPlan";
import { buildArtifactIndexesFromMockHandoff } from "@/lib/artifactIndexes";
import { retrieveEvidenceForInterpretation } from "@/lib/evidenceRetrieval";
import { runFourMockAgentsForInterpretation } from "@/lib/mockAgents";
import { aggregateFinalVerdictsForInterpretation } from "@/lib/finalVerdictAggregator";
import {
  createSelectionContext,
  createMockReviewThread,
  createMockActionPlan,
} from "@/lib/interactiveReviewMock";
import {
  toDocumentedClaimExtraction,
  toDocumentedInterpretationClaimMap,
  toDocumentedNormalizedEntities,
  toDocumentedArtifactDiscovery,
  toDocumentedAgentQueryPlan,
  toDocumentedArtifactIndex,
  toDocumentedRetrievedEvidence,
  toDocumentedFinalVerdictResult,
  toDocumentedTextSelectionContext,
  toDocumentedChatThread,
  toDocumentedActionPlan,
} from "@/lib/documentedJson";
import { MOCK_HANDOFF_PROJECT } from "@/lib/mockHandoff";
import type { InterpretationInput } from "@/lib/schemas";

function heading(n: string, title: string) {
  console.log(`\n${"=".repeat(80)}\nSTAGE ${n}: ${title}\n${"=".repeat(80)}`);
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

const DEFAULT_INTERPRETATION: InterpretationInput = {
  interpretation_id: "demo-interp-001",
  source_label: "Demo interpretation — CD4+ T cell Perturb-seq",
  full_text:
    "STAT1 knockdown suppresses interferon signaling in stimulated CD4+ T cells, suggesting STAT1 acts as a key regulator of inflammatory activation. IRF4 perturbation shifts cells toward a Th2-like polarization state, raising the possibility of a therapeutic target for immune modulation.",
  handoff_project_id: MOCK_HANDOFF_PROJECT.handoff_project_id,
  created_at: "2026-07-01T09:15:00Z",
};

const STAT1_CLAIM_ID = "demo-interp-001-c1";

const extraction = extractClaimsMock(DEFAULT_INTERPRETATION);
const categorization = categorizeBiologicalEntitiesMock(extraction.claims);
const normalization = normalizeCategorizedEntities(extraction.claims, categorization.categorized_claims);
const claimMap = buildInterpretationClaimMap(extraction.source_text, extraction.claims);
const artifactDiscovery = discoverArtifactsFromMockHandoff();
const artifactIndexes = buildArtifactIndexesFromMockHandoff();
const agentQueryPlanResult = buildAgentQueryPlansForInterpretation(
  normalization.normalized_claims,
  categorization.categorized_claims,
  extraction.claims,
);
const evidenceRetrieval = retrieveEvidenceForInterpretation(agentQueryPlanResult, artifactIndexes);
const agentVerdicts = runFourMockAgentsForInterpretation(evidenceRetrieval);
const finalVerdict = aggregateFinalVerdictsForInterpretation(agentVerdicts);

const stat1Claim = extraction.claims.find((c) => c.claim_id === STAT1_CLAIM_ID)!;
const stat1Plan = agentQueryPlanResult.plans.find((p) => p.claim_id === STAT1_CLAIM_ID)!;
const stat1Evidence = evidenceRetrieval.retrieved_evidence_by_claim.find((e) => e.claim_id === STAT1_CLAIM_ID)!;

heading("1", "Claim Extraction JSON (full interpretation — STAT1 is Claims[0])");
printJson(toDocumentedClaimExtraction(extraction));

heading("2", "InterpretationClaimMap JSON");
printJson(toDocumentedInterpretationClaimMap(claimMap));

heading("3", "Normalized Entities JSON (STAT1 claim only)");
printJson(toDocumentedNormalizedEntities(normalization).find((c) => c.Claim_id === STAT1_CLAIM_ID));

heading("4", "Artifact Discovery JSON (truncated to first 3 manifest entries)");
const discoveryDoc = toDocumentedArtifactDiscovery(artifactDiscovery);
printJson({ ...discoveryDoc, Artifact_manifest: discoveryDoc.Artifact_manifest.slice(0, 3) });

heading("5", "AgentQueryPlan JSON (STAT1 claim)");
printJson(toDocumentedAgentQueryPlan(stat1Plan));

heading("6", "Artifact Index JSON (perturbation_evidence_index, truncated to first chunk)");
const perturbationIndexDoc = toDocumentedArtifactIndex("perturbation_evidence_index", artifactIndexes.indexes.perturbation_evidence_index);
printJson({ ...perturbationIndexDoc, Chunks: perturbationIndexDoc.Chunks.slice(0, 1) });

heading("7", "Retrieved Evidence JSON (STAT1 claim)");
printJson(toDocumentedRetrievedEvidence(stat1Evidence));

heading("8", "Final Claim Result JSON (whole interpretation, no confidence scores)");
printJson(toDocumentedFinalVerdictResult(finalVerdict));

heading("9-11", "Interactive review: TextSelectionContext -> Chat Thread -> Action Plan (selecting the STAT1 claim text)");
const selectionCtx = createSelectionContext(stat1Claim.original_text, null, null, claimMap, finalVerdict);
printJson(toDocumentedTextSelectionContext(selectionCtx));

const thread = createMockReviewThread(selectionCtx, finalVerdict);
printJson(toDocumentedChatThread(thread));

const plan = createMockActionPlan(selectionCtx, "rewrite_cautiously", finalVerdict, claimMap);
printJson(toDocumentedActionPlan(plan));
