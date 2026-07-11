// Regression checks for this turn's final-verdict-aggregation sharpening
// (chooseFinalVerdict's new ClaimVerdictContext parameter, the
// OVERSTATED_TEXT_TRIGGERS / PARTIALLY_SUPPORTED_TEXT_TRIGGERS backstops, and
// the rewrite entity-hallucination guard in
// src/app/api/claude/final-rewrite/route.ts). Run via `npm run test`.
//
// The two synthetic claims below are modeled on the two intentional subtle
// overstatements in the live-demo interpretation (regulatory-role inference
// from an upregulation signal, and a "define distinct arms" architecture
// claim from several independent knockdowns) — not copied from any gold
// fixture, and no claim_id or expected_verdict is read from a fixture file.
// This only proves the deterministic aggregation logic classifies this kind
// of wording correctly; it is not a substitute for running the real live-demo
// handoff through the app.

import { chooseFinalVerdict, aggregateFinalVerdictsForInterpretation } from "@/lib/finalVerdictAggregator";
import type { AgentResult, AgentType, AgentVerdictLabel, ClaimAgentResults } from "@/lib/schemas";

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
    confidence: 0.75,
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
// 1. "regulatory role ... restraining" wording -> partially_supported
// ---------------------------------------------------------------------------

section("1. Regulatory-role inference language escalates to partially_supported");

// Modeled after: "This reproducible upregulation points to a regulatory role
// for NFKB2 in restraining the inflammatory program." Every agent judges this
// as clean supports_with_caveats at the agent level (language_causality's own
// taxonomy-word risk_flags don't fire on "regulatory role" / "restraining" —
// that's the exact gap this fix closes), so before this fix the claim
// resolved to supported_with_caveats. The claim_type (regulatory_role) plus
// the text-pattern backstop should now push it to partially_supported.
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
check("regulatory-role 'restraining' wording resolves to partially_supported, not supported_with_caveats", regulatoryRoleVerdict === "partially_supported");

// Sanity: the same agent verdicts on plainly cautious wording (no inference
// language, non-inference-prone claim_type) should NOT be escalated — the
// text-pattern check must be additive, not a blanket downgrade.
const cautiousVerdict = chooseFinalVerdict(regulatoryRoleAgents, {
  claim_type: "gene_expression_effect",
  original_claim_text: "NFKB2 expression is significantly upregulated in this condition, consistent with a perturbation-linked transcriptional response.",
});
check("cautious wording with the same agent verdicts is not escalated by the new backstop", cautiousVerdict === "supported_with_caveats");

// ---------------------------------------------------------------------------
// 2. "define distinct arms" architecture wording -> overstated
// ---------------------------------------------------------------------------

section("2. Architecture/hierarchy language escalates to overstated");

// Modeled after: "Together, these knockdowns begin to define distinct arms of
// the CD4+ T cell response." Same setup: clean agent-level verdicts, no
// language_causality risk_flags fired (the phrase isn't a single taxonomy
// word), so this used to fall through to supported_with_caveats.
const architectureAgents = {
  perturbation_evidence: agentResult("perturbation_evidence", "supports"),
  pathway_signature: agentResult("pathway_signature", "supports"),
  robustness_quality: agentResult("robustness_quality", "supports_with_caveats"),
  language_causality: agentResult("language_causality", "supports_with_caveats", { risk_flags: [] }),
};

const architectureVerdict = chooseFinalVerdict(architectureAgents, {
  claim_type: "summary_claim",
  original_claim_text: "Together, these knockdowns begin to define distinct arms of the CD4+ T cell response.",
});
check("'define distinct arms' architecture wording resolves to overstated", architectureVerdict === "overstated");

// ---------------------------------------------------------------------------
// 3. A realistic mixed interpretation is not flattened to all
//    supported_with_caveats
// ---------------------------------------------------------------------------

section("3. A mixed set of claims does not collapse to a single verdict bucket");

function claimAgentResults(id: string, claim_type: string, original_claim_text: string, agents: ClaimAgentResults["agent_results"]): ClaimAgentResults {
  return {
    claim_id: id,
    interpretation_id: "synthetic-interp",
    sentence_id: `${id}-s1`,
    original_claim_text,
    claim_type,
    agent_results: agents,
  };
}

const mixedClaims: ClaimAgentResults[] = [
  claimAgentResults("s1", "gene_expression_effect", "NFKB2 expression is significantly upregulated in this condition.", {
    perturbation_evidence: agentResult("perturbation_evidence", "supports"),
    pathway_signature: agentResult("pathway_signature", "supports"),
    robustness_quality: agentResult("robustness_quality", "supports"),
    language_causality: agentResult("language_causality", "supports"),
  }),
  claimAgentResults("s2", "cell_state_effect", "GATA3 knockdown is associated with a shift away from a Th2-like state.", {
    perturbation_evidence: agentResult("perturbation_evidence", "supports"),
    pathway_signature: agentResult("pathway_signature", "supports_with_caveats"),
    robustness_quality: agentResult("robustness_quality", "supports_with_caveats"),
    language_causality: agentResult("language_causality", "supports"),
  }),
  claimAgentResults(
    "s3",
    "regulatory_role",
    "This reproducible upregulation points to a regulatory role for NFKB2 in restraining the inflammatory program.",
    regulatoryRoleAgents,
  ),
  claimAgentResults("s4", "summary_claim", "Together, these knockdowns begin to define distinct arms of the CD4+ T cell response.", architectureAgents),
];

const summaryResult = aggregateFinalVerdictsForInterpretation({ interpretation_id: "synthetic-interp", claim_agent_results: mixedClaims });

check("summary has at least one partially_supported claim", summaryResult.summary.partially_supported >= 1);
check("summary has at least one overstated claim", summaryResult.summary.overstated >= 1);
check(
  "summary is not a single-bucket 4/4 supported_with_caveats collapse",
  !(summaryResult.summary.supported_with_caveats === summaryResult.summary.total_claims),
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
