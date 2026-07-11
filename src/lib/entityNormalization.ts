import genesOntologyRaw from "@/data/ontology-mini/genes.hgnc.mini.json";
import cellOntologyRaw from "@/data/ontology-mini/cell_ontology.cl.mini.json";
import pathwaysOntologyRaw from "@/data/ontology-mini/pathways.reactome.mini.json";
import signaturesOntologyRaw from "@/data/ontology-mini/signatures.immune_curated.mini.json";
import datasetTermsRaw from "@/data/ontology-mini/dataset_terms.geneground.json";
import type {
  CategorizedBiologicalEntities,
  ExtractedClaim,
  EntityNormalizationResult,
  NormalizedCellContext,
  NormalizedClaimEntities,
  NormalizedConditionEntity,
  NormalizedDirectionEntity,
  NormalizedDirectionValue,
  NormalizedGeneEntity,
  NormalizedPathwayEntity,
} from "./schemas";

// ---------------------------------------------------------------------------
// Mini ontology bundle — lightweight structural types for the build-time
// JSON files under src/data/ontology-mini/ (see scripts/build-mini-ontology.mjs).
// Not Zod-validated: these are our own generated artifacts, not external input.
// ---------------------------------------------------------------------------

interface GeneTerm {
  hgnc_id: string | null;
  symbol: string;
  name: string | null;
  alias_symbol: string[];
  prev_symbol: string[];
  ensembl_gene_id: string | null;
}

interface GeneOntology {
  approved_symbols: Record<string, GeneTerm>;
  alias_to_symbol: Record<string, string>;
  previous_symbol_to_symbol: Record<string, string>;
  manual_alias_overrides: Record<string, string>;
}

interface CellTerm {
  id: string;
  label: string;
  synonyms: string[];
  curated: boolean;
  caveat: string | null;
}

interface CellOntology {
  id_to_term: Record<string, CellTerm>;
  label_to_id: Record<string, string>;
  synonym_to_id: Record<string, string>;
}

interface PathwayTerm {
  id: string;
  name: string;
}

interface PathwayOntology {
  pathway_id_to_term: Record<string, PathwayTerm>;
  pathway_name_to_ids: Record<string, string[]>;
  pathway_alias_to_ids: Record<string, string[]>;
}

interface CuratedSignature {
  signature_id: string;
  display_name: string;
  aliases: string[];
  caveat: string;
}

interface SignatureOntology {
  signatures: CuratedSignature[];
}

interface DatasetConditionAlias {
  conditions: string[];
  ambiguous: boolean;
  note: string | null;
}

interface DatasetPerturbationAlias {
  normalized: string | null;
  warning: string | null;
  note: string | null;
}

interface DatasetTerms {
  conditions: string[];
  condition_aliases: Record<string, DatasetConditionAlias>;
  perturbation_type_aliases: Record<string, DatasetPerturbationAlias>;
  direction_aliases: Record<string, "up" | "down" | "changed">;
}

const GENE_ONTOLOGY = genesOntologyRaw as unknown as GeneOntology;
const CELL_ONTOLOGY = cellOntologyRaw as unknown as CellOntology;
const PATHWAY_ONTOLOGY = pathwaysOntologyRaw as unknown as PathwayOntology;
const SIGNATURE_ONTOLOGY = signaturesOntologyRaw as unknown as SignatureOntology;
const DATASET_TERMS = datasetTermsRaw as unknown as DatasetTerms;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Genes
// ---------------------------------------------------------------------------

/**
 * Step 3's gene extraction only matches exact approved symbols already
 * present verbatim in the text, so it can't surface alias phrasings like
 * "T-bet" or "PD-1". Step 4 re-scans the claim's own text against the full
 * HGNC mini panel (approved symbols + aliases + previous symbols) so those
 * phrasings resolve correctly, preserving the exact substring as typed.
 */
export function findRawGeneMentions(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const vocab = [
    ...Object.keys(GENE_ONTOLOGY.approved_symbols),
    ...Object.keys(GENE_ONTOLOGY.alias_to_symbol),
    ...Object.keys(GENE_ONTOLOGY.previous_symbol_to_symbol),
  ];

  for (const term of vocab) {
    const match = new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").exec(text);
    if (!match) continue;
    const key = match[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(match[0]);
  }

  return found;
}

/**
 * HGNC-first: approved symbols, then alias symbols, then previous symbols.
 * Manual alias overrides are checked only after all three HGNC lookups fail
 * — they must never shadow a real HGNC match (docs/geneground-taxonomies.md
 * Gene Source taxonomy: "Manual alias overrides should not override an HGNC
 * match").
 */
function normalizeGeneRaw(raw: string): NormalizedGeneEntity {
  const lower = raw.toLowerCase();

  if (GENE_ONTOLOGY.approved_symbols[raw.toUpperCase()]) {
    const term = GENE_ONTOLOGY.approved_symbols[raw.toUpperCase()];
    return {
      raw,
      normalized_symbol: term.symbol,
      source: "HGNC",
      source_id: term.hgnc_id,
      match_type: "exact_symbol",
      confidence: 0.95,
      warnings: [],
    };
  }

  if (GENE_ONTOLOGY.alias_to_symbol[lower]) {
    const symbol = GENE_ONTOLOGY.alias_to_symbol[lower];
    const term = GENE_ONTOLOGY.approved_symbols[symbol];
    return {
      raw,
      normalized_symbol: symbol,
      source: "HGNC",
      source_id: term?.hgnc_id ?? null,
      match_type: "alias_symbol",
      confidence: 0.85,
      warnings: [],
    };
  }

  if (GENE_ONTOLOGY.previous_symbol_to_symbol[lower]) {
    const symbol = GENE_ONTOLOGY.previous_symbol_to_symbol[lower];
    const term = GENE_ONTOLOGY.approved_symbols[symbol];
    return {
      raw,
      normalized_symbol: symbol,
      source: "HGNC",
      source_id: term?.hgnc_id ?? null,
      match_type: "previous_symbol",
      confidence: 0.8,
      warnings: [`'${raw}' is a previous HGNC symbol; current approved symbol is '${symbol}'.`],
    };
  }

  if (GENE_ONTOLOGY.manual_alias_overrides[lower]) {
    const symbol = GENE_ONTOLOGY.manual_alias_overrides[lower];
    const term = GENE_ONTOLOGY.approved_symbols[symbol];
    return {
      raw,
      normalized_symbol: symbol,
      source: "manual_alias_override",
      source_id: term?.hgnc_id ?? null,
      match_type: "manual_alias_override",
      confidence: 0.9,
      warnings: [],
    };
  }

  return {
    raw,
    normalized_symbol: null,
    source: "unresolved",
    source_id: null,
    match_type: "unresolved",
    confidence: 0.15,
    warnings: [`'${raw}' is not in the mini HGNC gene panel — this is a focused subset, not the full ~45k gene set.`],
  };
}

export function normalizeGenes(rawGenes: string[]): NormalizedGeneEntity[] {
  return dedupePreserveOrder(rawGenes).map(normalizeGeneRaw);
}

/**
 * All identifiers (approved symbol, aliases, previous symbols, Ensembl ID)
 * that a chunk's own gene metadata might legitimately be stored under for
 * one normalized gene symbol — used by evidenceRetrieval.ts's hard gene
 * filter so a chunk whose `target_gene_symbol`/`target_gene_ensembl` is an
 * alias or Ensembl ID for an allowed gene still counts as a match, not just
 * an exact approved-symbol string match.
 */
export function expandGeneIdentifiers(normalizedSymbol: string): { symbols: string[]; ensemblIds: string[] } {
  const term = GENE_ONTOLOGY.approved_symbols[normalizedSymbol.toUpperCase()];
  if (!term) return { symbols: [normalizedSymbol], ensemblIds: [] };
  return {
    symbols: Array.from(new Set([term.symbol, ...term.alias_symbol, ...term.prev_symbol])),
    ensemblIds: term.ensembl_gene_id ? [term.ensembl_gene_id] : [],
  };
}

// ---------------------------------------------------------------------------
// Pathways / processes / signatures
// ---------------------------------------------------------------------------

// Mirrors scripts/build-mini-ontology.mjs's IMMUNE_PATHWAY_KEYWORD_GROUPS —
// used only to pick which pre-computed pathway_alias_to_ids bucket(s) apply
// to a raw string; keep these patterns in sync if that script's groups change.
const REACTOME_KEYWORD_PATTERNS: Record<string, RegExp> = {
  interferon: /interferon/i,
  cytokine: /cytokine/i,
  interleukin: /interleukin/i,
  t_cell: /\bt[\s-]cell\b|\bt[\s-]lymphocyte\b/i,
  nf_kb: /nf-?[κk]?appa?b|nf-?kb/i,
  inflammatory: /inflammat/i,
  antigen: /antigen/i,
  immune: /immun/i,
  jak_stat: /jak[\s-]?stat/i,
  cell_cycle: /cell cycle/i,
  apoptosis: /apoptosis|apoptotic/i,
  proliferation: /proliferation/i,
};

// Cross-references a raw pathway phrase to related curated signatures beyond
// exact alias matches — e.g. generic "interferon" text should surface both
// the alpha and gamma response signatures, not just whichever one happens to
// share an exact alias string.
const SIGNATURE_KEYWORD_GROUPS: { pattern: RegExp; signatureIds: string[] }[] = [
  { pattern: /interferon/i, signatureIds: ["interferon_alpha_response", "interferon_gamma_response"] },
  { pattern: /inflammat/i, signatureIds: ["inflammatory_response", "tnf_nfkB_signaling"] },
  { pattern: /nf-?[κk]?appa?b|nf-?kb|\btnf\b/i, signatureIds: ["tnf_nfkB_signaling"] },
  { pattern: /t\s*cell activation/i, signatureIds: ["t_cell_activation"] },
  { pattern: /\bth1\b/i, signatureIds: ["th1_like_polarization"] },
  { pattern: /\bth2\b/i, signatureIds: ["th2_like_polarization"] },
  { pattern: /exhaust/i, signatureIds: ["exhaustion_like_signature"] },
  { pattern: /proliferation|cell cycle/i, signatureIds: ["proliferation_cell_cycle"] },
  { pattern: /stress/i, signatureIds: ["stress_response"] },
];

const MAX_KEYWORD_CANDIDATES = 5;

function matchReactome(rawLower: string): { ids: string[]; matchType: "exact_name" | "keyword" | null; warnings: string[] } {
  const exact = PATHWAY_ONTOLOGY.pathway_name_to_ids[rawLower];
  if (exact && exact.length > 0) {
    return { ids: exact, matchType: "exact_name", warnings: [] };
  }

  const keywordIds = new Set<string>();
  for (const [keyword, pattern] of Object.entries(REACTOME_KEYWORD_PATTERNS)) {
    if (!pattern.test(rawLower)) continue;
    for (const id of PATHWAY_ONTOLOGY.pathway_alias_to_ids[keyword] ?? []) keywordIds.add(id);
  }

  if (keywordIds.size === 0) return { ids: [], matchType: null, warnings: [] };

  const allIds = Array.from(keywordIds);
  const capped = allIds.slice(0, MAX_KEYWORD_CANDIDATES);
  const warnings =
    allIds.length > MAX_KEYWORD_CANDIDATES
      ? [`Showing top ${MAX_KEYWORD_CANDIDATES} of ${allIds.length} keyword-matched Reactome pathways.`]
      : [];
  return { ids: capped, matchType: "keyword", warnings };
}

function matchSignatures(rawLower: string): { exact: CuratedSignature[]; fuzzy: CuratedSignature[] } {
  const byId = new Map(SIGNATURE_ONTOLOGY.signatures.map((sig) => [sig.signature_id, sig]));
  const exactIds = new Set<string>();
  const fuzzyIds = new Set<string>();

  for (const sig of SIGNATURE_ONTOLOGY.signatures) {
    const candidates = [sig.display_name.toLowerCase(), ...sig.aliases.map((a) => a.toLowerCase())];
    if (candidates.includes(rawLower)) exactIds.add(sig.signature_id);
  }

  for (const { pattern, signatureIds } of SIGNATURE_KEYWORD_GROUPS) {
    if (!pattern.test(rawLower)) continue;
    for (const id of signatureIds) {
      if (!exactIds.has(id)) fuzzyIds.add(id);
    }
  }

  return {
    exact: Array.from(exactIds)
      .map((id) => byId.get(id))
      .filter((sig): sig is CuratedSignature => Boolean(sig)),
    fuzzy: Array.from(fuzzyIds)
      .map((id) => byId.get(id))
      .filter((sig): sig is CuratedSignature => Boolean(sig)),
  };
}

function normalizePathwayRaw(raw: string): NormalizedPathwayEntity {
  const rawLower = raw.toLowerCase();
  const warnings: string[] = [];

  const reactome = matchReactome(rawLower);
  warnings.push(...reactome.warnings);

  const { exact: exactSignatures, fuzzy: fuzzySignatures } = matchSignatures(rawLower);
  const signatureMatches = [...exactSignatures, ...fuzzySignatures];
  for (const sig of signatureMatches) {
    warnings.push(`${sig.display_name}: ${sig.caveat}`);
    if (sig.signature_id === "exhaustion_like_signature") {
      warnings.push(
        "Exhaustion-like signature reflects a transcriptional state, not confirmed cell identity — requires marker/protein-level evidence.",
      );
    }
  }

  const signatureIds = signatureMatches.map((sig) => sig.signature_id);
  const candidateIds = Array.from(new Set([...reactome.ids, ...signatureIds]));

  if (candidateIds.length === 0) {
    return {
      raw,
      normalized_name: null,
      candidate_ids: [],
      source: "unresolved",
      match_type: "unresolved",
      confidence: 0.15,
      warnings: [`No Reactome pathway or curated signature match found for '${raw}'.`],
    };
  }

  const hasReactome = reactome.ids.length > 0;
  const hasSignature = signatureIds.length > 0;
  const source = hasReactome && hasSignature ? "Reactome + curated_immune_signature" : hasReactome ? "Reactome" : "curated_immune_signature";

  let matchType: NormalizedPathwayEntity["match_type"];
  let confidence: number;
  if (reactome.matchType === "exact_name") {
    matchType = "exact_name";
    confidence = 0.9;
  } else if (exactSignatures.length > 0) {
    matchType = "alias";
    confidence = 0.8;
  } else if (reactome.matchType === "keyword") {
    matchType = "keyword";
    confidence = 0.55;
  } else {
    matchType = "curated_fallback";
    confidence = 0.65;
  }

  const normalizedName = hasReactome
    ? (PATHWAY_ONTOLOGY.pathway_id_to_term[reactome.ids[0]]?.name ?? raw)
    : (signatureMatches[0]?.display_name ?? raw);

  return {
    raw,
    normalized_name: normalizedName,
    candidate_ids: candidateIds,
    source,
    match_type: matchType,
    confidence,
    warnings,
  };
}

export function normalizePathways(rawPathways: string[]): NormalizedPathwayEntity[] {
  return dedupePreserveOrder(rawPathways).map(normalizePathwayRaw);
}

const MIN_PATHWAY_MENTION_CHARS = 4;

/**
 * Scans free text for known Reactome pathway names or curated signature
 * names/aliases actually appearing verbatim — used by the rewrite
 * entity-expansion guard (src/lib/claude/finalRewrite.ts) to catch a rewrite
 * naming a specific pathway/signature the original claim never mentioned.
 * Deliberately does not use pathway_alias_to_ids' keys (those are internal
 * keyword-bucket names like "nf_kb", not natural-language substrings).
 */
export function findRawPathwayMentions(text: string): string[] {
  const vocab = [
    ...Object.keys(PATHWAY_ONTOLOGY.pathway_name_to_ids),
    ...SIGNATURE_ONTOLOGY.signatures.map((sig) => sig.display_name),
    ...SIGNATURE_ONTOLOGY.signatures.flatMap((sig) => sig.aliases),
  ];
  const found: string[] = [];
  const seen = new Set<string>();

  for (const term of vocab) {
    if (term.trim().length < MIN_PATHWAY_MENTION_CHARS) continue;
    const match = new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").exec(text);
    if (!match) continue;
    const key = match[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(match[0]);
  }

  return found;
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/**
 * Scans free text for known dataset condition values or their aliases —
 * used by the rewrite entity-expansion guard to catch a rewrite naming a
 * culture condition (e.g. "Stim48hr") the original claim never mentioned.
 */
export function findRawConditionMentions(text: string): string[] {
  const vocab = [...DATASET_TERMS.conditions, ...Object.keys(DATASET_TERMS.condition_aliases)];
  const found: string[] = [];
  const seen = new Set<string>();

  for (const term of vocab) {
    const match = new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").exec(text);
    if (!match) continue;
    const key = match[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(match[0]);
  }

  return found;
}

function normalizeConditionRaw(raw: string): NormalizedConditionEntity {
  const lower = raw.toLowerCase();

  const canonical = DATASET_TERMS.conditions.find((c) => c.toLowerCase() === lower);
  if (canonical) {
    return {
      raw,
      candidate_dataset_values: [canonical],
      resolution: "resolved",
      reason: `'${raw}' directly matches the dataset condition value '${canonical}'.`,
      confidence: 0.95,
      warnings: [],
    };
  }

  const alias = DATASET_TERMS.condition_aliases[lower];
  if (alias) {
    const reason =
      alias.note ??
      (alias.ambiguous
        ? `'${raw}' does not specify a timepoint.`
        : `'${raw}' maps to dataset condition '${alias.conditions[0]}'.`);
    return {
      raw,
      candidate_dataset_values: alias.conditions,
      resolution: alias.ambiguous ? "ambiguous" : "resolved",
      reason,
      confidence: alias.ambiguous ? 0.5 : 0.9,
      warnings: alias.ambiguous ? [reason] : [],
    };
  }

  return {
    raw,
    candidate_dataset_values: [],
    resolution: "unresolved",
    reason: `'${raw}' does not match a known dataset condition or alias.`,
    confidence: 0.15,
    warnings: [`No dataset condition mapping found for '${raw}'.`],
  };
}

export function normalizeConditions(rawConditions: string[]): NormalizedConditionEntity[] {
  return dedupePreserveOrder(rawConditions).map(normalizeConditionRaw);
}

// ---------------------------------------------------------------------------
// Cell context
// ---------------------------------------------------------------------------

const CELL_CONTEXT_STRIP_PREFIXES = [/^primary\s+human\s+/i, /^stimulated\s+/i, /^resting\s+/i, /^unstimulated\s+/i];

function stripKnownConditionPrefix(raw: string): string {
  let stripped = raw;
  for (const pattern of CELL_CONTEXT_STRIP_PREFIXES) {
    stripped = stripped.replace(pattern, "");
  }
  return stripped.trim();
}

function resolveCellType(rawPhrase: string) {
  const stripped = stripKnownConditionPrefix(rawPhrase);
  const key = stripped.toLowerCase();
  // Step 3's cell-context labels are pluralized ("CD4+ T cells"), but Cell
  // Ontology labels are singular ("T cell") — try both forms.
  const keyCandidates = dedupePreserveOrder([key, key.replace(/\bcells\b/, "cell")]).map((k) => k.toLowerCase());

  let id: string | undefined;
  let matchedVia: "exact_label" | "synonym" = "exact_label";
  for (const candidate of keyCandidates) {
    id = CELL_ONTOLOGY.label_to_id[candidate];
    if (id) {
      matchedVia = "exact_label";
      break;
    }
    id = CELL_ONTOLOGY.synonym_to_id[candidate];
    if (id) {
      matchedVia = "synonym";
      break;
    }
  }

  if (!id) {
    return {
      normalized_name: null,
      id_system: "Cell Ontology" as const,
      source_id: null,
      match_type: "unresolved" as const,
      confidence: 0.15,
      warnings: [`No Cell Ontology match found for '${rawPhrase}'.`],
    };
  }

  const term = CELL_ONTOLOGY.id_to_term[id];
  const matchType = term.curated ? ("curated_fallback" as const) : matchedVia;
  const warnings = term.curated && term.caveat ? [term.caveat] : [];
  const confidence = matchType === "exact_label" ? 0.9 : matchType === "synonym" ? 0.85 : 0.7;

  return {
    normalized_name: term.label,
    id_system: "Cell Ontology" as const,
    source_id: term.id,
    match_type: matchType,
    confidence,
    warnings,
  };
}

function normalizeCellContextRaw(raw: string, conditionCandidates: string[]): NormalizedCellContext {
  const exhaustionMatch = /exhaust(ed|ion)/i.test(raw);
  const basePhrase = stripKnownConditionPrefix(raw).replace(/exhausted\s+/i, "").trim() || raw;
  const cellType = resolveCellType(basePhrase);

  if (exhaustionMatch) {
    cellType.warnings = [
      ...cellType.warnings,
      "Exhaustion is a transcriptional state/signature, not a confirmed cell identity here — treated as the base T cell type plus an exhaustion-like signature signal, and requires marker evidence.",
    ];
  }

  return { raw, cell_type: cellType, condition_candidates: conditionCandidates };
}

/**
 * One NormalizedCellContext per raw cell-context phrase (docs/geneground-backend-logic.md
 * Step 3B treats Cell_context as an array), mirroring how genes/pathways/conditions
 * already normalize every raw mention rather than just the first.
 */
export function normalizeCellContexts(
  rawCellContexts: string[],
  conditionResults: NormalizedConditionEntity[],
): NormalizedCellContext[] {
  const conditionCandidates = dedupePreserveOrder(conditionResults.flatMap((r) => r.candidate_dataset_values));
  return dedupePreserveOrder(rawCellContexts).map((raw) => normalizeCellContextRaw(raw, conditionCandidates));
}

// ---------------------------------------------------------------------------
// Direction
// ---------------------------------------------------------------------------

// Causal/strength words are not a direction by themselves — see rules below.
// Kept in sync with docs/geneground-taxonomies.md's Direction Dictionary
// "ambiguous" row (drives, causes, controls, regulates, reprograms, rescues).
const AMBIGUOUS_CAUSAL_DIRECTION_WORDS = new Set([
  "drives",
  "drive",
  "causes",
  "cause",
  "controls",
  "control",
  "regulates",
  "regulate",
  "reprograms",
  "reprogram",
]);
const AMBIGUOUS_STRONG_DIRECTION_WORDS = new Set(["rescues", "rescue"]);

function findRawDirectionMentions(text: string): string[] {
  const vocab = [
    ...Object.keys(DATASET_TERMS.direction_aliases),
    ...AMBIGUOUS_CAUSAL_DIRECTION_WORDS,
    ...AMBIGUOUS_STRONG_DIRECTION_WORDS,
  ];
  const found: string[] = [];
  const seen = new Set<string>();

  for (const word of vocab) {
    const match = new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").exec(text);
    if (!match) continue;
    const key = match[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(match[0]);
  }

  return found;
}

type DirectionWordKind = "up" | "down" | "changed" | "ambiguous_causal" | "ambiguous_strong" | null;

function classifyDirectionWord(raw: string): DirectionWordKind {
  const lower = raw.toLowerCase();
  if (DATASET_TERMS.direction_aliases[lower]) return DATASET_TERMS.direction_aliases[lower];
  if (AMBIGUOUS_CAUSAL_DIRECTION_WORDS.has(lower)) return "ambiguous_causal";
  if (AMBIGUOUS_STRONG_DIRECTION_WORDS.has(lower)) return "ambiguous_strong";
  return null;
}

export function normalizeDirections(rawDirections: string[]): NormalizedDirectionEntity[] {
  const words = dedupePreserveOrder(rawDirections);
  const classified = words.map((raw) => ({ raw, kind: classifyDirectionWord(raw) }));
  const clearDirection = classified.find(
    (c): c is { raw: string; kind: "up" | "down" | "changed" } => c.kind === "up" || c.kind === "down" || c.kind === "changed",
  );

  return classified.map(({ raw, kind }): NormalizedDirectionEntity => {
    if (kind === "up" || kind === "down" || kind === "changed") {
      return { raw, normalized_direction: kind, match_type: "curated_direction_dictionary", confidence: 0.9, warnings: [] };
    }

    if (kind === "ambiguous_causal") {
      if (clearDirection) {
        return {
          raw,
          normalized_direction: clearDirection.kind as NormalizedDirectionValue,
          match_type: "curated_direction_dictionary",
          confidence: 0.6,
          warnings: [
            `'${raw}' is causal/strength language, not a direction by itself — inferred '${clearDirection.kind}' from '${clearDirection.raw}' elsewhere in the claim.`,
          ],
        };
      }
      return {
        raw,
        normalized_direction: "ambiguous",
        match_type: "ambiguous",
        confidence: 0.3,
        warnings: [`'${raw}' implies a causal/strength claim but does not specify a direction on its own.`],
      };
    }

    if (kind === "ambiguous_strong") {
      return {
        raw,
        normalized_direction: "ambiguous",
        match_type: "ambiguous",
        confidence: 0.25,
        warnings: [
          `'${raw}' is strong/causal "rescue" language, not a direction by itself, and requires functional evidence beyond differential expression.`,
        ],
      };
    }

    return {
      raw,
      normalized_direction: "unresolved",
      match_type: "unresolved",
      confidence: 0.15,
      warnings: [`'${raw}' was not recognized in the direction dictionary.`],
    };
  });
}

// ---------------------------------------------------------------------------
// Claim-level orchestration
// ---------------------------------------------------------------------------

function buildNormalizationWarnings(input: {
  conditions: NormalizedConditionEntity[];
  pathways: NormalizedPathwayEntity[];
  genes: NormalizedGeneEntity[];
  cellContexts: NormalizedCellContext[];
  perturbationTypes: string[];
}): string[] {
  const warnings: string[] = [];

  for (const condition of input.conditions) {
    if (condition.resolution === "ambiguous") {
      warnings.push(
        `Condition '${condition.raw}' maps to multiple candidate dataset values (${condition.candidate_dataset_values.join(", ")}).`,
      );
    }
  }

  const resolvedTimepoints = new Set(
    input.conditions.filter((c) => c.resolution === "resolved").flatMap((c) => c.candidate_dataset_values),
  );
  if (resolvedTimepoints.has("Stim8hr") && resolvedTimepoints.has("Stim48hr")) {
    warnings.push("Both early (Stim8hr) and late (Stim48hr) stimulation timepoints are referenced in this claim.");
  }

  for (const pathway of input.pathways) {
    if (pathway.candidate_ids.length > 1) {
      warnings.push(`Pathway phrase '${pathway.raw}' maps to multiple candidate ${pathway.source ?? "pathway/signature"} entries.`);
    }
  }

  for (const perturbationType of input.perturbationTypes) {
    const alias = DATASET_TERMS.perturbation_type_aliases[perturbationType.toLowerCase()];
    if (alias?.warning && alias.note) {
      warnings.push(alias.note);
    }
  }

  for (const cellContext of input.cellContexts) {
    for (const warning of cellContext.cell_type.warnings) {
      if (!warnings.includes(warning)) warnings.push(warning);
    }
  }

  const unresolvedGenes = input.genes.filter((g) => g.match_type === "unresolved");
  if (unresolvedGenes.length > 0) {
    warnings.push(
      `${unresolvedGenes.length} gene mention(s) could not be resolved against the mini HGNC panel: ${unresolvedGenes.map((g) => g.raw).join(", ")}.`,
    );
  }

  return warnings;
}

function normalizeClaim(claim: ExtractedClaim, categorized: CategorizedBiologicalEntities): NormalizedClaimEntities {
  const rawGeneMentions = findRawGeneMentions(claim.original_text);
  const rawDirectionMentions = findRawDirectionMentions(claim.original_text);

  const genes = normalizeGenes(rawGeneMentions);
  const pathways = normalizePathways(categorized.pathways_or_processes);
  const conditions = normalizeConditions(categorized.conditions);
  const cellContexts = normalizeCellContexts(categorized.cell_contexts, conditions);
  const direction = normalizeDirections(rawDirectionMentions);

  const normalization_warnings = buildNormalizationWarnings({
    conditions,
    pathways,
    genes,
    cellContexts,
    perturbationTypes: categorized.perturbation_types,
  });

  return {
    claim_id: claim.claim_id,
    interpretation_id: claim.interpretation_id,
    genes,
    pathways,
    conditions,
    cell_context: cellContexts,
    direction,
    normalization_warnings,
  };
}

/**
 * Mock mini-ontology normalization (Step 4): resolves each categorized
 * claim's raw text against the local HGNC / Cell Ontology / Reactome +
 * curated-signature / dataset-term mini ontologies built by
 * scripts/build-mini-ontology.mjs. Preserves ambiguity (multiple candidate
 * IDs/dataset values) instead of forcing a single answer. No RAG, no
 * embeddings, no Claude API — deterministic local lookups only.
 */
export function normalizeCategorizedEntities(
  claims: ExtractedClaim[],
  categorizedClaims: CategorizedBiologicalEntities[],
): EntityNormalizationResult {
  const claimsById = new Map(claims.map((claim) => [claim.claim_id, claim]));
  const interpretationId = categorizedClaims[0]?.interpretation_id ?? claims[0]?.interpretation_id ?? "";

  const normalized_claims = categorizedClaims
    .map((categorized) => {
      const claim = claimsById.get(categorized.claim_id);
      if (!claim) return null;
      return normalizeClaim(claim, categorized);
    })
    .filter((entry): entry is NormalizedClaimEntities => entry !== null);

  return { interpretation_id: interpretationId, normalized_claims };
}
