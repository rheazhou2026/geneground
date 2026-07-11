// Optional convenience: detect an omics interpretation file bundled inside
// an uploaded Claude Science handoff and offer to load it into the demo
// composer. This is pure UI convenience — it never touches claim
// extraction, normalization, artifact indexing, retrieval, or final_verdict
// aggregation. See docs/geneground-backend-logic.md's "User-Facing Progress
// Stages" note: the interpretation is always just plain text handed to Step
// 1, regardless of whether the user typed it or it was loaded from a file.

/** Exact (case-insensitive) file basenames GeneGround recognizes as "this file contains the interpretation to ground". */
export const RECOGNIZED_INTERPRETATION_FILE_NAMES = [
  "geneground_realistic_interpretation.json",
  "realistic_interpretation.json",
  "interpretation.json",
  "omics_interpretation.txt",
  "omics_interpretation.md",
  "interpretation.txt",
  "interpretation.md",
] as const;

/**
 * Demo/evaluation fixture files that may ride along in a handoff bundle but
 * must never be treated as biological evidence or auto-run as additional
 * interpretations in the main app flow (gold verdicts, stress-test
 * variants, canned demo claims — all out of scope here).
 */
export const DEMO_FIXTURE_FILE_NAMES = [
  "geneground_interpretation_variants.json",
  "geneground_demo_claims.json",
  "geneground_gold_verdicts.json",
] as const;

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function isRecognizedInterpretationFileName(path: string): boolean {
  const name = basename(path).toLowerCase();
  return (RECOGNIZED_INTERPRETATION_FILE_NAMES as readonly string[]).includes(name);
}

/** True for demo/evaluation fixture files that should be excluded from the main grounding run's evidence set entirely. */
export function shouldIgnoreDemoFixtureFileForMainRun(path: string): boolean {
  const name = basename(path).toLowerCase();
  return (DEMO_FIXTURE_FILE_NAMES as readonly string[]).includes(name);
}

export interface InterpretationFileCandidate {
  path: string;
}

/** Filters a flat list of handoff file paths/names down to recognized interpretation files, preserving order. */
export function findInterpretationFilesInHandoff<T extends InterpretationFileCandidate>(files: T[]): T[] {
  return files.filter((f) => isRecognizedInterpretationFileName(f.path));
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

// Priority order: the most specific/likely field names first.
const JSON_INTERPRETATION_FIELD_PRIORITY = ["interpretation", "realistic_interpretation", "text", "paragraph", "content", "summary"];

const MIN_PARAGRAPH_LENGTH = 40;

function looksLikeInterpretationParagraph(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= MIN_PARAGRAPH_LENGTH && /\s/.test(trimmed);
}

/**
 * Robustly extracts interpretation text from a parsed JSON value.
 * 1. Checks a fixed priority list of common field names at the top level.
 * 2. If none match, shallowly (one level only) searches nested objects for
 *    the same priority fields.
 * 3. Falls back to the first top-level string field that looks like a
 *    prose paragraph rather than an ID, filename, or short label.
 * Returns null if nothing usable is found — callers must treat that as
 * "no interpretation detected", never as an empty-string interpretation.
 */
export function extractInterpretationTextFromJson(parsed: unknown, depth = 0): string | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  for (const field of JSON_INTERPRETATION_FIELD_PRIORITY) {
    const value = obj[field];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }

  if (depth === 0) {
    for (const value of Object.values(obj)) {
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const nested = extractInterpretationTextFromJson(value, depth + 1);
        if (nested) return nested;
      }
    }
  }

  for (const value of Object.values(obj)) {
    if (typeof value === "string" && looksLikeInterpretationParagraph(value)) return value.trim();
  }

  return null;
}

function stripLeadingMarkdownHeading(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && /^#{1,6}\s+/.test(lines[0].trim())) {
    return lines.slice(1).join("\n").trim();
  }
  return text.trim();
}

/**
 * Extracts interpretation text from a recognized interpretation file's raw
 * text content, dispatching by extension. Returns null (never an empty
 * string) if the file's content doesn't yield usable text.
 */
export function extractInterpretationTextFromFile(fileName: string, rawContent: string): string | null {
  const ext = (/\.[a-z0-9]+$/i.exec(fileName)?.[0] ?? "").toLowerCase();

  if (ext === ".json") {
    try {
      return extractInterpretationTextFromJson(JSON.parse(rawContent));
    } catch {
      return null;
    }
  }

  if (ext === ".txt" || ext === ".md") {
    const body = stripLeadingMarkdownHeading(rawContent);
    return body.length > 0 ? body : null;
  }

  return null;
}

/**
 * Policy for the "load from handoff" prompt: only silently loadable when
 * the composer is empty. Once the user has typed/pasted anything, loading a
 * handoff interpretation must go through an explicit replace/keep choice
 * rather than overwriting silently.
 */
export function shouldConfirmBeforeLoadingInterpretation(currentComposerText: string): boolean {
  return currentComposerText.trim().length > 0;
}
