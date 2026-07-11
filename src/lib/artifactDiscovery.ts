import { MOCK_FILE_INVENTORY } from "@/data/mock-handoff/mockFileInventory";
import { MOCK_HANDOFF_PROJECT } from "./mockHandoff";
import type {
  ArtifactDiscoveryResult,
  ArtifactDiscoverySummary,
  ArtifactIndexType,
  ArtifactManifestEntry,
  ArtifactPriority,
  ArtifactType,
  HandoffImportFile,
  HandoffImportParsedKind,
  HandoffImportResult,
  IgnoredFileAction,
  IgnoredFileEntry,
} from "./schemas";

// A file is classifiable by the cascade below as long as it has these four
// fields — both MockHandoffFile (mock demo data) and HandoffImportFile
// (real zip import, Step 12) satisfy this structurally, so the same
// classification logic works for both without duplication.
interface ClassifiableFile {
  file_name: string;
  file_path: string;
  content_preview?: string;
  size_bytes: number;
}

// ---------------------------------------------------------------------------
// Signal vocabularies (file name / content-preview keyword matches)
// ---------------------------------------------------------------------------

const PERTURBATION_SIGNALS = [
  "perturbation",
  "de_stats",
  "differential_expression",
  "de_summary",
  "gene_level_de",
  "evidence_packets",
  "top_changed_genes",
  "log_fc",
  "adj_p_value",
  "zscore",
  "ontarget",
];

const PATHWAY_SIGNALS = [
  "pathway",
  "signature",
  "enrichment",
  "reactome",
  "hallmark",
  "interferon",
  "nfkb",
  "overlap_genes",
  "enrichment_score",
  "padj",
];

const ROBUSTNESS_SIGNALS = [
  "robustness",
  "guide",
  "donor",
  "pseudobulk",
  "low_target_gex",
  "neighboring_gene_kd",
  "distal_offtarget_flag",
  "n_cells_target",
  "keep_for_de",
  "qc",
];

const LANGUAGE_SIGNALS = [
  "language_rules",
  "claim_language",
  "causal_words",
  "strength_words",
  "safer_rewrites",
  "master regulator",
  "therapeutic target",
  "mechanism",
  "drives",
  "causes",
];

const PROVENANCE_SIGNALS = [
  "provenance",
  "manifest",
  "import_log",
  "dataset_inventory",
  "schema_map",
  "source_files",
  "processing_report",
  "session_report",
  "thresholds",
  "caveats",
];

const DEMO_CLAIMS_SIGNALS = ["demo_claims", "gold_verdicts", "example_claims", "expected_verdicts", "safer_rewrites", "demo_examples"];

const ONTOLOGY_SIGNALS = ["hgnc", "cell_ontology", "cl-basic", "reactome", "ontology", "signatures.immune", "dataset_terms"];

const RAW_OMICS_EXTENSIONS = [".h5ad", ".h5mu", ".loom", ".mtx"];
const RAW_OMICS_NAME_SIGNALS = ["raw_cell", "pseudobulk_merged", "assigned_guide"];

const VISUALIZATION_EXTENSIONS = [".png", ".jpg", ".jpeg", ".svg", ".pdf"];
// .html included alongside .md/.txt/.pdf so uploaded handoff report files
// (Step 12 real zip import) can classify as "report" like any other
// narrative artifact — see item 3's .html handling in handoffImport.ts.
const REPORT_EXTENSIONS = [".md", ".txt", ".pdf", ".html"];
const REPORT_NAME_SIGNALS = ["report", "summary", "analysis", "final"];

// .tsv and .html are accepted handoff import extensions (see
// ACCEPTED_HANDOFF_EXTENSIONS in handoffImport.ts) and must not be
// re-rejected here as "unsupported" once the import layer has already
// accepted them.
const KNOWN_EXTENSIONS = new Set([".json", ".csv", ".tsv", ".parquet", ".md", ".txt", ".html", ".png", ".jpg", ".jpeg", ".svg", ".pdf", ".gmt"]);

const SIGNAL_LISTS: Partial<Record<ArtifactType, string[]>> = {
  perturbation_evidence: PERTURBATION_SIGNALS,
  pathway_evidence: PATHWAY_SIGNALS,
  robustness_evidence: ROBUSTNESS_SIGNALS,
  language_rules: LANGUAGE_SIGNALS,
  provenance: PROVENANCE_SIGNALS,
  demo_claims: DEMO_CLAIMS_SIGNALS,
  ontology_reference: ONTOLOGY_SIGNALS,
};

const SIZE_IGNORE_THRESHOLD_BYTES = 50_000_000; // 50MB — compact evidence packets should be well under this

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFileExtension(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function buildHaystack(fileName: string, contentPreview: string | undefined): string {
  return `${fileName} ${contentPreview ?? ""}`.toLowerCase();
}

// ---------------------------------------------------------------------------
// Public building blocks (per the required function list)
// ---------------------------------------------------------------------------

/**
 * Rule-based classification cascade. Raw-omics extension and ontology
 * reference are checked before the evidence-category keyword lists because
 * a huge .h5ad matrix or a raw Reactome/HGNC dump can otherwise collide with
 * keywords like "de_stats" or "reactome" that also appear in evidence-packet
 * file names — format/reference-status should win over an incidental
 * keyword match.
 */
export function inferArtifactType(
  fileName: string,
  filePath: string,
  contentPreview?: string,
): ArtifactType {
  const ext = getFileExtension(fileName);
  const haystack = buildHaystack(`${fileName} ${filePath}`, contentPreview);

  if (RAW_OMICS_EXTENSIONS.includes(ext) || RAW_OMICS_NAME_SIGNALS.some((s) => haystack.includes(s))) {
    return "raw_omics_data";
  }
  if (ONTOLOGY_SIGNALS.some((s) => haystack.includes(s))) return "ontology_reference";
  if (PERTURBATION_SIGNALS.some((s) => haystack.includes(s))) return "perturbation_evidence";
  if (PATHWAY_SIGNALS.some((s) => haystack.includes(s))) return "pathway_evidence";
  if (ROBUSTNESS_SIGNALS.some((s) => haystack.includes(s))) return "robustness_evidence";
  if (LANGUAGE_SIGNALS.some((s) => haystack.includes(s))) return "language_rules";
  if (PROVENANCE_SIGNALS.some((s) => haystack.includes(s))) return "provenance";
  if (DEMO_CLAIMS_SIGNALS.some((s) => haystack.includes(s))) return "demo_claims";
  if (VISUALIZATION_EXTENSIONS.includes(ext)) return "visualization";
  if (REPORT_EXTENSIONS.includes(ext) && REPORT_NAME_SIGNALS.some((s) => haystack.includes(s))) return "report";

  return "unknown";
}

export function inferTargetIndexes(artifactType: ArtifactType): ArtifactIndexType[] {
  switch (artifactType) {
    case "perturbation_evidence":
      return ["perturbation_evidence_index"];
    case "pathway_evidence":
      return ["pathway_signature_index"];
    case "robustness_evidence":
      return ["robustness_quality_index"];
    case "language_rules":
      return ["language_rules_index"];
    case "provenance":
      return ["provenance_index"];
    case "demo_claims":
      return ["demo_examples_index"];
    case "report":
      return ["provenance_index"];
    default:
      return [];
  }
}

const COMPACT_EXTENSIONS = new Set([".json", ".csv", ".parquet"]);
const NARRATIVE_EXTENSIONS = new Set([".md", ".txt", ".pdf"]);

export function inferPriority(artifactType: ArtifactType, fileName: string, sizeBytes?: number): ArtifactPriority {
  void sizeBytes; // size-based downgrade is handled upstream via shouldIgnoreFile
  const ext = getFileExtension(fileName);

  switch (artifactType) {
    case "perturbation_evidence":
    case "pathway_evidence":
    case "robustness_evidence":
      if (COMPACT_EXTENSIONS.has(ext)) return "high";
      return NARRATIVE_EXTENSIONS.has(ext) ? "medium" : "low";
    case "language_rules":
      return "high";
    case "provenance":
      return ext === ".json" ? "high" : "medium";
    case "demo_claims":
      return "medium";
    case "report":
      return "medium";
    case "ontology_reference":
      return "medium";
    case "visualization":
    default:
      return "low";
  }
}

/**
 * Generic gate: is this file out of scope for the web MVP regardless of what
 * it looks like it contains? Raw-omics formats and oversized files both
 * qualify, as does anything with a completely unrecognized extension.
 */
export function shouldIgnoreFile(fileName: string, fileExtension: string, sizeBytes?: number): boolean {
  if (RAW_OMICS_EXTENSIONS.includes(fileExtension)) return true;
  if (typeof sizeBytes === "number" && sizeBytes > SIZE_IGNORE_THRESHOLD_BYTES) return true;
  if (!KNOWN_EXTENSIONS.has(fileExtension) && !RAW_OMICS_EXTENSIONS.includes(fileExtension)) return true;
  return false;
}

function getDetectedSignals(fileName: string, contentPreview: string | undefined, artifactType: ArtifactType): string[] {
  const list = SIGNAL_LISTS[artifactType];
  if (!list) return [];
  const haystack = buildHaystack(fileName, contentPreview);
  return list.filter((s) => haystack.includes(s));
}

const ARTIFACT_TYPE_REASONS: Record<ArtifactType, string> = {
  perturbation_evidence: "File name/content signals indicate differential expression / on-target perturbation evidence.",
  pathway_evidence: "File name/content signals indicate pathway or signature enrichment evidence.",
  robustness_evidence: "File name/content signals indicate guide/donor robustness or QC evidence.",
  language_rules: "File name/content signals indicate curated language/causality rule definitions.",
  provenance: "File name/content signals indicate provenance, schema, or processing/session metadata.",
  demo_claims: "File name/content signals indicate demo claims or gold verdicts for MVP/testing.",
  ontology_reference: "Ontology/reference files are used for normalization, not claim evidence retrieval.",
  raw_omics_data: "Raw omics matrices should be processed in Claude Science. GeneGround web MVP uses compact handoff artifacts.",
  visualization: "File is a visualization asset (figure/plot); not used as structured claim evidence.",
  report: "File is a narrative report/summary; used as provenance/context, not structured evidence.",
  unsupported: "Unsupported file type for the web MVP evidence pipeline.",
  irrelevant: "No recognizable evidence signals were found in the file name or content preview.",
  unknown: "No recognizable evidence signals were found in the file name or content preview.",
};

function buildManifestEntry(file: ClassifiableFile, fileExtension: string, artifactType: ArtifactType): ArtifactManifestEntry {
  const warnings =
    artifactType === "demo_claims"
      ? ["Demo examples are for MVP/testing and should not be treated as biological evidence."]
      : undefined;

  return {
    file_name: file.file_name,
    file_path: file.file_path,
    file_extension: fileExtension,
    artifact_type: artifactType,
    use_for_indexes: inferTargetIndexes(artifactType),
    priority: inferPriority(artifactType, file.file_name, file.size_bytes),
    reason: ARTIFACT_TYPE_REASONS[artifactType],
    detected_signals: getDetectedSignals(file.file_name, file.content_preview, artifactType),
    size_bytes: file.size_bytes,
    warnings,
  };
}

function buildIgnoredEntry(file: ClassifiableFile, fileExtension: string, artifactType: ArtifactType): IgnoredFileEntry {
  if (artifactType === "raw_omics_data") {
    const tooLarge = file.size_bytes > SIZE_IGNORE_THRESHOLD_BYTES;
    return {
      file_name: file.file_name,
      file_path: file.file_path,
      file_extension: fileExtension,
      reason: ARTIFACT_TYPE_REASONS.raw_omics_data,
      action_taken: tooLarge ? "ignored_too_large" : "ignored_for_web_mvp",
      size_bytes: file.size_bytes,
      warnings: tooLarge
        ? [`File is ${formatBytes(file.size_bytes)}, exceeding the ${formatBytes(SIZE_IGNORE_THRESHOLD_BYTES)} web MVP size budget.`]
        : undefined,
    };
  }

  if (file.size_bytes > SIZE_IGNORE_THRESHOLD_BYTES) {
    return {
      file_name: file.file_name,
      file_path: file.file_path,
      file_extension: fileExtension,
      reason: `File was recognized as ${artifactType.replace(/_/g, " ")} evidence but exceeds the compact-artifact size budget for the web MVP.`,
      action_taken: "ignored_too_large",
      size_bytes: file.size_bytes,
      warnings: [`File is ${formatBytes(file.size_bytes)}, exceeding the ${formatBytes(SIZE_IGNORE_THRESHOLD_BYTES)} web MVP size budget.`],
    };
  }

  const unsupportedType = !KNOWN_EXTENSIONS.has(fileExtension);
  return {
    file_name: file.file_name,
    file_path: file.file_path,
    file_extension: fileExtension,
    reason: unsupportedType ? ARTIFACT_TYPE_REASONS.unsupported : ARTIFACT_TYPE_REASONS.irrelevant,
    action_taken: unsupportedType ? "ignored_unsupported_type" : "needs_manual_review",
    size_bytes: file.size_bytes,
  };
}

/**
 * Classifies a single handoff file into either a manifest entry (feeds at
 * least the *idea* of an artifact index — ontology/report/visualization
 * files can classify with zero target indexes) or an ignored-file entry
 * (out of scope for the web MVP: raw omics matrices, oversized files,
 * unsupported types, or files with no recognizable signal at all).
 */
export function classifyArtifactFile(file: ClassifiableFile): ArtifactManifestEntry | IgnoredFileEntry {
  const fileExtension = getFileExtension(file.file_name);
  const artifactType = inferArtifactType(file.file_name, file.file_path, file.content_preview);

  if (artifactType === "raw_omics_data" || artifactType === "unknown" || shouldIgnoreFile(file.file_name, fileExtension, file.size_bytes)) {
    return buildIgnoredEntry(file, fileExtension, artifactType);
  }

  return buildManifestEntry(file, fileExtension, artifactType);
}

export function buildArtifactDiscoverySummary(
  entries: ArtifactManifestEntry[],
  ignoredFiles: IgnoredFileEntry[],
): ArtifactDiscoverySummary {
  const files_by_artifact_type: Record<string, number> = {};
  const files_by_index: Record<string, number> = {};
  let high_priority_files = 0;
  let medium_priority_files = 0;
  let low_priority_files = 0;

  for (const entry of entries) {
    files_by_artifact_type[entry.artifact_type] = (files_by_artifact_type[entry.artifact_type] ?? 0) + 1;
    for (const index of entry.use_for_indexes) {
      files_by_index[index] = (files_by_index[index] ?? 0) + 1;
    }
    if (entry.priority === "high") high_priority_files += 1;
    else if (entry.priority === "medium") medium_priority_files += 1;
    else low_priority_files += 1;
  }

  return {
    total_files_scanned: entries.length + ignoredFiles.length,
    classified_files: entries.length,
    ignored_files: ignoredFiles.length,
    high_priority_files,
    medium_priority_files,
    low_priority_files,
    files_by_artifact_type,
    files_by_index,
  };
}

/**
 * Scans the mock Claude Science handoff file inventory and classifies every
 * file. Deterministic rules only — no zip upload, no real file parsing yet.
 */
export function discoverArtifactsFromMockHandoff(): ArtifactDiscoveryResult {
  const artifact_manifest: ArtifactManifestEntry[] = [];
  const ignored_files: IgnoredFileEntry[] = [];

  for (const file of MOCK_FILE_INVENTORY) {
    const result = classifyArtifactFile(file);
    if ("artifact_type" in result) artifact_manifest.push(result);
    else ignored_files.push(result);
  }

  const summary = buildArtifactDiscoverySummary(artifact_manifest, ignored_files);

  const manifest_warnings: string[] = [
    "Large raw omics matrices are ignored in the web MVP. They should be processed in Claude Science first, then exported as compact evidence packets.",
  ];
  if (summary.ignored_files > 0) {
    manifest_warnings.push(`${summary.ignored_files} file(s) were ignored — see ignored_files for reasons.`);
  }

  return {
    project_id: MOCK_HANDOFF_PROJECT.handoff_project_id,
    created_at: MOCK_HANDOFF_PROJECT.generated_at,
    artifact_manifest,
    ignored_files,
    summary,
    manifest_warnings,
  };
}

// ---------------------------------------------------------------------------
// Real handoff zip import (Step 12) bridge
// ---------------------------------------------------------------------------

/**
 * Maps a HandoffImportFile that the import layer already decided to ignore
 * (junk/unsafe path/raw omics/unsupported extension/size limit) to the
 * closest IgnoredFileAction. Files with a recognized-but-accepted
 * parsed_kind (json/table/text/html_text/visualization/parquet) only ever
 * reach here because of a size/budget limit or a parse failure, since the
 * import layer already gates everything else before parsed_content exists.
 */
function mapImportFileToIgnoredAction(file: HandoffImportFile): IgnoredFileAction {
  const kind: HandoffImportParsedKind = file.parsed_kind;
  if (kind === "junk") return "ignored_junk_file";
  if (kind === "unsafe") return "ignored_unsafe_path";
  if (kind === "raw_omics_ignored") return "ignored_for_web_mvp";
  if (kind === "unsupported") return "ignored_unsupported_type";
  if (file.warnings && file.warnings.length > 0 && !file.ignore_reason?.includes("size")) return "needs_manual_review";
  return "ignored_too_large";
}

function buildIgnoredEntryFromImportFile(file: HandoffImportFile): IgnoredFileEntry {
  return {
    file_name: file.file_name,
    file_path: file.file_path,
    file_extension: file.file_extension,
    reason: file.ignore_reason ?? "File was ignored during handoff import.",
    action_taken: mapImportFileToIgnoredAction(file),
    size_bytes: file.size_bytes,
    warnings: file.warnings,
  };
}

/**
 * Runs Artifact Discovery over a real, user-uploaded Claude Science handoff
 * (src/lib/handoffImport.ts's importClaudeScienceHandoffZip output) instead
 * of the mock file inventory. Files the import layer already ignored
 * (junk/unsafe/raw-omics/unsupported/oversized) are carried straight into
 * Ignored_files using their own reason; every accepted file is classified
 * with the exact same cascade (inferArtifactType/inferPriority/etc.) as the
 * mock demo path, so behavior stays identical for files that look alike.
 */
export function discoverArtifactsFromHandoffImport(importResult: HandoffImportResult): ArtifactDiscoveryResult {
  const artifact_manifest: ArtifactManifestEntry[] = [];
  const ignored_files: IgnoredFileEntry[] = [];

  for (const file of importResult.files) {
    if (file.accepted) {
      const result = classifyArtifactFile(file);
      if ("artifact_type" in result) artifact_manifest.push(result);
      else ignored_files.push(result);
    } else {
      ignored_files.push(buildIgnoredEntryFromImportFile(file));
    }
  }

  const summary = buildArtifactDiscoverySummary(artifact_manifest, ignored_files);

  const manifest_warnings: string[] = [...importResult.warnings];
  if (summary.ignored_files > 0 && !manifest_warnings.some((w) => w.includes("were ignored"))) {
    manifest_warnings.push(`${summary.ignored_files} file(s) were ignored — see ignored_files for reasons.`);
  }

  return {
    project_id: importResult.project_id,
    created_at: importResult.created_at,
    artifact_manifest,
    ignored_files,
    summary,
    manifest_warnings,
  };
}
