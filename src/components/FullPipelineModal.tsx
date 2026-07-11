"use client";

import { TechnicalPipelineDetail, type TechnicalPipelineData } from "./TechnicalPipelineDetail";
import type { PipelineSources } from "./TechnicalPipelinePanel";
import type { InterpretationSource } from "./DemoComposer";

export function FullPipelineModal({
  data,
  pipelineSources,
  pipelineWarnings,
  submittedAttachments,
  interpretationSource,
  showRawJson,
  onToggleRawJson,
  onClose,
}: {
  data: TechnicalPipelineData;
  pipelineSources: PipelineSources;
  pipelineWarnings: string[];
  submittedAttachments: { name: string; size: number }[];
  interpretationSource: InterpretationSource;
  showRawJson: boolean;
  onToggleRawJson: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Full pipeline trace</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleRawJson}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {showRawJson ? "Hide raw JSON" : "Show raw JSON"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close full pipeline"
            className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-4xl">
          <TechnicalPipelineDetail
            data={data}
            pipelineSources={pipelineSources}
            pipelineWarnings={pipelineWarnings}
            submittedAttachments={submittedAttachments}
            interpretationSource={interpretationSource}
            showRawJson={showRawJson}
          />
        </div>
      </div>
    </div>
  );
}
