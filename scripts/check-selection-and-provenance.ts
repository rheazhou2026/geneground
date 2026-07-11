// Regression checks for this turn's fixes:
//   1. Partial text selection: a drag-selected phrase must produce a
//      selection context carrying exactly that phrase, never the whole
//      claim, while a whole-claim click still produces the whole claim.
//      (src/lib/interactiveReviewMock.ts — createSelectionContext,
//      buildInterpretationClaimMap; src/components/EvidenceLinkedReviewEditor.tsx's
//      handleSegmentClick already prioritizes a live browser selection over
//      the click target, verified here by exercising the same pure functions
//      it calls, since this repo has no DOM/browser test harness.)
//   4. Provenance display: chunk provenance now distinguishes the original
//      upstream file from the processed bundle file GeneGround actually read
//      (src/lib/artifactIndexes.ts, src/lib/chunkDisplay.ts).
// Run via `npm run test`. No gold verdicts, no hardcoded claim IDs.

import { buildInterpretationClaimMap, createSelectionContext } from "@/lib/interactiveReviewMock";
import { buildChunksFromEvidenceBundle } from "@/lib/artifactIndexes";
import { chunkProvenanceLines } from "@/lib/chunkDisplay";
import type { ExtractedClaim } from "@/lib/schemas";

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
// 1. Partial text selection vs. whole-claim click
// ---------------------------------------------------------------------------

section("1. Drag-selecting a phrase never widens to the whole claim");

const CLAIM_TEXT = "This reproducible upregulation points to a regulatory role for NFKB2 in restraining the inflammatory program.";
const INTERPRETATION_ID = "synthetic-selection-interp";

const claim: ExtractedClaim = {
  claim_id: `${INTERPRETATION_ID}-c1`,
  interpretation_id: INTERPRETATION_ID,
  sentence_id: `${INTERPRETATION_ID}-s1`,
  original_text: CLAIM_TEXT,
  claim_type: "regulatory_role",
  raw_entities: { genes: ["NFKB2"], pathways: [], cell_context: [], conditions: [], direction: [] },
  language_flags: { strength_words: [], causal_words: [] },
};

const claimMap = buildInterpretationClaimMap(CLAIM_TEXT, [claim]);
const claimRef = claimMap.claims[0];
check("the claim map resolves a real span for the synthetic claim", claimRef?.span_start !== undefined && claimRef?.span_end !== undefined);

// Simulates dragging over "regulatory role" inside the rendered claim —
// exactly what EvidenceLinkedReviewEditor.openReviewForBrowserSelection
// computes from the real DOM selection (closestSegIndex -> segment spans),
// just without a browser to drive it from.
const dragPhrase = "regulatory role";
const dragStart = CLAIM_TEXT.indexOf(dragPhrase);
const dragEnd = dragStart + dragPhrase.length;
const dragContext = createSelectionContext(dragPhrase, dragStart, dragEnd, claimMap);

check("drag-selecting 'regulatory role' yields selected_text exactly 'regulatory role'", dragContext.selected_text === "regulatory role");
check("drag-selection is not widened to the whole claim text", dragContext.selected_text !== CLAIM_TEXT);
check("drag-selection scope is not 'full_claim'", dragContext.selection_scope !== "full_claim");
check("drag-selection still links back to the overlapping claim_id", dragContext.matched_claim_ids.includes(claim.claim_id));

// Simulates clicking the whole highlighted claim segment (no active browser
// selection) — EvidenceLinkedReviewEditor.openReviewForClaim uses the
// claim's own original_text (or rewritten display text) and full span.
const wholeClaimContext = createSelectionContext(claim.original_text, claimRef.span_start ?? null, claimRef.span_end ?? null, claimMap);

check("clicking the whole claim yields selected_text equal to the whole claim", wholeClaimContext.selected_text === CLAIM_TEXT);
// This synthetic claim is exactly one sentence, so "the whole claim" and
// "the whole sentence" are the identical string — inferSelectionScope checks
// sentence-match before claim-match, so "sentence" (not "full_claim") is the
// correct, more specific label here. Either way, what matters is that it's
// resolved as "the whole thing", not a fragment (word_or_phrase/partial_claim).
check(
  "whole-claim click scope reflects a complete selection, not a fragment",
  wholeClaimContext.selection_scope === "full_claim" || wholeClaimContext.selection_scope === "sentence",
);
check("whole-claim click still links to the same claim_id", wholeClaimContext.matched_claim_ids.includes(claim.claim_id));

// A selection is never silently dropped/emptied by resolving to the claim
// map — the exact dragged substring survives byte-for-byte.
check("the drag-selected phrase is never replaced by any other text", dragContext.selected_text.length === dragPhrase.length);

// A two-claim sentence (the maybeSplitTherapeutic shape) distinguishes
// "sentence" from "full_claim" cleanly, since a single claim is now
// narrower than its sentence — this is the case that actually exercises
// selection_scope === "full_claim".
const MULTI_CLAIM_SENTENCE_TEXT =
  "STAT1 knockdown suppresses interferon signaling, raising the possibility of a therapeutic target for immune modulation.";
const firstFragment = "STAT1 knockdown suppresses interferon signaling";
const secondFragment = "Raising the possibility of a therapeutic target for immune modulation.";
const multiClaims: ExtractedClaim[] = [
  {
    claim_id: "synthetic-multi-c1",
    interpretation_id: "synthetic-multi",
    sentence_id: "synthetic-multi-s1",
    original_text: firstFragment,
    claim_type: "gene_expression_effect",
    raw_entities: { genes: ["STAT1"], pathways: [], cell_context: [], conditions: [], direction: [] },
    language_flags: { strength_words: [], causal_words: [] },
  },
  {
    claim_id: "synthetic-multi-c2",
    interpretation_id: "synthetic-multi",
    sentence_id: "synthetic-multi-s1",
    original_text: secondFragment,
    claim_type: "therapeutic_relevance",
    raw_entities: { genes: [], pathways: [], cell_context: [], conditions: [], direction: [] },
    language_flags: { strength_words: [], causal_words: [] },
  },
];
const multiClaimMap = buildInterpretationClaimMap(MULTI_CLAIM_SENTENCE_TEXT, multiClaims);
const firstClaimRef = multiClaimMap.claims.find((c) => c.claim_id === "synthetic-multi-c1");
const firstClaimContext = createSelectionContext(firstFragment, firstClaimRef?.span_start ?? null, firstClaimRef?.span_end ?? null, multiClaimMap);
check(
  "clicking one claim out of a two-claim sentence resolves scope to 'full_claim', not 'sentence'",
  firstClaimContext.selection_scope === "full_claim",
);
check("that click only links to its own claim, not the sentence's other claim", !firstClaimContext.matched_claim_ids.includes("synthetic-multi-c2"));

// ---------------------------------------------------------------------------
// 4. Provenance display is index-type-aware, not one generic line for every chunk
// ---------------------------------------------------------------------------

section("4. Chunk provenance is index-type-aware, not identical across every chunk");

const packet = {
  evidence_packet_id: "GG_DE_ENSG00000077150_Stim8hr",
  perturbation_target_gene: "NFKB2",
  perturbation_target_ensembl: "ENSG00000077150",
  culture_condition: "Stim8hr",
  source_file: "GWCD4i.DE_stats.h5ad",
  dataset_name: "Primary Human CD4+ T Cell Perturb-seq",
  n_total_de_genes: 700,
  n_up_genes: 400,
  n_down_genes: 300,
  ontarget_effect_size: -20,
  ontarget_significant: true,
  robustness_context: { robustness_score: 0.8, donor_evidence: { n_donors: 4 }, guide_evidence: { n_guides: 2 } },
  pathway_evidence: { external_enrichment_up_top: [{ pathway_name: "NF-kB signaling", overlap_genes: ["NFKB2"], adj_p_value: 0.01 }] },
};

// A second packet whose pathway evidence includes a *local* signature hit —
// exercises the "Also uses local_signature_sets.json" tertiary line, which
// only applies when this specific chunk actually used a local signature.
const localSignaturePacket = {
  evidence_packet_id: "GG_DE_ENSG00000107485_Stim8hr",
  perturbation_target_gene: "GATA3",
  culture_condition: "Stim8hr",
  source_file: "GWCD4i.DE_stats.h5ad",
  pathway_evidence: { local_signature_enrichment: [{ signature_name: "Th2-like polarization", overlap_genes: ["GATA3", "IL4"], adj_p_value: 0.02 }] },
};

const bundle = {
  bundle_name: "geneground_evidence_bundle_v2",
  dataset_name: "Primary Human CD4+ T Cell Perturb-seq",
  provenance: {
    gene_level_de_evidence: "GWCD4i.DE_stats.h5ad",
    robustness_packets: "perturbation_evidence_packets_with_robustness.json",
    pathway_enrichment_results: "pathway_enrichment_results.csv",
    local_signature_sets: "local_signature_sets.json",
    external_enrichment_api: "MSigDB Hallmark, GO Biological Process, Reactome, MSigDB Immune Signatures C7",
  },
  claim_wording_policy: {},
  evidence_packets: [packet, localSignaturePacket],
};
const chunksByIndex = buildChunksFromEvidenceBundle(bundle, "geneground_evidence_bundle_v2.json", "GENEGROUND_EVIDENCE_BUNDLE_V2");

const perturbationChunk = chunksByIndex.perturbation_evidence_index?.[0];
const pathwayChunk = chunksByIndex.pathway_signature_index?.find((c) => c.chunk_id.includes("ENSG00000077150"));
const localSignatureChunk = chunksByIndex.pathway_signature_index?.find((c) => c.chunk_id.includes("ENSG00000107485"));
const robustnessChunk = chunksByIndex.robustness_quality_index?.[0];

const perturbationLines = perturbationChunk ? chunkProvenanceLines(perturbationChunk) : undefined;
const pathwayLines = pathwayChunk ? chunkProvenanceLines(pathwayChunk) : undefined;
const localSignatureLines = localSignatureChunk ? chunkProvenanceLines(localSignatureChunk) : undefined;
const robustnessLines = robustnessChunk ? chunkProvenanceLines(robustnessChunk) : undefined;
const languageLines = chunkProvenanceLines({
  metadata: {},
  source_file_name: "geneground_evidence_bundle_v2.json",
  index_type: "language_rules_index",
});
const provenanceLines = chunkProvenanceLines({
  metadata: { dataset_name: "Primary Human CD4+ T Cell Perturb-seq", original_source_file: "GWCD4i.DE_stats.h5ad" },
  source_file_name: "geneground_evidence_bundle_v2.json",
  index_type: "provenance_index",
});

check("perturbation primary line names differential expression evidence and the original file", perturbationLines?.primary === "Differential expression evidence · GWCD4i.DE_stats.h5ad");
check("perturbation secondary line credits the processed bundle", perturbationLines?.secondary === "Packaged in GeneGround Evidence Bundle v2");

check("pathway primary line names pathway/signature evidence and the enrichment results file", pathwayLines?.primary === "Pathway/signature evidence · pathway_enrichment_results.csv");
check("pathway secondary line names the underlying DE source, not just the enrichment API", pathwayLines?.secondary === "Underlying DE source: GWCD4i.DE_stats.h5ad");
check("a pathway chunk with no local signature hit has no tertiary 'also uses' line", pathwayLines?.tertiary === undefined);
check("a pathway chunk that DOES use a local signature gets the 'Also uses local_signature_sets.json' line", localSignatureLines?.tertiary === "Also uses local_signature_sets.json");

check("robustness primary line names robustness/QC evidence and the robustness packets file", robustnessLines?.primary === "Robustness/QC evidence · perturbation_evidence_packets_with_robustness.json");
check("robustness secondary line names the underlying DE source", robustnessLines?.secondary === "Underlying DE source: GWCD4i.DE_stats.h5ad");

check("language-rules primary line names the claim wording policy", languageLines.primary === "Claim wording policy · GeneGround Evidence Bundle v2");
check("language-rules secondary line explains what it's used for", languageLines.secondary === "Checks causal, mechanistic, knockout, and therapeutic wording");

check("provenance-index primary line names the dataset", provenanceLines.primary === "Dataset provenance · Primary Human CD4+ T Cell Perturb-seq");
check("provenance-index secondary line names the original source", provenanceLines.secondary === "Original source: GWCD4i.DE_stats.h5ad");

// Perturbation, pathway, and robustness cards must not collapse to the same
// primary line just because they share one processed bundle file — this is
// the exact "every chunk looks identical" bug being fixed.
const primaryLines = [perturbationLines?.primary, pathwayLines?.primary, robustnessLines?.primary, languageLines.primary, provenanceLines.primary];
check("perturbation/pathway/robustness/language/provenance cards all render distinct primary lines", new Set(primaryLines).size === primaryLines.length);

// A chunk with none of the specific provenance fields on record (e.g. a
// real handoff bundle that doesn't populate the optional provenance.*
// manifest) still keeps its layer-specific primary prefix rather than
// collapsing to the fully generic "Claude Science evidence packet" line —
// that collapse is exactly what made every biological chunk look identical.
// Only a genuinely unrecognized index_type falls back to the generic line.
const noProvenanceChunk = { metadata: {}, source_file_name: "geneground_evidence_bundle_v2.json", index_type: "perturbation_evidence_index" as const };
const fallbackLines = chunkProvenanceLines(noProvenanceChunk);
check("a chunk with no specific provenance on record still keeps its layer-specific prefix, not the generic fallback", fallbackLines.primary === "Differential expression evidence · GeneGround Evidence Bundle v2");
check("the fallback line never contains the literal string 'undefined'", !fallbackLines.primary.includes("undefined"));

const unrecognizedIndexChunk = { metadata: {}, source_file_name: "geneground_evidence_bundle_v2.json", index_type: "demo_examples_index" as const };
const unrecognizedFallbackLines = chunkProvenanceLines(unrecognizedIndexChunk);
check(
  "a genuinely unrecognized index_type still falls back to the generic evidence-packet line",
  unrecognizedFallbackLines.primary === "Claude Science evidence packet · GeneGround Evidence Bundle v2",
);

// The mock built-in demo handoff's own distinct per-index file names (no
// bundle.provenance manifest at all) still produce a specific, non-generic
// primary line rather than collapsing to the fallback.
const mockPathwayChunk = { metadata: {}, source_file_name: "pathway_enrichment_packets.json", index_type: "pathway_signature_index" as const };
const mockPathwayLines = chunkProvenanceLines(mockPathwayChunk);
check(
  "the mock built-in handoff's own distinct file name still produces a specific (non-fallback) pathway line",
  mockPathwayLines.primary === "Pathway/signature evidence · pathway_enrichment_packets.json",
);

check("the perturbation chunk still carries the original upstream source file in metadata", perturbationChunk?.metadata.original_source_file === "GWCD4i.DE_stats.h5ad");
check("the perturbation chunk still carries the dataset name in metadata", perturbationChunk?.metadata.dataset_name === "Primary Human CD4+ T Cell Perturb-seq");
check("the pathway chunk also carries the original upstream source file (not just perturbation)", pathwayChunk?.metadata.original_source_file === "GWCD4i.DE_stats.h5ad");
check("the robustness chunk also carries the original upstream source file", robustnessChunk?.metadata.original_source_file === "GWCD4i.DE_stats.h5ad");

// bundle.provenance.gene_level_de_evidence alone (no packet- or bundle-level
// source_file/bundle_name at all — bundle_name is itself an OR-fallback for
// "original source file", so it must be absent here too or it would shadow
// the provenance.gene_level_de_evidence path this specifically tests) is
// still enough to resolve the original source file.
const provenanceOnlyBundle = {
  provenance: { gene_level_de_evidence: "GWCD4i.DE_stats.h5ad" },
  evidence_packets: [{ evidence_packet_id: "GG_DE_ENSG00000115415_Stim8hr", perturbation_target_gene: "STAT1", culture_condition: "Stim8hr" }],
};
const provenanceOnlyChunks = buildChunksFromEvidenceBundle(provenanceOnlyBundle, "geneground_evidence_bundle_v2.json", "GENEGROUND_EVIDENCE_BUNDLE_V2");
check(
  "bundle.provenance.gene_level_de_evidence alone resolves the original source file with no packet/bundle source_file",
  provenanceOnlyChunks.perturbation_evidence_index?.[0]?.metadata.original_source_file === "GWCD4i.DE_stats.h5ad",
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
