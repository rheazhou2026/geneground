import { z } from "zod";
import { answerSelectionQuestionWithClaude } from "@/lib/claude/interactiveReview";
import { buildMockFollowupResponse } from "@/lib/interactiveReviewMock";
import { FinalClaimResultSchema, RetrievedChunkSchema, TextSelectionContextSchema } from "@/lib/schemas";

const RequestBodySchema = z.object({
  selectionContext: TextSelectionContextSchema,
  claimResult: FinalClaimResultSchema.nullable(),
  retrievedChunks: z.array(RetrievedChunkSchema),
  userQuestion: z.string().min(1),
});

/**
 * Step 9/10 — selection chatbot answer. Falls back to the deterministic mock
 * followup response (src/lib/interactiveReviewMock.ts) on any failure.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = RequestBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Request body did not match the expected schema.", issues: parsed.error.issues.slice(0, 10) }, { status: 400 });
  }

  const claudeResult = await answerSelectionQuestionWithClaude(parsed.data);
  if (claudeResult.ok) {
    return Response.json({ source: "claude", content: claudeResult.data.content });
  }

  const fallbackContent = buildMockFollowupResponse(parsed.data.userQuestion, parsed.data.claimResult ? [parsed.data.claimResult] : []);
  return Response.json({ source: "mock", content: fallbackContent, warning: claudeResult.reason });
}
