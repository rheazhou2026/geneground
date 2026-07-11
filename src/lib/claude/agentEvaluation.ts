// Step 7B — Claude-powered four-agent evaluation. Server-side only.
//
// Claude evaluates only the chunks already retrieved deterministically in
// Step 7 (never raw handoff files) and returns one internal verdict per
// agent. It does not choose the final user-facing final_verdict — that
// stays fully deterministic (src/lib/finalVerdictAggregator.ts, untouched).
// See docs/geneground-backend-logic.md Step 7B and
// docs/geneground-taxonomies.md's Agent-Level Verdict Guidelines.

import { z } from "zod";
import { callClaudeJson, lenientObject, type CallClaudeJsonResult, type ClaudeJsonToolSchema } from "./client";
import { CLAUDE_MAX_TOKENS } from "./config";
import { AGENT_TYPES, INTERNAL_AGENT_VERDICTS } from "../taxonomies";
import type { AgentResult, AgentType, AgentVerdictLabel, ClaimAgentResults, ClaimRetrievedEvidence, ExtractedClaim, NormalizedClaimEntities, RetrievedChunk } from "../schemas";

// ---------------------------------------------------------------------------
// Doc-shaped (Step 7B) Claude output schema
// ---------------------------------------------------------------------------

const ClaudeAgentResultSchema = z.object({
  agent: z.enum(AGENT_TYPES),
  verdict: z.enum(INTERNAL_AGENT_VERDICTS),
  rationale: z.string(),
  chunk_ids: z.array(z.string()),
  warnings: z.array(z.string()),
});

const ClaudeAgentEvaluationOutputSchema = z.object({
  agent_results: lenientObject(
    z.object({
      perturbation_evidence: ClaudeAgentResultSchema,
      pathway_signature: ClaudeAgentResultSchema,
      robustness_quality: ClaudeAgentResultSchema,
      language_causality: ClaudeAgentResultSchema,
    }),
  ),
});
type ClaudeAgentEvaluationOutput = z.infer<typeof ClaudeAgentEvaluationOutputSchema>;
/** Exported for tests only — the shape of a single agent's raw Claude output before chunk_id subset enforcement. */
export type ClaudeAgentResult = z.infer<typeof ClaudeAgentResultSchema>;

function agentResultInputSchema(agentName: AgentType): ClaudeJsonToolSchema["properties"][string] {
  return {
    type: "object",
    properties: {
      agent: { type: "string", enum: [agentName], description: `Must always be exactly "${agentName}".` },
      verdict: { type: "string", enum: [...INTERNAL_AGENT_VERDICTS] },
      rationale: { type: "string", description: "One or two sentences explaining the verdict, grounded only in the provided chunks." },
      chunk_ids: {
        type: "array",
        items: { type: "string" },
        description: "Only chunk_id values copied exactly from this agent's retrieved chunks below. Never invent a chunk_id.",
      },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: ["agent", "verdict", "rationale", "chunk_ids", "warnings"],
  };
}

const AGENT_EVALUATION_INPUT_SCHEMA: ClaudeJsonToolSchema = {
  type: "object",
  properties: {
    agent_results: {
      type: "object",
      properties: {
        perturbation_evidence: agentResultInputSchema("perturbation_evidence"),
        pathway_signature: agentResultInputSchema("pathway_signature"),
        robustness_quality: agentResultInputSchema("robustness_quality"),
        language_causality: agentResultInputSchema("language_causality"),
      },
      required: [...AGENT_TYPES],
    },
  },
  required: ["agent_results"],
};

// ---------------------------------------------------------------------------
// Prompt — compact chunk summaries only, never raw handoff files.
// ---------------------------------------------------------------------------

function summarizeChunk(chunk: RetrievedChunk): string {
  const payload = Object.entries(chunk.structured_payload)
    .slice(0, 12)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(", ");
  return `[${chunk.chunk_id}] ${chunk.text_for_embedding} | data: ${payload}${chunk.warnings && chunk.warnings.length > 0 ? ` | quality flags: ${chunk.warnings.join("; ")}` : ""}`;
}

function buildSystemPrompt(): string {
  return [
    "You are GeneGround's four-agent evaluation step for a single biological claim from an AI-generated single-cell RNA-seq / Perturb-seq interpretation.",
    "You evaluate exactly four agents: perturbation_evidence, pathway_signature, robustness_quality, language_causality. Each agent judges only its own retrieved chunk list below — never the other agents' chunks, and never any file or evidence not explicitly listed.",
    "",
    "For each agent, choose one verdict from this fixed list — never invent a new label: " + INTERNAL_AGENT_VERDICTS.join(", "),
    "- not_applicable: this agent's evidence type is not relevant to this claim (e.g. pathway_signature for a purely gene-level claim).",
    "- insufficient_evidence: this agent's retrieved chunks are empty, missing, or inadequate to judge.",
    "- contradicts: the evidence points against the claim or the opposite direction.",
    "- For language_causality specifically: flag overstrong wording (weak_support or lower) when the claim's strength/causal words assert more than the retrieved dataset evidence in the OTHER agents' summaries supports — e.g. 'master regulator', 'causes', 'therapeutic target', 'mechanism' without matching perturbation/pathway/robustness support.",
    "",
    "chunk_ids in your answer must be copied exactly from the chunk_id values shown for that agent below. Never invent a chunk_id, never cite a chunk_id from a different agent's list, and never cite a chunk_id that is not shown at all.",
    "You are not choosing the claim's final verdict — that is computed separately and deterministically. Only report each agent's own internal verdict.",
    "",
    "Call the return_agent_evaluations tool exactly once with all four agent results.",
  ].join("\n");
}

function buildUserPrompt(input: EvaluateClaimAgentsWithClaudeInput): string {
  const { extractedClaim, normalizedClaim, claimEvidence } = input;

  const entitySummary = [
    `Genes: ${normalizedClaim.genes.map((g) => g.normalized_symbol ?? g.raw).join(", ") || "none"}`,
    `Pathways: ${normalizedClaim.pathways.map((p) => p.normalized_name ?? p.raw).join(", ") || "none"}`,
    `Conditions: ${normalizedClaim.conditions.flatMap((c) => c.candidate_dataset_values).join(", ") || "none"}`,
    `Direction: ${normalizedClaim.direction.map((d) => d.normalized_direction).join(", ") || "none"}`,
  ].join("\n");

  const agentSections = AGENT_TYPES.map((agent) => {
    const chunks = claimEvidence.agent_evidence[agent].retrieved_chunks;
    const list = chunks.length > 0 ? chunks.map(summarizeChunk).join("\n") : "(no chunks retrieved for this agent)";
    return `### ${agent} — retrieved chunks:\n${list}`;
  }).join("\n\n");

  return [
    `Claim: "${extractedClaim.original_text}"`,
    `Claim_type: ${extractedClaim.claim_type}`,
    `Strength_Words: ${extractedClaim.language_flags.strength_words.join(", ") || "none"}`,
    `Causal_Words: ${extractedClaim.language_flags.causal_words.join(", ") || "none"}`,
    "",
    "Normalized entities:",
    entitySummary,
    "",
    agentSections,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Server-side chunk_id subset enforcement + adapter to internal AgentResult
// ---------------------------------------------------------------------------

const VERDICT_CONFIDENCE_APPROXIMATION: Record<AgentVerdictLabel, number> = {
  supports: 0.85,
  supports_with_caveats: 0.65,
  weak_support: 0.45,
  contradicts: 0.3,
  insufficient_evidence: 0.2,
  not_applicable: 0.9,
  needs_review: 0.35,
};

/** Exported for tests — enforces that Claude can only cite chunk_ids actually retrieved for this agent; invented ones are dropped into warnings instead of trusted. */
export function adaptAgentResult(
  agentType: AgentType,
  claimId: string,
  agentQueryId: string,
  claudeResult: z.infer<typeof ClaudeAgentResultSchema>,
  retrievedChunkIds: Set<string>,
): AgentResult {
  const invented = claudeResult.chunk_ids.filter((id) => !retrievedChunkIds.has(id));
  const validChunkIds = claudeResult.chunk_ids.filter((id) => retrievedChunkIds.has(id));
  const warnings = [...claudeResult.warnings];
  if (invented.length > 0) {
    warnings.push(`Claude cited ${invented.length} chunk_id(s) not present in retrieved evidence; they were dropped: ${invented.join(", ")}`);
  }

  return {
    agent_type: agentType,
    agent_query_id: agentQueryId,
    claim_id: claimId,
    agent_verdict: claudeResult.verdict,
    confidence: VERDICT_CONFIDENCE_APPROXIMATION[claudeResult.verdict],
    evidence_chunk_ids: validChunkIds,
    supporting_points: [],
    weak_points: [],
    missing_evidence: [],
    risk_flags: warnings,
    agent_reasoning_summary: claudeResult.rationale,
  };
}

function adaptClaudeOutput(input: EvaluateClaimAgentsWithClaudeInput, output: ClaudeAgentEvaluationOutput): ClaimAgentResults {
  const { extractedClaim, claimEvidence } = input;

  function retrievedIdsFor(agent: AgentType): Set<string> {
    return new Set(claimEvidence.agent_evidence[agent].retrieved_chunks.map((c) => c.chunk_id));
  }

  return {
    claim_id: extractedClaim.claim_id,
    interpretation_id: extractedClaim.interpretation_id,
    sentence_id: extractedClaim.sentence_id,
    original_claim_text: extractedClaim.original_text,
    claim_type: extractedClaim.claim_type,
    agent_results: {
      perturbation_evidence: adaptAgentResult(
        "perturbation_evidence",
        extractedClaim.claim_id,
        claimEvidence.agent_evidence.perturbation_evidence.agent_query_id,
        output.agent_results.perturbation_evidence,
        retrievedIdsFor("perturbation_evidence"),
      ),
      pathway_signature: adaptAgentResult(
        "pathway_signature",
        extractedClaim.claim_id,
        claimEvidence.agent_evidence.pathway_signature.agent_query_id,
        output.agent_results.pathway_signature,
        retrievedIdsFor("pathway_signature"),
      ),
      robustness_quality: adaptAgentResult(
        "robustness_quality",
        extractedClaim.claim_id,
        claimEvidence.agent_evidence.robustness_quality.agent_query_id,
        output.agent_results.robustness_quality,
        retrievedIdsFor("robustness_quality"),
      ),
      language_causality: adaptAgentResult(
        "language_causality",
        extractedClaim.claim_id,
        claimEvidence.agent_evidence.language_causality.agent_query_id,
        output.agent_results.language_causality,
        retrievedIdsFor("language_causality"),
      ),
    },
    warnings: claimEvidence.claim_retrieval_warnings.length > 0 ? claimEvidence.claim_retrieval_warnings : undefined,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface EvaluateClaimAgentsWithClaudeInput {
  extractedClaim: ExtractedClaim;
  normalizedClaim: NormalizedClaimEntities;
  claimEvidence: ClaimRetrievedEvidence;
}

export async function evaluateClaimAgentsWithClaude(input: EvaluateClaimAgentsWithClaudeInput): Promise<CallClaudeJsonResult<ClaimAgentResults>> {
  const result = await callClaudeJson({
    taskName: "agent_evaluation",
    system: buildSystemPrompt(),
    prompt: buildUserPrompt(input),
    toolName: "return_agent_evaluations",
    toolDescription: "Return all four agents' internal verdicts as structured JSON matching the required schema.",
    inputSchema: AGENT_EVALUATION_INPUT_SCHEMA,
    schema: ClaudeAgentEvaluationOutputSchema,
    maxTokens: CLAUDE_MAX_TOKENS.agent_evaluation,
  });

  if (!result.ok) return result;
  return { ok: true, data: adaptClaudeOutput(input, result.data), source: "claude" };
}
