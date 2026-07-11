// Regression checks for this turn's claim-card polish fixes:
//   1. claimNeedsRewrite skips methodological caveat claims — covered in
//      scripts/check-claim-reasoning-and-rewrite.ts (section 2).
//   2. Exploratory/low-support rationale language (buildBiologistFriendlyExplanation).
//   3. Interferon-arm caveat correction (buildBiologistFriendlyExplanation).
//   4. Verdicts unaffected: NFKB2 regulatory-role claim stays
//      partially_supported, "define distinct arms" stays overstated.
// Run via `npm run test`. No gold verdicts, no hardcoded claim IDs.

import { buildBiologistFriendlyExplanation, chooseFinalVerdict, ARCHITECTURE_OVERSTATED_REASON } from "@/lib/finalVerdictAggregator";
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

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

function agentResult(agentType: AgentType, verdict: AgentVerdictLabel, overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    agent_type: agentType,
    agent_query_id: `q-${agentType}`,
    claim_id: "c-synthetic",
    agent_verdict: verdict,
    confidence: 0.6,
    evidence_chunk_ids: ["chunk-1"],
    supporting_points: [],
    weak_points: [],
    missing_evidence: [],
    risk_flags: [],
    agent_reasoning_summary: `${agentType} reasoning summary.`,
    ...overrides,
  };
}

function buildPartial(
  final_verdict: FinalVerdictLabel,
  overrides: { supported_parts?: string[]; caveats?: string[]; missing_evidence?: string[] } = {},
) {
  return {
    final_verdict,
    supported_parts: overrides.supported_parts ?? ["a strong perturbation effect"],
    caveats: overrides.caveats ?? [],
    missing_evidence: overrides.missing_evidence ?? [],
    recommended_action: "add_caveat" as const,
  };
}

const NEUTRAL_AGENTS = {
  perturbation_evidence: agentResult("perturbation_evidence", "supports"),
  pathway_signature: agentResult("pathway_signature", "supports"),
  robustness_quality: agentResult("robustness_quality", "supports"),
  language_causality: agentResult("language_causality", "supports"),
};

// ---------------------------------------------------------------------------
// 2. Exploratory/low-support rationale language
// ---------------------------------------------------------------------------

section("2. Exploratory/low-support claims get accurate, non-alarming rationale");

const batfPartial = buildPartial("partially_supported", {
  supported_parts: [],
  caveats: ["Low donor support (1 donor) and a single guide reduce confidence in this evidence, independent of the underlying biology."],
});
const batfReason = buildBiologistFriendlyExplanation(batfPartial, NEUTRAL_AGENTS, "BATF knockdown may shift Th2-like polarization.");

check("a low-support claim's reason names the claim's own gene (BATF)", batfReason.includes("BATF"));
check("a low-support claim's reason calls it appropriately exploratory", /exploratory/i.test(batfReason));
check(
  "a low-support claim's reason does not use the generic 'does not clearly support this claim as worded' phrasing",
  !batfReason.includes("does not clearly support this claim as worded"),
);
check("the exploratory reason stays within the ~45 word claim-card budget", wordCount(batfReason) <= 45);

// A claim with zero supported_parts but NO low-support signal should still
// fall back to the original generic sentence — the override is specific to
// genuinely low-powered evidence, not every empty-supported_parts case.
const noSignalPartial = buildPartial("partially_supported", { supported_parts: [], caveats: ["Condition is ambiguous across two timepoints."] });
const noSignalReason = buildBiologistFriendlyExplanation(noSignalPartial, NEUTRAL_AGENTS, "GATA3 knockdown shifts polarization.");
check(
  "a claim with no supported_parts but no low-support signal keeps the original generic sentence",
  noSignalReason.includes("does not clearly support this claim as worded"),
);

// ---------------------------------------------------------------------------
// 3. Interferon-arm caveat correction
// ---------------------------------------------------------------------------

section("3. Interferon-arm caveat is corrected when a known interferon gene is present");

const stat1Partial = buildPartial("partially_supported", {
  supported_parts: ["STAT1 knockdown reducing interferon-stimulated gene expression"],
  caveats: ["No perturbation chunk directly targets an interferon-pathway gene beyond the signature-level association."],
});
const stat1Reason = buildBiologistFriendlyExplanation(stat1Partial, NEUTRAL_AGENTS, "STAT1 knockdown suppresses interferon signaling.");

check("the interferon-arm reason names STAT1", stat1Reason.includes("STAT1"));
check(
  "the interferon-arm reason never claims no interferon-pathway gene was targeted",
  !/no[^.]*(perturbation (chunk|evidence)|evidence|knockdown)[^.]*(directly target|target|tested|assayed)[^.]*interferon/i.test(stat1Reason),
);
check("the interferon-arm reason states the accurate 'fully defined response arm' caveat", stat1Reason.includes("fully defined response arm"));
check("the interferon-arm reason stays within the ~45 word claim-card budget", wordCount(stat1Reason) <= 45);

// The same false caveat with NO interferon-response gene present must not
// be rewritten — the correction is specifically about STAT1/STAT2/IRF1/
// MX1/OAS1-type genes, not a blanket suppression of this caveat text.
const noGenePartial = buildPartial("partially_supported", {
  supported_parts: [],
  caveats: ["No perturbation chunk directly targets an interferon-pathway gene beyond the signature-level association."],
});
const noGeneReason = buildBiologistFriendlyExplanation(noGenePartial, NEUTRAL_AGENTS, "This claim mentions interferon signaling generally.");
check(
  "the same false caveat is left untouched when no known interferon-response gene is present",
  noGeneReason.toLowerCase().includes("no perturbation chunk directly targets an interferon-pathway gene"),
);

// ---------------------------------------------------------------------------
// 4. Verdicts unaffected by this turn's changes
// ---------------------------------------------------------------------------

section("4. NFKB2 regulatory-role and 'define distinct arms' verdicts are unchanged");

const regulatoryRoleAgents = {
  perturbation_evidence: agentResult("perturbation_evidence", "supports"),
  pathway_signature: agentResult("pathway_signature", "supports_with_caveats"),
  robustness_quality: agentResult("robustness_quality", "supports_with_caveats"),
  language_causality: agentResult("language_causality", "supports_with_caveats", { risk_flags: [] }),
};
const regulatoryRoleVerdict = chooseFinalVerdict(regulatoryRoleAgents, {
  claim_type: "regulatory_role",
  original_claim_text: "This reproducible upregulation points to a regulatory role for NFKB2 in restraining the inflammatory program.",
});
check("the NFKB2 regulatory-role claim remains partially_supported", regulatoryRoleVerdict === "partially_supported");

const architectureAgents = {
  perturbation_evidence: agentResult("perturbation_evidence", "supports"),
  pathway_signature: agentResult("pathway_signature", "supports"),
  robustness_quality: agentResult("robustness_quality", "supports_with_caveats"),
  language_causality: agentResult("language_causality", "supports_with_caveats", { risk_flags: [] }),
};
const architectureClaimText = "Together, these knockdowns begin to define distinct arms of the CD4+ T cell response.";
const architectureVerdict = chooseFinalVerdict(architectureAgents, { claim_type: "summary_claim", original_claim_text: architectureClaimText });
check("the 'define distinct arms' claim remains overstated", architectureVerdict === "overstated");

const architectureReason = buildBiologistFriendlyExplanation(buildPartial("overstated"), architectureAgents, architectureClaimText);
check("the 'define distinct arms' claim still gets the fixed accurate architecture reason", architectureReason === ARCHITECTURE_OVERSTATED_REASON);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passCount} passed, ${failures.length} failed.`);
if (failures.length > 0) {
  console.log("\nFailed checks:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
