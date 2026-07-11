"use client";

export interface InterpretationCandidate {
  path: string;
  text: string;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * Non-blocking inline prompt shown in the composer when an attached handoff
 * contains a recognized interpretation file. Never auto-loads — every path
 * here requires an explicit click, and loading over existing typed text
 * always uses "Replace" wording rather than reusing "Load" silently.
 */
export function InterpretationFoundCard({
  candidates,
  composerHasText,
  onLoad,
  onIgnore,
  onChooseAmongMultiple,
}: {
  candidates: InterpretationCandidate[];
  composerHasText: boolean;
  onLoad: (candidate: InterpretationCandidate) => void;
  onIgnore: () => void;
  onChooseAmongMultiple: () => void;
}) {
  if (candidates.length === 0) return null;

  const single = candidates.length === 1 ? candidates[0] : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs dark:border-blue-500/30 dark:bg-blue-500/10">
      <div className="min-w-0">
        <p className="font-semibold text-blue-900 dark:text-blue-100">
          {single ? "Interpretation found in handoff" : `${candidates.length} possible interpretation files found in handoff`}
        </p>
        <p className="mt-0.5 truncate text-blue-700 dark:text-blue-300">{single ? basename(single.path) : candidates.map((c) => basename(c.path)).join(", ")}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {single ? (
          <button
            type="button"
            onClick={() => onLoad(single)}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            {composerHasText ? "Replace composer text" : "Load into composer"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onChooseAmongMultiple}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            Choose one
          </button>
        )}
        <button
          type="button"
          onClick={onIgnore}
          className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:border-blue-400 dark:border-blue-500/30 dark:text-blue-300"
        >
          {composerHasText && single ? "Keep current text" : "Ignore"}
        </button>
      </div>
    </div>
  );
}
