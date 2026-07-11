// Shared safety-net shortener for claim-card-facing "Reason" text. Applied
// both to the deterministic biologist_friendly_explanation builder
// (finalVerdictAggregator.ts) and to Claude's returned Reason (the
// /api/claude/final-rewrite route) so the claim card never shows a long,
// report-style paragraph regardless of which path produced the text.

const DEFAULT_MAX_WORDS = 45;
// Stop accumulating sentences once we're past this fraction of the budget,
// so a short first sentence still gets a second one appended (reads as
// "1-2 sentences") without regularly running all the way up to the cap.
const SENTENCE_STOP_FRACTION = 0.55;

/**
 * Clamps `text` to roughly maxWords words, preferring to keep whole
 * sentences (so the result reads as prose, not a mid-sentence cut). Falls
 * back to a hard word-count clip with an ellipsis only when the input has no
 * sentence punctuation to break on at all.
 */
export function shortenReason(text: string, maxWords: number = DEFAULT_MAX_WORDS): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return trimmed;
  if (trimmed.split(/\s+/).length <= maxWords) return trimmed;

  const sentences = trimmed.match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [trimmed];
  let acc = "";
  let accWords = 0;
  for (const sentence of sentences) {
    const s = sentence.trim();
    if (s.length === 0) continue;
    const sWords = s.split(/\s+/).length;
    if (accWords > 0 && accWords + sWords > maxWords) break;
    acc = acc.length > 0 ? `${acc} ${s}` : s;
    accWords += sWords;
    if (accWords >= Math.round(maxWords * SENTENCE_STOP_FRACTION)) break;
  }

  // Either nothing accumulated, or the very first "sentence" (e.g. a single
  // long run-on, or text with no punctuation at all so the whole input was
  // treated as one "sentence") already blew the budget on its own — hard
  // clip by word count in that case rather than returning it unclamped.
  if (acc.length === 0 || accWords > maxWords) {
    return `${trimmed.split(/\s+/).slice(0, maxWords).join(" ")}…`;
  }
  return acc;
}
