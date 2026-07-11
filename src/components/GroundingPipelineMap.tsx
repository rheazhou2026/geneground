"use client";

import { PIPELINE_STAGES, countCompletedStages, deriveStageStatus, hasAnyError, type PipelineNodeStatusMap } from "@/lib/pipelineStages";
import { GroundingProgressNode } from "./GroundingProgressNode";

export function GroundingPipelineMap({ statuses, done }: { statuses: PipelineNodeStatusMap; done: boolean }) {
  const completedStages = countCompletedStages(statuses);
  const errored = hasAnyError(statuses);

  return (
    <div className="max-w-sm rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          {errored ? "Grounding hit an issue" : done ? "Grounding complete" : "Grounding in progress"}
        </span>
        <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">{completedStages} / {PIPELINE_STAGES.length} complete</span>
      </div>

      <div className="flex flex-col">
        {PIPELINE_STAGES.map((stage, i) => (
          <div key={stage.id}>
            <GroundingProgressNode label={stage.label} status={deriveStageStatus(stage, statuses)} />
            {i < PIPELINE_STAGES.length - 1 && <div className="ml-3 h-3 w-px bg-zinc-200 dark:bg-zinc-800" />}
          </div>
        ))}
      </div>
    </div>
  );
}
