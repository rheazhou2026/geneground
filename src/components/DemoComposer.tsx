"use client";

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { ACCEPTED_HANDOFF_EXTENSIONS, listFilesFromZip, readMatchingZipEntriesAsText } from "@/lib/handoffImport";
import { extractInterpretationTextFromFile, isRecognizedInterpretationFileName } from "@/lib/interpretationFileDetection";
import { AttachmentChip, type AttachedFile } from "./AttachmentChip";
import { InterpretationFoundCard, type InterpretationCandidate } from "./InterpretationFoundCard";
import { InterpretationSourceModal, type InterpretationSourceModalMode } from "./InterpretationSourceModal";

// Handoff evidence attach accepts the same extensions the artifact-evidence
// pipeline recognizes, plus .txt — .txt isn't evidence (handoffImport.ts's
// ACCEPTED_HANDOFF_EXTENSIONS still excludes it from that pipeline
// unchanged), but it's a valid *interpretation* file extension, so it
// shouldn't be hidden by the OS file picker's filter.
const ACCEPT_ATTR = [...ACCEPTED_HANDOFF_EXTENSIONS, ".txt", ".zip"].join(",");

function getExtension(fileName: string): string {
  const match = /\.[a-z0-9]+$/i.exec(fileName);
  return match ? match[0].toLowerCase() : "";
}

function makeAttachmentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sourceLabelFor(extension: string, isRecognizedName: boolean): string {
  if (extension === ".zip") return "Claude Science handoff";
  if (isRecognizedName) return "Interpretation file";
  return "Evidence file";
}

/**
 * Determines per-attachment read/parse status and, for zips or recognized
 * interpretation file names, whether an interpretation was found inside.
 * Purely a composer convenience for immediate visual feedback — independent
 * of the evidence-artifact pipeline, which runs its own (unchanged) import
 * at submit time in src/app/demo/page.tsx.
 */
async function evaluateAttachment(entry: AttachedFile, patch: (id: string, changes: Partial<AttachedFile>) => void): Promise<void> {
  patch(entry.id, { status: "parsing" });

  if (!entry.interpretationRelevant) {
    // Not a zip or recognized interpretation name — nothing to check beyond
    // basic readability, so a corrupt file still surfaces as an error.
    try {
      await entry.file.slice(0, 1).arrayBuffer();
      patch(entry.id, { status: "ready" });
    } catch {
      patch(entry.id, { status: "error", errorMessage: "Could not read file" });
    }
    return;
  }

  if (entry.extension === ".zip") {
    try {
      await listFilesFromZip(entry.file);
    } catch (err) {
      patch(entry.id, { status: "error", errorMessage: err instanceof Error ? err.message : "Could not read file" });
      return;
    }
    const matches = await readMatchingZipEntriesAsText(entry.file, isRecognizedInterpretationFileName);
    let text: string | null = null;
    for (const match of matches) {
      const extracted = extractInterpretationTextFromFile(match.file_path, match.text);
      if (extracted) {
        text = extracted;
        break;
      }
    }
    patch(entry.id, { status: text ? "ready" : "warning", interpretationText: text });
    return;
  }

  // Recognized non-zip interpretation file name (.json/.txt/.md).
  try {
    const rawText = await entry.file.text();
    const text = extractInterpretationTextFromFile(entry.file.name, rawText);
    patch(entry.id, { status: text ? "ready" : "warning", interpretationText: text });
  } catch {
    patch(entry.id, { status: "error", errorMessage: "Could not read file" });
  }
}

export type InterpretationSource = "pasted" | "loaded_from_handoff";

export function DemoComposer({
  defaultValue,
  onSubmit,
  submitting,
}: {
  defaultValue: string;
  onSubmit: (text: string, files: File[], meta: { interpretationSource: InterpretationSource }) => void;
  submitting: boolean;
}) {
  const [text, setText] = useState(defaultValue);
  const [interpretationSource, setInterpretationSource] = useState<InterpretationSource>("pasted");
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [dismissedForAttachmentsKey, setDismissedForAttachmentsKey] = useState<string | null>(null);
  const [submitModalMode, setSubmitModalMode] = useState<InterpretationSourceModalMode | null>(null);

  const attachmentsKey = attachments.map((a) => a.id).join("|");
  const cardDismissed = dismissedForAttachmentsKey === attachmentsKey;

  // Derived directly from live attachment state, so removing an attachment
  // automatically drops its candidate (and the found-interpretation prompt
  // along with it) unless another attachment still has one.
  const candidates: InterpretationCandidate[] = attachments
    .filter((a) => a.interpretationText !== null)
    .map((a) => ({ path: a.file.name, text: a.interpretationText as string }));

  function patchAttachment(id: string, changes: Partial<AttachedFile>) {
    setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, ...changes } : a)));
  }

  function addFiles(newFiles: FileList | File[]) {
    const entries: AttachedFile[] = Array.from(newFiles).map((file) => {
      const extension = getExtension(file.name);
      const isRecognizedName = isRecognizedInterpretationFileName(file.name);
      console.log(`Attached file: ${file.name}, size: ${file.size}, type: ${file.type || extension || "unknown"}`);
      return {
        id: makeAttachmentId(),
        file,
        extension,
        sourceLabel: sourceLabelFor(extension, isRecognizedName),
        status: "pending",
        interpretationText: null,
        interpretationRelevant: extension === ".zip" || isRecognizedName,
      };
    });

    // Chips render immediately (status "pending") — evaluation happens
    // asynchronously afterward and patches each entry in place by id.
    setAttachments((prev) => [...prev, ...entries]);
    for (const entry of entries) {
      void evaluateAttachment(entry, patchAttachment);
    }
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files && event.target.files.length > 0) addFiles(event.target.files);
    event.target.value = "";
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) addFiles(event.dataTransfer.files);
  }

  const textNonEmpty = text.trim().length > 0;
  const hasCandidate = candidates.length > 0;
  const anyPending = attachments.some((a) => a.status === "pending" || a.status === "parsing");
  const hasAnyAttachment = attachments.length > 0;

  let buttonLabel = "Ground with GeneGround →";
  let buttonDisabled = false;
  let showSpinner = false;

  if (submitting) {
    buttonLabel = "Grounding…";
    buttonDisabled = true;
    showSpinner = true;
  } else if (!textNonEmpty && !hasCandidate && anyPending) {
    // Don't guess yet — an attachment might still turn out to contain an
    // interpretation. Show a loading state rather than silently no-op'ing.
    buttonLabel = "Checking attachments…";
    buttonDisabled = true;
    showSpinner = true;
  } else if (!textNonEmpty && !hasCandidate && !hasAnyAttachment) {
    buttonDisabled = true;
  }

  function handleSubmit() {
    if (buttonDisabled) return;
    if (textNonEmpty) {
      onSubmit(
        text,
        attachments.map((a) => a.file),
        { interpretationSource },
      );
      return;
    }
    // Composer is empty — offer to load from the attached handoff instead
    // of just silently failing.
    if (candidates.length === 1) setSubmitModalMode("single");
    else if (candidates.length > 1) setSubmitModalMode("multiple");
    else setSubmitModalMode("none");
  }

  function handleCardLoad(candidate: InterpretationCandidate) {
    setText(candidate.text);
    setInterpretationSource("loaded_from_handoff");
    setDismissedForAttachmentsKey(attachmentsKey);
  }

  function handleModalLoad(candidate: InterpretationCandidate) {
    setText(candidate.text);
    setInterpretationSource("loaded_from_handoff");
    setSubmitModalMode(null);
    setDismissedForAttachmentsKey(attachmentsKey);
  }

  function handleModalPasteManually() {
    setSubmitModalMode(null);
    textareaRef.current?.focus();
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`rounded-2xl border bg-white shadow-sm transition-colors dark:bg-zinc-950 ${
          dragOver ? "border-emerald-400 ring-2 ring-emerald-200 dark:border-emerald-500 dark:ring-emerald-500/20" : "border-zinc-200 dark:border-zinc-800"
        }`}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setInterpretationSource("pasted");
          }}
          placeholder="Paste a Claude Science AI-generated omics interpretation…"
          rows={8}
          className="w-full resize-y bg-transparent px-5 py-4 text-sm leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-600"
        />

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-900">
            {attachments.map((attachment) => (
              <AttachmentChip key={attachment.id} attachment={attachment} onRemove={() => removeAttachment(attachment.id)} />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-4 py-3 dark:border-zinc-900">
          <div className="flex items-center gap-2">
            <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden" onChange={handleFileInputChange} />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              title="Attach Claude Science handoff files or a .zip"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 text-base font-medium text-zinc-500 hover:border-zinc-400 hover:text-zinc-800 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              +
            </button>
            <span className="text-[11px] text-zinc-400 dark:text-zinc-600">
              {hasAnyAttachment
                ? `${attachments.length} file${attachments.length > 1 ? "s" : ""} attached — evidence for grounding`
                : "Attach a Claude Science handoff .zip or files — optional, a demo handoff is used otherwise"}
            </span>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={buttonDisabled}
            className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {showSpinner && (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white dark:border-zinc-900/40 dark:border-t-zinc-900" />
            )}
            {buttonLabel}
          </button>
        </div>
      </div>

      {!cardDismissed && (
        <InterpretationFoundCard
          candidates={candidates}
          composerHasText={textNonEmpty}
          onLoad={handleCardLoad}
          onIgnore={() => setDismissedForAttachmentsKey(attachmentsKey)}
          onChooseAmongMultiple={() => setSubmitModalMode("multiple")}
        />
      )}

      {submitModalMode && (
        <InterpretationSourceModal
          mode={submitModalMode}
          candidates={candidates}
          onLoad={handleModalLoad}
          onPasteManually={handleModalPasteManually}
          onCancel={() => setSubmitModalMode(null)}
        />
      )}
    </div>
  );
}
