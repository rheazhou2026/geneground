// Regression checks for the Claude API integration layer (Parts 1-12 of the
// GeneGround Claude integration). These run entirely against the
// deterministic/mock pipeline — no live ANTHROPIC_API_KEY required — so they
// exercise exactly the logic that stays true whether or not Claude is
// actually called: ontology normalization, taxonomy-constrained verdict
// aggregation, and the chunk_id subset enforcement that guards Claude's
// agent-evaluation output. Run via `npm run test`.

import { extractClaimsMock } from "@/lib/claimExtractionMock";
import { categorizeBiologicalEntitiesMock } from "@/lib/entityCategorizationMock";
import { normalizeCategorizedEntities } from "@/lib/entityNormalization";
import { buildAgentQueryPlansForInterpretation } from "@/lib/agentQueryPlan";
import { buildArtifactIndexesFromMockHandoff } from "@/lib/artifactIndexes";
import { retrieveEvidenceForInterpretation } from "@/lib/evidenceRetrieval";
import { runFourMockAgentsForInterpretation } from "@/lib/mockAgents";
import { aggregateFinalVerdictsForInterpretation } from "@/lib/finalVerdictAggregator";
import { adaptAgentResult, type ClaudeAgentResult } from "@/lib/claude/agentEvaluation";
import { MOCK_HANDOFF_PROJECT } from "@/lib/mockHandoff";
import type { InterpretationInput } from "@/lib/schemas";

let passCount = 0;
const failures: string[] = [];

function check(name: string, condition: boolean) {
  if (condition) {
    passCount += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

function runFullPipeline(interpretation: InterpretationInput) {
  const extraction = extractClaimsMock(interpretation);
  const categorization = categorizeBiologicalEntitiesMock(extraction.claims);
  const normalization = normalizeCategorizedEntities(extraction.claims, categorization.categorized_claims);
  const artifactIndexes = buildArtifactIndexesFromMockHandoff();
  const agentQueryPlanResult = buildAgentQueryPlansForInterpretation(
    normalization.normalized_claims,
    categorization.categorized_claims,
    extraction.claims,
  );
  const evidenceRetrieval = retrieveEvidenceForInterpretation(agentQueryPlanResult, artifactIndexes);
  const agentVerdicts = runFourMockAgentsForInterpretation(evidenceRetrieval);
  const finalVerdict = aggregateFinalVerdictsForInterpretation(agentVerdicts);
  return { extraction, categorization, normalization, evidenceRetrieval, agentVerdicts, finalVerdict };
}

// ---------------------------------------------------------------------------
// 1. STAT1 claim — same default demo interpretation the extraction API route
//    falls back to; sanity-checks the extraction -> normalization -> verdict
//    chain the Claude claim-extraction/agent-evaluation/final-rewrite calls
//    all sit on top of, end to end.
// ---------------------------------------------------------------------------

section("1. STAT1 claim (default demo interpretation)");

const DEFAULT_INTERPRETATION: InterpretationInput = {
  interpretation_id: "demo-interp-001",
  source_label: "Demo interpretation — CD4+ T cell Perturb-seq",
  full_text:
    "STAT1 knockdown suppresses interferon signaling in stimulated CD4+ T cells, suggesting STAT1 acts as a key regulator of inflammatory activation. IRF4 perturbation shifts cells toward a Th2-like polarization state, raising the possibility of a therapeutic target for immune modulation.",
  handoff_project_id: MOCK_HANDOFF_PROJECT.handoff_project_id,
  created_at: "2026-07-01T09:15:00Z",
};

const defaultRun = runFullPipeline(DEFAULT_INTERPRETATION);
const stat1Claim = defaultRun.finalVerdict.claim_results.find((c) => c.claim_id === "demo-interp-001-c1");

check("STAT1 claim is extracted and produces a final verdict", stat1Claim !== undefined);
check(
  "STAT1 claim's final_verdict is dataset-grounded (evidence_basis.dataset_grounded)",
  stat1Claim?.evidence_basis.dataset_grounded === true,
);
check("STAT1 claim has a non-empty safer_rewrite", (stat1Claim?.safer_rewrite.trim().length ?? 0) > 0);

// ---------------------------------------------------------------------------
// 2. T-bet -> TBX21 alias normalization
// ---------------------------------------------------------------------------

section("2. T-bet -> TBX21 alias normalization");

const TBET_INTERPRETATION: InterpretationInput = {
  interpretation_id: "test-interp-tbet",
  source_label: "Test — T-bet alias",
  full_text: "T-bet perturbation shifts cells toward Th1 polarization in stimulated CD4+ T cells.",
  handoff_project_id: MOCK_HANDOFF_PROJECT.handoff_project_id,
  created_at: new Date().toISOString(),
};

const tbetRun = runFullPipeline(TBET_INTERPRETATION);
const tbetGene = tbetRun.normalization.normalized_claims[0]?.genes.find((g) => g.raw.toLowerCase() === "t-bet");

check("raw 'T-bet' mention is picked up during normalization", tbetGene !== undefined);
check("'T-bet' normalizes to approved symbol TBX21", tbetGene?.normalized_symbol === "TBX21");
check("'T-bet' -> TBX21 resolution source is HGNC (alias table), not unresolved", tbetGene?.source === "HGNC");

// ---------------------------------------------------------------------------
// 3. PD-1 -> PDCD1 alias normalization
// ---------------------------------------------------------------------------

section("3. PD-1 -> PDCD1 alias normalization");

const PD1_INTERPRETATION: InterpretationInput = {
  interpretation_id: "test-interp-pd1",
  source_label: "Test — PD-1 alias",
  full_text: "PD-1 blockade increases IFNG expression in stimulated CD4+ T cells.",
  handoff_project_id: MOCK_HANDOFF_PROJECT.handoff_project_id,
  created_at: new Date().toISOString(),
};

const pd1Run = runFullPipeline(PD1_INTERPRETATION);
const pd1Gene = pd1Run.normalization.normalized_claims[0]?.genes.find((g) => g.raw.toLowerCase() === "pd-1");

check("raw 'PD-1' mention is picked up during normalization", pd1Gene !== undefined);
check("'PD-1' normalizes to approved symbol PDCD1", pd1Gene?.normalized_symbol === "PDCD1");
check("'PD-1' -> PDCD1 resolution source is HGNC (alias table), not unresolved", pd1Gene?.source === "HGNC");

// ---------------------------------------------------------------------------
// 4. "therapeutic target" wording gets flagged, not silently accepted
// ---------------------------------------------------------------------------

section('4. "therapeutic target" language flagged unless evidence supports therapeutic relevance');

const therapeuticClaim = defaultRun.finalVerdict.claim_results.find((c) => c.original_claim_text.toLowerCase().includes("therapeutic target"));

check('a claim mentioning "therapeutic target" exists in the default demo run', therapeuticClaim !== undefined);
check(
  "that claim's risk_flags include therapeutic_claim_without_validation",
  (therapeuticClaim?.risk_flags ?? []).includes("therapeutic_claim_without_validation"),
);
check(
  'final_verdict for the "therapeutic target" claim is NOT a clean "supported" (no orthogonal validation was retrieved)',
  therapeuticClaim?.final_verdict !== "supported" && therapeuticClaim?.final_verdict !== "supported_with_caveats",
);

// ---------------------------------------------------------------------------
// 5. "stimulated" condition maps to both Stim8hr and Stim48hr
// ---------------------------------------------------------------------------

section("5. Ambiguous 'stimulated' condition maps to Stim8hr + Stim48hr");

const stat1Normalized = defaultRun.normalization.normalized_claims.find((c) => c.claim_id === "demo-interp-001-c1");
const stimulatedCondition = stat1Normalized?.conditions.find((c) => c.raw.toLowerCase() === "stimulated");

check(
  "'stimulated' resolves as ambiguous across both Stim8hr and Stim48hr",
  stimulatedCondition?.resolution === "ambiguous" &&
    (stimulatedCondition?.candidate_dataset_values.includes("Stim8hr") ?? false) &&
    (stimulatedCondition?.candidate_dataset_values.includes("Stim48hr") ?? false),
);

// ---------------------------------------------------------------------------
// 6. Agent evaluation cannot cite chunk_ids that were not retrieved
// ---------------------------------------------------------------------------

section("6. Agent evaluation drops chunk_ids Claude did not actually retrieve");

const retrievedChunkIds = new Set(["real-chunk-1", "real-chunk-2"]);
const claudeResultWithInventedChunk: ClaudeAgentResult = {
  agent: "perturbation_evidence",
  verdict: "supports",
  rationale: "Test rationale citing a mix of real and invented chunk_ids.",
  chunk_ids: ["real-chunk-1", "invented-chunk-99", "real-chunk-2"],
  warnings: [],
};

const adapted = adaptAgentResult("perturbation_evidence", "test-claim-1", "test-query-1", claudeResultWithInventedChunk, retrievedChunkIds);

check(
  "only actually-retrieved chunk_ids survive into evidence_chunk_ids",
  JSON.stringify([...adapted.evidence_chunk_ids].sort()) === JSON.stringify(["real-chunk-1", "real-chunk-2"]),
);
check("the invented chunk_id does not appear anywhere in evidence_chunk_ids", !adapted.evidence_chunk_ids.includes("invented-chunk-99"));
check(
  "a warning records that the invented chunk_id was dropped",
  adapted.risk_flags.some((flag) => flag.includes("invented-chunk-99")),
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passCount} passed, ${failures.length} failed.`);
if (failures.length > 0) {
  console.log("\nFailed checks:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
