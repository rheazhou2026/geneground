"use client";

import { useState } from "react";
import type { ReviewActionPlan } from "@/lib/schemas";
import { ProposedChangeCard } from "./ProposedChangeCard";

const STATUS_STYLES: Record<string, string> = {
  awaiting_user_approval:
    "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-400/30",
  approved:
    "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30",
  applied:
    "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30",
  cancelled: "bg-zinc-100 text-zinc-500 ring-zinc-500/20 dark:bg-zinc-500/10 dark:text-zinc-400 dark:ring-zinc-400/30",
  edited: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/30",
};

export function ReviewActionPlanCard({
  plan,
  onApprove,
  onCancel,
  onEdit,
}: {
  plan: ReviewActionPlan;
  onApprove: () => void;
  onCancel: () => void;
  onEdit: (newText: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(plan.proposed_changes[0]?.proposed_text ?? "");

  const isFinal = plan.status === "cancelled" || plan.status === "applied";
  const showApprove = plan.user_decision_options.includes("approve");
  const showCancel = plan.user_decision_options.includes("cancel");
  const showEdit = plan.user_decision_options.includes("edit");
  const showAcknowledge = plan.user_decision_options.includes("acknowledge");

  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Action plan · {plan.requested_action.replace(/_/g, " ")}
        </span>
        <span
          className={`whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ring-1 ring-inset ${STATUS_STYLES[plan.status]}`}
        >
          {plan.status.replace(/_/g, " ")}
        </span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{plan.explanation}</p>

      {plan.warnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {plan.warnings.map((w) => (
            <li key={w} className="text-[11px] text-amber-700 dark:text-amber-400">
              ! {w}
            </li>
          ))}
        </ul>
      )}

      {plan.proposed_changes.length > 0 && (
        <div className="mt-2 space-y-2">
          {plan.proposed_changes.map((change) => (
            <ProposedChangeCard key={change.change_id} change={change} />
          ))}
        </div>
      )}

      {plan.agents_to_rerun.length > 0 && (
        <p className="mt-2 text-[10px] text-zinc-400 dark:text-zinc-600">Agents to re-run: {plan.agents_to_rerun.join(", ")}</p>
      )}

      {!isFinal && (showApprove || showCancel || showEdit || showAcknowledge) && (
        <div className="mt-3 space-y-2">
          {editing && (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-zinc-200 bg-transparent px-2.5 py-1.5 text-xs text-zinc-900 focus:outline-none dark:border-zinc-700 dark:text-zinc-100"
            />
          )}
          <div className="flex flex-wrap gap-2">
            {showApprove && (
              <button
                type="button"
                onClick={onApprove}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
              >
                Approve
              </button>
            )}
            {(showCancel || showAcknowledge) && (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300"
              >
                {showAcknowledge && !showCancel ? "Acknowledge" : "Cancel"}
              </button>
            )}
            {showEdit &&
              (editing ? (
                <button
                  type="button"
                  onClick={() => {
                    onEdit(draft);
                    setEditing(false);
                  }}
                  className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:border-blue-400 dark:border-blue-500/30 dark:text-blue-300"
                >
                  Save edit
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300"
                >
                  Edit
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
