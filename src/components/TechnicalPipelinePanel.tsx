"use client";

import { useState } from "react";
import { TechnicalPipelineDetail, type TechnicalPipelineData } from "./TechnicalPipelineDetail";
import { FullPipelineModal } from "./FullPipelineModal";
import type { InterpretationSource } from "./DemoComposer";

export interface PipelineSources {
  extraction: "claude" | "mock";
  // "skipped" = claimNeedsRewrite decided no rewrite was needed, so the
  // /api/claude/final-rewrite call was never made for that claim.
  perClaim: Record<string, { agentEval: "claude" | "mock"; rewrite: "claude" | "mock" | "skipped" }>;
}

export function TechnicalPipelinePanel({
  data,
  pipelineSources,
  pipelineWarnings,
  submittedAttachments,
  interpretationSource,
}: {
  data: TechnicalPipelineData;
  pipelineSources: PipelineSources;
  pipelineWarnings: string[];
  submittedAttachments: { name: string; size: number }[];
  interpretationSource: InterpretationSource;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Technical Pipeline</h3>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowRawJson((s) => !s)}
              className="text-[11px] font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              {showRawJson ? "Hide raw JSON" : "Show raw JSON"}
            </button>
            <button
              type="button"
              onClick={() => setFullscreen(true)}
              title="Fullscreen"
              aria-label="Fullscreen"
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
            >
              ⤢
            </button>
          </div>
        </div>

        <TechnicalPipelineDetail
          data={data}
          pipelineSources={pipelineSources}
          pipelineWarnings={pipelineWarnings}
          submittedAttachments={submittedAttachments}
          interpretationSource={interpretationSource}
          showRawJson={showRawJson}
        />
      </div>

      {fullscreen && (
        <FullPipelineModal
          data={data}
          pipelineSources={pipelineSources}
          pipelineWarnings={pipelineWarnings}
          submittedAttachments={submittedAttachments}
          interpretationSource={interpretationSource}
          showRawJson={showRawJson}
          onToggleRawJson={() => setShowRawJson((s) => !s)}
          onClose={() => setFullscreen(false)}
        />
      )}
    </div>
  );
}
