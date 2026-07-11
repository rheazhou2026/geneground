// Lightweight regression checks for the Step 12 handoff zip importer — no
// test framework, just deterministic assertions against a self-built
// in-memory test zip (STORE/uncompressed entries only, since our reader
// already supports STORE and this keeps the fixture dependency-free and
// reproducible). Run via `npm run test`.

import { importClaudeScienceHandoffZip } from "@/lib/handoffImport";
import { discoverArtifactsFromHandoffImport } from "@/lib/artifactDiscovery";
import { buildArtifactIndexesFromDiscoveryResult } from "@/lib/artifactIndexes";

let passCount = 0;
let skipCount = 0;
const failures: string[] = [];

function check(name: string, condition: boolean) {
  if (condition) {
    passCount += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}`);
  }
}

function skip(name: string, reason: string) {
  skipCount += 1;
  console.log(`  SKIP  ${name} (${reason})`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
// Minimal STORE-mode (uncompressed) ZIP writer, for building a self-contained
// test fixture in memory — not used by the app itself, test-only.
// ---------------------------------------------------------------------------

function buildStoreZip(entries: { path: string; content: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const data = encoder.encode(entry.content);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true); // compression method = store
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, 0, true); // crc32 unchecked by our reader
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, 0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length;
  }

  const localTotal = localParts.reduce((sum, p) => sum + p.length, 0);
  const centralTotal = centralParts.reduce((sum, p) => sum + p.length, 0);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralTotal, true);
  ev.setUint32(16, localTotal, true);

  const out = new Uint8Array(localTotal + centralTotal + 22);
  let cursor = 0;
  for (const part of [...localParts, ...centralParts, eocd]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Build the test fixture
// ---------------------------------------------------------------------------

const testZipBytes = buildStoreZip([
  { path: "perturbation_evidence.json", content: JSON.stringify([{ target_gene_symbol: "STAT1", culture_condition: "Stim8hr", direction: "down" }]) },
  { path: "pathway_evidence.csv", content: "target_gene_symbol,culture_condition,pathway_name,direction\nSTAT1,Stim8hr,Interferon Signaling,down\n" },
  { path: "robustness.tsv", content: "target_gene_symbol\tculture_condition\tn_guides\nSTAT1\tStim8hr\t4\n" },
  { path: "notes.md", content: "# Session Notes\n\nSome provenance notes.\n\n## Caveats\n\nBe cautious.\n" },
  { path: "report.html", content: "<html><body><h1>Report</h1><p>Summary text with provenance details.</p></body></html>" },
  { path: "figure.png", content: "not-a-real-png-but-bytes" },
  { path: "huge_matrix.h5ad", content: "fake raw omics matrix bytes" },
  { path: ".DS_Store", content: "junk" },
  { path: "__MACOSX/._perturbation_evidence.json", content: "junk" },
  { path: "../../etc/passwd_lookalike.json", content: '{"malicious":true}' },
]);

const testZipBlob = new Blob([testZipBytes as unknown as BlobPart]);

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  const result = await importClaudeScienceHandoffZip(testZipBlob);
  const byName = new Map(result.files.map((f) => [f.file_name, f]));

  section("1. Per-file-type acceptance and parsing");

  const jsonFile = byName.get("perturbation_evidence.json");
  check(".json is accepted and parsed_kind is json", jsonFile?.accepted === true && jsonFile?.parsed_kind === "json");
  check(".json parsed_content is the parsed array", Array.isArray(jsonFile?.parsed_content) && jsonFile?.parsed_content.length === 1);

  const csvFile = byName.get("pathway_evidence.csv");
  check(".csv is accepted and parsed_kind is table", csvFile?.accepted === true && csvFile?.parsed_kind === "table");
  const csvHeaders = (csvFile?.parsed_content as { headers?: string[] } | undefined)?.headers ?? [];
  check(".csv headers are parsed correctly", JSON.stringify(csvHeaders) === JSON.stringify(["target_gene_symbol", "culture_condition", "pathway_name", "direction"]));

  const tsvFile = byName.get("robustness.tsv");
  check(".tsv is accepted and parsed_kind is table", tsvFile?.accepted === true && tsvFile?.parsed_kind === "table");
  const tsvHeaders = (tsvFile?.parsed_content as { headers?: string[] } | undefined)?.headers ?? [];
  check(".tsv headers are parsed correctly", JSON.stringify(tsvHeaders) === JSON.stringify(["target_gene_symbol", "culture_condition", "n_guides"]));

  const mdFile = byName.get("notes.md");
  check(".md is accepted, parsed_kind is text, and a preview exists", mdFile?.accepted === true && mdFile?.parsed_kind === "text" && (mdFile?.content_preview?.length ?? 0) > 0);

  const htmlFile = byName.get("report.html");
  if (typeof DOMParser === "undefined") {
    skip(".html is accepted and text stripped", "DOMParser is a browser-only API, not available under Node/tsx — verify manually in a browser");
  } else {
    check(".html is accepted, parsed_kind is html_text, and text was stripped of tags", htmlFile?.accepted === true && htmlFile?.parsed_kind === "html_text" && !(htmlFile?.content_preview ?? "").includes("<"));
  }

  const pngFile = byName.get("figure.png");
  check(".png is accepted as visualization", pngFile?.accepted === true && pngFile?.parsed_kind === "visualization");

  section("2. Raw omics + junk + unsafe-path handling");

  const h5adFile = byName.get("huge_matrix.h5ad");
  check(".h5ad is recognized and ignored (not accepted)", h5adFile?.accepted === false && h5adFile?.ignored === true && h5adFile?.parsed_kind === "raw_omics_ignored");

  const dsStoreFile = result.files.find((f) => f.file_path === ".DS_Store");
  check(".DS_Store is ignored as junk", dsStoreFile?.ignored === true && dsStoreFile?.parsed_kind === "junk");

  const macosxFile = result.files.find((f) => f.file_path.startsWith("__MACOSX/"));
  check("__MACOSX/* is ignored as junk", macosxFile?.ignored === true && macosxFile?.parsed_kind === "junk");

  const traversalFile = result.files.find((f) => f.file_path.includes(".."));
  check("path traversal (../../) entry is blocked as unsafe", traversalFile?.ignored === true && traversalFile?.parsed_kind === "unsafe");

  section("3. Artifact Discovery + Artifact Indexes run on imported files");

  const discovery = discoverArtifactsFromHandoffImport(result);
  check("Artifact Discovery classifies at least one accepted file", discovery.artifact_manifest.length > 0);
  check(
    "Artifact Discovery routes the raw omics + junk + unsafe files into ignored_files with distinct reasons",
    discovery.ignored_files.some((f) => f.action_taken === "ignored_for_web_mvp") &&
      discovery.ignored_files.some((f) => f.action_taken === "ignored_junk_file") &&
      discovery.ignored_files.some((f) => f.action_taken === "ignored_unsafe_path"),
  );

  const perturbationEntry = discovery.artifact_manifest.find((e) => e.artifact_type === "perturbation_evidence");
  check("perturbation_evidence.json classifies as perturbation_evidence -> perturbation_evidence_index", (perturbationEntry?.use_for_indexes ?? []).includes("perturbation_evidence_index"));

  const pathwayEntry = discovery.artifact_manifest.find((e) => e.artifact_type === "pathway_evidence");
  check("pathway_evidence.csv classifies as pathway_evidence -> pathway_signature_index", (pathwayEntry?.use_for_indexes ?? []).includes("pathway_signature_index"));

  check(
    "robustness.tsv (accepted extension) reaches the Artifact Discovery manifest, not re-rejected as unsupported",
    discovery.artifact_manifest.some((e) => e.file_name === "robustness.tsv") || discovery.ignored_files.some((e) => e.file_name === "robustness.tsv" && e.action_taken !== "ignored_unsupported_type"),
  );
  if (typeof DOMParser === "undefined") {
    skip("report.html reaches the Artifact Discovery manifest as a report", "depends on the .html parse step above, which needs DOMParser");
  } else {
    const reportEntry = discovery.artifact_manifest.find((e) => e.file_name === "report.html");
    check("report.html classifies as report (not unsupported)", reportEntry?.artifact_type === "report");
  }

  const indexes = buildArtifactIndexesFromDiscoveryResult(discovery, result);
  const totalChunks = Object.values(indexes.indexes).reduce((sum, idx) => sum + idx.chunks.length, 0);
  check("typed Artifact Indexes are built with at least one chunk from accepted files", totalChunks > 0);
  check(
    "perturbation_evidence_index has a chunk carrying the STAT1/Stim8hr metadata signal",
    indexes.indexes.perturbation_evidence_index.chunks.some((c) => c.metadata.target_gene_symbol === "STAT1" && c.metadata.culture_condition === "Stim8hr"),
  );

  console.log(`\n${passCount} passed, ${failures.length} failed, ${skipCount} skipped.`);
  if (failures.length > 0) {
    console.log("\nFailed checks:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main();
