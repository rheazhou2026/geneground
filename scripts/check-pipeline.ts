// Lightweight regression checks for the GeneGround JSON pipeline — no test
// framework, just deterministic assertions against the mock pipeline output
// for the default STAT1 demo interpretation. Run via `npm run test`.
//
// Goal: catch taxonomy-label drift and JSON-shape regressions (e.g. a
// schema/data file falling out of sync with src/lib/taxonomies.ts, the way
// language_rules.geneground.json's claim_types metadata once did).

import { extractClaimsMock } from "@/lib/claimExtractionMock";
import { categorizeBiologicalEntitiesMock } from "@/lib/entityCategorizationMock";
import { normalizeCategorizedEntities } from "@/lib/entityNormalization";
import { buildAgentQueryPlansForInterpretation } from "@/lib/agentQueryPlan";
import { buildArtifactIndexesFromMockHandoff } from "@/lib/artifactIndexes";
import { retrieveEvidenceForInterpretation } from "@/lib/evidenceRetrieval";
import { runFourMockAgentsForInterpretation } from "@/lib/mockAgents";
import { aggregateFinalVerdictsForInterpretation } from "@/lib/finalVerdictAggregator";
import { discoverArtifactsFromMockHandoff } from "@/lib/artifactDiscovery";
import { MOCK_HANDOFF_PROJECT } from "@/lib/mockHandoff";
import { AgentVerdictLabelSchema, FinalVerdictLabelSchema } from "@/lib/schemas";
import {
  AGENT_TYPES,
  CAUSAL_WORDS,
  CLAIM_TYPES,
  FINAL_VERDICTS,
  INTERNAL_AGENT_VERDICTS,
  STRENGTH_WORDS_HIGH_RISK,
  STRENGTH_WORDS_LOW_RISK,
  STRENGTH_WORDS_MEDIUM_RISK,
} from "@/lib/taxonomies";
import type { InterpretationInput } from "@/lib/schemas";

const ALL_STRENGTH_WORDS = new Set<string>([...STRENGTH_WORDS_LOW_RISK, ...STRENGTH_WORDS_MEDIUM_RISK, ...STRENGTH_WORDS_HIGH_RISK]);
const CAUSAL_WORD_SET = new Set<string>(CAUSAL_WORDS);

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

// ---------------------------------------------------------------------------
// Run the pipeline for the default STAT1 demo interpretation (same text as
// src/app/demo/page.tsx's DEFAULT_INTERPRETATION).
// ---------------------------------------------------------------------------

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
const artifactIndexes = buildArtifactIndexesFromMockHandoff();
const agentQueryPlanResult = buildAgentQueryPlansForInterpretation(
  normalization.normalized_claims,
  categorization.categorized_claims,
  extraction.claims,
);
const evidenceRetrieval = retrieveEvidenceForInterpretation(agentQueryPlanResult, artifactIndexes);
const agentVerdicts = runFourMockAgentsForInterpretation(evidenceRetrieval);
const finalVerdict = aggregateFinalVerdictsForInterpretation(agentVerdicts);
const artifactDiscovery = discoverArtifactsFromMockHandoff();

const stat1Normalized = normalization.normalized_claims.find((c) => c.claim_id === STAT1_CLAIM_ID);
const stat1Plan = agentQueryPlanResult.plans.find((p) => p.claim_id === STAT1_CLAIM_ID);
const stat1Evidence = evidenceRetrieval.retrieved_evidence_by_claim.find((e) => e.claim_id === STAT1_CLAIM_ID);
const stat1Final = finalVerdict.claim_results.find((c) => c.claim_id === STAT1_CLAIM_ID);

// ---------------------------------------------------------------------------
// 1. Default STAT1 interpretation pipeline
// ---------------------------------------------------------------------------

section("1. Default STAT1 interpretation pipeline");

check("extraction produces at least one claim", extraction.claims.length > 0);

check(
  "every claim_type is a member of taxonomies.ts CLAIM_TYPES",
  extraction.claims.every((c) => (CLAIM_TYPES as readonly string[]).includes(c.claim_type)),
);

check(
  "every language flag word is from taxonomies.ts strength/causal word lists",
  extraction.claims.every(
    (c) =>
      c.language_flags.strength_words.every((w) => ALL_STRENGTH_WORDS.has(w)) &&
      c.language_flags.causal_words.every((w) => CAUSAL_WORD_SET.has(w)),
  ),
);

const stat1Gene = stat1Normalized?.genes.find((g) => g.raw.toUpperCase() === "STAT1");
check("STAT1 gene mention normalizes to symbol STAT1", stat1Gene?.normalized_symbol === "STAT1");

const stimulatedCondition = stat1Normalized?.conditions.find((c) => c.raw.toLowerCase() === "stimulated");
check(
  "ambiguous 'stimulated' condition maps to both Stim8hr and Stim48hr",
  stimulatedCondition?.resolution === "ambiguous" &&
    (stimulatedCondition?.candidate_dataset_values.includes("Stim8hr") ?? false) &&
    (stimulatedCondition?.candidate_dataset_values.includes("Stim48hr") ?? false),
);

check(
  "AgentQueryPlan has exactly the four agent_queries (perturbation_evidence, pathway_signature, robustness_quality, language_causality)",
  !!stat1Plan && JSON.stringify(Object.keys(stat1Plan.agent_queries).sort()) === JSON.stringify([...AGENT_TYPES].sort()),
);

const allRetrievedChunks = stat1Evidence ? Object.values(stat1Evidence.agent_evidence).flatMap((a) => a.retrieved_chunks) : [];
check("at least one evidence chunk was retrieved for the STAT1 claim", allRetrievedChunks.length > 0);
check(
  "every retrieved chunk carries at least one retrieval_reason",
  allRetrievedChunks.length > 0 && allRetrievedChunks.every((chunk) => chunk.retrieval_reasons.length > 0),
);

check(
  "final_verdict is a member of taxonomies.ts FINAL_VERDICTS",
  !!stat1Final && (FINAL_VERDICTS as readonly string[]).includes(stat1Final.final_verdict),
);

check("a rewritten claim (safer_rewrite) exists and is non-empty", (stat1Final?.safer_rewrite.trim().length ?? 0) > 0);

check(
  "trace contains a non-empty sentence_id and four agent_query_ids",
  !!stat1Final && stat1Final.trace.sentence_id.length > 0 && stat1Final.trace.agent_query_id.length === 4 && stat1Final.trace.agent_query_id.every((id) => id.length > 0),
);

// ---------------------------------------------------------------------------
// 2. Artifact Discovery
// ---------------------------------------------------------------------------

section("2. Artifact Discovery");

const perturbationEntry = artifactDiscovery.artifact_manifest.find((e) => e.artifact_type === "perturbation_evidence");
check(
  "a perturbation_evidence file maps to perturbation_evidence_index",
  !!perturbationEntry && perturbationEntry.use_for_indexes.includes("perturbation_evidence_index"),
);

const pathwayEntry = artifactDiscovery.artifact_manifest.find((e) => e.artifact_type === "pathway_evidence");
check(
  "a pathway_evidence file maps to pathway_signature_index",
  !!pathwayEntry && pathwayEntry.use_for_indexes.includes("pathway_signature_index"),
);

const largeH5adIgnored = artifactDiscovery.ignored_files.find((e) => e.file_extension === ".h5ad");
check("a large .h5ad file is placed in ignored_files", !!largeH5adIgnored);

const ontologyEntries = artifactDiscovery.artifact_manifest.filter((e) => e.artifact_type === "ontology_reference");
check(
  "ontology_reference files exist and are not placed into any artifact evidence index",
  ontologyEntries.length > 0 && ontologyEntries.every((e) => e.use_for_indexes.length === 0),
);

// ---------------------------------------------------------------------------
// 3. Internal agent verdicts vs. final claim verdicts
// ---------------------------------------------------------------------------

section("3. Internal agent verdicts vs. final claim verdicts");

check("INTERNAL_AGENT_VERDICTS includes not_applicable", (INTERNAL_AGENT_VERDICTS as readonly string[]).includes("not_applicable"));
check("AgentVerdictLabelSchema (runtime) accepts not_applicable", AgentVerdictLabelSchema.safeParse("not_applicable").success);

check("FINAL_VERDICTS does not include not_applicable", !(FINAL_VERDICTS as readonly string[]).includes("not_applicable"));
check("FinalVerdictLabelSchema (runtime) rejects not_applicable", !FinalVerdictLabelSchema.safeParse("not_applicable").success);

check(
  "no claim in the default demo run has a final_verdict of not_applicable",
  finalVerdict.claim_results.every((c) => (c.final_verdict as string) !== "not_applicable"),
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
