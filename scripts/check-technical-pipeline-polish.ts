// Regression checks for this turn's fixes:
//   1. Broad-claim gene constraint no longer depends on the claim being
//      classified with the exact literal claim_type "summary_claim" — any
//      claim with no gene of its own now falls back to the interpretation's
//      own genes (src/lib/agentQueryPlan.ts's resolveGeneConstraint).
//   2. Pathway chunk summaries no longer say "unnamed enriched gene set (N)"
//      when a hit has no resolvable name — they use a clean fallback phrase
//      instead (src/lib/artifactIndexes.ts's summarizeHitGroup /
//      buildPathwayChunkFromPacket).
// Run via `npm run test`. No gold verdicts, no hardcoded claim IDs.

import { extractClaimsMock } from "@/lib/claimExtractionMock";
import { categorizeBiologicalEntitiesMock } from "@/lib/entityCategorizationMock";
import { normalizeCategorizedEntities } from "@/lib/entityNormalization";
import { buildAgentQueryPlansForInterpretation } from "@/lib/agentQueryPlan";
import { buildChunksFromEvidenceBundle } from "@/lib/artifactIndexes";
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

// ---------------------------------------------------------------------------
// 1. Broad-claim gene constraint applies regardless of exact claim_type
// ---------------------------------------------------------------------------

section("1. A broad, gene-less claim is constrained to the interpretation's own genes regardless of its exact claim_type");

// The third sentence deliberately avoids SUMMARY_TRIGGER words ("together",
// "overall", ...) so the mock classifier gives it some OTHER claim_type
// (here, novelty_claim, via "novel") — the fix under test is that the
// gene-constraint fallback no longer requires the literal claim_type
// "summary_claim" to kick in.
const interpretation: InterpretationInput = {
  interpretation_id: "synthetic-broad-nonsummary-interp",
  source_label: "Synthetic broad non-summary-typed claim test",
  full_text:
    "NFKB2 knockdown increases inflammatory signaling in Stim8hr CD4+ T cells. GATA3 knockdown shifts polarization in Rest CD4+ T cells. Across the profiled genes, this pattern represents a novel finding.",
  handoff_project_id: MOCK_HANDOFF_PROJECT.handoff_project_id,
  created_at: new Date().toISOString(),
};

const extraction = extractClaimsMock(interpretation);
const categorization = categorizeBiologicalEntitiesMock(extraction.claims);
const normalization = normalizeCategorizedEntities(extraction.claims, categorization.categorized_claims);
const queryPlanResult = buildAgentQueryPlansForInterpretation(normalization.normalized_claims, categorization.categorized_claims, extraction.claims);

const broadClaim = extraction.claims.find((c) => c.claim_type === "novelty_claim" && /novel/i.test(c.original_text));
check("the synthetic interpretation produces a broad claim classified as novelty_claim (not summary_claim)", broadClaim !== undefined);
check("that broad claim genuinely has no gene of its own", (broadClaim ? normalization.normalized_claims.find((n) => n.claim_id === broadClaim.claim_id)?.genes.length : -1) === 0);

const broadPlan = broadClaim ? queryPlanResult.plans.find((p) => p.claim_id === broadClaim.claim_id) : undefined;
const broadAllowedGenes = (broadPlan?.agent_queries.perturbation_evidence.filters.allowed_gene_symbols as string[] | undefined) ?? [];

check("the non-summary-typed broad claim still gets NFKB2 in its allowed gene set", broadAllowedGenes.includes("NFKB2"));
check("the non-summary-typed broad claim still gets GATA3 in its allowed gene set", broadAllowedGenes.includes("GATA3"));
check("the non-summary-typed broad claim's allowed gene set excludes genes never mentioned (FOXP3)", !broadAllowedGenes.includes("FOXP3"));
check(
  "the non-summary-typed broad claim is gene_constrained (not left fully open)",
  broadPlan?.agent_queries.perturbation_evidence.filters.gene_constrained === true,
);

// ---------------------------------------------------------------------------
// 2. Pathway summary text never says "unnamed enriched gene set"
// ---------------------------------------------------------------------------

section("2. Pathway chunk summaries never say 'unnamed enriched gene set'");

function pathwayPacket(id: string, gene: string, condition: string, pathwayEvidence: Record<string, unknown>) {
  return { evidence_packet_id: id, perturbation_target_gene: gene, culture_condition: condition, pathway_evidence: pathwayEvidence };
}

// A hit record with no name-bearing field at all (pathway_name, signature_name, name, term, gene_set_name all absent) —
// exactly the shape that used to produce "an unnamed enriched gene set (1)".
const namelessBundle = {
  evidence_packets: [
    pathwayPacket("GG_NAMELESS_Stim8hr", "NFKB2", "Stim8hr", {
      external_enrichment_up_top: [{ overlap_genes: ["TNFAIP3", "NFKBIA"], adj_p_value: 0.01 }],
    }),
  ],
};
const namelessChunks = buildChunksFromEvidenceBundle(namelessBundle, "geneground_evidence_bundle_v2.json", "BUNDLE");
const namelessText = namelessChunks.pathway_signature_index?.[0]?.text_for_embedding ?? "";

check("a nameless pathway hit never produces the 'unnamed enriched gene set' phrase", !namelessText.toLowerCase().includes("unnamed enriched gene set"));
check("a nameless pathway hit uses the clean fallback phrase instead", namelessText.includes("shows pathway/signature enrichment among"));
check("the clean fallback phrase points the reader to metadata for details", namelessText.includes("see metadata for enrichment records"));
check("overlap genes are still included even when no pathway name resolves", namelessText.includes("TNFAIP3"));
check("the fallback still includes the standard pathway-vs-mechanism caveat", namelessText.includes("does not establish") === false && namelessText.includes("not direct mechanism"));

// A normally-named hit still gets its real name in the summary (regression:
// the cleanup must not have broken the happy path).
const namedBundle = {
  evidence_packets: [
    pathwayPacket("GG_NAMED_Stim8hr", "NFKB2", "Stim8hr", {
      external_enrichment_up_top: [{ pathway_name: "TNF-alpha signaling via NF-kB", overlap_genes: ["TNFAIP3"], adj_p_value: 0.001 }],
    }),
  ],
};
const namedChunks = buildChunksFromEvidenceBundle(namedBundle, "geneground_evidence_bundle_v2.json", "BUNDLE");
const namedText = namedChunks.pathway_signature_index?.[0]?.text_for_embedding ?? "";
check("a named pathway hit still includes its real pathway name", namedText.includes("TNF-alpha signaling via NF-kB"));
check("a named pathway hit never uses the generic fallback phrase", !namedText.includes("shows pathway/signature enrichment among"));

// A mix of one named and one nameless hit still surfaces the named one
// rather than falling all the way back to the generic phrase.
const mixedBundle = {
  evidence_packets: [
    pathwayPacket("GG_MIXED_Stim8hr", "GATA3", "Stim8hr", {
      external_enrichment_up_top: [{ pathway_name: "Th2-like polarization", overlap_genes: ["IL4"], adj_p_value: 0.02 }],
      external_enrichment_down_top: [{ overlap_genes: ["IFNG"], adj_p_value: 0.03 }],
    }),
  ],
};
const mixedChunks = buildChunksFromEvidenceBundle(mixedBundle, "geneground_evidence_bundle_v2.json", "BUNDLE");
const mixedText = mixedChunks.pathway_signature_index?.[0]?.text_for_embedding ?? "";
check("a mixed named/nameless result still surfaces the named pathway", mixedText.includes("Th2-like polarization"));
check("a mixed named/nameless result never says 'unnamed enriched gene set'", !mixedText.toLowerCase().includes("unnamed"));
check("a mixed named/nameless result still includes the nameless group's overlap genes", mixedText.includes("IFNG"));

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passCount} passed, ${failures.length} failed.`);
if (failures.length > 0) {
  console.log("\nFailed checks:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
