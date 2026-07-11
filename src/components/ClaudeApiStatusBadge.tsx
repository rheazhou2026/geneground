"use client";

import { useEffect, useState } from "react";

interface ClaudeStatusResponse {
  configured: boolean;
  model: string | null;
  mode: "claude" | "mock";
}

/**
 * Small, subtle indicator of whether the server has a working ANTHROPIC_API_KEY.
 * Purely informational — every /api/claude/* route already falls back to the
 * deterministic/mock pipeline on its own when the key is missing or a call
 * fails, so this badge never gates anything, it just tells the user which
 * mode they're currently getting.
 */
export function ClaudeApiStatusBadge() {
  const [status, setStatus] = useState<ClaudeStatusResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/claude/status")
      .then((res) => res.json())
      .then((data: ClaudeStatusResponse) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed || !status) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-zinc-100 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-zinc-500 ring-1 ring-inset ring-zinc-300 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
        {failed ? "Mock mode" : "Checking Claude API…"}
      </span>
    );
  }

  if (status.configured) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-emerald-800 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Claude API enabled{status.model ? ` · ${status.model}` : ""}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/30">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Mock mode · API key missing
    </span>
  );
}
