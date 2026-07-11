// Shared deterministic sentence splitting — used by the mock claim extractor
// and by the Claude claim-extraction adapter (to assign sentence_id to
// Claude-identified claims), so both paths agree on the same sentence
// boundaries for a given interpretation text.

export function splitIntoSentences(text: string): string[] {
  return text
    .split(/\r?\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z(])/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}
