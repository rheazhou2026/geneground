// Regression checks for this turn's fixes:
//   1. chunkProvenanceLines never collapses perturbation/pathway/robustness/
//      language/provenance chunks to the fully generic "Claude Science
//      evidence packet" line — each keeps its own layer-specific primary
//      prefix even when the bundle supplies none of the optional
//      provenance.* fields (src/lib/chunkDisplay.ts).
//   2. rankChunksForDisplay orders retrieved chunks by retrieval_mode
//      priority (metadata_exact > metadata_partial > hybrid > local vector
//      fallback), then by whether they match the claim's own primary
//      gene/condition (src/lib/chunkDisplay.ts).
//   3. rankChunksForDisplay interleaves by gene coverage within a tier, so a
//      multi-gene summary claim's default top evidence spans every mentioned
//      gene instead of several timepoints of whichever gene scored highest
//      (src/lib/chunkDisplay.ts).
// Run via `npm run test`. No gold verdicts, no hardcoded claim IDs.

import { chunkProvenanceLines, countDistinctGenes, rankChunksForDisplay } from "@/lib/chunkDisplay";
import type { RetrievedChunk } from "@/lib/schemas";

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
// 1. Provenance labels stay layer-distinct even with a data-poor bundle
// ---------------------------------------------------------------------------

section("1. chunkProvenanceLines keeps distinct primary prefixes per index type, even with no optional provenance.* fields");

const GENERIC_SOURCE_FILE = "geneground_evidence_bundle_v2.json";

const perturbationChunk = {
  index_type: "perturbation_evidence_index" as const,
  source_file_name: GENERIC_SOURCE_FILE,
  metadata: { target_gene_symbol: "NFKB2", culture_condition: "Stim8hr" },
};
const pathwayChunk = {
  index_type: "pathway_signature_index" as const,
  source_file_name: GENERIC_SOURCE_FILE,
  metadata: { target_gene_symbol: "NFKB2", culture_condition: "Stim8hr" },
};
const robustnessChunk = {
  index_type: "robustness_quality_index" as const,
  source_file_name: GENERIC_SOURCE_FILE,
  metadata: { target_gene_symbol: "NFKB2", culture_condition: "Stim8hr" },
};
const languageChunk = {
  index_type: "language_rules_index" as const,
  source_file_name: GENERIC_SOURCE_FILE,
  metadata: {},
};
const provenanceChunk = {
  index_type: "provenance_index" as const,
  source_file_name: GENERIC_SOURCE_FILE,
  metadata: {},
};

const perturbationLines = chunkProvenanceLines(perturbationChunk);
const pathwayLines = chunkProvenanceLines(pathwayChunk);
const robustnessLines = chunkProvenanceLines(robustnessChunk);
const languageLines = chunkProvenanceLines(languageChunk);
const provenanceLines = chunkProvenanceLines(provenanceChunk);

const allPrimaries = [perturbationLines.primary, pathwayLines.primary, robustnessLines.primary, languageLines.primary, provenanceLines.primary];
check("all five index types produce distinct primary lines even with no optional metadata", new Set(allPrimaries).size === allPrimaries.length);
check("perturbation primary line is layer-specific, not the generic fallback", perturbationLines.primary.startsWith("Differential expression evidence"));
check("pathway primary line is layer-specific, not the generic fallback", pathwayLines.primary.startsWith("Pathway/signature evidence"));
check("robustness primary line is layer-specific, not the generic fallback", robustnessLines.primary.startsWith("Robustness/QC evidence"));
check("language primary line is layer-specific, not the generic fallback", languageLines.primary.startsWith("Claim wording policy"));
check("provenance primary line is layer-specific, not the generic fallback", provenanceLines.primary.startsWith("Dataset provenance"));
check("none of the five lines is the fully generic 'Claude Science evidence packet' fallback", !allPrimaries.some((p) => p.startsWith("Claude Science evidence packet")));
check("no primary line uses the old 'Processed from X via Y' sentence shape", !allPrimaries.some((p) => p.includes("Processed from")));
check("language secondary line matches the requested exact wording", languageLines.secondary === "Checks causal, mechanistic, knockout, and therapeutic wording");

// A chunk that DOES have layer-specific fields still prefers them over the bundle's own name.
const pathwayWithSource = chunkProvenanceLines({
  index_type: "pathway_signature_index" as const,
  source_file_name: GENERIC_SOURCE_FILE,
  metadata: { pathway_results_source: "pathway_enrichment_results.csv", external_enrichment_sources: "MSigDB Hallmark" },
});
check("a pathway chunk with a specific source file uses it instead of the bundle name", pathwayWithSource.primary.includes("pathway_enrichment_results.csv"));
check("a pathway chunk with enrichment sources surfaces them as the secondary line", pathwayWithSource.secondary === "Enrichment sources: MSigDB Hallmark");

// ---------------------------------------------------------------------------
// 2. rankChunksForDisplay orders by retrieval_mode tier, then claim match
// ---------------------------------------------------------------------------

section("2. rankChunksForDisplay orders retrieved chunks by retrieval_mode priority, then claim gene/condition match");

function retrievedChunk(overrides: Partial<RetrievedChunk> & Pick<RetrievedChunk, "chunk_id" | "retrieval_mode">): RetrievedChunk {
  return {
    index_type: "perturbation_evidence_index",
    chunk_type: "perturbation_de_summary",
    source_file_name: GENERIC_SOURCE_FILE,
    retrieval_score: 0,
    retrieval_reasons: [],
    metadata: {},
    structured_payload: {},
    text_for_embedding: "",
    ...overrides,
  };
}

const localFallback = retrievedChunk({ chunk_id: "local", retrieval_mode: "local_vector_fallback" });
const hybrid = retrievedChunk({ chunk_id: "hybrid", retrieval_mode: "hybrid_metadata_and_local_vector" });
const partial = retrievedChunk({ chunk_id: "partial", retrieval_mode: "metadata_partial" });
const exact = retrievedChunk({ chunk_id: "exact", retrieval_mode: "metadata_exact" });

const rankedByMode = rankChunksForDisplay([localFallback, hybrid, partial, exact]);
check(
  "metadata_exact ranks first, then metadata_partial, then hybrid, then local_vector_fallback",
  rankedByMode.map((c) => c.chunk_id).join(",") === "exact,partial,hybrid,local",
);

// Claim 4 example from this turn's validation criteria: an NFKB2/Stim8hr
// claim should show its own NFKB2/Stim8hr evidence before Rest/Stim48hr
// evidence, even when both cleared the same retrieval_mode tier.
const nfkb2Stim8hr = retrievedChunk({
  chunk_id: "NFKB2_Stim8hr",
  retrieval_mode: "metadata_exact",
  metadata: { target_gene_symbol: "NFKB2", culture_condition: "Stim8hr" },
});
const nfkb2Rest = retrievedChunk({
  chunk_id: "NFKB2_Rest",
  retrieval_mode: "metadata_exact",
  metadata: { target_gene_symbol: "NFKB2", culture_condition: "Rest" },
});
const nfkb2Stim48hr = retrievedChunk({
  chunk_id: "NFKB2_Stim48hr",
  retrieval_mode: "metadata_exact",
  metadata: { target_gene_symbol: "NFKB2", culture_condition: "Stim48hr" },
});

const rankedForClaim = rankChunksForDisplay([nfkb2Rest, nfkb2Stim48hr, nfkb2Stim8hr], "NFKB2", "Stim8hr");
check("the NFKB2/Stim8hr claim's own condition-matched chunk ranks first among same-tier chunks", rankedForClaim[0].chunk_id === "NFKB2_Stim8hr");
check("Rest/Stim48hr chunks are not visually prioritized over the claim's own timepoint", rankedForClaim[0].chunk_id !== "NFKB2_Rest" && rankedForClaim[0].chunk_id !== "NFKB2_Stim48hr");

// Retrieval-mode tier always wins over claim-match — a lower-tier chunk that
// happens to match the claim's gene/condition still ranks below a
// higher-tier chunk that doesn't, since tier reflects retrieval confidence.
const exactWrongCondition = retrievedChunk({
  chunk_id: "exact_wrong_condition",
  retrieval_mode: "metadata_exact",
  metadata: { target_gene_symbol: "NFKB2", culture_condition: "Rest" },
});
const partialRightCondition = retrievedChunk({
  chunk_id: "partial_right_condition",
  retrieval_mode: "metadata_partial",
  metadata: { target_gene_symbol: "NFKB2", culture_condition: "Stim8hr" },
});
const tierRanked = rankChunksForDisplay([partialRightCondition, exactWrongCondition], "NFKB2", "Stim8hr");
check("retrieval_mode tier outranks claim-match preference", tierRanked[0].chunk_id === "exact_wrong_condition");

// No primary/condition supplied (e.g. language_rules_index has no gene) —
// ranking still works and doesn't crash, ordering purely by tier.
const noClaimContext = rankChunksForDisplay([hybrid, exact], undefined, undefined);
check("ranking with no primary gene/condition falls back to pure retrieval_mode ordering", noClaimContext.map((c) => c.chunk_id).join(",") === "exact,hybrid");

// ---------------------------------------------------------------------------
// 3. Multi-gene summary claims: gene-coverage interleaving
// ---------------------------------------------------------------------------

section("3. rankChunksForDisplay interleaves by gene coverage for multi-gene summary claims");

// A "these knockdowns define distinct arms" style summary claim: no single
// primary gene (broad claim, primaryGene undefined), and NFKB2 happens to
// have scored/retrieved multiple timepoints ahead of GATA3/STAT1's single
// chunk each — the exact shape that previously buried GATA3/STAT1 behind
// several NFKB2 timepoints within the same retrieval_mode tier.
const nfkb2Stim8hrChunk = retrievedChunk({ chunk_id: "NFKB2_Stim8hr", retrieval_mode: "metadata_exact", metadata: { target_gene_symbol: "NFKB2", culture_condition: "Stim8hr" } });
const nfkb2RestChunk = retrievedChunk({ chunk_id: "NFKB2_Rest", retrieval_mode: "metadata_exact", metadata: { target_gene_symbol: "NFKB2", culture_condition: "Rest" } });
const gata3Chunk = retrievedChunk({ chunk_id: "GATA3_Stim8hr", retrieval_mode: "metadata_exact", metadata: { target_gene_symbol: "GATA3", culture_condition: "Stim8hr" } });
const stat1Chunk = retrievedChunk({ chunk_id: "STAT1_Stim8hr", retrieval_mode: "metadata_exact", metadata: { target_gene_symbol: "STAT1", culture_condition: "Stim8hr" } });

const multiGeneRanked = rankChunksForDisplay([nfkb2Stim8hrChunk, nfkb2RestChunk, gata3Chunk, stat1Chunk], undefined, undefined);
const top3GeneKeys = multiGeneRanked.slice(0, 3).map((c) => c.metadata.target_gene_symbol);
check("the top 3 displayed chunks cover all three mentioned genes, not two NFKB2 timepoints", new Set(top3GeneKeys).size === 3);
check("NFKB2's second timepoint (Rest) is pushed after the other genes get their first chunk", multiGeneRanked.findIndex((c) => c.chunk_id === "NFKB2_Rest") === 3);
check("gene-coverage interleaving never drops or duplicates a chunk", multiGeneRanked.length === 4 && new Set(multiGeneRanked.map((c) => c.chunk_id)).size === 4);

check("countDistinctGenes counts 3 distinct genes across the multi-gene pool", countDistinctGenes(multiGeneRanked) === 3);
check("countDistinctGenes counts 1 distinct gene for a single-gene claim's chunks", countDistinctGenes([nfkb2Stim8hrChunk, nfkb2RestChunk]) === 1);

// Single-gene case must stay completely unaffected — interleaving across a
// single bucket is a documented no-op, so previous single-gene ordering
// guarantees (e.g. the NFKB2/Stim8hr-first check above) keep holding.
const singleGeneRanked = rankChunksForDisplay([nfkb2Rest, nfkb2Stim48hr, nfkb2Stim8hr], "NFKB2", "Stim8hr");
check("a single-gene claim's chunk order is unaffected by gene-coverage interleaving", singleGeneRanked.map((c) => c.chunk_id).join(",") === rankedForClaim.map((c) => c.chunk_id).join(","));

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passCount} passed, ${failures.length} failed.`);
if (failures.length > 0) {
  console.log("\nFailed checks:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
