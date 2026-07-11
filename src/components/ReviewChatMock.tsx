import type { InteractiveReviewThread } from "@/lib/schemas";

export function ReviewChatMock({
  thread,
  draft,
  onDraftChange,
  onSubmit,
  loading = false,
}: {
  thread: InteractiveReviewThread;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  loading?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="max-h-64 space-y-2 overflow-y-auto p-3">
        {thread.messages.map((m) => (
          <div
            key={m.message_id}
            className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
              m.role === "assistant"
                ? "bg-zinc-50 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                : "ml-6 bg-blue-50 text-blue-900 dark:bg-blue-500/10 dark:text-blue-100"
            }`}
          >
            <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-600">{m.role}</p>
            {m.content}
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-1.5 rounded-lg bg-zinc-50 px-3 py-2 text-[11px] text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
            <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-300" />
            Thinking…
          </div>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="flex items-center gap-2 border-t border-zinc-100 p-2 dark:border-zinc-900"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Ask a follow-up question…"
          disabled={loading}
          className="flex-1 rounded-lg border border-zinc-200 bg-transparent px-2.5 py-1.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-100 dark:placeholder:text-zinc-600"
        />
        <button
          type="submit"
          disabled={draft.trim().length === 0 || loading}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-900"
        >
          Send
        </button>
      </form>
    </div>
  );
}
