// Regression checks for this turn's claim-card conciseness + rewrite-skip
// changes: shortenReason (src/lib/reasonSummary.ts) and claimNeedsRewrite /
// buildDetailedReason (src/lib/finalVerdictAggregator.ts). Run via `npm run test`.

import { shortenReason } from "@/lib/reasonSummary";
import { buildDetailedReason, claimNeedsRewrite } from "@/lib/finalVerdictAggregator";
import { checkRewriteEntityExpansion } from "@/lib/claude/finalRewrite";
import type { AgentResult, AgentType, AgentVerdictLabel, ExtractedClaim, FinalVerdictLabel } from "@/lib/schemas";

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

// ---------------------------------------------------------------------------
// 1. shortenReason
// ---------------------------------------------------------------------------

section("1. shortenReason clamps long text, leaves short text alone");

const shortText = "The claim is supported by perturbation evidence.";
check("short text is returned unchanged", shortenReason(shortText) === shortText);

const longText =
  "The claim is broadly supported by perturbation and pathway evidence, but GeneGround keeps the wording cautious because the evidence is transcriptomic and associational in nature and was only observed in a single stimulation condition. CRISPRi supports knockdown-linked expression changes, not a confirmed causal mechanism, and further caveats include limited donor coverage, ambiguous timepoint resolution, and the absence of any orthogonal validation beyond the differential expression and enrichment signals already described above in detail.";
const shortened = shortenReason(longText, 45);
check("long text is shortened below the word budget", wordCount(shortened) <= 45);
check("shortened text is non-empty", shortened.length > 0);
check("shortened text is a prefix of the original (sentence-preserving, not reworded)", longText.startsWith(shortened.split("…")[0].split(".")[0]));

const noPunctuationText = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
const shortenedNoPunctuation = shortenReason(noPunctuationText, 45);
check("text with no sentence punctuation hard-clips with an ellipsis", shortenedNoPunctuation.endsWith("…"));
check("hard-clipped text respects the word budget", wordCount(shortenedNoPunctuation.replace("…", "")) <= 45);

// ---------------------------------------------------------------------------
// 2. claimNeedsRewrite
// ---------------------------------------------------------------------------

section("2. claimNeedsRewrite gates the final-rewrite API call correctly");

function claim(
  strengthWords: string[],
  causalWords: string[],
  originalText = "STAT1 knockdown suppresses interferon signaling in stimulated CD4+ T cells.",
): Pick<ExtractedClaim, "language_flags" | "original_text"> {
  return { language_flags: { strength_words: strengthWords, causal_words: causalWords }, original_text: originalText };
}

function agentResult(verdict: AgentVerdictLabel, agentType: AgentType = "language_causality"): AgentResult {
  return {
    agent_type: agentType,
    agent_query_id: `q-${agentType}`,
    claim_id: "c1",
    agent_verdict: verdict,
    confidence: 0.7,
    evidence_chunk_ids: [],
    supporting_points: [],
    weak_points: [],
    missing_evidence: [],
    risk_flags: [],
    agent_reasoning_summary: `${agentType} reasoning summary.`,
  };
}

function fourAgents(languageVerdict: AgentVerdictLabel) {
  return {
    perturbation_evidence: agentResult("supports", "perturbation_evidence"),
    pathway_signature: agentResult("supports", "pathway_signature"),
    robustness_quality: agentResult("supports", "robustness_quality"),
    language_causality: agentResult(languageVerdict, "language_causality"),
  };
}

const ALWAYS_REWRITE_VERDICTS: FinalVerdictLabel[] = ["partially_supported", "overstated", "unsupported", "insufficient_evidence", "needs_review"];
for (const verdict of ALWAYS_REWRITE_VERDICTS) {
  check(`final_verdict '${verdict}' always needs a rewrite`, claimNeedsRewrite(verdict, claim([], []), fourAgents("supports")));
}

check("'supported' never needs a rewrite, even with risky language flags", !claimNeedsRewrite("supported", claim(["key regulator"], ["drives"]), fourAgents("supports")));

check(
  "'supported_with_caveats' with no risky language and a confident language_causality verdict needs no rewrite",
  !claimNeedsRewrite("supported_with_caveats", claim([], []), fourAgents("supports")),
);

check(
  "'supported_with_caveats' with a strength word flagged needs a rewrite",
  claimNeedsRewrite("supported_with_caveats", claim(["key regulator"], []), fourAgents("supports")),
);

check(
  "'supported_with_caveats' with a causal word flagged needs a rewrite",
  claimNeedsRewrite("supported_with_caveats", claim([], ["drives"]), fourAgents("supports")),
);

check(
  "'supported_with_caveats' with language_causality verdict weak_support needs a rewrite even with no flagged words",
  claimNeedsRewrite("supported_with_caveats", claim([], []), fourAgents("weak_support")),
);

check(
  "'supported_with_caveats' with language_causality verdict needs_review needs a rewrite",
  claimNeedsRewrite("supported_with_caveats", claim([], []), fourAgents("needs_review")),
);

// A methodological caveat claim naively flags "causal"/"mechanism" as risky
// strength/causal words (literal text match, no negation awareness at
// extraction time) — claimNeedsRewrite must not send this to the rewrite
// API just because of that, since the wording is already appropriately
// cautious.
const METHODOLOGICAL_CAVEAT_TEXT =
  "All of these are transcriptional associations from pseudobulk differential expression against non-targeting controls; CRISPRi represses rather than fully knocks out the target, and none of these results establishes a causal mechanism on its own.";
check(
  "a methodological caveat claim needs no rewrite even with 'causal'/'mechanism' flagged as risky words",
  !claimNeedsRewrite("supported_with_caveats", claim(["causal mechanism"], ["mechanism"], METHODOLOGICAL_CAVEAT_TEXT), fourAgents("supports")),
);
check(
  "the same methodological caveat claim still needs a rewrite if it lands on overstated instead",
  claimNeedsRewrite("overstated", claim(["causal mechanism"], ["mechanism"], METHODOLOGICAL_CAVEAT_TEXT), fourAgents("weak_support")),
);
check(
  "a claim with genuinely risky language and no caveat phrasing still needs a rewrite",
  claimNeedsRewrite("supported_with_caveats", claim(["key regulator"], [], "STAT1 acts as a key regulator of inflammatory activation."), fourAgents("supports")),
);

// ---------------------------------------------------------------------------
// 3. buildDetailedReason
// ---------------------------------------------------------------------------

section("3. buildDetailedReason joins all four agents' own rationale");

const detailed = buildDetailedReason(fourAgents("supports"));
check("detailed reason mentions perturbation_evidence's rationale", detailed.includes("perturbation_evidence reasoning summary"));
check("detailed reason mentions pathway_signature's rationale", detailed.includes("pathway_signature reasoning summary"));
check("detailed reason mentions robustness_quality's rationale", detailed.includes("robustness_quality reasoning summary"));
check("detailed reason mentions language_causality's rationale", detailed.includes("language_causality reasoning summary"));

// ---------------------------------------------------------------------------
// 4. checkRewriteEntityExpansion — the live-demo FOXP3/RELB regression, plus
//    pathway and condition expansion (the evidence index carries genes,
//    pathways, and conditions far beyond any one live-demo interpretation).
// ---------------------------------------------------------------------------

section("4. checkRewriteEntityExpansion catches rewrite entity hallucination");

const nfkb2Original = "This reproducible upregulation points to a regulatory role for NFKB2 in restraining the inflammatory program.";

check(
  "a rewrite introducing a gene absent from the original claim (FOXP3) is flagged",
  checkRewriteEntityExpansion(nfkb2Original, "This upregulation is associated with NFKB2 and FOXP3 activity in the inflammatory program.").hasNewEntities,
);

check(
  "a rewrite introducing a different absent gene (RELB) is flagged",
  checkRewriteEntityExpansion(nfkb2Original, "This upregulation is consistent with NFKB2 and RELB shaping the inflammatory program.").hasNewEntities,
);

check(
  "a rewrite that only re-uses the original claim's own gene (NFKB2) is not flagged",
  !checkRewriteEntityExpansion(nfkb2Original, "This upregulation is consistent with, but does not establish, a regulatory role for NFKB2.").hasNewEntities,
);

check(
  "a rewrite that introduces no gene at all is not flagged",
  !checkRewriteEntityExpansion(nfkb2Original, "This upregulation is consistent with a regulatory role in the inflammatory program.").hasNewEntities,
);

const multiGeneOriginal = "NFKB2, GATA3, STAT1, and BATF knockdowns each show theme-consistent transcriptional changes.";
check(
  "a multi-gene original claim still catches one added gene the rewrite introduces",
  checkRewriteEntityExpansion(multiGeneOriginal, "NFKB2, GATA3, STAT1, BATF, and RELB knockdowns each show theme-consistent transcriptional changes.")
    .hasNewEntities,
);
check(
  "a multi-gene original claim allows a rewrite using only its own genes",
  !checkRewriteEntityExpansion(multiGeneOriginal, "NFKB2, GATA3, STAT1, and BATF knockdowns are each associated with theme-consistent transcriptional changes.")
    .hasNewEntities,
);

check(
  "a rewrite introducing a pathway not in the original claim is flagged",
  checkRewriteEntityExpansion(nfkb2Original, "This upregulation is consistent with activation of NF-kappaB in B cells.").newPathways.length > 0,
);
check(
  "a rewrite that stays within the original claim's own condition is not flagged",
  !checkRewriteEntityExpansion("NFKB2 is upregulated in Stim8hr CD4+ T cells.", "NFKB2 shows increased expression in Stim8hr CD4+ T cells.")
    .hasNewEntities,
);
check(
  "a rewrite introducing a condition not in the original claim (Stim48hr) is flagged",
  checkRewriteEntityExpansion("NFKB2 is upregulated in Stim8hr CD4+ T cells.", "NFKB2 is upregulated in both Stim8hr and Stim48hr CD4+ T cells.")
    .newConditions.length > 0,
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
