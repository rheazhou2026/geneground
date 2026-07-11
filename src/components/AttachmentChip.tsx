"use client";

export type AttachmentStatus = "pending" | "parsing" | "ready" | "warning" | "error";

export interface AttachedFile {
  id: string;
  file: File;
  extension: string;
  /** e.g. "Claude Science handoff" for a zip, "Interpretation file" for a recognized name, "Evidence file" otherwise. */
  sourceLabel: string;
  status: AttachmentStatus;
  errorMessage?: string;
  /** null until checked, or if this attachment isn't the kind of file we'd expect to contain an interpretation. */
  interpretationText: string | null;
  /** Whether this attachment is a zip or a recognized interpretation file name — i.e. worth showing a found/not-found badge for at all. */
  interpretationRelevant: boolean;
}

const STATUS_META: Record<AttachmentStatus, { label: string; dotClass: string; textClass: string }> = {
  pending: { label: "Preparing…", dotClass: "bg-zinc-300 dark:bg-zinc-600", textClass: "text-zinc-500 dark:text-zinc-400" },
  parsing: { label: "Reading handoff…", dotClass: "bg-blue-400 animate-pulse", textClass: "text-blue-700 dark:text-blue-400" },
  ready: { label: "Attached", dotClass: "bg-emerald-500", textClass: "text-emerald-700 dark:text-emerald-400" },
  warning: { label: "Needs interpretation", dotClass: "bg-amber-500", textClass: "text-amber-700 dark:text-amber-400" },
  error: { label: "Could not read file", dotClass: "bg-red-500", textClass: "text-red-700 dark:text-red-400" },
};

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function AttachmentChip({ attachment, onRemove }: { attachment: AttachedFile; onRemove: () => void }) {
  const meta = STATUS_META[attachment.status];
  const showFoundBadge = attachment.interpretationRelevant && attachment.status === "ready" && attachment.interpretationText !== null;

  return (
    <div className="flex max-w-full items-start gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900">
      <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${meta.dotClass}`} aria-hidden="true" />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="max-w-[12rem] truncate font-medium text-zinc-800 dark:text-zinc-100">{attachment.file.name}</span>
          <span className="shrink-0 text-zinc-400 dark:text-zinc-500">{formatBytes(attachment.file.size)}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {attachment.sourceLabel}
          </span>
          <span className={`text-[11px] font-medium ${meta.textClass}`}>
            {attachment.status === "error" && attachment.errorMessage ? attachment.errorMessage : meta.label}
          </span>
          {showFoundBadge && (
            <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30">
              Interpretation found
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${attachment.file.name}`}
        className="ml-auto shrink-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
      >
        ✕
      </button>
    </div>
  );
}
