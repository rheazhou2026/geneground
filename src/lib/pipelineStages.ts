// User-facing grounding pipeline model for the /demo composer flow.
//
// This is purely a UI-progress model — it does not change what the backend
// pipeline computes (src/lib/*, src/lib/claude/*), only how its progress is
// visualized. Node ids map onto the two conceptual branches described in the
// product spec (interpretation vs. Claude Science handoff) merging into a
// single grounded-rewrite pipeline; the 7 STAGES are the coarser, plain-
// language grouping shown as step text ("3 / 7 complete").

export type PipelineNodeStatus = "pending" | "running" | "complete" | "fallback" | "error";

export type PipelineNodeId =
  | "interpretation"
  | "handoff"
  | "claim_extraction"
  | "artifact_discovery"
  | "entity_normalization"
  | "evidence_indexing"
  | "evidence_retrieval"
  | "agent_evaluation"
  | "grounded_rewrite";

export interface PipelineNodeMeta {
  id: PipelineNodeId;
  label: string;
  /** "a" = interpretation branch, "b" = handoff branch, "merge" = shared tail. */
  branch: "a" | "b" | "merge";
  /** Row within its branch column, used to lay out the compact map. */
  row: number;
}

export const PIPELINE_NODES: PipelineNodeMeta[] = [
  { id: "interpretation", label: "Interpretation", branch: "a", row: 0 },
  { id: "handoff", label: "Claude Science handoff", branch: "b", row: 0 },
  { id: "claim_extraction", label: "Claim extraction", branch: "a", row: 1 },
  { id: "artifact_discovery", label: "Artifact discovery", branch: "b", row: 1 },
  { id: "entity_normalization", label: "Entity normalization", branch: "a", row: 2 },
  { id: "evidence_indexing", label: "Evidence indexing", branch: "b", row: 2 },
  { id: "evidence_retrieval", label: "Evidence retrieval", branch: "merge", row: 3 },
  { id: "agent_evaluation", label: "Four-agent evaluation", branch: "merge", row: 4 },
  { id: "grounded_rewrite", label: "Grounded rewrite", branch: "merge", row: 5 },
];

export interface PipelineStage {
  id: string;
  label: string;
  nodeIds: PipelineNodeId[];
  /** Plain-language description of the backend steps this stage covers. */
  backendMapping: string;
}

// Exactly 6 user-facing stages. The Claude Science handoff / Artifact
// Discovery / Evidence indexing work still happens (page.tsx still tracks
// those three node ids individually via setNodeStatus), it's just folded
// into stage 1's combined status here rather than shown as its own visible
// row — see deriveStageStatus below.
export const PIPELINE_STAGES: PipelineStage[] = [
  {
    id: "reading",
    label: "Reading interpretation",
    nodeIds: ["interpretation", "handoff", "artifact_discovery", "evidence_indexing"],
    backendMapping: "Input parsing + sentence splitting + handoff import/Artifact Discovery/evidence indexing",
  },
  {
    id: "extracting",
    label: "Extracting biological claims",
    nodeIds: ["claim_extraction"],
    backendMapping: "Step 1 Claude API claim extraction + Step 2 deterministic InterpretationClaimMap",
  },
  {
    id: "normalizing",
    label: "Normalizing genes, pathways, cells, and conditions",
    nodeIds: ["entity_normalization"],
    backendMapping: "Step 3B deterministic mini ontology normalization",
  },
  {
    id: "retrieving",
    label: "Retrieving relevant evidence chunks",
    nodeIds: ["evidence_retrieval"],
    backendMapping: "AgentQueryPlan + metadata_exact + metadata_partial + local TF-IDF vector fallback retrieval",
  },
  {
    id: "evaluating",
    label: "Evaluating claims with specialist agents",
    nodeIds: ["agent_evaluation"],
    backendMapping: "Step 8B Claude API four-agent evaluation",
  },
  {
    id: "rewriting",
    label: "Generating grounded rewrite",
    nodeIds: ["grounded_rewrite"],
    backendMapping: "Deterministic final_verdict aggregation + Claude API Reason/Rewritten_Claim generation",
  },
];

export type PipelineNodeStatusMap = Record<PipelineNodeId, PipelineNodeStatus>;

export function initialPipelineNodeStatus(): PipelineNodeStatusMap {
  return PIPELINE_NODES.reduce((acc, node) => {
    acc[node.id] = "pending";
    return acc;
  }, {} as PipelineNodeStatusMap);
}

/**
 * Combines a stage's underlying node statuses into one representative
 * status for display: any error wins outright; otherwise any node still
 * running (or a partial mix of settled/unsettled nodes) reads as running;
 * complete only once every node is complete; fallback once every node has
 * settled but at least one used a fallback path; pending only while nothing
 * has started yet.
 */
export function deriveStageStatus(stage: PipelineStage, statuses: PipelineNodeStatusMap): PipelineNodeStatus {
  const values = stage.nodeIds.map((id) => statuses[id]);
  if (values.some((v) => v === "error")) return "error";
  if (values.every((v) => v === "pending")) return "pending";
  if (values.every((v) => v === "complete")) return "complete";
  if (values.every((v) => v === "complete" || v === "fallback")) return "fallback";
  return "running";
}

/** A stage counts as "done" once every node it covers has settled (complete or fallback — not pending/running/error). */
function isStageDone(stage: PipelineStage, statuses: PipelineNodeStatusMap): boolean {
  return stage.nodeIds.every((id) => statuses[id] === "complete" || statuses[id] === "fallback");
}

export function countCompletedStages(statuses: PipelineNodeStatusMap): number {
  return PIPELINE_STAGES.filter((stage) => isStageDone(stage, statuses)).length;
}

export function hasAnyFallback(statuses: PipelineNodeStatusMap): boolean {
  return PIPELINE_NODES.some((node) => statuses[node.id] === "fallback");
}

export function hasAnyError(statuses: PipelineNodeStatusMap): boolean {
  return PIPELINE_NODES.some((node) => statuses[node.id] === "error");
}
