import { extractClaimsWithClaude } from "@/lib/claude/claimExtraction";
import { extractClaimsMock } from "@/lib/claimExtractionMock";
import type { InterpretationInput } from "@/lib/schemas";

interface ExtractClaimsRequestBody {
  interpretation_id: string;
  full_text: string;
}

function isValidBody(value: unknown): value is ExtractClaimsRequestBody {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ExtractClaimsRequestBody).interpretation_id === "string" &&
    typeof (value as ExtractClaimsRequestBody).full_text === "string" &&
    (value as ExtractClaimsRequestBody).full_text.trim().length > 0
  );
}

/**
 * Step 1 — claim extraction. Tries Claude first; on any failure (missing key,
 * request error, invalid output) falls back to the deterministic mock
 * extractor so the demo never breaks.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isValidBody(body)) {
    return Response.json({ error: "Expected { interpretation_id: string, full_text: string }." }, { status: 400 });
  }

  const claudeResult = await extractClaimsWithClaude({ interpretation_id: body.interpretation_id, full_text: body.full_text });
  if (claudeResult.ok) {
    return Response.json({ source: "claude", data: claudeResult.data });
  }

  const mockInput: InterpretationInput = {
    interpretation_id: body.interpretation_id,
    source_label: "Fallback deterministic extraction",
    full_text: body.full_text,
    created_at: new Date().toISOString(),
  };
  const fallback = extractClaimsMock(mockInput);
  return Response.json({ source: "mock", data: fallback, warning: claudeResult.reason });
}
