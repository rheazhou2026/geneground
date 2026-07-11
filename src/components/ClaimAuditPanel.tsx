"use client";

import type { FinalClaimResult } from "@/lib/schemas";
import { ClaimAuditCard } from "./ClaimAuditCard";

export function ClaimAuditPanel({
  claimResults,
  activeClaimId,
  onSelectClaim,
}: {
  claimResults: FinalClaimResult[];
  activeClaimId: string | null;
  onSelectClaim: (claimId: string | null) => void;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Claim-level audit</h3>
      <div className="space-y-3">
        {claimResults.map((claimResult, index) => {
          const expanded = activeClaimId === claimResult.claim_id;
          return (
            <ClaimAuditCard
              key={claimResult.claim_id}
              index={index}
              claimResult={claimResult}
              expanded={expanded}
              onToggle={() => onSelectClaim(expanded ? null : claimResult.claim_id)}
            />
          );
        })}
      </div>
    </div>
  );
}
