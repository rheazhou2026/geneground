import type {
  AgentResult,
  AgentType,
  AgentVerdictLabel,
  AgentVerdictResult,
  ArtifactIndexType,
  ClaimAgentResults,
  ExtractedClaim,
  FinalClaimResult,
  FinalEvidenceBasis,
  FinalVerdictLabel,
  FinalVerdictResult,
  FinalVerdictSummary,
  RecommendedAction,
} from "./schemas";
import { CAUSAL_WORDS, STRENGTH_WORDS_HIGH_RISK } from "./taxonomies";
import { shortenReason } from "./reasonSummary";
import { findRawGeneMentions } from "./entityNormalization";

type FourAgentResults = ClaimAgentResults["agent_results"];

function dedupeSimilar(strings: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of strings) {
    const key = s.toLowerCase().replace(/\s+/g, " ").trim();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// Trigger words that mark a claim "overstated" when biology gives at least
// weak grounding but the wording overclaims relative to it. Sourced from
// taxonomies.ts (high-risk strength words + causal words) rather than a
// separately hardcoded list — this is what previously let words like "key
// regulator" slip through uncaught even though they're high-risk per the
// taxonomy doc.
const OVERSTATED_TRIGGER_WORDS = new Set<string>([...STRENGTH_WORDS_HIGH_RISK, ...CAUSAL_WORDS]);

// Backstop, independent of what language_causality's own risk_flags happened
// to catch (that agent was only primed with the single-word taxonomy above,
// so multi-word architecture/hierarchy phrasing like "define distinct arms"
// or "mechanistic control point" slides through as supports_with_caveats at
// the agent level). Matched directly against original_claim_text so an
// obvious subtle overclaim is never missed just because the agent's own
// wording detector didn't fire. Not the only logic — see chooseFinalVerdict.
const OVERSTATED_TEXT_TRIGGERS = [
  "define distinct arms",
  "regulatory network",
  "govern",
  "master regulator",
  "drives",
  "causes",
  "reprograms",
  "mechanistic control point",
  "therapeutic target",
  "proves",
  "establishes",
] as const;

// Marks claim wording that upgrades a supported expression change into an
// inferred regulatory/functional role — biology-supported, but the role
// itself is inference beyond differential expression, not directly measured.
const PARTIALLY_SUPPORTED_TEXT_TRIGGERS = [
  "regulatory role",
  "restraining",
  "constrains",
  "sustains",
  "points to",
  "regulates",
  "consistent regulatory role",
] as const;

// Claim types where wording upgrading an observed effect into an inferred
// role/architecture claim is common enough that a text-trigger match should
// push the verdict to partially_supported rather than supported_with_caveats.
// condition_specific_effect and unsupported_generalization stand in for the
// task's "condition_generalization" — that literal value isn't in CLAIM_TYPES
// (see taxonomies.ts), and these are the closest real equivalents: a claim
// generalizing beyond the specific condition tested, or an inference-prone
// generalization flagged as such by claim extraction.
const INFERENCE_PRONE_CLAIM_TYPES = new Set<string>([
  "regulatory_role",
  "cell_state_effect",
  "summary_claim",
  "condition_specific_effect",
  "unsupported_generalization",
]);

function textIncludesAnyPhrase(text: string, phrases: readonly string[]): string | null {
  const lower = text.toLowerCase();
  for (const phrase of phrases) {
    if (lower.includes(phrase)) return phrase;
  }
  return null;
}

// The causal/mechanism/knockout family of overstated words is the one family
// that a claim can legitimately use to CAUTION against overreach ("none of
// these results establishes a causal mechanism on its own") rather than
// commit it. Other overstated triggers (master regulator, therapeutic
// target, define distinct arms, ...) don't have this ambiguity — using them
// at all already implies the overreach — so only this family gets
// negation-checked below.
const CAUSAL_MECHANISM_FAMILY_WORDS = new Set(["causal", "causal mechanism", "mechanism", "mechanistically", "establishes", "knockout"]);

// Cautionary/negating phrasing that flips a causal/mechanism word from an
// overclaim into an explicit methodological caveat. Deliberately specific
// phrases (not a generic "not X" scan) to avoid accidentally suppressing a
// genuine overstated claim that happens to contain an unrelated negation.
// Unambiguous on their own — any one of these is sufficient.
const STRONG_CAUSAL_NEGATION_PHRASES = [
  "does not establish",
  "does not establishes",
  "none of these results establishes",
  "not causal",
  "not a causal",
  "association, not causation",
  "associations, not causation",
  "transcriptional associations",
  "rather than fully knocks out",
  "rather than fully knock out",
  "partial repression",
  "not mechanism",
  "not a mechanism",
] as const;

// Ambiguous alone — "establishes a causal mechanism on its own" (positive:
// this alone is sufficient) reads oppositely to "does not establish... on
// its own" (negative: not even alone). Only counts as a negation signal
// alongside a generic negator elsewhere in the text.
const WEAK_CAUSAL_NEGATION_PHRASE = "on its own";
const GENERIC_NEGATOR_PATTERN = /\b(not|none|never|doesn't|does not|no)\b/i;

function hasCausalMechanismNegation(text: string): boolean {
  if (textIncludesAnyPhrase(text, STRONG_CAUSAL_NEGATION_PHRASES) !== null) return true;
  return text.toLowerCase().includes(WEAK_CAUSAL_NEGATION_PHRASE) && GENERIC_NEGATOR_PATTERN.test(text);
}

// Phrases that mark a claim as self-describing its own methodological
// limits — broader than pure causal negation above: also covers a claim
// that just names the assay type or perturbation method as the basis for
// caution (pseudobulk DE, CRISPRi knockdown vs. knockout) without
// necessarily using an explicit negation word.
const METHODOLOGICAL_CAVEAT_PHRASES = [
  "pseudobulk differential expression",
  "represses rather than knocks out",
  "represses rather than fully knocks out",
] as const;

/**
 * True for a claim that already reads as a cautionary/methodological
 * caveat statement rather than a positive biological assertion — used by
 * claimNeedsRewrite below to skip an unnecessary rewrite call for a claim
 * whose own cautious wording happens to literally contain a high-risk word
 * like "causal"/"mechanism" (that's what it's warning against, not
 * overreaching into).
 */
function isMethodologicalCaveatClaim(text: string): boolean {
  return hasCausalMechanismNegation(text) || textIncludesAnyPhrase(text, METHODOLOGICAL_CAVEAT_PHRASES) !== null;
}

// Architecture/hierarchy overstated triggers specifically — "define distinct
// arms", "regulatory network", "govern", "mechanistic control point" all
// upgrade a set of independent, theme-consistent findings into a claimed
// coordinated system. This is the one family with a single, always-accurate
// rationale (ARCHITECTURE_OVERSTATED_REASON below): the failure mode is
// always the same shape (independent associations presented as an
// architecture), so a fixed sentence is safer than any generated one, which
// risks inventing specifics like a gene count or claiming an untested gene
// was never assayed.
const ARCHITECTURE_OVERSTATED_TRIGGERS = new Set(["define distinct arms", "regulatory network", "govern", "mechanistic control point"]);

export const ARCHITECTURE_OVERSTATED_REASON =
  "The individual perturbations support distinct transcriptional themes, but the wording overstates the evidence because independent DE/signature associations do not establish coordinated response architecture or defined regulatory arms.";

/**
 * Fixed, pre-verified reason for architecture/network-family overstated
 * claims (see ARCHITECTURE_OVERSTATED_TRIGGERS) — returns null for every
 * other claim, in which case the normal generated/deterministic reason
 * applies unchanged. Exported so the final-rewrite API route can apply the
 * same override to Claude's own Reason, not just the deterministic fallback.
 */
export function getArchitectureOverstatedReason(finalVerdict: FinalVerdictLabel, originalClaimText: string): string | null {
  if (finalVerdict !== "overstated") return null;
  const match = textIncludesAnyPhrase(originalClaimText, Array.from(ARCHITECTURE_OVERSTATED_TRIGGERS));
  return match !== null ? ARCHITECTURE_OVERSTATED_REASON : null;
}

function getLanguageTriggerWord(languageResult: AgentResult): string | null {
  for (const flag of languageResult.risk_flags) {
    const match = /^(?:high|medium)_severity_language:(.+)$/.exec(flag);
    if (match) return match[1];
  }
  return null;
}

/**
 * Maps whatever signals Step 8's agents actually surfaced (risk_flags,
 * weak_points text) into this step's canonical major-risk-flag vocabulary.
 * Not every canonical flag can fire today (e.g. condition_ambiguous depends
 * on wording no current agent emits) — that's an honest gap, not a bug.
 */
function deriveMajorRiskFlags(agentResults: FourAgentResults): string[] {
  const flags = new Set<string>();

  const ROBUSTNESS_MAJOR_FLAGS = new Set(["single_guide", "low_target_gex", "distal_offtarget_flag", "weak_donor_support", "weak_guide_support"]);
  for (const flag of agentResults.robustness_quality.risk_flags) {
    if (ROBUSTNESS_MAJOR_FLAGS.has(flag)) flags.add(flag);
  }

  const pathwayWeakPoints = agentResults.pathway_signature.weak_points.join(" ").toLowerCase();
  if (pathwayWeakPoints.includes("multiple candidate")) flags.add("pathway_ambiguous");
  if (pathwayWeakPoints.includes("does not prove mechanism")) flags.add("mechanism_not_proven");

  const conditionText = [
    ...agentResults.perturbation_evidence.weak_points,
    ...agentResults.perturbation_evidence.missing_evidence,
    ...agentResults.pathway_signature.weak_points,
    ...agentResults.pathway_signature.missing_evidence,
  ]
    .join(" ")
    .toLowerCase();
  if (conditionText.includes("ambiguous") && conditionText.includes("condition")) flags.add("condition_ambiguous");

  const languageRiskFlags = agentResults.language_causality.risk_flags;
  if (languageRiskFlags.some((f) => f.toLowerCase().includes("therapeutic target"))) {
    flags.add("therapeutic_claim_without_validation");
  }
  if (
    languageRiskFlags.some(
      (f) => (f.startsWith("high_severity_language:") || f.startsWith("medium_severity_language:")) && !f.toLowerCase().includes("therapeutic target"),
    )
  ) {
    flags.add("causal_language_overreach");
  }

  return Array.from(flags);
}

// ---------------------------------------------------------------------------
// Final verdict selection
// ---------------------------------------------------------------------------

export interface ClaimVerdictContext {
  claim_type: string;
  original_claim_text: string;
}

/**
 * Deterministic mapping per docs/geneground-taxonomies.md's "Claim-Level
 * Verdict Guidelines" table, in priority order:
 *   1. unsupported       — perturbation_evidence or pathway_signature contradicts.
 *   2. needs_review       — strong conflict between agents, or any key agent needs_review.
 *   3. insufficient_evidence — most relevant agents have nothing to go on.
 *   4. overstated         — biology has some grounding, but language_causality
 *                           flags high-risk/causal wording, the wording itself
 *                           matches a known architecture/hierarchy/mechanism
 *                           phrase (OVERSTATED_TEXT_TRIGGERS), or language_causality
 *                           itself can't back it (weak_support/insufficient_evidence).
 *   5. partially_supported — one biology agent supports, another is weaker/missing,
 *                           OR the claim_type is inference-prone (regulatory_role,
 *                           cell_state_effect, summary_claim, condition_specific_effect,
 *                           unsupported_generalization) and the wording upgrades a
 *                           supported effect into an inferred role/function
 *                           (PARTIALLY_SUPPORTED_TEXT_TRIGGERS) while biology supports.
 *   6. supported_with_caveats — core biology supports, but robustness/language/
 *                           pathway caveats exist.
 *   7. supported          — relevant biology supports, robustness supports,
 *                           language supports, no major ambiguity.
 * Falls back to needs_review for anything that doesn't resolve cleanly above.
 * not_applicable never appears in the return value — that label is
 * agent-level only (INTERNAL_AGENT_VERDICTS), never a final claim verdict
 * (FINAL_VERDICTS excludes it).
 *
 * The text-pattern checks (steps 4 and 5) are a backstop, not the primary
 * signal: they supplement the agent-verdict-based logic so an internal
 * supports_with_caveats result doesn't flatten every claim to the same final
 * verdict when the claim's own wording independently overreaches.
 */
export function chooseFinalVerdict(agentResults: FourAgentResults, context: ClaimVerdictContext): FinalVerdictLabel {
  const pe = agentResults.perturbation_evidence.agent_verdict;
  const ps = agentResults.pathway_signature.agent_verdict;
  const rq = agentResults.robustness_quality.agent_verdict;
  const lc = agentResults.language_causality.agent_verdict;
  const verdicts = [pe, ps, rq, lc];

  // 1. unsupported — a biology agent directly contradicts the claim.
  if (pe === "contradicts" || ps === "contradicts") return "unsupported";

  // 2. needs_review — strong conflict between agents (robustness or language
  //    directly contradicts while biology hasn't already failed above), or
  //    any agent's own verdict is needs_review.
  const strongAgentConflict = rq === "contradicts" || lc === "contradicts";
  if (strongAgentConflict || verdicts.some((v) => v === "needs_review")) return "needs_review";

  // 3. insufficient_evidence — the two biology agents have nothing, or most agents have nothing.
  const insufficientCount = verdicts.filter((v) => v === "insufficient_evidence").length;
  if ((pe === "insufficient_evidence" && ps === "insufficient_evidence") || insufficientCount >= 3) {
    return "insufficient_evidence";
  }

  // 4. overstated — biology gives at least some grounding, but the wording overclaims:
  //    either a specific high-risk/causal trigger word the agent itself flagged,
  //    a known architecture/mechanism/hierarchy phrase in the claim's own text,
  //    or language_causality itself can't back the wording (weak_support/insufficient_evidence).
  //    Negation-aware for the causal/mechanism/knockout family only (see
  //    hasCausalMechanismNegation) — a claim explicitly denying causality/
  //    mechanism ("none of these results establishes a causal mechanism on
  //    its own") is stating a caveat, not committing the overclaim it names.
  const triggerWord = getLanguageTriggerWord(agentResults.language_causality);
  const negatesCausalMechanism = hasCausalMechanismNegation(context.original_claim_text);
  const triggerWordIsCausalFamily = triggerWord !== null && CAUSAL_MECHANISM_FAMILY_WORDS.has(triggerWord.toLowerCase());
  const hasOverstatedLanguage =
    triggerWord !== null && OVERSTATED_TRIGGER_WORDS.has(triggerWord.toLowerCase()) && !(triggerWordIsCausalFamily && negatesCausalMechanism);

  const overstatedTextMatchRaw = textIncludesAnyPhrase(context.original_claim_text, OVERSTATED_TEXT_TRIGGERS);
  const textMatchIsCausalFamily = overstatedTextMatchRaw !== null && CAUSAL_MECHANISM_FAMILY_WORDS.has(overstatedTextMatchRaw);
  const overstatedTextMatch = textMatchIsCausalFamily && negatesCausalMechanism ? null : overstatedTextMatchRaw;

  const languageVerdictWeak = lc === "weak_support" || lc === "insufficient_evidence";
  const languageUndercutsWording = hasOverstatedLanguage || overstatedTextMatch !== null || (languageVerdictWeak && !negatesCausalMechanism);
  const biologyHasSomeGrounding = pe !== "insufficient_evidence" && ps !== "insufficient_evidence";
  if (languageUndercutsWording && biologyHasSomeGrounding) return "overstated";

  // 5. partially_supported — one biology agent supports, another is weaker or
  //    missing, OR the claim is an inference-prone type whose wording upgrades
  //    a supported effect into an inferred regulatory/functional role.
  const anyBiologySupports = pe === "supports" || pe === "supports_with_caveats" || ps === "supports" || ps === "supports_with_caveats";
  const anyBiologyWeakOrInsufficient = pe === "weak_support" || pe === "insufficient_evidence" || ps === "weak_support" || ps === "insufficient_evidence";
  if (anyBiologySupports && anyBiologyWeakOrInsufficient) return "partially_supported";

  const partialTextMatch = textIncludesAnyPhrase(context.original_claim_text, PARTIALLY_SUPPORTED_TEXT_TRIGGERS);
  if (anyBiologySupports && partialTextMatch !== null && INFERENCE_PRONE_CLAIM_TYPES.has(context.claim_type)) {
    return "partially_supported";
  }

  // 6/7. supported_with_caveats vs. supported — core biology supports across
  //    all four; "supported" is the strict, flag-free subset of that.
  //    lc landing on weak_support/insufficient_evidence purely because a
  //    causal/mechanism-family word tripped a negation-blind agent (the same
  //    gap step 4 corrects for) shouldn't block this claim from at least
  //    supported_with_caveats — otherwise a claim that correctly cautions
  //    "does not establish a causal mechanism" falls through to needs_review
  //    for using the very words it's warning against.
  const lcVerdictIsCausalNegationArtifact =
    negatesCausalMechanism && triggerWordIsCausalFamily && (lc === "weak_support" || lc === "insufficient_evidence");
  const peOk = pe === "supports" || pe === "supports_with_caveats";
  const psOk = ps === "supports" || ps === "supports_with_caveats" || ps === "not_applicable";
  const rqOk = rq === "supports" || rq === "supports_with_caveats";
  const lcOk = lc === "supports" || lc === "supports_with_caveats" || lc === "not_applicable" || lcVerdictIsCausalNegationArtifact;
  if (peOk && psOk && rqOk && lcOk) {
    const pathwayOkForSupport = ps === "supports" || ps === "not_applicable";
    const noMajorRiskFlags = deriveMajorRiskFlags(agentResults).length === 0;
    if (pe === "supports" && pathwayOkForSupport && rq === "supports" && lc === "supports" && noMajorRiskFlags) {
      return "supported";
    }
    return "supported_with_caveats";
  }

  // Fallback — signals that don't resolve cleanly above.
  return "needs_review";
}

// ---------------------------------------------------------------------------
// Recommended action
// ---------------------------------------------------------------------------

export function chooseRecommendedAction(finalVerdict: FinalVerdictLabel, agentResults: FourAgentResults): RecommendedAction {
  switch (finalVerdict) {
    case "supported":
      return "accept";
    case "supported_with_caveats":
      return agentResults.language_causality.weak_points.length > 0 || agentResults.language_causality.suggested_language_change
        ? "soften_wording"
        : "add_caveat";
    case "partially_supported": {
      const flags = deriveMajorRiskFlags(agentResults);
      return flags.includes("condition_ambiguous") || flags.includes("pathway_ambiguous") ? "specify_condition" : "split_claim";
    }
    case "overstated":
      return "soften_wording";
    case "unsupported":
      return "reject_or_rewrite";
    case "insufficient_evidence":
      return "request_more_evidence";
    case "needs_review":
    default:
      return "human_review";
  }
}

// ---------------------------------------------------------------------------
// Rewrite-needed gate
// ---------------------------------------------------------------------------

const REWRITE_REQUIRED_VERDICTS = new Set<FinalVerdictLabel>([
  "partially_supported",
  "overstated",
  "unsupported",
  "insufficient_evidence",
  "needs_review",
]);

// language_causality verdicts that themselves signal the wording overreaches
// the evidence, even when the overall claim still lands on
// supported_with_caveats (e.g. biology agents are confident but the wording
// itself hasn't been vetted as safe).
const LANGUAGE_VERDICTS_NEEDING_REWRITE = new Set<AgentVerdictLabel>(["weak_support", "contradicts", "needs_review", "insufficient_evidence"]);

/**
 * Deterministic gate for whether calling the Claude final-rewrite API is
 * worth it for this claim. "supported" claims never need a rewrite.
 * "supported_with_caveats" only needs one when the original wording itself
 * carries risky strength/causal language or language_causality flagged the
 * wording as weak/unreviewed — cautious wording with clean language
 * evaluation gets no rewrite call at all. Every other final_verdict always
 * needs a rewrite.
 *
 * A methodological-caveat claim (isMethodologicalCaveatClaim) is exempted
 * from the risky-language check even though it literally contains words
 * like "causal"/"mechanism" — it's reachable here only when final_verdict
 * is supported_with_caveats, not overstated, and chooseFinalVerdict already
 * reserves "overstated" for a claim that *also* makes a genuine positive
 * causal/mechanistic assertion — so "unless it also makes a positive
 * causal/mechanistic assertion" is already guaranteed by that priority
 * ordering, not re-checked here.
 */
export function claimNeedsRewrite(
  finalVerdict: FinalVerdictLabel,
  extractedClaim: Pick<ExtractedClaim, "language_flags" | "original_text">,
  agentResults: FourAgentResults,
): boolean {
  if (REWRITE_REQUIRED_VERDICTS.has(finalVerdict)) return true;
  if (finalVerdict !== "supported_with_caveats") return false; // only "supported" remains — never needs a rewrite
  if (isMethodologicalCaveatClaim(extractedClaim.original_text)) return false;

  const hasRiskyLanguage = extractedClaim.language_flags.strength_words.length > 0 || extractedClaim.language_flags.causal_words.length > 0;
  return hasRiskyLanguage || LANGUAGE_VERDICTS_NEEDING_REWRITE.has(agentResults.language_causality.agent_verdict);
}

// ---------------------------------------------------------------------------
// Safer rewrite
// ---------------------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Collapses an immediately-repeated single word (case-insensitive), e.g.
// "regulation of of inflammatory" -> "regulation of inflammatory" — a cheap
// but effective cleanup for the prepositions naive substitution can double up.
function collapseDuplicateWords(text: string): string {
  return text.replace(/\b(\w+)\s+\1\b/gi, "$1");
}

// Common lead-ins that a suggested_language_change phrase (itself often a
// full clause like "raises the possibility of therapeutic relevance") is
// meant to replace *along with* the trigger word, not just the bare word —
// longest/most-specific first so the leftmost match wins.
const LEAD_IN_PATTERNS = [
  /\braising the possibility of an\b\s*$/i,
  /\braising the possibility of a\b\s*$/i,
  /\braising the possibility of\b\s*$/i,
  /\bacts as an\b\s*$/i,
  /\bacts as a\b\s*$/i,
  /\bis an\b\s*$/i,
  /\bis a\b\s*$/i,
];

const DETERMINISTIC_REPLACEMENTS: [RegExp, string][] = [
  [/\bdrives\b/gi, "is associated with"],
  [/\bcauses\b/gi, "is associated with"],
  [/\bmaster regulator\b/gi, "candidate regulator"],
  [/\btherapeutic target\b/gi, "potential candidate for further study"],
  [/\bproves\b/gi, "is consistent with"],
  [/\bsuppresses\b/gi, "is associated with decreased"],
  [/\bactivates\b/gi, "is associated with increased"],
];

export function buildSaferRewrite(originalClaimText: string, agentResults: FourAgentResults): string {
  const suggested = agentResults.language_causality.suggested_language_change;
  const triggerWord = getLanguageTriggerWord(agentResults.language_causality);

  if (suggested && triggerWord) {
    const pattern = new RegExp(`\\b${escapeRegExp(triggerWord)}\\b`, "i");
    const match = pattern.exec(originalClaimText);
    if (match) {
      const before = originalClaimText.slice(0, match.index);
      const after = originalClaimText.slice(match.index + match[0].length);
      const leadIn = LEAD_IN_PATTERNS.map((p) => p.exec(before)).find((m) => m !== null);
      const prefix = leadIn ? before.slice(0, leadIn.index) : before;
      const insertedSuggested = /^\s*$/.test(prefix) ? suggested.charAt(0).toUpperCase() + suggested.slice(1) : suggested;
      return collapseDuplicateWords(`${prefix}${insertedSuggested}${after}`);
    }
    return `${originalClaimText.replace(/\.$/, "")} — consider rephrasing '${triggerWord}' as "${suggested}".`;
  }

  let rewritten = originalClaimText;
  for (const [pattern, replacement] of DETERMINISTIC_REPLACEMENTS) {
    rewritten = rewritten.replace(pattern, replacement);
  }
  return rewritten;
}

// ---------------------------------------------------------------------------
// Evidence collection (supported_parts / caveats / unsupported / missing / basis)
// ---------------------------------------------------------------------------

const AGENT_TO_INDEX: Record<AgentType, ArtifactIndexType> = {
  perturbation_evidence: "perturbation_evidence_index",
  pathway_signature: "pathway_signature_index",
  robustness_quality: "robustness_quality_index",
  language_causality: "language_rules_index",
};

function buildEvidenceBasis(agentResults: FourAgentResults): FinalEvidenceBasis {
  const chunkIds = new Set<string>();
  const indexes = new Set<ArtifactIndexType>();

  (Object.entries(agentResults) as [AgentType, AgentResult][]).forEach(([agentType, result]) => {
    if (result.evidence_chunk_ids.length > 0) {
      indexes.add(AGENT_TO_INDEX[agentType]);
      result.evidence_chunk_ids.forEach((id) => chunkIds.add(id));
    }
  });

  return {
    dataset_grounded: true,
    artifact_indexes_used: Array.from(indexes),
    evidence_chunk_ids: Array.from(chunkIds),
    chunk_ids_by_agent: {
      perturbation_evidence: agentResults.perturbation_evidence.evidence_chunk_ids,
      pathway_signature: agentResults.pathway_signature.evidence_chunk_ids,
      robustness_quality: agentResults.robustness_quality.evidence_chunk_ids,
      language_causality: agentResults.language_causality.evidence_chunk_ids,
    },
  };
}

function buildSupportedParts(agentResults: FourAgentResults): string[] {
  return dedupeSimilar([
    ...agentResults.perturbation_evidence.supporting_points,
    ...agentResults.pathway_signature.supporting_points,
    ...agentResults.robustness_quality.supporting_points,
    ...agentResults.language_causality.supporting_points,
  ]);
}

function buildCaveats(agentResults: FourAgentResults): string[] {
  return dedupeSimilar([
    ...agentResults.perturbation_evidence.weak_points,
    ...agentResults.perturbation_evidence.risk_flags,
    ...agentResults.pathway_signature.weak_points,
    ...agentResults.pathway_signature.risk_flags,
    ...agentResults.robustness_quality.weak_points,
    ...agentResults.robustness_quality.risk_flags,
    ...agentResults.language_causality.weak_points,
  ]);
}

function buildUnsupportedOrOverstatedParts(agentResults: FourAgentResults): string[] {
  const items: string[] = [...agentResults.language_causality.weak_points];

  items.push(...agentResults.pathway_signature.weak_points.filter((p) => p.toLowerCase().includes("does not prove mechanism")));

  (Object.entries(agentResults) as [AgentType, AgentResult][]).forEach(([agentType, result]) => {
    if (result.agent_verdict === "contradicts") {
      items.push(...result.weak_points, `${agentType.replace(/_/g, " ")} evidence contradicts this claim.`);
    }
  });

  const triggerWord = getLanguageTriggerWord(agentResults.language_causality);
  if (triggerWord && agentResults.language_causality.suggested_language_change) {
    items.push(`Wording flagged: '${triggerWord}' — consider "${agentResults.language_causality.suggested_language_change}" instead.`);
  }

  return dedupeSimilar(items);
}

const HIGH_RISK_DEFAULT_MISSING_EVIDENCE = [
  "Orthogonal functional validation is not shown in the retrieved artifact evidence.",
  "External literature grounding is not included yet.",
  "Mechanistic evidence is not established by pathway enrichment alone.",
];

function buildMissingEvidence(agentResults: FourAgentResults, hasOverstatedLanguage: boolean): string[] {
  const items = [
    ...agentResults.perturbation_evidence.missing_evidence,
    ...agentResults.pathway_signature.missing_evidence,
    ...agentResults.robustness_quality.missing_evidence,
    ...agentResults.language_causality.missing_evidence,
  ];
  if (hasOverstatedLanguage) items.push(...HIGH_RISK_DEFAULT_MISSING_EVIDENCE);
  return dedupeSimilar(items);
}

// ---------------------------------------------------------------------------
// Biologist-friendly explanation
// ---------------------------------------------------------------------------

// Genes in the mini HGNC panel with a canonical interferon-response role —
// used only to correct a specific inaccurate agent-generated caveat pattern
// below (NO_INTERFERON_GENE_TESTED_PATTERN), not as a general biology
// classifier.
const INTERFERON_RESPONSE_GENES = new Set(["STAT1", "STAT2", "IRF1", "MX1", "OAS1"]);

// Matches an agent-generated caveat claiming no interferon-pathway gene was
// targeted/tested — this can be wrong when the claim's own evidence chunk
// IS for a known interferon-response gene (e.g. STAT1), just not literally
// worded "interferon" in that gene's own symbol.
const NO_INTERFERON_GENE_TESTED_PATTERN =
  /no[^.]*(perturbation (chunk|evidence)|evidence|knockdown)[^.]*(directly target|target|tested|assayed)[^.]*interferon/i;

function findKnownInterferonGeneMention(text: string): string | null {
  const match = findRawGeneMentions(text).find((g) => INTERFERON_RESPONSE_GENES.has(g.toUpperCase()));
  return match ? match.toUpperCase() : null;
}

// Signals that a claim's lack of supported_parts reflects a genuinely
// exploratory/low-powered result (weak donor or guide support, low target
// expression, a single guide) rather than an unexplained "doesn't support
// this" gap that leaves the reader guessing why.
const LOW_SUPPORT_SIGNAL_PATTERN = /low.*(support|confidence|cell|donor|guide)|weak.*(donor|guide)|single[- ]guide|low_target_gex/i;

function hasLowSupportSignal(finalClaimResult: Pick<FinalClaimResult, "caveats" | "missing_evidence">): boolean {
  const text = [...finalClaimResult.caveats, ...finalClaimResult.missing_evidence].join(" ");
  return LOW_SUPPORT_SIGNAL_PATTERN.test(text);
}

// Clauses assembled per-claim from what the claim's OWN wording actually
// contains — never a fixed sentence copied across claims. This is what fixes
// the bug where a methodological-caveat claim (e.g. a CRISPRi-knockdown
// caveat) could fall through to the low-support-signal branch below and
// surface a *different* claim's "exploratory/low cell support" reason
// instead of its own.
function buildMethodologicalCaveatReason(originalClaimText: string): string {
  const clauses: string[] = [];
  if (hasCausalMechanismNegation(originalClaimText)) {
    clauses.push("frames the results as transcriptional associations");
  }
  if (textIncludesAnyPhrase(originalClaimText, ["represses rather than knocks out", "represses rather than fully knocks out"]) !== null) {
    clauses.push("notes that CRISPRi is knockdown rather than knockout");
  }
  if (/pseudobulk differential expression/i.test(originalClaimText)) {
    clauses.push("notes reliance on pseudobulk differential expression rather than single-cell resolution");
  }
  if (clauses.length === 0) clauses.push("avoids overreaching beyond the dataset evidence");
  clauses.push("avoids claiming causal mechanism");

  const clauseText = clauses.length > 1 ? `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}` : clauses[0];
  return shortenReason(`This claim is already an appropriate methodological caveat: it ${clauseText}.`);
}

function lowerFirst(s: string): string {
  if (s.length === 0) return s;
  // Don't mangle acronyms/gene symbols (STAT1, IRF4, NFKB1, ...) — only
  // lowercase when the leading word looks like an ordinary capitalized word.
  const leadingWord = /^[A-Za-z0-9]+/.exec(s)?.[0] ?? "";
  const upperCount = (leadingWord.match(/[A-Z]/g) ?? []).length;
  if (upperCount >= 2) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Concise, user-facing "Reason" (~1-2 sentences, clamped by shortenReason)
 * — the main evidence boundary only, not a multi-point report. The fuller
 * multi-point breakdown (every agent's own rationale) lives separately in
 * buildDetailedReason below, surfaced only in Evidence Trace / Technical
 * Pipeline, never in the default claim card.
 */
export function buildBiologistFriendlyExplanation(
  finalClaimResult: Pick<FinalClaimResult, "final_verdict" | "supported_parts" | "caveats" | "missing_evidence" | "recommended_action">,
  agentResults: FourAgentResults,
  originalClaimText: string,
): string {
  // Architecture/network-family overstated claims get a fixed, pre-verified
  // reason instead of one built from agent text fragments — see
  // getArchitectureOverstatedReason for why a generated reason is unsafe here
  // (risk of inventing a gene count or an untested-gene claim).
  const architectureReason = getArchitectureOverstatedReason(finalClaimResult.final_verdict, originalClaimText);
  if (architectureReason) return architectureReason;

  // A claim that already reads as a self-cautioning methodological caveat
  // (isMethodologicalCaveatClaim — same detector claimNeedsRewrite uses to
  // skip rewriting it) gets its own reason built from its own wording here,
  // before any of the generic branches below run. Without this, such a claim
  // could fall through to the low-support-signal branch and pick up whatever
  // gene/reason that generic branch happens to produce — which is exactly
  // how one claim's reason previously leaked onto a different, unrelated
  // methodological-caveat claim's card.
  if (isMethodologicalCaveatClaim(originalClaimText)) {
    return buildMethodologicalCaveatReason(originalClaimText);
  }

  // Correct a specific inaccurate agent-generated caveat: "no perturbation
  // chunk directly targets an interferon-pathway gene" can be wrong when the
  // claim's own gene mention IS a known interferon-response gene (e.g.
  // STAT1) — the caveat is really about pathway/signature-level evidence not
  // establishing a fully defined response arm, not about missing gene
  // coverage.
  const interferonGene = findKnownInterferonGeneMention(originalClaimText);
  if (interferonGene) {
    const hasFalseNoInterferonGeneCaveat = [...finalClaimResult.caveats, ...finalClaimResult.missing_evidence].some((c) =>
      NO_INTERFERON_GENE_TESTED_PATTERN.test(c),
    );
    if (hasFalseNoInterferonGeneCaveat) {
      return shortenReason(
        `${interferonGene} supports interferon-response gene changes, but independent DE/signature associations do not establish a fully defined response arm.`,
      );
    }
  }

  // A claim with no supported_parts because the evidence is genuinely
  // low-powered (weak donor/guide support, single guide, low target
  // expression) reads better as "this is appropriately exploratory" than
  // the generic "does not clearly support this claim as worded" — the
  // claim's own wording is already cautious, so the deterministic reason
  // shouldn't sound like it's contradicting the claim rather than agreeing
  // with its caution.
  if (finalClaimResult.supported_parts.length === 0 && hasLowSupportSignal(finalClaimResult)) {
    const genes = findRawGeneMentions(originalClaimText);
    const subjectPhrase = genes.length > 0 ? `The ${genes[0].toUpperCase()} result` : "This result";
    return shortenReason(
      `${subjectPhrase} is appropriately labeled exploratory because the evidence has low cell support. GeneGround preserves the caveat rather than strengthening the claim.`,
    );
  }

  const sentences: string[] = [];

  sentences.push(
    finalClaimResult.supported_parts.length > 0
      ? `The claim is supported by ${lowerFirst(finalClaimResult.supported_parts[0])}`
      : "The retrieved dataset evidence does not clearly support this claim as worded.",
  );

  if (finalClaimResult.caveats.length > 0) {
    sentences.push(`GeneGround keeps the wording cautious because ${lowerFirst(finalClaimResult.caveats[0])}`);
  } else if (finalClaimResult.recommended_action === "soften_wording" || finalClaimResult.final_verdict === "overstated") {
    sentences.push("The wording is softened because this is transcriptomic/signature-level evidence, not a confirmed mechanism.");
  }

  void agentResults; // reserved for future richer per-agent phrasing
  return shortenReason(sentences.join(" "));
}

const AGENT_LABEL_FOR_REASON: Record<AgentType, string> = {
  perturbation_evidence: "Perturbation evidence",
  pathway_signature: "Pathway signature",
  robustness_quality: "Robustness quality",
  language_causality: "Language & causality",
};

/**
 * Full-length rationale, deterministically built by joining every agent's
 * own agent_reasoning_summary — always available (no extra Claude call),
 * and exactly what Evidence Trace / Technical Pipeline should show when a
 * user wants more than the concise claim-card Reason.
 */
export function buildDetailedReason(agentResults: FourAgentResults): string {
  return (Object.entries(agentResults) as [AgentType, AgentResult][])
    .map(([agentType, result]) => `${AGENT_LABEL_FOR_REASON[agentType]}: ${result.agent_reasoning_summary}`)
    .join(" ");
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export function aggregateFinalVerdictForClaim(claimAgentResults: ClaimAgentResults): FinalClaimResult {
  const agentResults = claimAgentResults.agent_results;
  const context: ClaimVerdictContext = {
    claim_type: claimAgentResults.claim_type,
    original_claim_text: claimAgentResults.original_claim_text,
  };

  const final_verdict = chooseFinalVerdict(agentResults, context);

  const triggerWord = getLanguageTriggerWord(agentResults.language_causality);
  const overstatedTextMatch = textIncludesAnyPhrase(context.original_claim_text, OVERSTATED_TEXT_TRIGGERS);
  const hasOverstatedLanguage = (triggerWord !== null && OVERSTATED_TRIGGER_WORDS.has(triggerWord.toLowerCase())) || overstatedTextMatch !== null;

  const supported_parts = buildSupportedParts(agentResults);
  const caveats = buildCaveats(agentResults);
  const unsupported_or_overstated_parts = buildUnsupportedOrOverstatedParts(agentResults);
  const missing_evidence = buildMissingEvidence(agentResults, hasOverstatedLanguage);
  const risk_flags = deriveMajorRiskFlags(agentResults);
  const recommended_action = chooseRecommendedAction(final_verdict, agentResults);

  const safer_rewrite =
    final_verdict === "unsupported"
      ? "No evidence-grounded rewrite is recommended without additional supporting evidence."
      : buildSaferRewrite(claimAgentResults.original_claim_text, agentResults);

  const partial: Pick<FinalClaimResult, "final_verdict" | "supported_parts" | "caveats" | "missing_evidence" | "recommended_action"> = {
    final_verdict,
    supported_parts,
    caveats,
    missing_evidence,
    recommended_action,
  };

  return {
    claim_id: claimAgentResults.claim_id,
    interpretation_id: claimAgentResults.interpretation_id,
    original_claim_text: claimAgentResults.original_claim_text,
    claim_type: claimAgentResults.claim_type,
    final_verdict,
    evidence_basis: buildEvidenceBasis(agentResults),
    trace: {
      sentence_id: claimAgentResults.sentence_id,
      agent_query_id: [
        agentResults.perturbation_evidence.agent_query_id,
        agentResults.pathway_signature.agent_query_id,
        agentResults.robustness_quality.agent_query_id,
        agentResults.language_causality.agent_query_id,
      ],
    },
    agent_verdicts: {
      perturbation_evidence: { agent_verdict: agentResults.perturbation_evidence.agent_verdict },
      pathway_signature: { agent_verdict: agentResults.pathway_signature.agent_verdict },
      robustness_quality: { agent_verdict: agentResults.robustness_quality.agent_verdict },
      language_causality: { agent_verdict: agentResults.language_causality.agent_verdict },
    },
    supported_parts,
    caveats,
    unsupported_or_overstated_parts,
    missing_evidence,
    risk_flags,
    recommended_action,
    safer_rewrite,
    biologist_friendly_explanation: buildBiologistFriendlyExplanation(partial, agentResults, claimAgentResults.original_claim_text),
    detailed_reason: buildDetailedReason(agentResults),
  };
}

export function aggregateFinalVerdictsForInterpretation(agentVerdictResult: AgentVerdictResult): FinalVerdictResult {
  const claim_results = agentVerdictResult.claim_agent_results.map(aggregateFinalVerdictForClaim);

  const counts: Record<FinalVerdictLabel, number> = {
    supported: 0,
    supported_with_caveats: 0,
    partially_supported: 0,
    overstated: 0,
    unsupported: 0,
    insufficient_evidence: 0,
    needs_review: 0,
  };
  for (const r of claim_results) counts[r.final_verdict] += 1;

  const summary: FinalVerdictSummary = { total_claims: claim_results.length, ...counts };

  const global_warnings: string[] = [];
  if (summary.needs_review > 0) {
    global_warnings.push(`${summary.needs_review} claim(s) need human review due to conflicting agent signals.`);
  }
  if (summary.insufficient_evidence > 0) {
    global_warnings.push(`${summary.insufficient_evidence} claim(s) have insufficient dataset evidence.`);
  }
  global_warnings.push("All verdicts are dataset-grounded only; literature/MCP context is not included yet.");

  return {
    interpretation_id: agentVerdictResult.interpretation_id,
    summary,
    claim_results,
    global_warnings,
  };
}
