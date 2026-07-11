// Regression checks for this turn's retrieval-precision fix: gene match must
// be mandatory (and checked before condition/pathway/direction) for
// perturbation_evidence_index, pathway_signature_index, and
// robustness_quality_index (src/lib/evidenceRetrieval.ts), and the allowed
// gene set for a claim is computed in src/lib/agentQueryPlan.ts. Run via
// `npm run test`.
//
// Reproduces the exact reported bug shape (NFKB2/Stim8hr claim pulling in an
// unrelated CD28/Stim8hr chunk purely on condition match) using synthetic
// packets — no gold verdicts, no hardcoded demo claim IDs.

import { buildChunksFromEvidenceBundle } from "@/lib/artifactIndexes";
import { retrieveEvidenceForAgentQuery, retrieveEvidenceForClaim } from "@/lib/evidenceRetrieval";
import { buildAgentQueryPlansForInterpretation } from "@/lib/agentQueryPlan";
import { extractClaimsMock } from "@/lib/claimExtractionMock";
import { categorizeBiologicalEntitiesMock } from "@/lib/entityCategorizationMock";
import { normalizeCategorizedEntities } from "@/lib/entityNormalization";
import { MOCK_HANDOFF_PROJECT } from "@/lib/mockHandoff";
import type { AgentQuery, ArtifactIndex, ArtifactIndexes, ArtifactIndexType, EvidenceChunk, InterpretationInput } from "@/lib/schemas";

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
// Synthetic evidence: NFKB2 + CD28 in Stim8hr (the exact reported bug shape),
// GATA3 + ICOS in Rest, STAT1 in Stim8hr — via the same evidence-bundle
// packet shape a real live-demo handoff zip uses.
// ---------------------------------------------------------------------------

function packet(id: string, gene: string, ensembl: string, condition: string) {
  return {
    evidence_packet_id: id,
    perturbation_target_gene: gene,
    perturbation_target_ensembl: ensembl,
    culture_condition: condition,
    perturbation_type: "CRISPRi",
    n_cells_target: 1200,
    n_guides: 2,
    ontarget_effect_size: -20,
    ontarget_significant: true,
    n_up_genes: 400,
    n_down_genes: 300,
    n_total_de_genes: 700,
    top_upregulated_genes: ["A", "B"],
    top_downregulated_genes: ["C", "D"],
    confidence_flags: [],
    robustness_context: {
      robustness_score: 0.8,
      donor_evidence: { n_donors: 4 },
      guide_evidence: { n_guides: 2 },
      pseudobulk_support: { n_pass: 8, n_total: 8 },
    },
    pathway_evidence: {
      external_enrichment_up_top: [{ pathway_name: `${gene} enriched pathway`, overlap_genes: [gene], adj_p_value: 0.01 }],
    },
    caveats: [],
  };
}

// Packet IDs follow the real GG_DE_<ensembl>_<condition> shape used by the
// live-demo handoff zip (see the request's own example chunk IDs), not
// arbitrary synthetic names — so this test doubles as a direct check against
// the literal "should NOT retrieve GG_DE_ENSG00000178562_Stim8hr__perturbation"
// example.
const BUNDLE = {
  bundle_name: "synthetic_gene_precision_bundle",
  evidence_packets: [
    packet("GG_DE_ENSG00000077150_Stim8hr", "NFKB2", "ENSG00000077150", "Stim8hr"),
    packet("GG_DE_ENSG00000178562_Stim8hr", "CD28", "ENSG00000178562", "Stim8hr"),
    packet("GG_DE_ENSG00000107485_Rest", "GATA3", "ENSG00000107485", "Rest"),
    packet("GG_DE_ENSG00000163600_Rest", "ICOS", "ENSG00000163600", "Rest"),
    packet("GG_DE_ENSG00000115415_Stim8hr", "STAT1", "ENSG00000115415", "Stim8hr"),
  ],
};

const chunksByIndex = buildChunksFromEvidenceBundle(BUNDLE, "synthetic_bundle.json", "SYNTHETIC_BUNDLE");

function emptyIndex(indexType: ArtifactIndexType): ArtifactIndex {
  return { index_name: indexType, plain_english_question: "", source_artifact_ids: [], chunks: [] };
}

function wrapAsArtifactIndexes(byIndex: Partial<Record<ArtifactIndexType, EvidenceChunk[]>>): ArtifactIndexes {
  const indexTypes: ArtifactIndexType[] = [
    "perturbation_evidence_index",
    "pathway_signature_index",
    "robustness_quality_index",
    "language_rules_index",
    "provenance_index",
    "demo_examples_index",
  ];
  const indexes = Object.fromEntries(
    indexTypes.map((t) => [t, { ...emptyIndex(t), chunks: byIndex[t] ?? [] }]),
  ) as ArtifactIndexes["indexes"];
  return { project_id: "synthetic", created_at: new Date().toISOString(), indexes };
}

const SYNTHETIC_INDEXES = wrapAsArtifactIndexes(chunksByIndex);

function baseQuery(overrides: Partial<AgentQuery["filters"]>, indexType: ArtifactIndexType = "perturbation_evidence_index"): AgentQuery {
  return {
    agent_type: "perturbation_evidence",
    agent_query_id: "test__perturbation_evidence",
    index_type: indexType,
    filters: { conditions: [], ...overrides },
    question: "test",
    evidence_fields_to_retrieve: [],
  };
}

// ---------------------------------------------------------------------------
// 1. NFKB2 claim does not retrieve CD28 even though condition matches
// ---------------------------------------------------------------------------

section("1. Gene-mandatory filtering: NFKB2/Stim8hr query never retrieves CD28/Stim8hr");

const nfkb2Query = baseQuery({ target_gene_symbol: "NFKB2", allowed_gene_symbols: ["NFKB2"], gene_constrained: true, conditions: ["Stim8hr"] });
const nfkb2Result = retrieveEvidenceForAgentQuery(nfkb2Query, SYNTHETIC_INDEXES);

check("NFKB2/Stim8hr query retrieves at least one chunk", nfkb2Result.retrieved_chunks.length > 0);
check(
  "every retrieved chunk's target_gene_symbol is NFKB2",
  nfkb2Result.retrieved_chunks.every((c) => c.metadata.target_gene_symbol === "NFKB2"),
);
check(
  "the exact GG_DE_ENSG00000077150_Stim8hr__perturbation (NFKB2) chunk is retrieved",
  nfkb2Result.retrieved_chunks.some((c) => c.chunk_id === "GG_DE_ENSG00000077150_Stim8hr__perturbation"),
);
check(
  "the exact GG_DE_ENSG00000178562_Stim8hr__perturbation (CD28) chunk is never retrieved",
  !nfkb2Result.retrieved_chunks.some((c) => c.chunk_id === "GG_DE_ENSG00000178562_Stim8hr__perturbation"),
);

// ---------------------------------------------------------------------------
// 2. Condition ambiguity does not override gene mismatch
// ---------------------------------------------------------------------------

section("2. Condition ambiguity never pulls in an unrelated gene");

// NFKB2 only exists in Stim8hr in this synthetic dataset; CD28 also only
// exists in Stim8hr. An ambiguous condition filter spanning Stim8hr+Stim48hr
// must not let CD28 slip in just because "Stim8hr" is one of the candidates.
const ambiguousQuery = baseQuery({
  target_gene_symbol: "NFKB2",
  allowed_gene_symbols: ["NFKB2"],
  gene_constrained: true,
  conditions: ["Stim8hr", "Stim48hr"],
});
const ambiguousResult = retrieveEvidenceForAgentQuery(ambiguousQuery, SYNTHETIC_INDEXES);

check(
  "ambiguous-condition NFKB2 query still returns only NFKB2 chunks",
  ambiguousResult.retrieved_chunks.every((c) => c.metadata.target_gene_symbol === "NFKB2"),
);
check(
  "ambiguous-condition NFKB2 query never returns the CD28 chunk",
  !ambiguousResult.retrieved_chunks.some((c) => c.metadata.target_gene_symbol === "CD28"),
);

// GATA3/Rest vs ICOS/Rest — the second reported bug shape.
const gata3Query = baseQuery({ target_gene_symbol: "GATA3", allowed_gene_symbols: ["GATA3"], gene_constrained: true, conditions: ["Rest"] });
const gata3Result = retrieveEvidenceForAgentQuery(gata3Query, SYNTHETIC_INDEXES);
check(
  "GATA3/Rest query never returns the ICOS/Rest chunk",
  !gata3Result.retrieved_chunks.some((c) => c.metadata.target_gene_symbol === "ICOS"),
);
check(
  "GATA3/Rest query returns only GATA3 chunks",
  gata3Result.retrieved_chunks.length > 0 && gata3Result.retrieved_chunks.every((c) => c.metadata.target_gene_symbol === "GATA3"),
);

// ---------------------------------------------------------------------------
// 3. TF-IDF fallback respects gene constraints
// ---------------------------------------------------------------------------

section("3. TF-IDF fallback stays within the gene-matched candidate pool");

// A condition that doesn't exist for NFKB2 in this dataset forces every
// metadata score to fall back to baseline-only for the real NFKB2 chunk (no
// condition match), so if TF-IDF ran over the WHOLE index it could easily
// prefer a differently-worded but textually-similar CD28 chunk instead.
const fallbackQuery = baseQuery({
  target_gene_symbol: "NFKB2",
  allowed_gene_symbols: ["NFKB2"],
  gene_constrained: true,
  conditions: ["Rest"], // NFKB2 has no Rest packet in this synthetic set
});
const fallbackResult = retrieveEvidenceForAgentQuery(fallbackQuery, SYNTHETIC_INDEXES);

check(
  "TF-IDF fallback for an unmatched condition still only returns NFKB2 (or nothing), never CD28/GATA3/ICOS",
  fallbackResult.retrieved_chunks.every((c) => c.metadata.target_gene_symbol === "NFKB2"),
);

// A gene with zero chunks anywhere in this index — must return nothing
// rather than substituting an unrelated gene via text similarity.
const noEvidenceQuery = baseQuery({ target_gene_symbol: "BATF", allowed_gene_symbols: ["BATF"], gene_constrained: true, conditions: ["Stim8hr"] });
const noEvidenceResult = retrieveEvidenceForAgentQuery(noEvidenceQuery, SYNTHETIC_INDEXES);
check("a gene with no matching chunks anywhere returns zero retrieved chunks (not an unrelated gene)", noEvidenceResult.retrieved_chunks.length === 0);
check("a gene with no matching chunks anywhere still explains why via retrieval_warnings", noEvidenceResult.retrieval_warnings.length > 0);

// ---------------------------------------------------------------------------
// 4. Broad summary retrieval is constrained to genes in the original
//    interpretation (not every gene in the evidence index)
// ---------------------------------------------------------------------------

section("4. Broad summary-claim retrieval is constrained to genes actually mentioned in the interpretation");

const interpretation: InterpretationInput = {
  interpretation_id: "synthetic-interp-gene-precision",
  source_label: "Synthetic gene-precision interpretation",
  full_text:
    "NFKB2 knockdown increases inflammatory signaling in Stim8hr CD4+ T cells. GATA3 knockdown shifts polarization in Rest CD4+ T cells. Together, these knockdowns show a theme-consistent pattern across the profiled genes.",
  handoff_project_id: MOCK_HANDOFF_PROJECT.handoff_project_id,
  created_at: new Date().toISOString(),
};

const extraction = extractClaimsMock(interpretation);
const categorization = categorizeBiologicalEntitiesMock(extraction.claims);
const normalization = normalizeCategorizedEntities(extraction.claims, categorization.categorized_claims);
const queryPlanResult = buildAgentQueryPlansForInterpretation(normalization.normalized_claims, categorization.categorized_claims, extraction.claims);

const summaryPlan = queryPlanResult.plans.find((p) => p.claim_type === "summary_claim");
check("the synthetic interpretation produces a summary_claim ('Together, these knockdowns...')", summaryPlan !== undefined);

if (summaryPlan) {
  const allowedGenes = (summaryPlan.agent_queries.perturbation_evidence.filters.allowed_gene_symbols as string[] | undefined) ?? [];
  check("summary claim's allowed_gene_symbols includes NFKB2 (mentioned in the interpretation)", allowedGenes.includes("NFKB2"));
  check("summary claim's allowed_gene_symbols includes GATA3 (mentioned in the interpretation)", allowedGenes.includes("GATA3"));
  check("summary claim's allowed_gene_symbols excludes CD28 (never mentioned in the interpretation)", !allowedGenes.includes("CD28"));
  check("summary claim's allowed_gene_symbols excludes STAT1 (never mentioned in the interpretation)", !allowedGenes.includes("STAT1"));

  const summaryEvidence = retrieveEvidenceForClaim(summaryPlan, SYNTHETIC_INDEXES);
  const summaryPerturbationGenes = summaryEvidence.agent_evidence.perturbation_evidence.retrieved_chunks.map((c) => c.metadata.target_gene_symbol);
  check(
    "summary claim's actual retrieved perturbation chunks are only NFKB2/GATA3, never CD28/ICOS/STAT1",
    summaryPerturbationGenes.every((g) => g === "NFKB2" || g === "GATA3"),
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passCount} passed, ${failures.length} failed.`);
if (failures.length > 0) {
  console.log("\nFailed checks:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
