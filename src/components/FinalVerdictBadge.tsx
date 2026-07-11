import type { FinalVerdictLabel } from "@/lib/schemas";

const FINAL_VERDICT_META: Record<FinalVerdictLabel, { label: string; className: string }> = {
  supported: {
    label: "Supported",
    className:
      "bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30",
  },
  supported_with_caveats: {
    label: "Supported w/ Caveats",
    className: "bg-blue-50 text-blue-800 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-400/30",
  },
  partially_supported: {
    label: "Partially Supported",
    className: "bg-blue-50 text-blue-800 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-400/30",
  },
  overstated: {
    label: "Overstated",
    className:
      "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/30",
  },
  unsupported: {
    label: "Unsupported",
    className: "bg-red-50 text-red-800 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/30",
  },
  insufficient_evidence: {
    label: "Insufficient Evidence",
    className:
      "bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-500/10 dark:text-zinc-400 dark:ring-zinc-400/30",
  },
  needs_review: {
    label: "Needs Review",
    className:
      "bg-purple-50 text-purple-800 ring-purple-600/20 dark:bg-purple-500/10 dark:text-purple-300 dark:ring-purple-400/30",
  },
};

export function FinalVerdictBadge({
  verdict,
  size = "md",
}: {
  verdict: FinalVerdictLabel;
  size?: "sm" | "md";
}) {
  const meta = FINAL_VERDICT_META[verdict];
  const sizeClass = size === "sm" ? "text-[11px] px-2 py-0.5" : "text-xs px-2.5 py-1";

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full font-mono font-medium uppercase tracking-wide ring-1 ring-inset ${meta.className} ${sizeClass}`}
    >
      {meta.label}
    </span>
  );
}
