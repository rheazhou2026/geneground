import type {
  ClaimExtractionResult,
  ClaimType,
  ExtractedClaim,
  InterpretationInput,
  LanguageFlags,
  RawEntities,
} from "./schemas";
import { CAUSAL_WORDS as TAXONOMY_CAUSAL_WORDS, DIRECTION_NORMALIZATION_DICTIONARY, STRENGTH_WORDS_HIGH_RISK, STRENGTH_WORDS_LOW_RISK, STRENGTH_WORDS_MEDIUM_RISK } from "./taxonomies";
import { splitIntoSentences } from "./sentenceSplit";

interface KeywordRule {
  test: RegExp;
  label: string;
  exclude?: RegExp;
}

const GENE_SYMBOLS = [
  "STAT1",
  "IRF1",
  "IRF4",
  "BATF",
  "JUN",
  "FOS",
  "NFKB1",
  "RELA",
  "TBX21",
  "GATA3",
  "FOXP3",
  "PDCD1",
  "CTLA4",
];

const PATHWAY_KEYWORDS: KeywordRule[] = [
  { test: /interferon/i, label: "Interferon signaling" },
  { test: /inflammatory/i, label: "Inflammatory activation" },
  { test: /nf-?κB|nf-?kb/i, label: "NF-κB signaling" },
  {
    test: /\bactivation\b/i,
    label: "Immune activation",
    exclude: /inflammatory activation|t\s*cell activation/i,
  },
  { test: /\bth1\b/i, label: "Th1 polarization" },
  { test: /\bth2\b/i, label: "Th2 polarization" },
  { test: /cell cycle/i, label: "Cell cycle" },
  { test: /exhaustion/i, label: "T cell exhaustion" },
];

const CELL_CONTEXT_KEYWORDS: KeywordRule[] = [
  { test: /cd4\+?\s*t\s*cells?/i, label: "CD4+ T cells" },
  { test: /cd8\+?\s*t\s*cells?/i, label: "CD8+ T cells" },
  { test: /th2-?\s*like/i, label: "Th2-like polarization state" },
  { test: /th1-?\s*like/i, label: "Th1-like polarization state" },
  {
    test: /\bt\s*cells?\b/i,
    label: "T cells",
    exclude: /cd4\+?\s*t\s*cells?|cd8\+?\s*t\s*cells?/i,
  },
];

const CONDITION_KEYWORDS: KeywordRule[] = [
  { test: /stim\s*48\s*hr|48\s*h(r)?\s*stimulation/i, label: "Stim48hr" },
  { test: /stim\s*8\s*hr|8\s*h(r)?\s*stimulation/i, label: "Stim8hr" },
  { test: /early stimulation/i, label: "Early stimulation" },
  { test: /late stimulation/i, label: "Late stimulation" },
  { test: /\bstimulated\b/i, label: "Stimulated" },
  { test: /\bresting\b/i, label: "Resting" },
];

// Taxonomy labels are sourced from src/lib/taxonomies.ts, not redefined here.
const STRENGTH_WORDS = [...STRENGTH_WORDS_LOW_RISK, ...STRENGTH_WORDS_MEDIUM_RISK, ...STRENGTH_WORDS_HIGH_RISK];
const CAUSAL_WORDS = TAXONOMY_CAUSAL_WORDS;
const DIRECTION_WORDS = Object.keys(DIRECTION_NORMALIZATION_DICTIONARY);

const THERAPEUTIC_TRIGGER = /therapeutic|translational|drug target|clinical target/i;

// Derived from taxonomies.ts's STRENGTH_WORDS_HIGH_RISK rather than a separate
// hardcoded list — "master regulator" / "central regulator" / "key regulator".
const REGULATOR_WORDS = STRENGTH_WORDS_HIGH_RISK.filter((w) => w.includes("regulator"));
const CAUSAL_MECHANISM_TRIGGER = new RegExp(`\\b(${TAXONOMY_CAUSAL_WORDS.map(escapeRegExp).join("|")})\\b`, "i");
const REGULATOR_TRIGGER = new RegExp(`\\b(${REGULATOR_WORDS.map(escapeRegExp).join("|")})\\b`, "i");

// Claim-type detection triggers below are classifier heuristics, not
// taxonomy label lists, so they stay local to this file (same convention as
// PATHWAY_KEYWORDS/CELL_CONTEXT_KEYWORDS/CONDITION_KEYWORDS above).
const CELL_STATE_TRIGGER = /\b(state|polarization|phenotype|identity|annotated as)\b|-like\b/i;
const PATHWAY_TRIGGER = /\b(pathway|signaling|signalling|response)\b/i;
const GENE_EXPRESSION_TRIGGER =
  /\b(expression (increased|decreased|is up|is down|was up|was down)|upregulated|downregulated|differentially expressed|transcript levels?)\b/i;
const CONDITION_SPECIFIC_TRIGGER =
  /\b(only in|specifically in|restricted to|but not in|selectively in|only after|only under|depends on (the )?condition)\b/i;
const ROBUSTNESS_TRIGGER = /\b(robust|reproducible|validated|reliable|consistent across|replicates)\b|across (donors|guides)/i;
const COMPARATIVE_TRIGGER = /\b(than|compared to|versus|vs\.?)\b|stronger effect|weaker effect/i;
const NOVELTY_TRIGGER = /\b(novel|unexpected|previously unknown|first time|newly identified|newly discovered)\b/i;
const SUMMARY_TRIGGER = /\b(overall|together|in summary|broadly|collectively|taken together)\b/i;
const METHOD_OR_DATA_TRIGGER =
  /\b(dataset|guide coverage|sequencing depth|pipeline|quality control|read depth|library size)\b|\bqc\b|analysis (pipeline|method)/i;
const PERTURBATION_TYPE_TRIGGER = /\b(knockdown|knock-down|knockout|knock-out|overexpression|perturbation|crispri|repression|silencing)\b/i;
const UNSUPPORTED_GENERALIZATION_TRIGGER = /\b(all|every|always|completely|universally|entirely)\b/i;

/**
 * If a sentence contains both a biological-effect clause and a separate
 * therapeutic/translational phrase, split it into two claim fragments at
 * the comma boundary before the therapeutic phrase. Otherwise returns the
 * sentence unchanged as a single fragment.
 */
function maybeSplitTherapeutic(sentence: string): string[] {
  const match = THERAPEUTIC_TRIGGER.exec(sentence);
  if (!match) return [sentence];

  const commaIndex = sentence.lastIndexOf(",", match.index);
  if (commaIndex === -1) return [sentence];

  const partA = sentence.slice(0, commaIndex).trim();
  const partBRaw = sentence.slice(commaIndex + 1).trim();
  if (partA.length === 0 || partBRaw.length === 0) return [sentence];

  const partB = partBRaw.charAt(0).toUpperCase() + partBRaw.slice(1);
  return [partA, partB];
}

function matchKeywordRules(text: string, rules: KeywordRule[]): string[] {
  const matches: string[] = [];
  for (const rule of rules) {
    if (rule.test.test(text) && !(rule.exclude && rule.exclude.test(text))) {
      matches.push(rule.label);
    }
  }
  return matches;
}

function extractGenes(text: string): string[] {
  return GENE_SYMBOLS.filter((gene) => new RegExp(`\\b${gene}\\b`, "i").test(text));
}

function extractRawEntities(text: string): RawEntities {
  return {
    genes: extractGenes(text),
    pathways: matchKeywordRules(text, PATHWAY_KEYWORDS),
    cell_context: matchKeywordRules(text, CELL_CONTEXT_KEYWORDS),
    conditions: matchKeywordRules(text, CONDITION_KEYWORDS),
    direction: findPhraseMatches(text, DIRECTION_WORDS),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word-boundary phrase matching (not plain substring) — short direction
 * words like "up"/"down" are otherwise prone to false positives as
 * substrings of unrelated words (e.g. "up" inside "suppresses", "down"
 * inside "knockdown").
 */
function findPhraseMatches(text: string, phrases: readonly string[]): string[] {
  return phrases.filter((phrase) => new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i").test(text));
}

function extractLanguageFlags(text: string): LanguageFlags {
  return {
    strength_words: findPhraseMatches(text, STRENGTH_WORDS),
    causal_words: findPhraseMatches(text, CAUSAL_WORDS),
  };
}

/**
 * Rule-based claim-type cascade over the full docs/geneground-taxonomies.md
 * taxonomy (15 values). Priority order (most specific/highest-risk first),
 * per that doc's classification guidance:
 *
 *   unsupported_generalization, therapeutic_relevance, causal_mechanism,
 *   regulatory_role, cell_state_effect, pathway_effect, gene_expression_effect,
 *   condition_specific_effect, robustness_claim, comparative_claim,
 *   novelty_claim, summary_claim, method_or_data_claim, perturbation_effect,
 *   unknown.
 *
 * unsupported_generalization is checked first because a totalizing/overbroad
 * claim should win even when it also contains a causal/regulator trigger
 * word (e.g. "proves X controls disease" is a generalization, not just a
 * causal claim). perturbation_effect is a low-priority fallback — a generic
 * "perturbation happened" claim is less specific than a pathway/cell-state/
 * gene-expression readout of that same perturbation.
 */
function classifyClaimType(text: string): ClaimType {
  const lower = text.toLowerCase();

  if (UNSUPPORTED_GENERALIZATION_TRIGGER.test(lower)) return "unsupported_generalization";
  if (THERAPEUTIC_TRIGGER.test(lower)) return "therapeutic_relevance";
  if (CAUSAL_MECHANISM_TRIGGER.test(lower)) return "causal_mechanism";
  if (REGULATOR_TRIGGER.test(lower)) return "regulatory_role";
  if (CELL_STATE_TRIGGER.test(lower)) return "cell_state_effect";
  if (PATHWAY_TRIGGER.test(lower)) return "pathway_effect";
  if (GENE_EXPRESSION_TRIGGER.test(lower)) return "gene_expression_effect";
  if (CONDITION_SPECIFIC_TRIGGER.test(lower)) return "condition_specific_effect";
  if (ROBUSTNESS_TRIGGER.test(lower)) return "robustness_claim";
  if (COMPARATIVE_TRIGGER.test(lower)) return "comparative_claim";
  if (NOVELTY_TRIGGER.test(lower)) return "novelty_claim";
  if (SUMMARY_TRIGGER.test(lower)) return "summary_claim";
  if (METHOD_OR_DATA_TRIGGER.test(lower)) return "method_or_data_claim";
  if (PERTURBATION_TYPE_TRIGGER.test(lower)) return "perturbation_effect";
  return "unknown";
}

function buildExtractionNotes(
  languageFlags: LanguageFlags,
  wasSplit: boolean,
  referentAdded?: string,
): string[] | undefined {
  const notes: string[] = [];

  if (wasSplit) {
    notes.push(
      "Split from a sentence that also contained a separate therapeutic/translational phrase.",
    );
  }
  if (languageFlags.strength_words.some((w) => w === "master regulator" || w === "key regulator")) {
    notes.push(
      "Contains regulator-ranking language ('key regulator' / 'master regulator') — requires stronger evidence than differential expression alone.",
    );
  }
  if (languageFlags.causal_words.length > 0) {
    notes.push(
      "Contains causal language — requires stronger evidence than a correlational or differential-expression signal.",
    );
  }
  if (referentAdded) {
    notes.push(
      `Originally began with a bare pronoun ('${referentAdded}' context) with no referent of its own — the subject from the preceding claim was prepended so this claim is independently checkable.`,
    );
  }

  return notes.length > 0 ? notes : undefined;
}

// ---------------------------------------------------------------------------
// Contextless-fragment handling (a claim fragment that begins with a bare
// pronoun and no referent of its own — e.g. "This directional pattern is
// reproducible across timepoints." right after a claim that already named
// the gene/pattern in question).
// ---------------------------------------------------------------------------

const LEADING_PRONOUN_PATTERN = /^(this|these|that|it|they)\b/i;

// Overlap ratio (of the fragment's own significant words already present in
// the previous claim) above which a pronoun-led fragment is treated as
// restating the same assertion rather than adding new checkable content.
const DUPLICATE_OVERLAP_THRESHOLD = 0.5;

const EXTRACTION_STOPWORDS = new Set([
  "the", "a", "an", "this", "these", "that", "those", "it", "they", "is", "are", "was", "were",
  "of", "in", "on", "at", "to", "for", "and", "or", "but", "with", "as", "by", "from", "across",
  "not", "does", "do", "did", "be", "been", "being", "than", "then", "so", "also", "which", "who",
]);

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9+\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !EXTRACTION_STOPWORDS.has(w)),
  );
}

function overlapRatio(fragmentWords: Set<string>, previousWords: Set<string>): number {
  if (fragmentWords.size === 0) return 0;
  let shared = 0;
  for (const w of fragmentWords) if (previousWords.has(w)) shared += 1;
  return shared / fragmentWords.size;
}

function stripLeadingPronoun(text: string): string {
  return text.replace(LEADING_PRONOUN_PATTERN, "").trim();
}

/** First gene, else first pathway, mentioned in the previous claim — the closest thing to "what does 'this'/'these' refer to" available without full coreference resolution. */
function extractReferentSubject(previousClaim: ExtractedClaim | undefined): string | null {
  if (!previousClaim) return null;
  if (previousClaim.raw_entities.genes.length > 0) return previousClaim.raw_entities.genes.join("/");
  if (previousClaim.raw_entities.pathways.length > 0) return previousClaim.raw_entities.pathways[0];
  return null;
}

function rewriteWithReferent(fragmentText: string, referent: string): string {
  return `Regarding ${referent}, ${fragmentText.charAt(0).toLowerCase()}${fragmentText.slice(1)}`;
}

/**
 * Mock raw-claim extraction: splits an interpretation into sentences, splits
 * multi-claim sentences (biological effect + therapeutic phrase) into
 * separate claims, and tags each with pattern-matched entities and language
 * flags. Deterministic and local — no Claude API call yet.
 *
 * A fragment that begins with a bare pronoun ("this"/"these"/"that"/"it"/
 * "they") and no referent of its own is either dropped (if it just restates
 * the immediately preceding claim's assertion — e.g. a second "this
 * directional pattern is reproducible..." clause) or rewritten to prepend
 * that claim's subject (e.g. its gene) so it's independently checkable. This
 * only ever touches fragments that already start with a bare pronoun — every
 * other multi-claim-sentence split is unaffected.
 */
export function extractClaimsMock(input: InterpretationInput): ClaimExtractionResult {
  const sentences = splitIntoSentences(input.full_text);
  const claims: ExtractedClaim[] = [];
  let claimCounter = 0;

  sentences.forEach((sentenceText, sentenceIndex) => {
    const sentenceId = `${input.interpretation_id}-s${sentenceIndex + 1}`;
    const fragments = maybeSplitTherapeutic(sentenceText);
    const wasSplit = fragments.length > 1;

    fragments.forEach((rawFragmentText) => {
      const previousClaim = claims[claims.length - 1];
      const startsWithBarePronoun = LEADING_PRONOUN_PATTERN.test(rawFragmentText.trim());

      if (startsWithBarePronoun && previousClaim) {
        const overlap = overlapRatio(significantWords(stripLeadingPronoun(rawFragmentText)), significantWords(previousClaim.original_text));
        if (overlap >= DUPLICATE_OVERLAP_THRESHOLD) {
          // Contextless restatement of an assertion the previous claim
          // already made (e.g. the same reproducibility clause) — drop it
          // rather than extracting a second, duplicate claim.
          return;
        }
      }

      let fragmentText = rawFragmentText;
      let referentAdded: string | null = null;
      if (startsWithBarePronoun) {
        const referent = extractReferentSubject(previousClaim);
        if (referent) {
          fragmentText = rewriteWithReferent(rawFragmentText, referent);
          referentAdded = referent;
        } else {
          // No referent available anywhere to attach — an unfixable
          // contextless fragment, so don't extract it standalone.
          return;
        }
      }

      claimCounter += 1;
      const languageFlags = extractLanguageFlags(fragmentText);

      claims.push({
        claim_id: `${input.interpretation_id}-c${claimCounter}`,
        interpretation_id: input.interpretation_id,
        sentence_id: sentenceId,
        original_text: fragmentText,
        claim_type: classifyClaimType(fragmentText),
        raw_entities: extractRawEntities(fragmentText),
        language_flags: languageFlags,
        extraction_notes: buildExtractionNotes(languageFlags, wasSplit, referentAdded ?? undefined),
      });
    });
  });

  return {
    interpretation_id: input.interpretation_id,
    source_text: input.full_text,
    claims,
  };
}
