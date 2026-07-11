// Regression checks for the geneground_evidence_bundle_v2.json-shaped
// handoff file: it must fan out into real per-packet chunks across four
// evidence indexes plus language_rules_index, never collapse into one giant
// "_record" chunk, and those chunks must actually be retrievable by the
// existing (unmodified) metadata scorer. Run via `npm run test`.

import { buildChunksFromEvidenceBundle, buildArtifactIndexesFromDiscoveryResult, isEvidenceBundleShape } from "@/lib/artifactIndexes";
import { discoverArtifactsFromHandoffImport } from "@/lib/artifactDiscovery";
import { scoreChunkAgainstFilters } from "@/lib/evidenceRetrieval";
import type { EvidenceChunk, HandoffImportFile, HandoffImportResult } from "@/lib/schemas";

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

function packet(id: string, gene: string, ensembl: string, condition: string) {
  return {
    evidence_packet_id: id,
    perturbation_target_gene: gene,
    perturbation_target_ensembl: ensembl,
    culture_condition: condition,
    perturbation_type: "CRISPRi",
    n_cells_target: 1200,
    n_guides: 2,
    ontarget_effect_size: -32.6,
    ontarget_significant: true,
    n_up_genes: 761,
    n_down_genes: 589,
    n_total_de_genes: 1350,
    top_upregulated_genes: ["PLEK", "GLDC", "DMD"],
    top_downregulated_genes: ["RCAN2", "FOXP3", "IL10"],
    confidence_flags: [],
    robustness_context: {
      robustness_score: 0.82,
      donor_evidence: { n_donors: 4 },
      guide_evidence: { n_guides: 2 },
      pseudobulk_support: { n_pass: 8, n_total: 8 },
    },
    pathway_evidence: {
      external_enrichment_up_top: [
        { pathway_name: "Hallmark TNF-alpha signaling via NF-kB", overlap_genes: ["PLEK", "GLDC"], adj_p_value: 0.001 },
      ],
    },
    suggested_safe_claim_templates: [],
    caveats: ["Single timepoint replicate"],
  };
}

const EXPECTED_PACKET_IDS = [
  "GG_DE_ENSG00000077150_Stim8hr",
  "GG_DE_ENSG00000077150_Stim48hr",
  "GG_DE_ENSG00000077150_Rest",
  "GG_DE_ENSG00000107485_Stim8hr",
  "GG_DE_ENSG00000115415_Stim8hr",
  "GG_DE_ENSG00000156127_Stim8hr",
];

const BUNDLE = {
  bundle_name: "geneground_evidence_bundle_v2",
  dataset_name: "CD4+ Perturb-seq live demo",
  source_file: "geneground_evidence_bundle_v2.json",
  evidence_packets: [
    packet("GG_DE_ENSG00000077150_Stim8hr", "NFKB2", "ENSG00000077150", "Stim8hr"),
    packet("GG_DE_ENSG00000077150_Stim48hr", "NFKB2", "ENSG00000077150", "Stim48hr"),
    packet("GG_DE_ENSG00000077150_Rest", "NFKB2", "ENSG00000077150", "Rest"),
    packet("GG_DE_ENSG00000107485_Stim8hr", "GATA3", "ENSG00000107485", "Stim8hr"),
    packet("GG_DE_ENSG00000115415_Stim8hr", "STAT1", "ENSG00000115415", "Stim8hr"),
    packet("GG_DE_ENSG00000156127_Stim8hr", "BATF", "ENSG00000156127", "Stim8hr"),
  ],
  claim_wording_policy: {
    safe_associational_wording: ["is associated with", "is consistent with"],
    avoid_without_stronger_evidence: ["drives", "causes"],
    global_caveats: ["Dataset uses CRISPRi knockdown, single donor cohort."],
  },
  // Evaluation-only fixture data — must never leak into live chunks.
  demo_layer: {
    geneground_demo_claims: [{ claim_id: "should_never_appear" }],
    gold_verdicts: [{ verdict: "should_never_appear" }],
  },
};

// ---------------------------------------------------------------------------
// 1. isEvidenceBundleShape + buildChunksFromEvidenceBundle (function level)
// ---------------------------------------------------------------------------

section("1. Bundle shape detection and per-packet chunk building");

check("isEvidenceBundleShape recognizes the bundle", isEvidenceBundleShape(BUNDLE));
check("isEvidenceBundleShape rejects a plain non-bundle object", !isEvidenceBundleShape({ foo: "bar" }));

const chunksByIndex = buildChunksFromEvidenceBundle(BUNDLE, "geneground_evidence_bundle_v2.json", "GENEGROUND_EVIDENCE_BUNDLE_V2");
const allChunks: EvidenceChunk[] = Object.values(chunksByIndex).flatMap((c) => c ?? []);

check("perturbation_evidence_index has one chunk per packet", chunksByIndex.perturbation_evidence_index?.length === EXPECTED_PACKET_IDS.length);
check("pathway_signature_index has one chunk per packet with pathway evidence", chunksByIndex.pathway_signature_index?.length === EXPECTED_PACKET_IDS.length);
check("robustness_quality_index has one chunk per packet", chunksByIndex.robustness_quality_index?.length === EXPECTED_PACKET_IDS.length);
check("provenance_index has one chunk per packet", chunksByIndex.provenance_index?.length === EXPECTED_PACKET_IDS.length);
check("language_rules_index has the 5 fixed policy chunks", chunksByIndex.language_rules_index?.length === 5);

check(
  "no chunk is a giant generic 'record' chunk",
  !allChunks.some((c) => c.chunk_id.toLowerCase().includes("record") || c.chunk_id.toLowerCase().includes("bundle_v2")),
);
check("bundle.demo_layer never leaks into any chunk", !allChunks.some((c) => JSON.stringify(c).includes("should_never_appear")));

for (const packetId of EXPECTED_PACKET_IDS) {
  check(`perturbation chunk_id follows \${evidence_packet_id}__perturbation for ${packetId}`, chunksByIndex.perturbation_evidence_index?.some((c) => c.chunk_id === `${packetId}__perturbation`) ?? false);
  check(`robustness chunk_id follows \${evidence_packet_id}__robustness for ${packetId}`, chunksByIndex.robustness_quality_index?.some((c) => c.chunk_id === `${packetId}__robustness`) ?? false);
}

const langRuleIds = (chunksByIndex.language_rules_index ?? []).map((c) => c.chunk_id);
for (const expectedId of [
  "LANG_SAFE_ASSOCIATIONAL_WORDING",
  "LANG_AVOID_CAUSAL_WORDING",
  "LANG_CRISPRI_NOT_KNOCKOUT",
  "LANG_PATHWAY_SIGNATURE_NOT_MECHANISM",
  "LANG_THERAPEUTIC_TARGET_REQUIRES_EXTRA_EVIDENCE",
]) {
  check(`language_rules_index includes ${expectedId}`, langRuleIds.includes(expectedId));
}

// ---------------------------------------------------------------------------
// 2. Chunk metadata uses the field names the (unmodified) retrieval scorer expects
// ---------------------------------------------------------------------------

section("2. Chunk metadata matches the retrieval scorer's expected field names");

const nfkb2Stim8hrPerturbation = chunksByIndex.perturbation_evidence_index?.find((c) => c.chunk_id === "GG_DE_ENSG00000077150_Stim8hr__perturbation");
check("NFKB2/Stim8hr perturbation chunk exists", nfkb2Stim8hrPerturbation !== undefined);

if (nfkb2Stim8hrPerturbation) {
  const { score, reasons } = scoreChunkAgainstFilters(nfkb2Stim8hrPerturbation, { target_gene_symbol: "NFKB2", conditions: ["Stim8hr"] });
  check("scoreChunkAgainstFilters matches target_gene_symbol", reasons.some((r) => r.startsWith("Matched target_gene_symbol")));
  check("scoreChunkAgainstFilters matches condition", reasons.some((r) => r.startsWith("Matched condition")));
  check("scoreChunkAgainstFilters score clears the metadata_exact baseline", score > 10);
}

const nfkb2Stim8hrPathway = chunksByIndex.pathway_signature_index?.find((c) => c.chunk_id === "GG_DE_ENSG00000077150_Stim8hr__pathway");
check("NFKB2/Stim8hr pathway chunk carries a pathway_name in metadata", typeof nfkb2Stim8hrPathway?.metadata.pathway_name === "string");

// ---------------------------------------------------------------------------
// 3. Full pipeline: Artifact Discovery -> buildArtifactIndexesFromDiscoveryResult
//    fans the bundle out to all 5 indexes even though Discovery's keyword
//    classifier only ever assigns the file to one index.
// ---------------------------------------------------------------------------

section("3. Full discovery -> index pipeline fans one file out to five indexes");

const importFile: HandoffImportFile = {
  file_name: "geneground_evidence_bundle_v2.json",
  file_path: "geneground_evidence_bundle_v2.json",
  file_extension: ".json",
  size_bytes: 50_000,
  accepted: true,
  ignored: false,
  parsed_kind: "json",
  // Mirrors what handoffImport.ts's buildJsonPreview actually produces for a
  // real parsed file (first ~600 chars of the stringified JSON) — Artifact
  // Discovery's keyword classifier reads file_name + content_preview, so an
  // accurate preview is needed for this test to reflect real behavior.
  content_preview: JSON.stringify(BUNDLE).slice(0, 600),
  parsed_content: BUNDLE,
};

const importResult: HandoffImportResult = {
  project_id: "test-project",
  created_at: new Date().toISOString(),
  total_files_seen: 1,
  accepted_files_count: 1,
  ignored_files_count: 0,
  files: [importFile],
  warnings: [],
};

const discovery = discoverArtifactsFromHandoffImport(importResult);
const manifestEntry = discovery.artifact_manifest.find((e) => e.file_name === "geneground_evidence_bundle_v2.json");
check("Artifact Discovery classifies the bundle file (into at least one index)", (manifestEntry?.use_for_indexes.length ?? 0) >= 1);

const artifactIndexes = buildArtifactIndexesFromDiscoveryResult(discovery, importResult);
check(
  "perturbation_evidence_index ends up with real per-packet chunks despite Discovery's single-index assignment",
  artifactIndexes.indexes.perturbation_evidence_index.chunks.length === EXPECTED_PACKET_IDS.length,
);
check("pathway_signature_index is also populated", artifactIndexes.indexes.pathway_signature_index.chunks.length === EXPECTED_PACKET_IDS.length);
check("robustness_quality_index is also populated", artifactIndexes.indexes.robustness_quality_index.chunks.length === EXPECTED_PACKET_IDS.length);
check("provenance_index is also populated", artifactIndexes.indexes.provenance_index.chunks.length === EXPECTED_PACKET_IDS.length);
check("language_rules_index is also populated", artifactIndexes.indexes.language_rules_index.chunks.length === 5);
check(
  "no index anywhere contains a giant generic record chunk",
  Object.values(artifactIndexes.indexes).every((idx) => !idx.chunks.some((c) => c.chunk_id.toLowerCase().includes("record"))),
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
