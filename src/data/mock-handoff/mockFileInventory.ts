// Mock listing of a Claude Science project export / handoff folder, as the
// Artifact Discovery Agent (Step 10) would see it before parsing anything.
// `content_preview` stands in for a lightweight peek at the file's schema
// (column names / top-level JSON keys) — not the full file contents.

export interface MockHandoffFile {
  file_name: string;
  file_path: string;
  size_bytes: number;
  content_preview?: string;
}

export const MOCK_FILE_INVENTORY: MockHandoffFile[] = [
  {
    file_name: "perturbation_evidence_packets.json",
    file_path: "/handoff/perturbation_evidence_packets.json",
    size_bytes: 42_000,
    content_preview:
      "target_gene_symbol, culture_condition, n_total_de_genes, top_upregulated_genes, top_downregulated_genes, ontarget_effect_size, ontarget_significant, adjusted_p_value_summary — differential_expression evidence_packets",
  },
  {
    file_name: "gene_level_de_evidence.parquet",
    file_path: "/handoff/gene_level_de_evidence.parquet",
    size_bytes: 1_150_000,
    content_preview: "gene_level_de columns: gene_symbol, log_fc, zscore, adj_p_value, condition",
  },
  {
    file_name: "perturbation_condition_summary.csv",
    file_path: "/handoff/perturbation_condition_summary.csv",
    size_bytes: 14_500,
    content_preview: "perturbation, condition, de_summary, top_changed_genes, ontarget",
  },
  {
    file_name: "pathway_enrichment_results.csv",
    file_path: "/handoff/pathway_enrichment_results.csv",
    size_bytes: 29_800,
    content_preview: "pathway, enrichment_score, padj, overlap_genes",
  },
  {
    file_name: "pathway_signature_packets.json",
    file_path: "/handoff/pathway_signature_packets.json",
    size_bytes: 51_200,
    content_preview: "pathway_name, signature_id, pathway_id, hallmark signature, interferon, nfkb, overlap_genes, enrichment_score, adjusted_p_value",
  },
  {
    file_name: "pseudobulk_robustness_summary.csv",
    file_path: "/handoff/pseudobulk_robustness_summary.csv",
    size_bytes: 19_600,
    content_preview: "robustness, guide, donor, pseudobulk, qc",
  },
  {
    file_name: "robustness_quality_packets.json",
    file_path: "/handoff/robustness_quality_packets.json",
    size_bytes: 34_900,
    content_preview:
      "n_guides, donor_robustness_score, guide_robustness_score, low_target_gex, neighboring_gene_KD, distal_offtarget_flag, n_cells_target, keep_for_DE",
  },
  {
    file_name: "language_rules.json",
    file_path: "/handoff/language_rules.json",
    size_bytes: 8_100,
    content_preview:
      "language_rules, claim_language, causal_words, strength_words, safer_rewrite_patterns, master regulator, therapeutic target, mechanism, drives, causes",
  },
  {
    file_name: "dataset_inventory.md",
    file_path: "/handoff/dataset_inventory.md",
    size_bytes: 4_300,
    content_preview: "dataset_inventory, provenance, source_files listing for this handoff",
  },
  {
    file_name: "import_log.md",
    file_path: "/handoff/import_log.md",
    size_bytes: 6_050,
    content_preview: "import_log, processing_report, session_report for the Claude Science session",
  },
  {
    file_name: "schema_map.json",
    file_path: "/handoff/schema_map.json",
    size_bytes: 10_200,
    content_preview: "schema_map, thresholds, caveats for dataset fields and filtering",
  },
  {
    file_name: "geneground_demo_claims.json",
    file_path: "/handoff/geneground_demo_claims.json",
    size_bytes: 5_400,
    content_preview: "demo_claims, example_claims for MVP walkthroughs",
  },
  {
    file_name: "geneground_gold_verdicts.json",
    file_path: "/handoff/geneground_gold_verdicts.json",
    size_bytes: 6_300,
    content_preview: "gold_verdicts, expected_verdicts for demo claim examples",
  },
  {
    file_name: "hgnc.mini.json",
    file_path: "/handoff/ontology/hgnc.mini.json",
    size_bytes: 19_800,
    content_preview: "hgnc approved gene symbols, aliases, previous symbols — ontology reference",
  },
  {
    file_name: "cell_ontology.cl.mini.json",
    file_path: "/handoff/ontology/cell_ontology.cl.mini.json",
    size_bytes: 212_000,
    content_preview: "cell_ontology cl-basic terms, synonyms — ontology reference",
  },
  {
    file_name: "ReactomePathways.gmt",
    file_path: "/handoff/ontology/ReactomePathways.gmt",
    size_bytes: 1_030_000,
    content_preview: "reactome pathway gene sets — ontology reference for normalization",
  },
  {
    file_name: "GWCD4i.DE_stats.h5ad",
    file_path: "/handoff/raw/GWCD4i.DE_stats.h5ad",
    size_bytes: 1_800_000_000,
    content_preview: "raw AnnData DE_stats matrix, per-cell differential expression statistics",
  },
  {
    file_name: "GWCD4i.pseudobulk_merged.h5ad",
    file_path: "/handoff/raw/GWCD4i.pseudobulk_merged.h5ad",
    size_bytes: 950_000_000,
    content_preview: "raw pseudobulk_merged AnnData matrix, assigned_guide per raw_cell",
  },
  {
    file_name: "UMAP_plot.png",
    file_path: "/handoff/figures/UMAP_plot.png",
    size_bytes: 812_000,
  },
  {
    file_name: "random_notes.txt",
    file_path: "/handoff/random_notes.txt",
    size_bytes: 1_800,
    content_preview: "unstructured scratch notes, no recognizable schema",
  },
];
