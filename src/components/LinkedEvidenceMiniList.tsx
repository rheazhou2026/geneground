import type { FinalClaimResult } from "@/lib/schemas";
import { FinalVerdictBadge } from "./FinalVerdictBadge";

export function LinkedEvidenceMiniList({ results }: { results: FinalClaimResult[] }) {
  if (results.length === 0) {
    return <p className="text-xs italic text-zinc-400 dark:text-zinc-600">No linked claim/verdict found for this selection.</p>;
  }

  return (
    <div className="space-y-2">
      {results.map((r) => (
        <div key={r.claim_id} className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600">{r.claim_id}</span>
            <FinalVerdictBadge verdict={r.final_verdict} size="sm" />
          </div>
          {r.evidence_basis.evidence_chunk_ids.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {r.evidence_basis.evidence_chunk_ids.map((id) => (
                <span
                  key={id}
                  className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                >
                  {id}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
