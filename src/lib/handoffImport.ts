// Real Claude Science handoff .zip import (Step 12).
//
// This module is the untrusted-input boundary for GeneGround: a
// user-uploaded zip is unzipped, filtered, and lightly parsed here, before
// anything touches Artifact Discovery or the Artifact Indexes. It never
// executes anything from the zip:
//   - the zip's own central directory / local file headers are parsed by
//     hand with DataView (no third-party zip library, no eval);
//   - deflate entries are inflated with the browser/Node's native
//     DecompressionStream (a standard, sandboxed Web API — not a script
//     interpreter);
//   - HTML is parsed with DOMParser, whose resulting document is detached
//     from the live DOM: <script> tags never run and remote resources
//     (<img src>, <link href>, ...) are never fetched;
//   - JSON is parsed with JSON.parse (never eval);
//   - parquet is only classified, not deeply parsed (see parseParquetFile).
//
// Runs entirely client-side against the browser File API — no server route,
// consistent with the rest of this MVP's "no unnecessary backend
// complexity" approach.

import type { HandoffImportConfig, HandoffImportFile, HandoffImportParsedKind, HandoffImportResult } from "./schemas";

// ---------------------------------------------------------------------------
// Configuration / constants
// ---------------------------------------------------------------------------

export const ACCEPTED_HANDOFF_EXTENSIONS = [".md", ".json", ".csv", ".tsv", ".parquet", ".png", ".jpg", ".jpeg", ".svg", ".html"] as const;
export const RAW_OMICS_EXTENSIONS = [".h5ad", ".h5mu", ".loom", ".mtx"] as const;
export const JUNK_FILE_PATTERNS = [".DS_Store", "__MACOSX", ".MACOSX"] as const;

// MVP limits — generous enough for compact evidence packets (the whole
// point of the handoff format), small relative to raw omics matrices.
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB per accepted file
export const MAX_TOTAL_UNZIPPED_BYTES = 200 * 1024 * 1024; // 200 MB total budget
// Backstop against reading an absurd upload into memory at all, before even
// attempting to parse it as a zip.
const MAX_ZIP_UPLOAD_BYTES = 400 * 1024 * 1024; // 400 MB

export const DEFAULT_HANDOFF_IMPORT_CONFIG: HandoffImportConfig = {
  accepted_extensions: [...ACCEPTED_HANDOFF_EXTENSIONS],
  raw_omics_extensions: [...RAW_OMICS_EXTENSIONS],
  junk_file_patterns: [...JUNK_FILE_PATTERNS],
  max_file_size_bytes: MAX_FILE_SIZE_BYTES,
  max_total_unzipped_bytes: MAX_TOTAL_UNZIPPED_BYTES,
};

const MAX_CONTENT_PREVIEW_CHARS = 600;

export const RAW_OMICS_IGNORE_REASON =
  "Raw omics matrix recognized but ignored for web MVP. Process in Claude Science first and export compact evidence packets.";
export const PARQUET_DEFERRED_WARNING = "Parquet file recognized but parsing is deferred in this MVP. Convert to JSON/CSV for full chunking.";

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

// ---------------------------------------------------------------------------
// Path / extension helpers
// ---------------------------------------------------------------------------

export function getFileExtension(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match ? `.${match[1].toLowerCase()}` : "";
}

/**
 * Blocks path traversal (../), absolute paths (unix or Windows drive-letter),
 * and null bytes. Uses depth-tracking rather than a naive ".." substring
 * check so "a/../b" (harmless, nets to one level) isn't over-blocked while
 * "../etc/passwd" or "a/../../b" (climbs above the zip root) is.
 */
export function isSafeZipPath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.includes("\0")) return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  if (/^[a-zA-Z]:[\\/]/.test(path)) return false;

  const segments = path.split(/[\\/]/);
  let depth = 0;
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      depth -= 1;
      if (depth < 0) return false;
      continue;
    }
    depth += 1;
  }
  return true;
}

/** Segment-exact match against JUNK_FILE_PATTERNS (.DS_Store as a filename, __MACOSX/.MACOSX as a folder). */
export function shouldIgnoreJunkFile(filePath: string): boolean {
  const segments = filePath.split(/[\\/]/);
  return segments.some((segment) => (JUNK_FILE_PATTERNS as readonly string[]).includes(segment));
}

export function classifyAcceptedExtension(extension: string): boolean {
  return (ACCEPTED_HANDOFF_EXTENSIONS as readonly string[]).includes(extension.toLowerCase());
}

export function isRecognizedRawOmicsExtension(extension: string): boolean {
  return (RAW_OMICS_EXTENSIONS as readonly string[]).includes(extension.toLowerCase());
}

function parsedKindForExtension(extension: string): HandoffImportParsedKind {
  const ext = extension.toLowerCase();
  if (ext === ".json") return "json";
  if (ext === ".csv" || ext === ".tsv") return "table";
  if (ext === ".md") return "text";
  if (ext === ".html") return "html_text";
  if (ext === ".parquet") return "parquet";
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".svg") return "visualization";
  return "unsupported";
}

// ---------------------------------------------------------------------------
// Hand-rolled ZIP reader (central directory + local file headers only —
// no ZIP64, which the size caps below make unnecessary for compact
// evidence packets). No third-party zip dependency; deflate entries are
// inflated with the platform's native DecompressionStream.
// ---------------------------------------------------------------------------

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const MAX_EOCD_COMMENT_LENGTH = 65535;

interface ZipCentralDirectoryEntry {
  fileName: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface ZipListedFile {
  file_path: string;
  file_name: string;
  file_extension: string;
  size_bytes: number;
  compression_method: number;
}

function findEndOfCentralDirectory(view: DataView): { cdOffset: number; entryCount: number } {
  const searchFloor = Math.max(0, view.byteLength - (22 + MAX_EOCD_COMMENT_LENGTH));
  for (let i = view.byteLength - 22; i >= searchFloor; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      const entryCount = view.getUint16(i + 10, true);
      const cdOffset = view.getUint32(i + 16, true);
      return { cdOffset, entryCount };
    }
  }
  throw new Error("Not a valid zip file (End Of Central Directory record not found).");
}

function parseCentralDirectory(bytes: Uint8Array, view: DataView, cdOffset: number, entryCount: number): ZipCentralDirectoryEntry[] {
  const decoder = new TextDecoder("utf-8");
  const entries: ZipCentralDirectoryEntry[] = [];
  let offset = cdOffset;

  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error("Corrupt zip central directory.");
    }
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const fileName = decoder.decode(bytes.subarray(nameStart, nameStart + fileNameLength));

    entries.push({ fileName, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    offset = nameStart + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

async function inflateRawDeflate(compressed: Uint8Array): Promise<Uint8Array> {
  // Copy into a standalone ArrayBuffer — Blob requires a concrete
  // ArrayBuffer-backed BlobPart, not a view over a shared/typed backing buffer.
  const arrayBuffer = compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength) as ArrayBuffer;
  const stream = new Blob([arrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function extractEntryData(bytes: Uint8Array, view: DataView, entry: ZipCentralDirectoryEntry): Promise<Uint8Array> {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > view.byteLength || view.getUint32(offset, true) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`Corrupt zip local file header for '${entry.fileName}'.`);
  }
  const fileNameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) return inflateRawDeflate(compressed);
  throw new Error(`Unsupported zip compression method (${entry.compressionMethod}) for '${entry.fileName}'.`);
}

async function readZipBuffer(file: File | Blob): Promise<{ bytes: Uint8Array; view: DataView; entries: ZipCentralDirectoryEntry[] }> {
  if (file.size > MAX_ZIP_UPLOAD_BYTES) {
    throw new Error(`Uploaded file is ${formatBytes(file.size)}, exceeding the ${formatBytes(MAX_ZIP_UPLOAD_BYTES)} upload limit.`);
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const { cdOffset, entryCount } = findEndOfCentralDirectory(view);
  const entries = parseCentralDirectory(bytes, view, cdOffset, entryCount);
  return { bytes, view, entries };
}

function isDirectoryEntry(fileName: string): boolean {
  return fileName.endsWith("/") || fileName.endsWith("\\");
}

/** Lightweight listing (workflow step 2) — names/sizes only, nothing decompressed yet. */
export async function listFilesFromZip(file: File | Blob): Promise<ZipListedFile[]> {
  const { entries } = await readZipBuffer(file);
  return entries
    .filter((entry) => !isDirectoryEntry(entry.fileName))
    .map((entry) => ({
      file_path: entry.fileName,
      file_name: entry.fileName.split(/[\\/]/).pop() ?? entry.fileName,
      file_extension: getFileExtension(entry.fileName),
      size_bytes: entry.uncompressedSize,
      compression_method: entry.compressionMethod,
    }));
}

/**
 * Reads just the text content of whichever zip entries match `matches`,
 * without running them through the full evidence-artifact import pipeline
 * (parseHandoffFile/classifyAcceptedExtension). Used only for the optional
 * "load interpretation from handoff" convenience feature — an interpretation
 * file isn't evidence, so it doesn't need artifact classification, and may
 * use extensions (.txt) the evidence pipeline doesn't accept. Never throws;
 * unreadable matching entries are silently skipped since this is a
 * best-effort convenience path, not part of the core import.
 */
export async function readMatchingZipEntriesAsText(file: File | Blob, matches: (fileName: string) => boolean): Promise<{ file_path: string; text: string }[]> {
  let bytes: Uint8Array;
  let view: DataView;
  let entries: ZipCentralDirectoryEntry[];
  try {
    ({ bytes, view, entries } = await readZipBuffer(file));
  } catch {
    return [];
  }

  const results: { file_path: string; text: string }[] = [];
  for (const entry of entries) {
    if (isDirectoryEntry(entry.fileName)) continue;
    if (!matches(entry.fileName)) continue;
    try {
      const data = await extractEntryData(bytes, view, entry);
      results.push({ file_path: entry.fileName, text: new TextDecoder("utf-8").decode(data) });
    } catch {
      // Best-effort convenience feature — skip unreadable entries rather than failing the whole scan.
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Per-file-type parsers
// ---------------------------------------------------------------------------

export function parseJsonFile(text: string): unknown {
  return JSON.parse(text);
}

function buildJsonPreview(parsed: unknown): string {
  const text = JSON.stringify(parsed);
  if (text === undefined) return "";
  return text.length > MAX_CONTENT_PREVIEW_CHARS ? `${text.slice(0, MAX_CONTENT_PREVIEW_CHARS)}…` : text;
}

export interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[];
  preview: string;
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  values.push(current);
  return values.map((v) => v.trim());
}

/** Lightweight CSV/TSV parsing — header row + basic quoted-field splitting, not a full RFC4180 implementation. */
export function parseCsvOrTsvFile(text: string, delimiter: "," | "\t"): ParsedTable {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return { headers: [], rows: [], preview: "" };

  const headers = splitDelimitedLine(lines[0], delimiter);
  const rows = lines.slice(1).map((line) => {
    const values = splitDelimitedLine(line, delimiter);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });

  const preview = `Headers: ${headers.join(", ")} (${rows.length} row(s))`;
  return { headers, rows, preview };
}

export interface TextSection {
  heading: string;
  body: string;
}

export interface ParsedText {
  text: string;
  headings: string[];
  preview: string;
  sections: TextSection[];
}

/** Chunks markdown by heading (#-###### ) boundaries. */
export function parseMarkdownFile(text: string): ParsedText {
  const headingPattern = /^(#{1,6})\s+(.+)$/gm;
  const matches = Array.from(text.matchAll(headingPattern));
  const headings: string[] = [];
  const sections: TextSection[] = [];

  if (matches.length === 0) {
    sections.push({ heading: "", body: text.trim() });
  } else {
    matches.forEach((match, i) => {
      const heading = match[2].trim();
      headings.push(heading);
      const bodyStart = (match.index ?? 0) + match[0].length;
      const bodyEnd = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
      sections.push({ heading, body: text.slice(bodyStart, bodyEnd).trim() });
    });
  }

  return { text, headings, preview: text.trim().slice(0, MAX_CONTENT_PREVIEW_CHARS), sections };
}

const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

/**
 * Strips HTML to plain text and chunks by heading, using DOMParser — a
 * detached document whose <script> tags never execute and whose remote
 * resources are never fetched (a well-documented browser security
 * property), so this is safe to run on untrusted uploaded HTML.
 */
export function parseHtmlFile(text: string): ParsedText {
  const doc = new DOMParser().parseFromString(text, "text/html");
  const root: Node = doc.body ?? doc.documentElement;

  const headings: string[] = [];
  const sections: TextSection[] = [];
  let currentHeading = "";
  let currentBody: string[] = [];

  function flushSection() {
    const body = currentBody.join(" ").replace(/\s+/g, " ").trim();
    if (currentHeading.length > 0 || body.length > 0) sections.push({ heading: currentHeading, body });
  }

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE && HEADING_TAGS.has((node as Element).tagName)) {
      flushSection();
      currentHeading = node.textContent?.trim() ?? "";
      headings.push(currentHeading);
      currentBody = [];
    } else if (node.nodeType === Node.TEXT_NODE) {
      const parentTag = (node.parentElement?.tagName ?? "").toUpperCase();
      if (!HEADING_TAGS.has(parentTag) && node.textContent) currentBody.push(node.textContent);
    }
    node = walker.nextNode();
  }
  flushSection();

  const bodyText = (root.textContent ?? "").replace(/\s+/g, " ").trim();
  return { text: bodyText, headings, preview: bodyText.slice(0, MAX_CONTENT_PREVIEW_CHARS), sections };
}

export interface ParsedParquetPlaceholder {
  note: string;
  byte_length: number;
}

/**
 * Classify-only support: parquet is a binary, Thrift-encoded columnar
 * format that can't be safely hand-rolled the way the ZIP/CSV/JSON parsers
 * above are, and pulling in a parquet-reading dependency is out of scope
 * for this MVP pass. The file is still recognized/accepted (so it shows up
 * in Artifact Discovery and gets a metadata-only index entry), it's just
 * not chunked from its actual row data.
 */
export function parseParquetFile(bytes: Uint8Array): ParsedParquetPlaceholder {
  return { note: PARQUET_DEFERRED_WARNING, byte_length: bytes.byteLength };
}

// ---------------------------------------------------------------------------
// Per-file orchestration
// ---------------------------------------------------------------------------

function baseHandoffFile(filePath: string, extension: string, sizeBytes: number): Pick<HandoffImportFile, "file_name" | "file_path" | "file_extension" | "size_bytes"> {
  return {
    file_name: filePath.split(/[\\/]/).pop() ?? filePath,
    file_path: filePath,
    file_extension: extension,
    size_bytes: sizeBytes,
  };
}

/** Parses one already-extracted, already-safety-checked file's bytes into a HandoffImportFile. */
export async function parseHandoffFile(filePath: string, extension: string, data: Uint8Array): Promise<HandoffImportFile> {
  const base = baseHandoffFile(filePath, extension, data.byteLength);
  const ext = extension.toLowerCase();

  if (ext === ".json") {
    const text = new TextDecoder("utf-8").decode(data);
    try {
      const parsed = parseJsonFile(text);
      return { ...base, accepted: true, ignored: false, parsed_kind: "json", content_preview: buildJsonPreview(parsed), parsed_content: parsed };
    } catch (err) {
      return {
        ...base,
        accepted: false,
        ignored: true,
        parsed_kind: "json",
        ignore_reason: "Failed to parse JSON content.",
        warnings: [err instanceof Error ? err.message : String(err)],
      };
    }
  }

  if (ext === ".csv" || ext === ".tsv") {
    const text = new TextDecoder("utf-8").decode(data);
    try {
      const parsed = parseCsvOrTsvFile(text, ext === ".tsv" ? "\t" : ",");
      return { ...base, accepted: true, ignored: false, parsed_kind: "table", content_preview: parsed.preview, parsed_content: parsed };
    } catch (err) {
      return {
        ...base,
        accepted: false,
        ignored: true,
        parsed_kind: "table",
        ignore_reason: "Failed to parse table content.",
        warnings: [err instanceof Error ? err.message : String(err)],
      };
    }
  }

  if (ext === ".md") {
    const text = new TextDecoder("utf-8").decode(data);
    const parsed = parseMarkdownFile(text);
    return { ...base, accepted: true, ignored: false, parsed_kind: "text", content_preview: parsed.preview, parsed_content: parsed };
  }

  if (ext === ".html") {
    const text = new TextDecoder("utf-8").decode(data);
    const parsed = parseHtmlFile(text);
    return { ...base, accepted: true, ignored: false, parsed_kind: "html_text", content_preview: parsed.preview, parsed_content: parsed };
  }

  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".svg") {
    return {
      ...base,
      accepted: true,
      ignored: false,
      parsed_kind: "visualization",
      content_preview: `${base.file_name} (${formatBytes(data.byteLength)}) — visualization asset, listed for provenance/audit display only, not used as core evidence.`,
    };
  }

  if (ext === ".parquet") {
    const parsed = parseParquetFile(data);
    return {
      ...base,
      accepted: true,
      ignored: false,
      parsed_kind: "parquet",
      content_preview: `${base.file_name} (${formatBytes(data.byteLength)}) — parquet file.`,
      parsed_content: parsed,
      warnings: [PARQUET_DEFERRED_WARNING],
    };
  }

  // Not reached in practice — callers only invoke this after
  // classifyAcceptedExtension has already gated the extension — but stay
  // safe if it ever is.
  return { ...base, accepted: false, ignored: true, parsed_kind: "unsupported", ignore_reason: `Unsupported file type for the web MVP evidence pipeline (${ext || "no extension"}).` };
}

// ---------------------------------------------------------------------------
// Top-level orchestrator (workflow steps 1-6)
// ---------------------------------------------------------------------------

/**
 * Safely unzips a user-uploaded Claude Science handoff .zip: lists entries,
 * blocks unsafe paths, filters to supported extensions, enforces size
 * limits, and lightly parses the accepted files. Never throws — parse/zip
 * failures are captured as warnings/per-file ignore reasons so the caller
 * always gets a valid HandoffImportResult to render.
 */
export async function importClaudeScienceHandoffZip(
  file: File | Blob,
  config: HandoffImportConfig = DEFAULT_HANDOFF_IMPORT_CONFIG,
  skipFileNames?: (fileName: string) => boolean,
): Promise<HandoffImportResult> {
  const created_at = new Date().toISOString();
  const project_id = `handoff-import-${created_at.replace(/[:.]/g, "-")}`;
  const warnings: string[] = [];

  let bytes: Uint8Array;
  let view: DataView;
  let entries: ZipCentralDirectoryEntry[];
  try {
    ({ bytes, view, entries } = await readZipBuffer(file));
  } catch (err) {
    warnings.push(`Could not read this file as a zip archive: ${err instanceof Error ? err.message : String(err)}`);
    return { project_id, created_at, total_files_seen: 0, accepted_files_count: 0, ignored_files_count: 0, files: [], warnings };
  }

  const files: HandoffImportFile[] = [];
  let runningTotalBytes = 0;

  for (const entry of entries) {
    if (isDirectoryEntry(entry.fileName)) continue;

    const filePath = entry.fileName;
    const extension = getFileExtension(filePath);
    const sizeBytes = entry.uncompressedSize;
    const base = baseHandoffFile(filePath, extension, sizeBytes);

    if (!isSafeZipPath(filePath)) {
      files.push({ ...base, accepted: false, ignored: true, parsed_kind: "unsafe", ignore_reason: "Unsafe path blocked (path traversal, absolute path, or null byte)." });
      continue;
    }

    if (shouldIgnoreJunkFile(filePath)) {
      files.push({ ...base, accepted: false, ignored: true, parsed_kind: "junk", ignore_reason: "Hidden/system file ignored (.DS_Store, __MACOSX, .MACOSX)." });
      continue;
    }

    if (skipFileNames?.(filePath)) {
      files.push({
        ...base,
        accepted: false,
        ignored: true,
        parsed_kind: parsedKindForExtension(extension),
        ignore_reason: "Recognized as an interpretation or demo/evaluation fixture file — not treated as evidence for this grounding run.",
      });
      continue;
    }

    if (isRecognizedRawOmicsExtension(extension)) {
      files.push({ ...base, accepted: false, ignored: true, parsed_kind: "raw_omics_ignored", ignore_reason: RAW_OMICS_IGNORE_REASON });
      continue;
    }

    if (!classifyAcceptedExtension(extension)) {
      files.push({
        ...base,
        accepted: false,
        ignored: true,
        parsed_kind: "unsupported",
        ignore_reason: `Unsupported file type for the web MVP evidence pipeline (${extension || "no extension"}).`,
      });
      continue;
    }

    if (sizeBytes > config.max_file_size_bytes) {
      files.push({
        ...base,
        accepted: false,
        ignored: true,
        parsed_kind: parsedKindForExtension(extension),
        ignore_reason: `File exceeds the per-file size limit (${formatBytes(sizeBytes)} > ${formatBytes(config.max_file_size_bytes)}).`,
      });
      continue;
    }

    if (runningTotalBytes + sizeBytes > config.max_total_unzipped_bytes) {
      files.push({
        ...base,
        accepted: false,
        ignored: true,
        parsed_kind: parsedKindForExtension(extension),
        ignore_reason: `Skipped — the total unzipped size budget (${formatBytes(config.max_total_unzipped_bytes)}) was reached.`,
      });
      continue;
    }

    try {
      const data = await extractEntryData(bytes, view, entry);
      runningTotalBytes += sizeBytes;
      files.push(await parseHandoffFile(filePath, extension, data));
    } catch (err) {
      files.push({
        ...base,
        accepted: false,
        ignored: true,
        parsed_kind: parsedKindForExtension(extension),
        ignore_reason: "Failed to extract or parse this file from the zip.",
        warnings: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  const accepted_files_count = files.filter((f) => f.accepted).length;
  const ignored_files_count = files.filter((f) => f.ignored).length;

  if (ignored_files_count > 0) {
    warnings.push(`${ignored_files_count} file(s) were ignored during import — see each file's ignore_reason.`);
  }
  warnings.push(
    "Large raw omics matrices are ignored in the web MVP. They should be processed in Claude Science first and exported as compact evidence packets.",
  );

  return {
    project_id,
    created_at,
    total_files_seen: files.length,
    accepted_files_count,
    ignored_files_count,
    files,
    warnings,
  };
}

/**
 * Sibling to importClaudeScienceHandoffZip for a flat list of individually
 * attached (non-zip) files — e.g. from a multi-file <input> or a folder
 * picker. Shares the same per-file classification/parsing rules
 * (parseHandoffFile, size limits, junk/raw-omics filtering); the only
 * difference is there's no zip archive to unsafely path-traverse, since each
 * File already comes from the browser's own file picker.
 */
export async function importClaudeScienceHandoffFiles(
  files: File[],
  config: HandoffImportConfig = DEFAULT_HANDOFF_IMPORT_CONFIG,
  skipFileNames?: (fileName: string) => boolean,
): Promise<HandoffImportResult> {
  const created_at = new Date().toISOString();
  const project_id = `handoff-import-${created_at.replace(/[:.]/g, "-")}`;
  const warnings: string[] = [];

  const outFiles: HandoffImportFile[] = [];
  let runningTotalBytes = 0;

  for (const file of files) {
    const filePath = file.webkitRelativePath && file.webkitRelativePath.length > 0 ? file.webkitRelativePath : file.name;
    const extension = getFileExtension(filePath);
    const sizeBytes = file.size;
    const base = baseHandoffFile(filePath, extension, sizeBytes);

    if (shouldIgnoreJunkFile(filePath)) {
      outFiles.push({ ...base, accepted: false, ignored: true, parsed_kind: "junk", ignore_reason: "Hidden/system file ignored (.DS_Store, __MACOSX, .MACOSX)." });
      continue;
    }

    if (skipFileNames?.(filePath)) {
      outFiles.push({
        ...base,
        accepted: false,
        ignored: true,
        parsed_kind: parsedKindForExtension(extension),
        ignore_reason: "Recognized as an interpretation or demo/evaluation fixture file — not treated as evidence for this grounding run.",
      });
      continue;
    }

    if (isRecognizedRawOmicsExtension(extension)) {
      outFiles.push({ ...base, accepted: false, ignored: true, parsed_kind: "raw_omics_ignored", ignore_reason: RAW_OMICS_IGNORE_REASON });
      continue;
    }

    if (!classifyAcceptedExtension(extension)) {
      outFiles.push({
        ...base,
        accepted: false,
        ignored: true,
        parsed_kind: "unsupported",
        ignore_reason: `Unsupported file type for the web MVP evidence pipeline (${extension || "no extension"}).`,
      });
      continue;
    }

    if (sizeBytes > config.max_file_size_bytes) {
      outFiles.push({
        ...base,
        accepted: false,
        ignored: true,
        parsed_kind: parsedKindForExtension(extension),
        ignore_reason: `File exceeds the per-file size limit (${formatBytes(sizeBytes)} > ${formatBytes(config.max_file_size_bytes)}).`,
      });
      continue;
    }

    if (runningTotalBytes + sizeBytes > config.max_total_unzipped_bytes) {
      outFiles.push({
        ...base,
        accepted: false,
        ignored: true,
        parsed_kind: parsedKindForExtension(extension),
        ignore_reason: `Skipped — the total unzipped size budget (${formatBytes(config.max_total_unzipped_bytes)}) was reached.`,
      });
      continue;
    }

    try {
      const data = new Uint8Array(await file.arrayBuffer());
      runningTotalBytes += sizeBytes;
      outFiles.push(await parseHandoffFile(filePath, extension, data));
    } catch (err) {
      outFiles.push({
        ...base,
        accepted: false,
        ignored: true,
        parsed_kind: parsedKindForExtension(extension),
        ignore_reason: "Failed to read or parse this file.",
        warnings: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  const accepted_files_count = outFiles.filter((f) => f.accepted).length;
  const ignored_files_count = outFiles.filter((f) => f.ignored).length;

  if (ignored_files_count > 0) {
    warnings.push(`${ignored_files_count} file(s) were ignored during import — see each file's ignore_reason.`);
  }
  warnings.push(
    "Large raw omics matrices are ignored in the web MVP. They should be processed in Claude Science first and exported as compact evidence packets.",
  );

  return {
    project_id,
    created_at,
    total_files_seen: outFiles.length,
    accepted_files_count,
    ignored_files_count,
    files: outFiles,
    warnings,
  };
}
