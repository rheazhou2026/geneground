// Local, provider-free TF-IDF cosine similarity — no external embeddings API,
// no vector database. Used only as a fallback in Step 7 evidence retrieval
// when deterministic metadata matching finds too little (see
// docs/geneground-backend-logic.md Step 7 and docs/geneground-taxonomies.md's
// Retrieval Mode Taxonomy). Pure, deterministic, dependency-free.

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
  return tf;
}

function tfIdfVector(tokens: string[], idf: (term: string) => number): Map<string, number> {
  const tf = termFrequency(tokens);
  const vector = new Map<string, number>();
  if (tokens.length === 0) return vector;
  for (const [term, count] of tf) {
    vector.set(term, (count / tokens.length) * idf(term));
  }
  return vector;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const value of a.values()) normA += value * value;
  for (const value of b.values()) normB += value * value;
  for (const [term, value] of a) {
    const other = b.get(term);
    if (other !== undefined) dot += value * other;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Ranks each candidate text against the query text using TF-IDF cosine
 * similarity, computed over the small local corpus of {query, ...candidates}
 * — not a persistent index, not an external embeddings call. Returns one
 * similarity score (0-1) per candidate, in the same order as `candidates`.
 * Callers use the score to rank/select chunks; it is never persisted or
 * exposed as an output field (no similarity_score anywhere downstream).
 */
export function rankByTfIdfCosineSimilarity(query: string, candidates: string[]): number[] {
  const queryTokens = tokenize(query);
  const candidateTokensList = candidates.map(tokenize);
  const allDocs = [queryTokens, ...candidateTokensList];

  const documentFrequency = new Map<string, number>();
  for (const docTokens of allDocs) {
    for (const term of new Set(docTokens)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const totalDocs = allDocs.length;
  function idf(term: string): number {
    const df = documentFrequency.get(term) ?? 0;
    return Math.log((totalDocs + 1) / (df + 1)) + 1;
  }

  const queryVector = tfIdfVector(queryTokens, idf);
  return candidateTokensList.map((tokens) => cosineSimilarity(queryVector, tfIdfVector(tokens, idf)));
}
