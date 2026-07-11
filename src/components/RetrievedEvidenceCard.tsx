import type { RetrievedChunk } from "@/lib/schemas";

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "none";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function scoreTone(score: number): string {
  if (score >= 80) {
    return "bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30";
  }
  if (score >= 40) {
    return "bg-blue-50 text-blue-800 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-400/30";
  }
  if (score >= 0) {
    return "bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-500/10 dark:text-zinc-400 dark:ring-zinc-400/30";
  }
  return "bg-red-50 text-red-800 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/30";
}

export function RetrievedEvidenceCard({ chunk }: { chunk: RetrievedChunk }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-medium text-zinc-900 dark:text-zinc-100">{chunk.chunk_id}</span>
        <span
          className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ring-1 ring-inset ${scoreTone(chunk.retrieval_score)}`}
        >
          score {chunk.retrieval_score}
        </span>
      </div>

      <ul className="mt-2 space-y-0.5">
        {chunk.retrieval_reasons.map((reason) => (
          <li key={reason} className="text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            · {reason}
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap gap-1">
        {Object.entries(chunk.metadata).map(([key, value]) => (
          <span
            key={key}
            title={key}
            className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
          >
            {key}: {formatValue(value)}
          </span>
        ))}
      </div>

      <dl className="mt-2 space-y-0.5 border-t border-zinc-100 pt-1.5 dark:border-zinc-900">
        {Object.entries(chunk.structured_payload).map(([key, value]) => (
          <div key={key} className="flex items-baseline justify-between gap-2 text-[10px]">
            <dt className="shrink-0 text-zinc-400 dark:text-zinc-600">{key.replace(/_/g, " ")}</dt>
            <dd className="text-right font-mono text-zinc-700 dark:text-zinc-300">{formatValue(value)}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-2 border-t border-zinc-100 pt-1.5 text-[10px] italic leading-relaxed text-zinc-400 dark:border-zinc-900 dark:text-zinc-600">
        &ldquo;{chunk.text_for_embedding}&rdquo;
      </p>

      <p className="mt-1.5 text-[10px] text-zinc-400 dark:text-zinc-600">source: {chunk.source_file_name}</p>

      {chunk.warnings && chunk.warnings.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 border-t border-amber-100 pt-1.5 dark:border-amber-500/20">
          {chunk.warnings.map((warning) => (
            <li key={warning} className="text-[10px] text-amber-700 dark:text-amber-400">
              ! {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
