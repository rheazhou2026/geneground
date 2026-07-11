// Claim-card display helper: classifies how different a claim's safer_rewrite
// actually reads from its original wording, so the UI never looks like it
// "rewrote" a claim that only got a trivial wording touch-up (e.g. "response"
// -> "transcriptional response"). Display-only — never affects rewrite_needed,
// final_verdict, or any other pipeline state.

export type RewriteMateriality = "identical" | "minor_clarification" | "material";

function normalizeForCompare(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Standard dynamic-programming longest common subsequence length. Fine for claim-length strings (tens to low hundreds of characters). */
function longestCommonSubsequenceLength(a: string, b: string): number {
  const n = b.length;
  const dp = new Array(n + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = 0;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prevDiag + 1 : Math.max(dp[j], dp[j - 1]);
      prevDiag = temp;
    }
  }
  return dp[n];
}

/** Character-level similarity in [0, 1] via LCS — robust to word insertions/substitutions, unlike a positional word-by-word diff. */
export function textSimilarityRatio(a: string, b: string): number {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (na.length === 0 && nb.length === 0) return 1;
  if (na.length === 0 || nb.length === 0) return 0;
  const lcs = longestCommonSubsequenceLength(na, nb);
  return (2 * lcs) / (na.length + nb.length);
}

// A "minor clarification" changes only a handful of characters relative to
// the claim's total length (e.g. inserting one qualifying word) — high bar,
// deliberately, so a genuine rewrite (softened verb, added caveat clause,
// restructured sentence) never gets miscategorized as trivial.
const MINOR_CLARIFICATION_SIMILARITY_THRESHOLD = 0.9;

/**
 * "identical" — original and rewrite read the same after whitespace/case
 * normalization (rewrite_needed=false claims always land here).
 * "minor_clarification" — the rewrite is a tiny wording touch-up (>=90%
 * character-level overlap) that shouldn't be presented as a rewrite.
 * "material" — a genuine rewrite: softened language, added caveat, or
 * restructured wording.
 */
export function classifyRewriteMateriality(originalText: string, rewriteText: string): RewriteMateriality {
  if (normalizeForCompare(originalText) === normalizeForCompare(rewriteText)) return "identical";
  if (textSimilarityRatio(originalText, rewriteText) >= MINOR_CLARIFICATION_SIMILARITY_THRESHOLD) return "minor_clarification";
  return "material";
}
