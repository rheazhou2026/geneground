// Step 1 — Claude-powered claim extraction. Server-side only.
//
// Claude identifies claim boundaries, raw (non-normalized) entities, and
// language flags, and picks Claim_type only from the fixed taxonomy. Claim
// IDs and sentence IDs are then assigned deterministically by this module,
// not by Claude — see docs/geneground-backend-logic.md Step 1 / Step 2 and
// docs/geneground-taxonomies.md's Claim Type table.

import { z } from "zod";
import { callClaudeJson, lenientArray, type CallClaudeJsonResult, type ClaudeJsonToolSchema } from "./client";
import { CLAUDE_MAX_TOKENS } from "./config";
import { splitIntoSentences } from "../sentenceSplit";
import { CAUSAL_WORDS, CLAIM_TYPES, STRENGTH_WORDS_HIGH_RISK, STRENGTH_WORDS_LOW_RISK, STRENGTH_WORDS_MEDIUM_RISK } from "../taxonomies";
import type { ClaimExtractionResult, ExtractedClaim } from "../schemas";

// ---------------------------------------------------------------------------
// Doc-shaped (Step 1) Claude output schema — PascalCase, matching
// docs/geneground-backend-logic.md's Step 1 JSON exactly. Adapted to the
// internal snake_case ExtractedClaim shape below, the same
// internal-vs-documented-JSON split used throughout this codebase.
// ---------------------------------------------------------------------------

const ClaudeRawEntitiesSchema = z.object({
  Genes: z.array(z.string()),
  Pathways: z.array(z.string()),
  Cell: z.array(z.string()),
  Conditions: z.array(z.string()),
  Direction: z.array(z.string()),
});

const ClaudeLanguageFlagsSchema = z.object({
  Strength_Words: z.array(z.string()),
  Causal_Words: z.array(z.string()),
});

const ClaudeExtractedClaimSchema = z.object({
  Original_text: z.string().min(1),
  Claim_type: z.enum(CLAIM_TYPES),
  Raw_Entities: ClaudeRawEntitiesSchema,
  Language_Flags: ClaudeLanguageFlagsSchema,
});

const ClaudeClaimExtractionOutputSchema = z.object({
  Claims: lenientArray(ClaudeExtractedClaimSchema),
});
type ClaudeClaimExtractionOutput = z.infer<typeof ClaudeClaimExtractionOutputSchema>;

const CLAIM_EXTRACTION_INPUT_SCHEMA: ClaudeJsonToolSchema = {
  type: "object",
  properties: {
    Claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          Original_text: {
            type: "string",
            description: "The exact original claim text, copied verbatim from the input. Do not paraphrase, summarize, or alter wording/punctuation.",
          },
          Claim_type: {
            type: "string",
            enum: [...CLAIM_TYPES],
            description: "Exactly one value from the fixed claim type taxonomy. Never invent a value not in this list.",
          },
          Raw_Entities: {
            type: "object",
            description: "Raw text mentions only — do not normalize gene symbols, pathway names, cell types, or conditions here.",
            properties: {
              Genes: { type: "array", items: { type: "string" } },
              Pathways: { type: "array", items: { type: "string" } },
              Cell: { type: "array", items: { type: "string" } },
              Conditions: { type: "array", items: { type: "string" } },
              Direction: { type: "array", items: { type: "string" } },
            },
            required: ["Genes", "Pathways", "Cell", "Conditions", "Direction"],
          },
          Language_Flags: {
            type: "object",
            properties: {
              Strength_Words: { type: "array", items: { type: "string" } },
              Causal_Words: { type: "array", items: { type: "string" } },
            },
            required: ["Strength_Words", "Causal_Words"],
          },
        },
        required: ["Original_text", "Claim_type", "Raw_Entities", "Language_Flags"],
      },
    },
  },
  required: ["Claims"],
};

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  const allStrengthWords = [...STRENGTH_WORDS_LOW_RISK, ...STRENGTH_WORDS_MEDIUM_RISK, ...STRENGTH_WORDS_HIGH_RISK];
  return [
    "You are GeneGround's claim extraction step for AI-generated single-cell RNA-seq / Perturb-seq interpretations.",
    "A claim is a biological claim expressed as a full sentence or part of a sentence. If one sentence contains both a biological-effect statement and a separate therapeutic/translational statement, split it into two claims at that boundary.",
    "Do not extract a standalone claim that begins with a bare pronoun ('this', 'these', 'that', 'it', 'they') and has no referent of its own — e.g. a trailing 'This directional pattern is reproducible...' clause after a claim that already named the gene/pattern. Either fold it into the claim it continues, or rewrite Original_text to name the referent (e.g. the gene) explicitly so the claim is checkable on its own — this is the one case where Original_text may deviate from verbatim source wording.",
    "Do not extract two claims for the same biological assertion restated in different sentences (e.g. a reproducibility/robustness statement already captured by an earlier claim) — extract it once, in the claim that first makes it.",
    "",
    "For each claim, extract:",
    "- Original_text: the exact original wording, copied verbatim, except for the bare-pronoun referent case above. Never paraphrase otherwise.",
    `- Claim_type: exactly one value from this fixed taxonomy, never invent a new one: ${CLAIM_TYPES.join(", ")}`,
    "- Raw_Entities: RAW text mentions only (Genes, Pathways, Cell context phrases, Conditions, Direction words) — do not normalize or canonicalize anything here, just copy the phrases as written in the claim.",
    `- Language_Flags.Strength_Words: any of these phrases that literally appear in the claim text: ${allStrengthWords.join(", ")}`,
    `- Language_Flags.Causal_Words: any of these phrases that literally appear in the claim text: ${CAUSAL_WORDS.join(", ")}`,
    "",
    "Call the return_extracted_claims tool exactly once with the full result. Do not include any claim not grounded in the input text.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Adapter: doc-shaped Claude output -> internal ExtractedClaim[] (deterministic
// claim_id/sentence_id assignment happens here, not inside Claude's output).
// ---------------------------------------------------------------------------

function assignSentenceIds(interpretationId: string, fullText: string, claims: { Original_text: string }[]): string[] {
  const sentences = splitIntoSentences(fullText);
  const sentenceEntries = sentences.map((text, i) => ({ id: `${interpretationId}-s${i + 1}`, text: text.toLowerCase() }));
  const fallbackId = sentenceEntries[sentenceEntries.length - 1]?.id ?? `${interpretationId}-s1`;

  return claims.map((claim) => {
    const norm = claim.Original_text.trim().toLowerCase();
    if (norm.length === 0) return fallbackId;
    const match = sentenceEntries.find((s) => s.text.includes(norm) || norm.includes(s.text));
    return match?.id ?? fallbackId;
  });
}

function adaptClaudeOutput(input: ExtractClaimsWithClaudeInput, output: ClaudeClaimExtractionOutput): ClaimExtractionResult {
  const sentenceIds = assignSentenceIds(input.interpretation_id, input.full_text, output.Claims);

  const claims: ExtractedClaim[] = output.Claims.map((claim, index) => ({
    claim_id: `${input.interpretation_id}-c${index + 1}`,
    interpretation_id: input.interpretation_id,
    sentence_id: sentenceIds[index],
    original_text: claim.Original_text,
    claim_type: claim.Claim_type,
    raw_entities: {
      genes: claim.Raw_Entities.Genes,
      pathways: claim.Raw_Entities.Pathways,
      cell_context: claim.Raw_Entities.Cell,
      conditions: claim.Raw_Entities.Conditions,
      direction: claim.Raw_Entities.Direction,
    },
    language_flags: {
      strength_words: claim.Language_Flags.Strength_Words,
      causal_words: claim.Language_Flags.Causal_Words,
    },
  }));

  return { interpretation_id: input.interpretation_id, source_text: input.full_text, claims };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface ExtractClaimsWithClaudeInput {
  interpretation_id: string;
  full_text: string;
}

export async function extractClaimsWithClaude(input: ExtractClaimsWithClaudeInput): Promise<CallClaudeJsonResult<ClaimExtractionResult>> {
  const result = await callClaudeJson({
    taskName: "claim_extraction",
    system: buildSystemPrompt(),
    prompt: `Interpretation text to extract claims from:\n\n"""\n${input.full_text}\n"""`,
    toolName: "return_extracted_claims",
    toolDescription: "Return the extracted biological claims as structured JSON matching the required schema.",
    inputSchema: CLAIM_EXTRACTION_INPUT_SCHEMA,
    schema: ClaudeClaimExtractionOutputSchema,
    maxTokens: CLAUDE_MAX_TOKENS.claim_extraction,
  });

  if (!result.ok) return result;
  return { ok: true, data: adaptClaudeOutput(input, result.data), source: "claude" };
}
