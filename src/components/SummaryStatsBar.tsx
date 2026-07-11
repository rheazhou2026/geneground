import type { FinalVerdictSummary } from "@/lib/schemas";

const STAT_META: { key: keyof Omit<FinalVerdictSummary, "total_claims">; label: string; dot: string }[] = [
  { key: "supported", label: "Supported", dot: "bg-emerald-500" },
  { key: "supported_with_caveats", label: "With caveats", dot: "bg-blue-500" },
  { key: "partially_supported", label: "Partially supported", dot: "bg-blue-400" },
  { key: "overstated", label: "Overstated", dot: "bg-amber-500" },
  { key: "unsupported", label: "Unsupported", dot: "bg-red-500" },
  { key: "insufficient_evidence", label: "Insufficient evidence", dot: "bg-zinc-400" },
  { key: "needs_review", label: "Needs review", dot: "bg-purple-500" },
];

export function SummaryStatsBar({ summary }: { summary: FinalVerdictSummary }) {
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-zinc-200 bg-white/95 px-5 py-4 shadow-sm backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/95">
      <div>
        <p className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{summary.total_claims}</p>
        <p className="text-[11px] uppercase tracking-wide text-zinc-400 dark:text-zinc-600">Total claims</p>
      </div>
      <div className="h-8 w-px bg-zinc-100 dark:bg-zinc-900" />
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {STAT_META.map(({ key, label, dot }) => {
          // Zero-count verdicts fade out rather than disappear — keeps the
          // full taxonomy visible for context while the verdicts the run
          // actually produced stand out at a glance. Never hides/reorders
          // based on live results; purely a display-weight choice.
          const count = summary[key];
          return (
            <div key={key} className={`flex items-center gap-1.5 ${count === 0 ? "opacity-40" : ""}`}>
              <span className={`h-2 w-2 rounded-full ${dot}`} />
              <span className="font-mono text-sm font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">{count}</span>
              <span className="text-[11px] text-zinc-400 dark:text-zinc-600">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
