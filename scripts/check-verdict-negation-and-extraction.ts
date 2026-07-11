// Regression checks for this turn's fixes:
//   1. Negated causal/mechanism caveats no longer classify as overstated
//      (src/lib/finalVerdictAggregator.ts).
//   2. Duplicate/contextless pronoun-led claim fragments are dropped or
//      given a referent (src/lib/claimExtractionMock.ts).
//   3. Architecture/network overstated claims get a fixed, accurate reason
//      instead of a generated one that can invent facts.
// Run via `npm run test`. No gold verdicts, no hardcoded claim IDs.

import { chooseFinalVerdict, buildBiologistFriendlyExplanation, ARCHITECTURE_OVERSTATED_REASON } from "@/lib/finalVerdictAggregator";
import { extractClaimsMock } from "@/lib/claimExtractionMock";
import type { AgentResult, AgentType, AgentVerdictLabel, FinalVerdictLabel } from "@/lib/schemas";

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

function agentResult(agentType: AgentType, verdict: AgentVerdictLabel, overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    agent_type: agentType,
    agent_query_id: `q-${agentType}`,
    claim_id: "c-synthetic",
    agent_verdict: verdict,
    confidence: 0.6,
    evidence_chunk_ids: ["chunk-1"],
    supporting_points: [`${agentType} supports the observed effect.`],
    weak_points: [],
    missing_evidence: [],
    risk_flags: [],
    agent_reasoning_summary: `${agentType} reasoning summary.`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Negated causal/mechanism caveat claims are not overstated
// ---------------------------------------------------------------------------

section("1. Negated causal/mechanism caveat is not misclassified as overstated");

const METHODOLOGICAL_CAVEAT_CLAIM =
  "All of these are transcriptional associations from pseudobulk differential expression against non-targeting controls; CRISPRi represses rather than fully knocks out the target, and none of these results establishes a causal mechanism on its own.";

// Mimics what a negation-blind language_causality agent (mock or Claude)
// plausibly returns: it sees the literal word "establishes" and flags it as
// high-severity, regardless of the sentence explicitly denying it.
const negatedCaveatAgents = {
  perturbation_evidence: agentResult("perturbation_evidence", "supports_with_caveats"),
  pathway_signature: agentResult("pathway_signature", "supports_with_caveats"),
  robustness_quality: agentResult("robustness_quality", "supports_with_caveats"),
  language_causality: agentResult("language_causality", "weak_support", { risk_flags: ["high_severity_language:establishes"] }),
};

const negatedCaveatVerdict = chooseFinalVerdict(negatedCaveatAgents, {
  claim_type: "robustness_claim",
  original_claim_text: METHODOLOGICAL_CAVEAT_CLAIM,
});
check(
  "methodological caveat claim resolves to supported_with_caveats, not overstated",
  negatedCaveatVerdict === "supported_with_caveats" || negatedCaveatVerdict === "supported",
);
check("methodological caveat claim is never overstated", negatedCaveatVerdict !== "overstated");
check("methodological caveat claim is never needs_review", negatedCaveatVerdict !== "needs_review");

// Control: the exact same agent signals WITHOUT the negating wording must
// still resolve to overstated — proves the fix is conditional on the
// negation phrasing, not a blanket suppression of the causal-word check.
const unnegatedControlVerdict = chooseFinalVerdict(negatedCaveatAgents, {
  claim_type: "causal_mechanism",
  original_claim_text: "STAT1 knockdown establishes a causal mechanism for inflammatory activation.",
});
check("the same agent signals without negating wording still resolve to overstated", unnegatedControlVerdict === "overstated");

// A claim making a POSITIVE causal/mechanistic assertion alongside cautious
// biology agents should still be caught — negation-awareness must not
// swallow genuine overreach that happens to also contain "on its own".
const positiveAssertionVerdict = chooseFinalVerdict(negatedCaveatAgents, {
  claim_type: "causal_mechanism",
  original_claim_text: "NFKB2 knockdown establishes a causal mechanism for inflammatory activation on its own.",
});
check(
  "a positive causal assertion is still overstated even if it happens to contain 'on its own'",
  positiveAssertionVerdict === "overstated",
);

// ---------------------------------------------------------------------------
// 2. Duplicate/contextless pronoun-led claim extraction
// ---------------------------------------------------------------------------

section("2. Duplicate/contextless pronoun-led claims are dropped or given a referent");

const extraction = extractClaimsMock({
  interpretation_id: "synthetic-extraction-interp",
  source_label: "Synthetic duplicate/contextless extraction test",
  full_text:
    "STAT1 knockdown increases inflammatory signaling in Stim8hr CD4+ T cells, and this pattern is reproducible across two independent donors. This directional pattern is reproducible across donors and guides. It also produced a significant on-target effect size that exceeded threshold in a separate replicate assay.",
  handoff_project_id: "synthetic-project",
  created_at: new Date().toISOString(),
});

check("the duplicate 'This directional pattern is reproducible...' fragment is not extracted as its own claim", extraction.claims.length === 2);
check(
  "no extracted claim is a bare, referent-less pronoun-led fragment",
  !extraction.claims.some((c) => /^(this|these|that|it|they)\b/i.test(c.original_text.trim())),
);
check(
  "the genuinely new 'It also produced...' fragment survives with the referent prepended",
  extraction.claims.some((c) => c.original_text.startsWith("Regarding STAT1,") && c.original_text.includes("on-target effect size")),
);
check(
  "the referent-rewritten claim's raw_entities picks up the prepended gene",
  extraction.claims.some((c) => c.original_text.startsWith("Regarding STAT1,") && c.raw_entities.genes.includes("STAT1")),
);
check(
  "claim IDs stay sequential with no gap left by the dropped duplicate",
  extraction.claims.map((c) => c.claim_id).join(",") === `${extraction.interpretation_id}-c1,${extraction.interpretation_id}-c2`,
);

// Non-pronoun-led multi-sentence extraction is unaffected.
const unaffectedExtraction = extractClaimsMock({
  interpretation_id: "synthetic-unaffected-interp",
  source_label: "Synthetic unaffected extraction test",
  full_text: "STAT1 knockdown suppresses interferon signaling. GATA3 knockdown shifts polarization toward a Th2-like state.",
  handoff_project_id: "synthetic-project",
  created_at: new Date().toISOString(),
});
check("ordinary multi-sentence extraction still produces one claim per sentence", unaffectedExtraction.claims.length === 2);

// ---------------------------------------------------------------------------
// 3. Architecture/network overstated claims get a fixed, accurate reason
// ---------------------------------------------------------------------------

section("3. Architecture/network overstated claims get the fixed accurate reason");

const ARCHITECTURE_CLAIM = "Together, these knockdowns begin to define distinct arms of the CD4+ T cell response.";

function buildPartial(final_verdict: FinalVerdictLabel) {
  return {
    final_verdict,
    supported_parts: ["an invented supporting point that should never appear for the architecture case"],
    caveats: ["an invented caveat that should never appear for the architecture case"],
    missing_evidence: [],
    recommended_action: "soften_wording" as const,
  };
}

const architectureAgentsForReason = {
  perturbation_evidence: agentResult("perturbation_evidence", "supports"),
  pathway_signature: agentResult("pathway_signature", "supports"),
  robustness_quality: agentResult("robustness_quality", "supports_with_caveats"),
  language_causality: agentResult("language_causality", "supports_with_caveats"),
};

const architectureReason = buildBiologistFriendlyExplanation(buildPartial("overstated"), architectureAgentsForReason, ARCHITECTURE_CLAIM);
check("architecture-family overstated claim gets the exact fixed reason", architectureReason === ARCHITECTURE_OVERSTATED_REASON);
check("the fixed reason never mentions an invented gene count", !/only \w+ genes?/i.test(architectureReason));
check("the fixed reason never claims something was not tested", !/not tested|no .* knockdown was tested/i.test(architectureReason));

const nonArchitectureOverstatedReason = buildBiologistFriendlyExplanation(
  buildPartial("overstated"),
  architectureAgentsForReason,
  "STAT1 acts as a master regulator of inflammatory activation.",
);
check(
  "a non-architecture overstated claim (master regulator) does not get the architecture-specific reason",
  nonArchitectureOverstatedReason !== ARCHITECTURE_OVERSTATED_REASON,
);

const supportedReason = buildBiologistFriendlyExplanation(buildPartial("supported"), architectureAgentsForReason, ARCHITECTURE_CLAIM);
check(
  "a claim with architecture wording but a 'supported' verdict does not get the architecture-specific reason",
  supportedReason !== ARCHITECTURE_OVERSTATED_REASON,
);

// ---------------------------------------------------------------------------
// 4. Reason length stays within the concise claim-card budget
// ---------------------------------------------------------------------------

section("4. Reason length stays within the concise claim-card budget");

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

check("the fixed architecture reason is at most ~45 words", wordCount(ARCHITECTURE_OVERSTATED_REASON) <= 45);
check("the fixed architecture reason reads as 1-2 sentences", (ARCHITECTURE_OVERSTATED_REASON.match(/[.!?]/g) ?? []).length <= 2);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passCount} passed, ${failures.length} failed.`);
if (failures.length > 0) {
  console.log("\nFailed checks:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
