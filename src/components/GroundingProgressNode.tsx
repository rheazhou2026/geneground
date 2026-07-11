"use client";

import type { PipelineNodeStatus } from "@/lib/pipelineStages";

const CIRCLE_BASE = "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold leading-none";

function Circle({ status }: { status: PipelineNodeStatus }) {
  switch (status) {
    case "pending":
      return <span className={`${CIRCLE_BASE} border-2 border-zinc-300 dark:border-zinc-700`} />;
    case "running":
      return (
        <span className={`${CIRCLE_BASE} border-2 border-zinc-300 border-t-blue-500 animate-spin dark:border-zinc-700 dark:border-t-blue-400`} />
      );
    case "complete":
      return <span className={`${CIRCLE_BASE} bg-emerald-500 text-white dark:bg-emerald-500`}>✓</span>;
    case "fallback":
      return <span className={`${CIRCLE_BASE} bg-amber-400 text-white dark:bg-amber-500`}>!</span>;
    case "error":
      return <span className={`${CIRCLE_BASE} bg-red-400 text-white dark:bg-red-500`}>×</span>;
  }
}

const LABEL_CLASSES: Record<PipelineNodeStatus, string> = {
  pending: "text-zinc-400 dark:text-zinc-600",
  running: "text-zinc-700 dark:text-zinc-200",
  complete: "text-zinc-700 dark:text-zinc-200",
  fallback: "text-amber-700 dark:text-amber-400",
  error: "text-red-700 dark:text-red-400",
};

export function GroundingProgressNode({ label, status }: { label: string; status: PipelineNodeStatus }) {
  return (
    <div className="flex items-center gap-2">
      <Circle status={status} />
      <span className={`text-xs font-medium ${LABEL_CLASSES[status]}`}>{label}</span>
    </div>
  );
}
