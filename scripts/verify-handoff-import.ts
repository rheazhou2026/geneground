import { readFileSync } from "node:fs";
import { importClaudeScienceHandoffZip } from "@/lib/handoffImport";
import { discoverArtifactsFromHandoffImport } from "@/lib/artifactDiscovery";
import { buildArtifactIndexesFromDiscoveryResult } from "@/lib/artifactIndexes";

const zipPath = process.argv[2];
if (!zipPath) {
  console.error("Usage: tsx scripts/verify-handoff-import.ts <path-to-zip>");
  process.exit(1);
}

const buffer = readFileSync(zipPath);
const blob = new Blob([buffer]);

async function main() {
  const result = await importClaudeScienceHandoffZip(blob);
  console.log(JSON.stringify(result, null, 2));

  const discovery = discoverArtifactsFromHandoffImport(result);
  console.log("\n=== Artifact Discovery ===");
  console.log(JSON.stringify(discovery, null, 2));

  const indexes = buildArtifactIndexesFromDiscoveryResult(discovery, result);
  console.log("\n=== Artifact Indexes (chunk counts) ===");
  for (const [name, index] of Object.entries(indexes.indexes)) {
    console.log(`${name}: ${index.chunks.length} chunk(s), source_artifact_ids=${JSON.stringify(index.source_artifact_ids)}`);
  }
}

main();
