// Regression checks for the optional "load interpretation from handoff"
// convenience feature (src/lib/interpretationFileDetection.ts +
// src/lib/handoffImport.ts's readMatchingZipEntriesAsText/skipFileNames).
// Pure-logic checks only — no DOM/React harness in this project, so the
// composer's card/modal wiring itself isn't exercised here, only the
// deterministic detection/extraction/policy functions it's built on.
// Run via `npm run test`.

import {
  DEMO_FIXTURE_FILE_NAMES,
  RECOGNIZED_INTERPRETATION_FILE_NAMES,
  extractInterpretationTextFromFile,
  extractInterpretationTextFromJson,
  findInterpretationFilesInHandoff,
  isRecognizedInterpretationFileName,
  shouldConfirmBeforeLoadingInterpretation,
  shouldIgnoreDemoFixtureFileForMainRun,
} from "@/lib/interpretationFileDetection";

let passCount = 0;
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

function section(title: string) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
// 1. Empty composer + handoff containing geneground_realistic_interpretation.json
//    -> should be found and its text extracted, prompting a load option.
// ---------------------------------------------------------------------------

section("1. geneground_realistic_interpretation.json is found and extracted");

const realisticInterpText =
  "STAT1 knockdown suppresses interferon signaling in stimulated CD4+ T cells, consistent with reduced pathway activity.";

const handoffWithInterpretation = [
  { path: "handoff/perturbation_evidence.json" },
  { path: "handoff/geneground_realistic_interpretation.json" },
  { path: "handoff/pathway_evidence.csv" },
];

const foundSingle = findInterpretationFilesInHandoff(handoffWithInterpretation);
check("exactly one interpretation file is found in a mixed evidence bundle", foundSingle.length === 1);
check("the found file is geneground_realistic_interpretation.json", foundSingle[0]?.path.endsWith("geneground_realistic_interpretation.json"));

check(
  "extractInterpretationTextFromFile pulls the paragraph from the 'interpretation' field",
  extractInterpretationTextFromFile("geneground_realistic_interpretation.json", JSON.stringify({ interpretation: realisticInterpText })) ===
    realisticInterpText,
);

for (const field of ["text", "paragraph", "realistic_interpretation", "content", "summary"]) {
  check(
    `extractInterpretationTextFromJson is robust to field name '${field}'`,
    extractInterpretationTextFromJson({ [field]: realisticInterpText }) === realisticInterpText,
  );
}

check(
  "extractInterpretationTextFromJson shallowly searches a nested object for a paragraph-like field",
  extractInterpretationTextFromJson({ metadata: { source: "claude-science" }, result: { interpretation: realisticInterpText } }) ===
    realisticInterpText,
);

check(
  "extractInterpretationTextFromJson falls back to a paragraph-shaped string field when no known field name matches",
  extractInterpretationTextFromJson({ notes: realisticInterpText, id: "abc123" }) === realisticInterpText,
);

check(
  "extractInterpretationTextFromJson returns null when nothing paragraph-like is present",
  extractInterpretationTextFromJson({ id: "abc123", version: 2 }) === null,
);

check(
  ".txt/.md interpretation files are read as plain text (leading markdown heading stripped)",
  extractInterpretationTextFromFile("omics_interpretation.md", `# Interpretation\n\n${realisticInterpText}`) === realisticInterpText,
);

check("file name matching is case-insensitive", isRecognizedInterpretationFileName("Handoff/INTERPRETATION.JSON"));

// ---------------------------------------------------------------------------
// 2. Empty composer + no interpretation file present -> nothing found.
// ---------------------------------------------------------------------------

section("2. No interpretation file present -> nothing found");

const evidenceOnlyHandoff = [
  { path: "perturbation_evidence.json" },
  { path: "pathway_evidence.csv" },
  { path: "robustness.tsv" },
  { path: "language_rules.json" },
];

check("findInterpretationFilesInHandoff returns an empty array for an evidence-only bundle", findInterpretationFilesInHandoff(evidenceOnlyHandoff).length === 0);

// ---------------------------------------------------------------------------
// 3. Multiple interpretation candidates present -> all are found, in order,
//    which is what drives the "which file?" selection modal.
// ---------------------------------------------------------------------------

section("3. Multiple interpretation candidates are all found");

const multiCandidateHandoff = [
  { path: "interpretation.json" },
  { path: "perturbation_evidence.json" },
  { path: "omics_interpretation.md" },
  { path: "interpretation.txt" },
];

const foundMultiple = findInterpretationFilesInHandoff(multiCandidateHandoff);
check("all three recognized interpretation files are found", foundMultiple.length === 3);
check(
  "the recognized files are found in their original order",
  foundMultiple.map((f) => f.path).join(",") === "interpretation.json,omics_interpretation.md,interpretation.txt",
);

// Sanity-check the full recognized name list is actually exercised somewhere above.
check("every RECOGNIZED_INTERPRETATION_FILE_NAMES entry is individually recognized", RECOGNIZED_INTERPRETATION_FILE_NAMES.every((n) => isRecognizedInterpretationFileName(n)));

// ---------------------------------------------------------------------------
// 4. User-typed composer text must not be silently overwritten.
// ---------------------------------------------------------------------------

section("4. User-typed composer text requires confirmation before being replaced");

check("an empty composer does not require confirmation before loading", shouldConfirmBeforeLoadingInterpretation("") === false);
check("a whitespace-only composer does not require confirmation before loading", shouldConfirmBeforeLoadingInterpretation("   \n  ") === false);
check("a composer with user-typed text requires confirmation before loading", shouldConfirmBeforeLoadingInterpretation("STAT1 knockdown suppresses...") === true);

// ---------------------------------------------------------------------------
// 5. Demo/evaluation fixture files (gold verdicts, variants, canned claims)
//    are ignored for the main grounding run and never treated as an
//    interpretation to load.
// ---------------------------------------------------------------------------

section("5. Demo/evaluation fixture files are ignored for the main run");

for (const fixtureName of DEMO_FIXTURE_FILE_NAMES) {
  check(`'${fixtureName}' is classified as a fixture to ignore for the main run`, shouldIgnoreDemoFixtureFileForMainRun(fixtureName));
  check(`'${fixtureName}' is never mistaken for an interpretation file`, !isRecognizedInterpretationFileName(fixtureName));
}

const bundleWithFixtures = [
  { path: "geneground_realistic_interpretation.json" },
  { path: "geneground_interpretation_variants.json" },
  { path: "geneground_demo_claims.json" },
  { path: "geneground_gold_verdicts.json" },
];

const foundWithFixturesPresent = findInterpretationFilesInHandoff(bundleWithFixtures);
check(
  "fixture files never leak into the interpretation candidate list",
  foundWithFixturesPresent.length === 1 && foundWithFixturesPresent[0].path === "geneground_realistic_interpretation.json",
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passCount} passed, ${failures.length} failed.`);
if (failures.length > 0) {
  console.log("\nFailed checks:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
