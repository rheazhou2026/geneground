#!/usr/bin/env node
// Preprocesses raw-ontology/ reference dumps (HGNC, Cell Ontology, Reactome)
// plus hand-curated signatures/dataset terms into small, backend-ready JSON
// files under src/data/ontology-mini/. Run with: npm run build:ontology
//
// This is Step 4 (mini ontology-based entity normalization) of GeneGround's
// architecture: it produces the lookup tables that a future normalization
// layer will use to resolve claim text to canonical genes/cells/pathways/
// dataset terms. It does not itself normalize claims, call Claude, or do
// ontology reasoning (no OWL, no cross-ontology ID mapping beyond what HGNC
// already provides).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT_DIR, "raw-ontology");
const OUTPUT_DIR = path.join(ROOT_DIR, "src", "data", "ontology-mini");

const HGNC_PATH = path.join(RAW_DIR, "hgnc", "hgnc_complete_set.json");
const CL_PATH = path.join(RAW_DIR, "cell-ontology", "cl-basic.json");
const REACTOME_PATHWAYS_PATH = path.join(RAW_DIR, "reactome", "ReactomePathways.txt");
const REACTOME_RELATIONS_PATH = path.join(RAW_DIR, "reactome", "ReactomePathwaysRelation.txt");
const REACTOME_GMT_PATH = path.join(RAW_DIR, "reactome", "ReactomePathways.gmt");

const BUILD_TIMESTAMP = new Date().toISOString();

// ---------------------------------------------------------------------------
// fs helpers
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readTextFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// 1. Genes (HGNC) — focused subset, not the full ~45k-gene set
// ---------------------------------------------------------------------------

// Common immune / T-cell genes called out in the Step 4 spec. NFKB2, CD28,
// ICOS, RELB added alongside NFKB1/RELA/GATA3 — all four are real
// perturbation targets/co-stimulatory genes in the live-demo evidence bundle
// (e.g. NFKB2 = ENSG00000077150, CD28 = ENSG00000178562) and must resolve
// during entity normalization, otherwise evidenceRetrieval.ts's gene-match
// hard filter can't tell a claim's gene apart from an unrelated one and either
// over-matches (the original retrieval-precision bug) or, worse, matches
// nothing at all for a claim about a gene missing from this panel.
const CURATED_IMMUNE_GENES = [
  "STAT1", "STAT2", "IRF1", "IRF4", "BATF", "JUN", "FOS", "NFKB1", "NFKB2", "RELA", "RELB",
  "TBX21", "GATA3", "FOXP3", "PDCD1", "CTLA4", "IL2RA", "IFNG", "IL4", "IL2",
  "MYC", "BCL6", "PRDM1", "CD28", "ICOS",
];

// Genes referenced in existing GeneGround mock evidence/artifacts
// (src/data/mockClaims.json evidence excerpts + Step 2/3 mock gene lists).
const MOCK_EVIDENCE_GENES = [
  "BAK1", "BAX", "CASP1", "CCND1", "CDKN1A", "GSDMD", "GZMB", "HAVCR2",
  "IL17A", "IL1B", "LAG3", "MKI67", "MX1", "NLRP3", "OAS1", "PRF1", "RORC",
  "TNF", "TOX", "TP53",
];

const FOCUS_GENE_SYMBOLS = Array.from(new Set([...CURATED_IMMUNE_GENES, ...MOCK_EVIDENCE_GENES])).sort();

// Aliases users commonly type that don't appear verbatim in HGNC's
// alias_symbol/prev_symbol lists (different punctuation/casing).
const MANUAL_GENE_ALIAS_OVERRIDES = {
  "t-bet": "TBX21",
  "tbet": "TBX21",
  "nf-kb p65": "RELA",
  "nf-κb p65": "RELA",
  "pd-1": "PDCD1",
  "ctla-4": "CTLA4",
  "ifn-gamma": "IFNG",
  "interferon gamma": "IFNG",
};

function buildGeneMiniOntology() {
  const raw = readJsonFile(HGNC_PATH);
  const docs = raw?.response?.docs ?? [];
  const focusSet = new Set(FOCUS_GENE_SYMBOLS);

  const bySymbol = new Map();
  for (const doc of docs) {
    if (doc.symbol && focusSet.has(doc.symbol)) bySymbol.set(doc.symbol, doc);
  }

  const approved_symbols = {};
  const alias_to_symbol = {};
  const previous_symbol_to_symbol = {};
  const missingSymbols = [];

  for (const symbol of FOCUS_GENE_SYMBOLS) {
    const doc = bySymbol.get(symbol);
    if (!doc) {
      missingSymbols.push(symbol);
      continue;
    }

    const term = {
      hgnc_id: doc.hgnc_id ?? null,
      symbol: doc.symbol,
      name: doc.name ?? null,
      alias_symbol: doc.alias_symbol ?? [],
      prev_symbol: doc.prev_symbol ?? [],
      ensembl_gene_id: doc.ensembl_gene_id ?? null,
      locus_group: doc.locus_group ?? null,
      locus_type: doc.locus_type ?? null,
    };
    approved_symbols[symbol] = term;

    for (const alias of term.alias_symbol) {
      const key = alias.toLowerCase();
      if (!(key in alias_to_symbol)) alias_to_symbol[key] = symbol;
    }
    for (const prev of term.prev_symbol) {
      const key = prev.toLowerCase();
      if (!(key in previous_symbol_to_symbol)) previous_symbol_to_symbol[key] = symbol;
    }
  }

  for (const [alias, symbol] of Object.entries(MANUAL_GENE_ALIAS_OVERRIDES)) {
    alias_to_symbol[alias.toLowerCase()] = symbol;
  }

  if (missingSymbols.length > 0) {
    console.warn(`[genes] WARNING: not found in HGNC complete set: ${missingSymbols.join(", ")}`);
  }

  return {
    schema: "genes.hgnc.mini.v1",
    generated_at: BUILD_TIMESTAMP,
    source: "HGNC complete set (raw-ontology/hgnc/hgnc_complete_set.json), focused subset",
    gene_count: Object.keys(approved_symbols).length,
    missing_symbols: missingSymbols,
    approved_symbols,
    alias_to_symbol,
    previous_symbol_to_symbol,
    manual_alias_overrides: MANUAL_GENE_ALIAS_OVERRIDES,
  };
}

// ---------------------------------------------------------------------------
// 2. Cell types / cell contexts (Cell Ontology) — immune/T-cell subset
// ---------------------------------------------------------------------------

const CELL_RELEVANCE_PATTERN = /(t[\s-]cell|t[\s-]lymphocyte|helper t|regulatory t|leukocyte|lymphocyte|immune)/i;

// Curated entries for phrasings/states GeneGround needs that are not exact
// verbatim CL labels or synonyms. Each is flagged `curated: true` with a
// `caveat` explaining the gap — see raw-ontology inspection notes in the
// project history for how each mapping was chosen.
const CURATED_FALLBACK_CELL_ENTRIES = [
  {
    id: "GGROUND:CD4_T_CELL",
    label: "CD4+ T cell",
    synonyms: ["CD4-positive T cell", "CD4 T cell"],
    maps_to_cl_id: "CL:0000624",
    caveat:
      "Curated alias for 'CD4-positive, alpha-beta T cell' (CL:0000624); this exact phrasing is not a literal CL synonym.",
  },
  {
    id: "GGROUND:ACTIVATED_T_CELL",
    label: "activated T cell",
    synonyms: ["activated CD4 T cell", "activated CD4+ T cell"],
    maps_to_cl_id: "CL:0000896",
    caveat:
      "Mapped to 'activated CD4-positive, alpha-beta T cell' (CL:0000896) as the closest CD4-context match; CL has no unqualified 'activated T cell' class.",
  },
  {
    id: "GGROUND:TYPE1_HELPER_T_CELL",
    label: "type 1 helper T cell",
    synonyms: ["type I helper T cell"],
    maps_to_cl_id: "CL:0000545",
    caveat: "Alternate word order for 'T-helper 1 cell' (CL:0000545); not present verbatim among CL synonyms.",
  },
  {
    id: "GGROUND:TYPE2_HELPER_T_CELL",
    label: "type 2 helper T cell",
    synonyms: ["type II helper T cell"],
    maps_to_cl_id: "CL:0000546",
    caveat: "Alternate word order for 'T-helper 2 cell' (CL:0000546); not present verbatim among CL synonyms.",
  },
  {
    id: "GGROUND:TH1_LIKE_STATE",
    label: "Th1-like polarization state",
    synonyms: ["Th1-like state", "Th1-like phenotype"],
    maps_to_cl_id: null,
    caveat:
      "This is a transcriptional cell STATE inferred from Perturb-seq analysis, not a strict Cell Ontology class. Loosely related to 'T-helper 1 cell' (CL:0000545) but not equivalent — treat as a signature-level label, not a cell type.",
  },
  {
    id: "GGROUND:TH2_LIKE_STATE",
    label: "Th2-like polarization state",
    synonyms: ["Th2-like state", "Th2-like phenotype"],
    maps_to_cl_id: null,
    caveat:
      "This is a transcriptional cell STATE inferred from Perturb-seq analysis, not a strict Cell Ontology class. Loosely related to 'T-helper 2 cell' (CL:0000546) but not equivalent — treat as a signature-level label, not a cell type.",
  },
];

function shortCurie(uri) {
  const match = /\/obo\/([A-Za-z]+)_(\d+)$/.exec(uri ?? "");
  return match ? `${match[1]}:${match[2]}` : uri;
}

function buildCellOntologyMiniOntology() {
  const raw = readJsonFile(CL_PATH);
  const graph = raw?.graphs?.[0] ?? { nodes: [], edges: [] };
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];

  const parentsByChild = new Map();
  for (const edge of edges) {
    if (edge.pred !== "is_a") continue;
    const child = shortCurie(edge.sub);
    const parent = shortCurie(edge.obj);
    if (!parentsByChild.has(child)) parentsByChild.set(child, []);
    parentsByChild.get(child).push(parent);
  }

  const id_to_term = {};
  const label_to_id = {};
  const synonym_to_id = {};
  let relevantCount = 0;

  for (const node of nodes) {
    if (node.type !== "CLASS" || !node.lbl) continue;
    const synonyms = (node.meta?.synonyms ?? []).map((s) => s.val).filter(Boolean);
    const isRelevant = CELL_RELEVANCE_PATTERN.test(node.lbl) || synonyms.some((s) => CELL_RELEVANCE_PATTERN.test(s));
    if (!isRelevant) continue;

    relevantCount += 1;
    const id = shortCurie(node.id);
    id_to_term[id] = {
      id,
      label: node.lbl,
      synonyms,
      parent_ids: parentsByChild.get(id) ?? [],
      curated: false,
      caveat: null,
    };
    label_to_id[node.lbl.toLowerCase()] = id;
    for (const syn of synonyms) {
      const key = syn.toLowerCase();
      if (!(key in synonym_to_id)) synonym_to_id[key] = id;
    }
  }

  for (const entry of CURATED_FALLBACK_CELL_ENTRIES) {
    id_to_term[entry.id] = {
      id: entry.id,
      label: entry.label,
      synonyms: entry.synonyms,
      parent_ids: entry.maps_to_cl_id ? [entry.maps_to_cl_id] : [],
      curated: true,
      caveat: entry.caveat,
    };
    label_to_id[entry.label.toLowerCase()] = entry.id;
    for (const syn of entry.synonyms) {
      const key = syn.toLowerCase();
      if (!(key in synonym_to_id)) synonym_to_id[key] = entry.id;
    }
  }

  return {
    schema: "cell_ontology.cl.mini.v1",
    generated_at: BUILD_TIMESTAMP,
    source:
      "Cell Ontology cl-basic.json (raw-ontology/cell-ontology/cl-basic.json), immune/T-cell-relevant subset + curated fallbacks",
    total_nodes_scanned: nodes.length,
    relevant_cl_terms: relevantCount,
    curated_fallback_terms: CURATED_FALLBACK_CELL_ENTRIES.length,
    id_to_term,
    label_to_id,
    synonym_to_id,
  };
}

// ---------------------------------------------------------------------------
// 3. Pathways / biological processes (Reactome) — human + immune keyword subset
// ---------------------------------------------------------------------------

const IMMUNE_PATHWAY_KEYWORD_GROUPS = {
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

function parseReactomePathwaysTxt() {
  const lines = readTextFile(REACTOME_PATHWAYS_PATH).split(/\r?\n/).filter(Boolean);
  const pathways = [];
  for (const line of lines) {
    const [id, name, species] = line.split("\t");
    if (!id || !name) continue;
    pathways.push({ id, name, species: species ? species.trim() : null });
  }
  return pathways;
}

function parseReactomeRelationsTxt() {
  const lines = readTextFile(REACTOME_RELATIONS_PATH).split(/\r?\n/).filter(Boolean);
  const relations = [];
  for (const line of lines) {
    const [parent, child] = line.split("\t");
    if (!parent || !child) continue;
    relations.push([parent.trim(), child.trim()]);
  }
  return relations;
}

function parseReactomeGmt() {
  const lines = readTextFile(REACTOME_GMT_PATH).split(/\r?\n/).filter(Boolean);
  const geneSets = new Map();
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [name, id, ...genes] = parts;
    geneSets.set(id, { name, genes: genes.filter(Boolean) });
  }
  return geneSets;
}

function buildPathwayMiniOntology() {
  const allPathways = parseReactomePathwaysTxt();
  const humanPathways = allPathways.filter((p) => p.species === "Homo sapiens");

  const matchesKeywords = (name) => Object.values(IMMUNE_PATHWAY_KEYWORD_GROUPS).some((re) => re.test(name));
  const focusPathways = humanPathways.filter((p) => matchesKeywords(p.name));
  const focusIds = new Set(focusPathways.map((p) => p.id));

  const relations = parseReactomeRelationsTxt();
  const parentsByChild = new Map();
  const childrenByParent = new Map();
  for (const [parent, child] of relations) {
    if (!focusIds.has(parent) || !focusIds.has(child)) continue;
    if (!parentsByChild.has(child)) parentsByChild.set(child, []);
    parentsByChild.get(child).push(parent);
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(child);
  }

  const geneSets = parseReactomeGmt();

  const pathway_id_to_term = {};
  const pathway_name_to_ids = {};
  const pathway_gene_sets = {};

  for (const p of focusPathways) {
    pathway_id_to_term[p.id] = {
      id: p.id,
      name: p.name,
      species: p.species,
      parent_ids: parentsByChild.get(p.id) ?? [],
      child_ids: childrenByParent.get(p.id) ?? [],
    };

    const nameKey = p.name.toLowerCase();
    if (!pathway_name_to_ids[nameKey]) pathway_name_to_ids[nameKey] = [];
    pathway_name_to_ids[nameKey].push(p.id);

    const geneSet = geneSets.get(p.id);
    if (geneSet) pathway_gene_sets[p.id] = { name: geneSet.name, genes: geneSet.genes };
  }

  const pathway_alias_to_ids = {};
  for (const [keyword, pattern] of Object.entries(IMMUNE_PATHWAY_KEYWORD_GROUPS)) {
    const ids = focusPathways.filter((p) => pattern.test(p.name)).map((p) => p.id);
    if (ids.length > 0) pathway_alias_to_ids[keyword] = ids;
  }

  return {
    schema: "pathways.reactome.mini.v1",
    generated_at: BUILD_TIMESTAMP,
    source:
      "Reactome ReactomePathways.txt / ReactomePathwaysRelation.txt / ReactomePathways.gmt (raw-ontology/reactome/), Homo sapiens + immune/signaling keyword subset",
    total_pathways_all_species: allPathways.length,
    total_human_pathways: humanPathways.length,
    focus_pathway_count: focusPathways.length,
    gene_sets_matched: Object.keys(pathway_gene_sets).length,
    keyword_groups: Object.keys(IMMUNE_PATHWAY_KEYWORD_GROUPS),
    pathway_id_to_term,
    pathway_name_to_ids,
    pathway_alias_to_ids,
    pathway_gene_sets,
  };
}

// ---------------------------------------------------------------------------
// 4. Curated immune signatures — hand-assembled, not derived from raw files
// ---------------------------------------------------------------------------

const CURATED_SIGNATURE_CAVEAT =
  "Hand-curated for this MVP demo; not sourced from MSigDB or a peer-reviewed gene set collection.";

function buildCuratedSignatures() {
  const signatures = [
    {
      signature_id: "interferon_alpha_response",
      display_name: "Interferon alpha response",
      aliases: ["IFN-alpha response", "interferon alpha signature", "type I interferon response"],
      genes: ["STAT1", "STAT2", "IRF1", "MX1", "OAS1"],
      source: "curated_mvp_signature",
      caveat: CURATED_SIGNATURE_CAVEAT,
    },
    {
      signature_id: "interferon_gamma_response",
      display_name: "Interferon gamma response",
      aliases: ["IFN-gamma response", "interferon gamma signature", "type II interferon response"],
      genes: ["STAT1", "IRF1", "IFNG"],
      source: "curated_mvp_signature",
      caveat: CURATED_SIGNATURE_CAVEAT,
    },
    {
      signature_id: "inflammatory_response",
      display_name: "Inflammatory response",
      aliases: ["inflammation signature", "inflammatory activation"],
      genes: ["NFKB1", "RELA", "TNF", "IL1B", "NLRP3"],
      source: "curated_mvp_signature",
      caveat: CURATED_SIGNATURE_CAVEAT,
    },
    {
      signature_id: "tnf_nfkB_signaling",
      display_name: "TNF / NF-κB signaling",
      aliases: ["TNF-NF-kB signaling", "NF-kB signature", "NF-kappaB signaling"],
      genes: ["TNF", "NFKB1", "RELA"],
      source: "curated_mvp_signature",
      caveat: CURATED_SIGNATURE_CAVEAT,
    },
    {
      signature_id: "t_cell_activation",
      display_name: "T cell activation",
      aliases: ["T cell activation signature", "TCR activation"],
      genes: ["JUN", "FOS", "BATF", "IL2", "IL2RA"],
      source: "curated_mvp_signature",
      caveat: CURATED_SIGNATURE_CAVEAT,
    },
    {
      signature_id: "th1_like_polarization",
      display_name: "Th1-like polarization",
      aliases: ["Th1 polarization", "Th1-like signature", "type 1 helper signature"],
      genes: ["TBX21", "IFNG", "STAT1"],
      source: "curated_mvp_signature",
      caveat: CURATED_SIGNATURE_CAVEAT,
    },
    {
      signature_id: "th2_like_polarization",
      display_name: "Th2-like polarization",
      aliases: ["Th2 polarization", "Th2-like signature", "type 2 helper signature"],
      genes: ["GATA3", "IL4"],
      source: "curated_mvp_signature",
      caveat: CURATED_SIGNATURE_CAVEAT,
    },
    {
      signature_id: "exhaustion_like_signature",
      display_name: "Exhaustion-like signature",
      aliases: ["T cell exhaustion", "exhaustion signature", "checkpoint exhaustion"],
      genes: ["PDCD1", "CTLA4", "LAG3", "HAVCR2", "TOX"],
      source: "curated_mvp_signature",
      caveat: CURATED_SIGNATURE_CAVEAT,
    },
    {
      signature_id: "proliferation_cell_cycle",
      display_name: "Proliferation / cell cycle",
      aliases: ["proliferation signature", "cell cycle signature"],
      genes: ["MKI67", "CCND1", "MYC"],
      source: "curated_mvp_signature",
      caveat: CURATED_SIGNATURE_CAVEAT,
    },
    {
      signature_id: "stress_response",
      display_name: "Stress response",
      aliases: ["stress response signature", "immediate early gene response"],
      genes: ["FOS", "JUN", "CDKN1A"],
      source: "curated_mvp_signature",
      caveat: CURATED_SIGNATURE_CAVEAT,
    },
  ];

  return {
    schema: "signatures.immune_curated.mini.v1",
    generated_at: BUILD_TIMESTAMP,
    source: "curated_mvp_signature (hand-assembled for GeneGround demo)",
    signatures,
  };
}

// ---------------------------------------------------------------------------
// 5. GeneGround dataset-specific terms — conditions, perturbation, direction
// ---------------------------------------------------------------------------

function buildDatasetTerms() {
  return {
    schema: "dataset_terms.geneground.v1",
    generated_at: BUILD_TIMESTAMP,
    dataset_label: "Primary Human CD4+ T Cell Perturb-seq (Virtual Cell Models)",
    conditions: ["Rest", "Stim8hr", "Stim48hr"],
    condition_aliases: {
      resting: { conditions: ["Rest"], ambiguous: false, note: null },
      unstimulated: { conditions: ["Rest"], ambiguous: false, note: null },
      stimulated: {
        conditions: ["Stim8hr", "Stim48hr"],
        ambiguous: true,
        note: "Generic 'stimulated' language does not specify a timepoint; both Stim8hr and Stim48hr are plausible matches in this dataset.",
      },
      "early stimulation": { conditions: ["Stim8hr"], ambiguous: false, note: null },
      "8 hour stimulation": { conditions: ["Stim8hr"], ambiguous: false, note: null },
      "8h": { conditions: ["Stim8hr"], ambiguous: false, note: null },
      "8 hour": { conditions: ["Stim8hr"], ambiguous: false, note: null },
      "late stimulation": { conditions: ["Stim48hr"], ambiguous: false, note: null },
      "48 hour stimulation": { conditions: ["Stim48hr"], ambiguous: false, note: null },
      "48h": { conditions: ["Stim48hr"], ambiguous: false, note: null },
      "48 hour": { conditions: ["Stim48hr"], ambiguous: false, note: null },
    },
    perturbation_types: ["CRISPRi_knockdown"],
    perturbation_type_aliases: {
      knockdown: { normalized: "CRISPRi_knockdown", warning: null, note: null },
      crispri: { normalized: "CRISPRi_knockdown", warning: null, note: null },
      repression: { normalized: "CRISPRi_knockdown", warning: null, note: null },
      silencing: { normalized: "CRISPRi_knockdown", warning: null, note: null },
      knockout: {
        normalized: null,
        warning: "possible_knockout_language_warning",
        note: "This dataset uses CRISPRi knockdown, not true knockout. 'Knockout' language may overstate the perturbation.",
      },
      "knock out": {
        normalized: null,
        warning: "possible_knockout_language_warning",
        note: "This dataset uses CRISPRi knockdown, not true knockout. 'Knockout' language may overstate the perturbation.",
      },
    },
    // Words with a single, unconditional direction. Deliberately excludes
    // causal/strength words (drives, causes, reprograms, rescues) — those
    // are ambiguous-by-default and handled in src/lib/entityNormalization.ts,
    // not baked into this simple word->direction dictionary.
    // Kept in sync with docs/geneground-taxonomies.md's Direction Dictionary
    // ("Raw words" column) — every word listed there for up/down/changed
    // must have an entry here, and vice versa.
    direction_aliases: {
      down: "down",
      suppress: "down",
      suppresses: "down",
      suppressed: "down",
      decrease: "down",
      decreases: "down",
      decreased: "down",
      downregulate: "down",
      downregulates: "down",
      downregulated: "down",
      lower: "down",
      reduce: "down",
      reduces: "down",
      reduced: "down",
      inhibits: "down",
      depleted: "down",
      attenuated: "down",
      up: "up",
      activate: "up",
      activates: "up",
      activated: "up",
      increase: "up",
      increases: "up",
      increased: "up",
      upregulate: "up",
      upregulates: "up",
      upregulated: "up",
      higher: "up",
      elevated: "up",
      induce: "up",
      induces: "up",
      induced: "up",
      enhances: "up",
      promotes: "up",
      enriched: "up",
      alter: "changed",
      alters: "changed",
      altered: "changed",
      change: "changed",
      changes: "changed",
      changed: "changed",
      shift: "changed",
      shifts: "changed",
      shifted: "changed",
      affect: "changed",
      affects: "changed",
      affected: "changed",
      modulate: "changed",
      modulates: "changed",
      modulated: "changed",
      perturbed: "changed",
      rewired: "changed",
    },
  };
}

// ---------------------------------------------------------------------------
// 6. Manifest
// ---------------------------------------------------------------------------

function buildManifest({ genes, cells, pathways, rawFileStats }) {
  return {
    schema: "ontology_manifest.v1",
    build_timestamp: BUILD_TIMESTAMP,
    description:
      "Manifest for GeneGround's mini ontology layer (Step 4: mini ontology-based entity normalization). This is a lightweight MVP normalization layer, not a full ontology reasoner — it resolves common gene/cell/pathway aliases to canonical labels and dataset-specific terms, but does not perform formal ontology reasoning, cross-ontology ID mapping, or evidence verification.",
    source_files: rawFileStats,
    source_descriptions: {
      hgnc_complete_set:
        "HUGO Gene Nomenclature Committee (HGNC) complete gene set — approved symbols, names, aliases, and previous symbols for human genes.",
      cell_ontology: "Cell Ontology (CL) basic release, OBOGraph JSON — structured vocabulary of cell types and states.",
      reactome_pathways: "Reactome pathway ID-to-name-to-species table (all species).",
      reactome_pathways_relation: "Reactome parent-child pathway hierarchy relations (all species).",
      reactome_gmt: "Reactome pathway gene sets in GMT format (Homo sapiens only).",
    },
    mini_ontology_files: [
      {
        file: "genes.hgnc.mini.json",
        description: `Focused HGNC subset: ${genes.gene_count} genes (curated immune/T-cell panel + genes referenced in existing GeneGround mock evidence), with alias and previous-symbol resolution.`,
      },
      {
        file: "cell_ontology.cl.mini.json",
        description: `Cell Ontology terms relevant to immune/T-cell context (${cells.relevant_cl_terms} CL terms) plus ${cells.curated_fallback_terms} curated fallback entries for phrasings/cell states not present verbatim in CL.`,
      },
      {
        file: "pathways.reactome.mini.json",
        description: `Reactome Homo sapiens pathways filtered to immune/signaling keyword groups (${pathways.focus_pathway_count} pathways, ${pathways.gene_sets_matched} with gene sets attached).`,
      },
      {
        file: "signatures.immune_curated.mini.json",
        description: "Hand-curated MVP gene signatures for common immune/T-cell response programs (not derived from a formal gene set database).",
      },
      {
        file: "dataset_terms.geneground.json",
        description:
          "GeneGround demo-dataset-specific condition, perturbation-type, and direction term normalization (CD4+ T cell Perturb-seq: Rest / Stim8hr / Stim48hr, CRISPRi-based).",
      },
      { file: "ontology_manifest.json", description: "This manifest." },
    ],
    warnings_and_caveats: [
      "Gene coverage is a focused subset (not the full ~45k HGNC gene set) — genes outside this panel will not resolve and should be treated as unnormalized.",
      "Cell Ontology coverage is filtered to nodes whose label or synonyms match immune/T-cell-related keywords; the full CL hierarchy above/below these terms is not included, and some parent_ids reference CL nodes outside this mini ontology's own id_to_term.",
      "Several cell-context entries (e.g., 'CD4+ T cell', 'activated T cell', 'Th1-like polarization state') are curated fallbacks, not verbatim Cell Ontology synonyms — see each entry's `caveat` field.",
      "'Th1-like polarization state' and 'Th2-like polarization state' are transcriptional cell STATES inferred from Perturb-seq analysis, not formal Cell Ontology classes.",
      "Reactome pathways are filtered to Homo sapiens and a keyword-matched immune/signaling subset; most of Reactome's human pathways are excluded from this mini ontology.",
      "Curated immune signatures are hand-assembled for this MVP demo and are not sourced from MSigDB or a peer-reviewed gene set collection; treat them as illustrative, not evidence-grade.",
      "Dataset-specific terms (Rest / Stim8hr / Stim48hr, CRISPRi_knockdown) are specific to the GeneGround CD4+ T cell Perturb-seq demo dataset and do not generalize to other datasets.",
      "'Stimulated' is intentionally ambiguous between Stim8hr and Stim48hr — normalization surfaces this ambiguity rather than guessing a timepoint.",
      "'Knockout' / 'knock out' language is flagged with possible_knockout_language_warning because the demo dataset uses CRISPRi knockdown, not true knockout — this is a deliberate mismatch check, not a resolved normalization.",
      "This is a lightweight MVP normalization layer, not a full ontology reasoner: no OWL reasoning, no cross-ontology ID mapping beyond what HGNC already provides, and no confidence scoring.",
    ],
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  console.log("Building GeneGround mini ontology files...\n");
  ensureDir(OUTPUT_DIR);

  const genes = buildGeneMiniOntology();
  writeJsonFile(path.join(OUTPUT_DIR, "genes.hgnc.mini.json"), genes);
  console.log(`[genes]      ${genes.gene_count} gene terms`);

  const cells = buildCellOntologyMiniOntology();
  writeJsonFile(path.join(OUTPUT_DIR, "cell_ontology.cl.mini.json"), cells);
  console.log(`[cells]      ${cells.relevant_cl_terms} CL terms + ${cells.curated_fallback_terms} curated fallbacks`);

  const pathways = buildPathwayMiniOntology();
  writeJsonFile(path.join(OUTPUT_DIR, "pathways.reactome.mini.json"), pathways);
  console.log(`[pathways]   ${pathways.focus_pathway_count} pathways (${pathways.gene_sets_matched} with gene sets)`);

  const signatures = buildCuratedSignatures();
  writeJsonFile(path.join(OUTPUT_DIR, "signatures.immune_curated.mini.json"), signatures);
  console.log(`[signatures] ${signatures.signatures.length} curated signatures`);

  const datasetTerms = buildDatasetTerms();
  writeJsonFile(path.join(OUTPUT_DIR, "dataset_terms.geneground.json"), datasetTerms);
  console.log("[dataset]    GeneGround dataset term normalization");

  const rawFileStats = [HGNC_PATH, CL_PATH, REACTOME_PATHWAYS_PATH, REACTOME_RELATIONS_PATH, REACTOME_GMT_PATH].map(
    (filePath) => ({
      file: path.relative(ROOT_DIR, filePath),
      bytes: fs.statSync(filePath).size,
    }),
  );

  const manifest = buildManifest({ genes, cells, pathways, rawFileStats });
  writeJsonFile(path.join(OUTPUT_DIR, "ontology_manifest.json"), manifest);
  console.log("[manifest]   ontology_manifest.json");

  console.log("\nDone.");
}

main();
