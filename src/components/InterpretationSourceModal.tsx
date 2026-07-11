"use client";

import { useRef, useState } from "react";
import { extractInterpretationTextFromFile } from "@/lib/interpretationFileDetection";
import type { InterpretationCandidate } from "./InterpretationFoundCard";

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function preview(text: string, max = 320): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export type InterpretationSourceModalMode = "single" | "multiple" | "none";

/**
 * Shown when the user clicks "Ground with GeneGround" with an empty
 * composer. Three variants (single/multiple/none recognized interpretation
 * files in the attached handoff) plus a shared "attach a specific file"
 * sub-flow that always ends in an explicit load confirmation — nothing here
 * ever populates the composer without a final button click.
 */
export function InterpretationSourceModal({
  mode,
  candidates,
  onLoad,
  onPasteManually,
  onCancel,
}: {
  mode: InterpretationSourceModalMode;
  candidates: InterpretationCandidate[];
  onLoad: (candidate: InterpretationCandidate) => void;
  onPasteManually: () => void;
  onCancel: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pickedFile, setPickedFile] = useState<{ name: string; text: string | null; rawText: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFilePicked(file: File) {
    const rawText = await file.text();
    const extracted = extractInterpretationTextFromFile(file.name, rawText);
    setPickedFile({ name: file.name, text: extracted, rawText });
  }

  const title =
    mode === "single"
      ? "No pasted interpretation found."
      : mode === "multiple"
        ? "Which file contains the omics interpretation?"
        : "No omics interpretation found.";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.md,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleFilePicked(file);
          }}
        />

        {pickedFile ? (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Load {pickedFile.name} into the composer?</h3>
            {!pickedFile.text && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Could not automatically find interpretation text in this file — showing raw file content. You can edit it after loading.
              </p>
            )}
            <p className="max-h-40 overflow-y-auto rounded-lg bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
              {preview(pickedFile.text ?? pickedFile.rawText)}
            </p>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPickedFile(null)}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onLoad({ path: pickedFile.name, text: pickedFile.text ?? pickedFile.rawText })}
                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
              >
                Load
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>

            {mode === "single" && (
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                We found an interpretation in your handoff (<span className="font-medium text-zinc-700 dark:text-zinc-200">{basename(candidates[0].path)}</span>). Load it?
              </p>
            )}

            {mode === "multiple" && (
              <div className="space-y-1.5">
                {candidates.map((c, i) => (
                  <label
                    key={c.path}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-700 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-200"
                  >
                    <input type="radio" name="interpretation-candidate" checked={selectedIndex === i} onChange={() => setSelectedIndex(i)} />
                    {basename(c.path)}
                  </label>
                ))}
              </div>
            )}

            {mode === "none" && (
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                GeneGround needs an interpretation to ground. Paste one into the composer, attach a file containing the interpretation, or cancel
                this run.
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onPasteManually}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300"
              >
                Paste manually
              </button>
              {mode === "single" && (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300"
                >
                  Choose another file
                </button>
              )}
              {mode === "none" && (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300"
                >
                  Attach interpretation file
                </button>
              )}
              {mode === "single" && (
                <button
                  type="button"
                  onClick={() => onLoad(candidates[0])}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
                >
                  Load interpretation
                </button>
              )}
              {mode === "multiple" && (
                <button
                  type="button"
                  onClick={() => onLoad(candidates[selectedIndex])}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
                >
                  Load selected
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
