// Step 8, hybrid — Claude writes only Reason + Rewritten_Claim. Server-side
// only. final_verdict is always computed first, deterministically, by
// src/lib/finalVerdictAggregator.ts (never touched here or overridden by
// Claude — the output schema below has no final_verdict field to write).
// See docs/geneground-backend-logic.md Step 8 and the Rewrite Rule Taxonomy
// in docs/geneground-taxonomies.md.

import { z } from "zod";
import { callClaudeJson, type CallClaudeJsonResult, type ClaudeJsonToolSchema } from "./client";
import { CLAUDE_MAX_TOKENS } from "./config";
import { REWRITE_RULES } from "../taxonomies";
import { findRawConditionMentions, findRawGeneMentions, findRawPathwayMentions, normalizeGenes } from "../entityNormalization";
import type { ClaimAgentResults, ClaimRetrievedEvidence, FinalClaimResult } from "../schemas";

// Matches typical HGNC-style gene symbols: an ALL-CAPS alphanumeric token,
// 2-10 characters (STAT1, NFKB2, RELB, FOXP3, GATA3, BATF, ...). Deliberately
// case-sensitive so ordinary sentence-case English words never match.
const GENE_SYMBOL_LIKE_PATTERN = /\b[A-Z][A-Z0-9]{1,9}\b/g;

// All-caps tokens that show up constantly in GeneGround's own domain writing
// but are not gene symbols — excluded so the hallucination guard doesn't fire
// on ordinary vocabulary a rewrite is free to reuse (e.g. every claim in this
// demo mentions "CD4+ T cells", and method language like "CRISPRi"/"DE").
const NON_GENE_ALL_CAPS_TOKENS = new Set([
  "RNA",
  "DNA",
  "PCR",
  "UMAP",
  "PCA",
  "TCR",
  "MHC",
  "ATAC",
  "CD4",
  "CD8",
  "CD3",
  "CD19",
  "CD25",
  "CRISPR",
  "CRISPRI",
  "CRISPRA",
  "DE",
  "FDR",
  "LFC",
  "GEX",
  "QC",
  "IL",
  "ID",
  "IDS",
]);

// Gene symbols a piece of text is "grounded" in. Combines two detectors:
//  1. The mini HGNC panel (findRawGeneMentions/normalizeGenes) — resolves
//     aliases like "T-bet" to their approved symbol (TBX21) so a rewrite
//     rephrasing a *known* gene via its alias isn't mistaken for a new one.
//  2. A generic ALL-CAPS gene-symbol-shaped token scan — the mini panel is a
//     small curated ~40-gene subset (see entityNormalization.ts), so relying
//     on it alone would miss a genuinely novel symbol the panel just doesn't
//     happen to include (e.g. RELB, or even NFKB2 itself, are both absent
//     from the panel despite being exactly the kind of gene name a rewrite
//     must not invent).
function extractGroundedGeneSymbols(text: string): Set<string> {
  const symbols = new Set<string>();

  const normalized = normalizeGenes(findRawGeneMentions(text));
  for (const gene of normalized) {
    symbols.add(gene.normalized_symbol ?? gene.raw.toUpperCase());
  }

  for (const token of text.match(GENE_SYMBOL_LIKE_PATTERN) ?? []) {
    if (!NON_GENE_ALL_CAPS_TOKENS.has(token)) symbols.add(token);
  }

  return symbols;
}

function diffLowercased(introduced: string[], allowed: string[]): string[] {
  const allowedLower = new Set(allowed.map((a) => a.toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of introduced) {
    const key = item.toLowerCase();
    if (allowedLower.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export interface RewriteEntityExpansionCheck {
  hasNewEntities: boolean;
  newGenes: string[];
  newPathways: string[];
  newConditions: string[];
}

/**
 * Rewrite-constraint safety net (independent of the prompt-level instruction
 * in buildSystemPrompt below, which is a soft constraint only): a rewrite
 * must never name a gene, pathway/signature, or dataset condition the
 * original claim didn't already name — this is what previously let Claude's
 * rewrite add e.g. FOXP3/RELB to a claim that only discussed NFKB2. Any new
 * entity anywhere in the rewrite means we don't trust the rewrite at all;
 * the caller (the final-rewrite API route) falls back to the deterministic
 * safer_rewrite in that case and logs which entities were caught.
 */
export function checkRewriteEntityExpansion(originalClaimText: string, rewrittenClaim: string): RewriteEntityExpansionCheck {
  const newGenes = diffLowercased(
    Array.from(extractGroundedGeneSymbols(rewrittenClaim)),
    Array.from(extractGroundedGeneSymbols(originalClaimText)),
  );
  const newPathways = diffLowercased(findRawPathwayMentions(rewrittenClaim), findRawPathwayMentions(originalClaimText));
  const newConditions = diffLowercased(findRawConditionMentions(rewrittenClaim), findRawConditionMentions(originalClaimText));

  return {
    hasNewEntities: newGenes.length > 0 || newPathways.length > 0 || newConditions.length > 0,
    newGenes,
    newPathways,
    newConditions,
  };
}

const ClaudeFinalRewriteOutputSchema = z.object({
  Reason: z.string().min(1),
  Rewritten_Claim: z.string().min(1),
});
type ClaudeFinalRewriteOutput = z.infer<typeof ClaudeFinalRewriteOutputSchema>;

const FINAL_REWRITE_INPUT_SCHEMA: ClaudeJsonToolSchema = {
  type: "object",
  properties: {
    Reason: {
      type: "string",
      description:
        "A SHORT, biologist-friendly explanation of why this claim received its final_verdict, grounded only in the provided agent rationales and evidence. Exactly 1-2 sentences, at most about 45 words. Plain language, no agent-by-agent report — state the main evidence boundary only (e.g. what's supported, and the main reason the wording stays cautious).",
    },
    Rewritten_Claim: {
      type: "string",
      description: "A safer, dataset-grounded rewrite of the original claim text. Must not change what the deterministic final_verdict already decided.",
    },
  },
  required: ["Reason", "Rewritten_Claim"],
};

function buildSystemPrompt(): string {
  const rewriteRuleLines = Object.entries(REWRITE_RULES)
    .map(([risky, safer]) => `- "${risky}" -> "${safer}"`)
    .join("\n");

  return [
    "You write the Reason and Rewritten_Claim for one already-verified biological claim in GeneGround, a claim-level verification tool for AI-generated single-cell RNA-seq / Perturb-seq interpretations.",
    "The final_verdict has ALREADY been decided deterministically and is given to you as fixed context — you must not contradict it, soften it, or imply a different verdict. You are only writing the human-readable explanation and a safer rewrite of the claim text.",
    "",
    "Rules:",
    "- Reason must be SHORT: exactly 1-2 sentences, at most about 45 words, plain language. It is shown directly on a claim card, not an internal agent report — do not summarize all four agents one by one. State only the main evidence boundary (what's supported, and the main reason for any caution).",
    "- Reason must be grounded only in the given original claim text, its named genes/pathways/conditions, and the given agent rationales — do not add unsupported claims or invent evidence.",
    "- Reason may reference the single most important condition-specific caveat (e.g. ambiguous timepoint, single-guide, small donor count) if it drives the verdict, but do not list every caveat.",
    "- Do not invent specific counts (e.g. 'only two genes were perturbed') unless that exact count is given to you below — you are only shown this one claim's context, not the full interpretation or dataset, so you cannot know totals across the whole analysis.",
    "- Do not state that a gene, pathway, or condition was or was not tested/assayed unless that is explicitly part of the agent evaluations given to you. Never claim something 'was not tested' based on what happens to be absent from this one claim's own wording.",
    "- Rewritten_Claim must soften high-risk wording when language_causality's rationale indicates the wording overreaches the evidence. Use these rewrite patterns as guidance (not verbatim substitution rules — write a natural sentence):",
    rewriteRuleLines,
    "- Rewritten_Claim must not claim mechanism, therapeutic relevance, direct causality, or confirmed cell identity unless the evidence agents actually support that.",
    "- Rewritten_Claim must not introduce any gene, protein, pathway, signature, or dataset condition (e.g. a different stimulation timepoint) that is not already present in the original claim text. Do not add other genes from the same pathway, related pathways/signatures, other conditions, or additional entities the retrieved evidence happens to mention — only soften the wording of what the original claim already names. Do not broaden a single claim's scope into a wider summary.",
    "- If final_verdict is unsupported, Rewritten_Claim should say no evidence-grounded rewrite is possible rather than inventing a softened claim.",
    "",
    "Call the return_final_rewrite tool exactly once with your result.",
  ].join("\n");
}

function buildUserPrompt(input: GenerateFinalReasonAndRewriteInput): string {
  const { finalClaimResult, claimAgentResults } = input;
  const agentLines = (Object.entries(claimAgentResults.agent_results) as [string, ClaimAgentResults["agent_results"][keyof ClaimAgentResults["agent_results"]]][]).map(
    ([agent, result]) => `- ${agent}: ${result.agent_verdict} — ${result.agent_reasoning_summary}`,
  );

  const mentionedGenes = findRawGeneMentions(finalClaimResult.original_claim_text);
  const mentionedPathways = findRawPathwayMentions(finalClaimResult.original_claim_text);
  const mentionedConditions = findRawConditionMentions(finalClaimResult.original_claim_text);
  const mentionedEntities = [...mentionedGenes, ...mentionedPathways, ...mentionedConditions];
  const allowedEntitiesLine =
    mentionedEntities.length > 0
      ? `Genes/pathways/conditions already named in the original claim (Rewritten_Claim may only refer to these, not introduce others): ${mentionedEntities.join(", ")}`
      : "The original claim does not name any specific gene, pathway, or condition — do not introduce one in Rewritten_Claim.";

  return [
    `Original claim: "${finalClaimResult.original_claim_text}"`,
    `claim_type: ${finalClaimResult.claim_type}`,
    `final_verdict (already decided, do not change): ${finalClaimResult.final_verdict}`,
    allowedEntitiesLine,
    "",
    "Agent evaluations:",
    ...agentLines,
    "",
    `Deterministic dataset_grounded: ${finalClaimResult.evidence_basis.dataset_grounded}`,
  ].join("\n");
}

export interface GenerateFinalReasonAndRewriteInput {
  finalClaimResult: FinalClaimResult;
  claimAgentResults: ClaimAgentResults;
  claimEvidence?: ClaimRetrievedEvidence;
}

export async function generateFinalReasonAndRewriteWithClaude(
  input: GenerateFinalReasonAndRewriteInput,
): Promise<CallClaudeJsonResult<{ claim_id: string; Reason: string; Rewritten_Claim: string }>> {
  const result = await callClaudeJson({
    taskName: "final_rewrite",
    system: buildSystemPrompt(),
    prompt: buildUserPrompt(input),
    toolName: "return_final_rewrite",
    toolDescription: "Return the Reason and Rewritten_Claim as structured JSON matching the required schema.",
    inputSchema: FINAL_REWRITE_INPUT_SCHEMA,
    schema: ClaudeFinalRewriteOutputSchema,
    maxTokens: CLAUDE_MAX_TOKENS.final_rewrite,
  });

  if (!result.ok) return result;
  const output: ClaudeFinalRewriteOutput = result.data;
  return { ok: true, data: { claim_id: input.finalClaimResult.claim_id, Reason: output.Reason, Rewritten_Claim: output.Rewritten_Claim }, source: "claude" };
}

/**
 * Applies Claude's Reason/Rewritten_Claim as an additive overlay on top of an
 * already-complete, deterministic FinalClaimResult. final_verdict and every
 * other deterministic field are always preserved unchanged. On any failure
 * this returns the input FinalClaimResult untouched — its deterministic
 * biologist_friendly_explanation/safer_rewrite already serve as the
 * fallback, so there is nothing extra to do on the failure path.
 */
export async function enhanceFinalClaimResultWithClaude(input: GenerateFinalReasonAndRewriteInput): Promise<FinalClaimResult> {
  const result = await generateFinalReasonAndRewriteWithClaude(input);
  if (!result.ok) return input.finalClaimResult;
  return {
    ...input.finalClaimResult,
    biologist_friendly_explanation: result.data.Reason,
    safer_rewrite: result.data.Rewritten_Claim,
  };
}
