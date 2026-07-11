// Step 9/10 — Claude-powered selection chatbot. Server-side only.
//
// Answers a user's free-text question about a selected span of the
// rewritten interpretation, grounded only in that selection's linked claim
// result and retrieved evidence chunks. Thread bookkeeping (thread_id,
// message ids/timestamps, claim_id/chunk_id linkage) stays deterministic —
// src/lib/interactiveReviewMock.ts's appendMessageToThread merges this
// answer into the existing InteractiveReviewThread, unchanged.

import { z } from "zod";
import { callClaudeJson, type CallClaudeJsonResult, type ClaudeJsonToolSchema } from "./client";
import { CLAUDE_MAX_TOKENS } from "./config";
import type { FinalClaimResult, RetrievedChunk, TextSelectionContext } from "../schemas";

const ClaudeChatAnswerOutputSchema = z.object({
  content: z.string().min(1),
});

const CHAT_ANSWER_INPUT_SCHEMA: ClaudeJsonToolSchema = {
  type: "object",
  properties: {
    content: {
      type: "string",
      description: "The assistant's reply to the user's question, grounded only in the provided claim result and evidence chunks.",
    },
  },
  required: ["content"],
};

const LITERATURE_GROUNDING_PATTERN = /\bliterature\b|\bpublished\b|\bpubmed\b|\bexternal (stud(y|ies)|paper)/i;

export const LITERATURE_GROUNDING_STUB_MESSAGE =
  "Literature grounding review is planned for a later release — GeneGround currently only checks claims against the dataset-grounded evidence shown here, not external published literature.";

function summarizeChunk(chunk: { chunk_id: string; text_for_embedding: string }): string {
  return `[${chunk.chunk_id}] ${chunk.text_for_embedding}`;
}

function buildSystemPrompt(): string {
  return [
    "You are GeneGround's evidence-linked review chatbot. You answer a scientist's question about one selected span of an AI-generated single-cell RNA-seq / Perturb-seq interpretation.",
    "Answer using only the claim result and evidence chunks given below — never invent new evidence, statistics, or citations, and never reference any file or data not shown here.",
    "If the retrieved evidence is missing or insufficient to answer part of the question, say so plainly rather than guessing.",
    "You do not perform literature grounding review (that feature is deferred) — if asked, say it is planned for later rather than attempting it.",
    "Keep the answer concise (2-4 sentences) and in plain, biologist-friendly language.",
    "",
    "Call the return_chat_answer tool exactly once with your reply.",
  ].join("\n");
}

function buildUserPrompt(input: AnswerSelectionQuestionWithClaudeInput): string {
  const { selectionContext, claimResult, retrievedChunks, userQuestion } = input;
  const chunkLines = retrievedChunks.length > 0 ? retrievedChunks.map(summarizeChunk).join("\n") : "(no evidence chunks linked to this selection)";

  return [
    `Selected text: "${selectionContext.selected_text}"`,
    claimResult
      ? [
          `Linked claim: "${claimResult.original_claim_text}"`,
          `final_verdict: ${claimResult.final_verdict}`,
          `Reason: ${claimResult.biologist_friendly_explanation}`,
          `Rewritten_Claim: ${claimResult.safer_rewrite}`,
        ].join("\n")
      : "No linked claim was found for this selection.",
    "",
    "Evidence chunks:",
    chunkLines,
    "",
    `User question: ${userQuestion}`,
  ].join("\n");
}

export interface AnswerSelectionQuestionWithClaudeInput {
  selectionContext: TextSelectionContext;
  claimResult: FinalClaimResult | null;
  retrievedChunks: RetrievedChunk[];
  userQuestion: string;
}

/**
 * Returns just the assistant's reply text. Callers merge it into the
 * existing thread via interactiveReviewMock.ts's appendMessageToThread
 * (deterministic thread/message-id bookkeeping is unchanged).
 */
export async function answerSelectionQuestionWithClaude(input: AnswerSelectionQuestionWithClaudeInput): Promise<CallClaudeJsonResult<{ content: string }>> {
  if (LITERATURE_GROUNDING_PATTERN.test(input.userQuestion)) {
    return { ok: true, data: { content: LITERATURE_GROUNDING_STUB_MESSAGE }, source: "claude" };
  }

  return callClaudeJson({
    taskName: "selection_chat",
    system: buildSystemPrompt(),
    prompt: buildUserPrompt(input),
    toolName: "return_chat_answer",
    toolDescription: "Return the assistant's reply as structured JSON matching the required schema.",
    inputSchema: CHAT_ANSWER_INPUT_SCHEMA,
    schema: ClaudeChatAnswerOutputSchema,
    maxTokens: CLAUDE_MAX_TOKENS.selection_chat,
  });
}
