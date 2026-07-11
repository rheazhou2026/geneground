import type { CategorizedBiologicalEntities, EntityCategorizationResult, ExtractedClaim } from "./schemas";

interface KeywordRule {
  test: RegExp;
  label: string;
  exclude?: RegExp;
}

const GENE_SYMBOLS = [
  "STAT1",
  "STAT2",
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
  "IL2RA",
  "IFNG",
  "IL4",
  "IL2",
  "MYC",
  "BCL6",
  "PRDM1",
];

const PATHWAY_RULES: KeywordRule[] = [
  { test: /interferon/i, label: "Interferon signaling" },
  { test: /inflammatory|inflammation/i, label: "Inflammatory response" },
  { test: /nf-?κB|nf-?kb/i, label: "NF-κB signaling" },
  { test: /t\s*cell activation/i, label: "T cell activation" },
  {
    test: /\bactivation\b/i,
    label: "Immune activation",
    exclude: /t\s*cell activation|inflammatory activation/i,
  },
  { test: /\bth1\b/i, label: "Th1 polarization" },
  { test: /\bth2\b/i, label: "Th2 polarization" },
  { test: /exhaustion/i, label: "T cell exhaustion" },
  { test: /proliferation/i, label: "Proliferation" },
  { test: /cell cycle/i, label: "Cell cycle" },
  { test: /cytokine/i, label: "Cytokine signaling" },
  { test: /stress response/i, label: "Stress response" },
  { test: /polarization/i, label: "Polarization", exclude: /\bth1\b|\bth2\b/i },
];

const CELL_CONTEXT_RULES: KeywordRule[] = [
  { test: /primary\s+human\s+cd4\+?\s*t\s*cells?/i, label: "Primary human CD4+ T cells" },
  { test: /stimulated\s+cd4\+?\s*t\s*cells?/i, label: "Stimulated CD4+ T cells" },
  { test: /resting\s+cd4\+?\s*t\s*cells?/i, label: "Resting CD4+ T cells" },
  {
    test: /cd4\+?\s*t\s*cells?/i,
    label: "CD4+ T cells",
    exclude:
      /primary\s+human\s+cd4\+?\s*t\s*cells?|stimulated\s+cd4\+?\s*t\s*cells?|resting\s+cd4\+?\s*t\s*cells?/i,
  },
  { test: /\bt\s*cells?\b/i, label: "T cells", exclude: /cd4\+?\s*t\s*cells?/i },
];

const CONDITION_RULES: KeywordRule[] = [
  { test: /stim\s*48\s*hr|48\s*h(r)?\s*stimulation/i, label: "Stim48hr" },
  { test: /stim\s*8\s*hr|8\s*h(r)?\s*stimulation/i, label: "Stim8hr" },
  { test: /early stimulation/i, label: "Early stimulation" },
  { test: /late stimulation/i, label: "Late stimulation" },
  { test: /unstimulated/i, label: "Unstimulated" },
  { test: /\bstimulated\b/i, label: "Stimulated" },
  { test: /\bresting\b/i, label: "Resting" },
  { test: /\brest\b/i, label: "Rest" },
];

const PERTURBATION_TYPE_RULES: KeywordRule[] = [
  { test: /knock\s*down/i, label: "knockdown" },
  { test: /knock\s*out/i, label: "knockout" },
  { test: /crispri/i, label: "CRISPRi" },
  { test: /\bperturbation\b/i, label: "perturbation" },
  { test: /\brepression\b/i, label: "repression" },
  { test: /\bsilencing\b/i, label: "silencing" },
];

const DIRECTION_RULES: { test: RegExp; label: "up" | "down" | "changed" }[] = [
  { test: /\b(down|decreased|decrease|suppresses|suppressed|reduces|reduced)\b/i, label: "down" },
  { test: /\b(up|increased|increase|activates|activated|induces|induced)\b/i, label: "up" },
  { test: /\b(shifts|alters|altered|changes|changed)\b/i, label: "changed" },
];

// All-caps tokens that look gene-like but are common non-gene shorthand in
// this domain; excluded so they don't clutter uncategorized_terms.
const KNOWN_NON_GENE_ALLCAPS = new Set(["CD4", "CD8", "DNA", "RNA", "PCR", "MHC", "TCR", "BCR", "NF", "KB"]);

function matchKeywordRules(text: string, rules: KeywordRule[]): string[] {
  const found = new Set<string>();
  for (const rule of rules) {
    if (rule.test.test(text) && !(rule.exclude && rule.exclude.test(text))) {
      found.add(rule.label);
    }
  }
  return Array.from(found);
}

function extractGenes(text: string): string[] {
  return GENE_SYMBOLS.filter((gene) => new RegExp(`\\b${gene}\\b`, "i").test(text));
}

function extractDirections(text: string): string[] {
  const found = new Set<string>();
  for (const rule of DIRECTION_RULES) {
    if (rule.test.test(text)) found.add(rule.label);
  }
  return Array.from(found);
}

/**
 * Flags all-caps tokens (potential gene/protein symbols) that aren't in the
 * known vocabulary — a placeholder for "this needs ontology normalization
 * later," not an attempt at general-purpose NER.
 */
function extractUncategorizedTerms(text: string, matchedGenes: string[]): string[] {
  const candidates = text.match(/\b[A-Z][A-Z0-9]{1,7}\b/g) ?? [];
  const matchedGeneSet = new Set(matchedGenes.map((gene) => gene.toUpperCase()));
  const found = new Set<string>();

  for (const candidate of candidates) {
    const upper = candidate.toUpperCase();
    if (matchedGeneSet.has(upper) || KNOWN_NON_GENE_ALLCAPS.has(upper)) continue;
    found.add(candidate);
  }

  return Array.from(found);
}

function buildCategorizationNotes(categories: {
  genes: string[];
  pathways_or_processes: string[];
  cell_contexts: string[];
  conditions: string[];
  perturbation_types: string[];
  directions: string[];
  uncategorized_terms: string[];
}): string[] {
  const notes: string[] = [];
  const totalCategorized =
    categories.genes.length +
    categories.pathways_or_processes.length +
    categories.cell_contexts.length +
    categories.conditions.length +
    categories.perturbation_types.length +
    categories.directions.length;

  if (totalCategorized === 0 && categories.uncategorized_terms.length === 0) {
    notes.push("No known biological entities were pattern-matched in this claim.");
  }
  if (categories.uncategorized_terms.length > 0) {
    notes.push(
      `${categories.uncategorized_terms.length} gene-like term(s) were not recognized against the current vocabulary and are not yet normalized to ontology IDs.`,
    );
  }
  if (categories.genes.length > 0 && categories.directions.length === 0) {
    notes.push("A gene is mentioned but no clear directional language was detected for it.");
  }

  return notes;
}

function categorizeClaim(claim: ExtractedClaim): CategorizedBiologicalEntities {
  const text = claim.original_text;
  const genes = extractGenes(text);
  const pathways_or_processes = matchKeywordRules(text, PATHWAY_RULES);
  const cell_contexts = matchKeywordRules(text, CELL_CONTEXT_RULES);
  const conditions = matchKeywordRules(text, CONDITION_RULES);
  const perturbation_types = matchKeywordRules(text, PERTURBATION_TYPE_RULES);
  const directions = extractDirections(text);
  const uncategorized_terms = extractUncategorizedTerms(text, genes);

  return {
    claim_id: claim.claim_id,
    interpretation_id: claim.interpretation_id,
    genes,
    pathways_or_processes,
    cell_contexts,
    conditions,
    perturbation_types,
    directions,
    uncategorized_terms,
    categorization_notes: buildCategorizationNotes({
      genes,
      pathways_or_processes,
      cell_contexts,
      conditions,
      perturbation_types,
      directions,
      uncategorized_terms,
    }),
  };
}

/**
 * Mock biological entity categorization: re-scans each extracted claim's
 * text against a broader pattern-matched vocabulary and buckets mentions
 * into genes / pathways / cell context / conditions / perturbation type /
 * direction. This is organization, not normalization — values stay as raw
 * matched text (or a light up/down/changed bucket for direction), with no
 * mapping to HGNC, Ensembl, or dataset-specific IDs yet.
 */
export function categorizeBiologicalEntitiesMock(claims: ExtractedClaim[]): EntityCategorizationResult {
  const interpretationId = claims[0]?.interpretation_id ?? "";
  return {
    interpretation_id: interpretationId,
    categorized_claims: claims.map(categorizeClaim),
  };
}
