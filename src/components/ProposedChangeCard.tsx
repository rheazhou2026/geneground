import type { ReviewProposedChange } from "@/lib/schemas";

export function ProposedChangeCard({ change }: { change: ReviewProposedChange }) {
  if (change.change_type === "no_change") {
    return <div className="rounded-lg bg-zinc-50 p-2.5 text-xs text-zinc-500 dark:bg-zinc-900/50 dark:text-zinc-400">{change.reason}</div>;
  }

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-2.5 dark:border-blue-500/20 dark:bg-blue-500/10">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
        {change.change_type.replace(/_/g, " ")}
      </p>
      <p className="mt-1 text-xs text-zinc-500 line-through dark:text-zinc-500">{change.original_text}</p>
      <p className="mt-1 text-xs font-medium text-blue-900 dark:text-blue-100">{change.proposed_text}</p>
      <p className="mt-1 text-[10px] italic text-zinc-500 dark:text-zinc-400">{change.reason}</p>
    </div>
  );
}
