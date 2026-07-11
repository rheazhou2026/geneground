// Serializers that convert GeneGround's internal (snake_case) pipeline
// representations into the exact JSON field names/casing documented in
// docs/geneground-backend-logic.md. Internal schemas/builders are unchanged
// by this file — this is purely an output-shaping layer, per that doc's own
// preamble: "Field names may be converted to code-friendly camelCase
// internally if needed, but output JSON should preserve the documented
// structure unless explicitly changed."
//
// The doc itself mixes Capitalized_Snake_Case (Steps 1-4, 6) and
// lowercase snake_case (Step 5 mostly, Steps 7, 9-11, most of Step 8) —
// that inconsistency is preserved exactly as documented, stage by stage.
//
// Step 8's final claim result intentionally omits confidence scores and
// per-agent verdict detail — those remain on the internal FinalClaimResult
// for debugging/UI, but are not part of the documented user-facing JSON.

import type { InterpretationClaimMap } from "./interactiveReviewMock";
import type {
  AgentQuery,
  AgentQueryPlan,
  AgentRetrievedEvidence,
  ArtifactDiscoveryResult,
  ArtifactIndex,
  ArtifactIndexType,
  ClaimExtractionResult,
  ClaimRetrievedEvidence,
  EntityNormalizationResult,
  FinalClaimResult,
  FinalVerdictResult,
  InteractiveReviewThread,
  ReviewActionPlan,
  TextSelectionContext,
} from "./schemas";

// ---------------------------------------------------------------------------
// Step 1 — Claim Extraction
// ---------------------------------------------------------------------------

export function toDocumentedClaimExtraction(result: ClaimExtractionResult) {
  return {
    Interpretation_id: result.interpretation_id,
    Claims: result.claims.map((claim) => ({
      Claim_id: claim.claim_id,
      Original_text: claim.original_text,
      Claim_type: claim.claim_type,
      Raw_Entities: {
        Genes: claim.raw_entities.genes,
        Pathways: claim.raw_entities.pathways,
        Cell: claim.raw_entities.cell_context,
        Conditions: claim.raw_entities.conditions,
        Direction: claim.raw_entities.direction,
      },
      Language_Flags: {
        Strength_Words: claim.language_flags.strength_words,
        Causal_Words: claim.language_flags.causal_words,
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// Step 2 — InterpretationClaimMap
// ---------------------------------------------------------------------------

export function toDocumentedInterpretationClaimMap(map: InterpretationClaimMap) {
  return {
    Interpretation_id: map.interpretation_id,
    Full_text: map.full_text,
    Sentences: map.sentences.map((sentence) => ({
      Sentence_id: sentence.sentence_id,
      Original_text: sentence.text,
      Span_start: sentence.span_start,
      Span_end: sentence.span_end,
      Claim_IDs: sentence.claim_ids,
    })),
    Claims: map.claims.map((claim) => ({
      Claim_id: claim.claim_id,
      Sentence_id: claim.sentence_id,
      Original_text: claim.original_text,
    })),
  };
}

// ---------------------------------------------------------------------------
// Step 3B — Normalized Claim JSON
// ---------------------------------------------------------------------------

export function toDocumentedNormalizedEntities(result: EntityNormalizationResult) {
  return result.normalized_claims.map((claim) => ({
    Claim_id: claim.claim_id,
    Normalized_entities: {
      Genes: claim.genes.map((gene) => ({
        Raw: gene.raw,
        Normalized_symbol: gene.normalized_symbol,
        "ID-System": "HGNC database",
      })),
      Pathways: claim.pathways.map((pathway) => ({
        Raw: pathway.raw,
        Normalized_name: pathway.normalized_name,
        Candidate_IDs: pathway.candidate_ids,
        "ID-System": pathway.source ?? "unresolved",
      })),
      Conditions: claim.conditions.map((condition) => ({
        Raw: condition.raw,
        Candidate_Dataset_Values: condition.candidate_dataset_values,
        Resolution: condition.resolution,
      })),
      Cell_context: claim.cell_context.map((cellContext) => ({
        Raw: cellContext.raw,
        Cell_Type: cellContext.cell_type.normalized_name,
        Condition_Candidates: cellContext.condition_candidates,
      })),
      Direction: claim.direction.map((direction) => ({
        Raw: direction.raw,
        Normalized_Direction: direction.normalized_direction,
      })),
    },
  }));
}

// ---------------------------------------------------------------------------
// Step 4 — Artifact Discovery Agent
// ---------------------------------------------------------------------------

export function toDocumentedArtifactDiscovery(result: ArtifactDiscoveryResult) {
  return {
    Project_id: result.project_id,
    Artifact_manifest: result.artifact_manifest.map((entry) => ({
      File_name: entry.file_name,
      Artifact_type: entry.artifact_type,
      Corresponding_Index: entry.use_for_indexes,
      Priority: entry.priority,
      Reason: entry.reason,
    })),
    Ignored_files: result.ignored_files.map((entry) => ({
      File_name: entry.file_name,
      Reason: entry.reason,
    })),
  };
}

// ---------------------------------------------------------------------------
// Step 5 — AgentQueryPlan
// ---------------------------------------------------------------------------

function toDocumentedAgentQuery(query: AgentQuery) {
  return {
    Agent_query_id: query.agent_query_id,
    index_type: query.index_type,
    filters: query.filters,
    question: query.question,
  };
}

export function toDocumentedAgentQueryPlan(plan: AgentQueryPlan) {
  return {
    claim_id: plan.claim_id,
    agent_queries: {
      perturbation_evidence: toDocumentedAgentQuery(plan.agent_queries.perturbation_evidence),
      pathway_signature: toDocumentedAgentQuery(plan.agent_queries.pathway_signature),
      robustness_quality: toDocumentedAgentQuery(plan.agent_queries.robustness_quality),
      language_causality: toDocumentedAgentQuery(plan.agent_queries.language_causality),
    },
  };
}

// ---------------------------------------------------------------------------
// Step 6 — Artifact Indexes and Potential Chunk Identification
// ---------------------------------------------------------------------------

export function toDocumentedArtifactIndex(indexType: ArtifactIndexType, index: ArtifactIndex) {
  return {
    Index_type: indexType,
    Source_artifacts: index.source_artifact_ids,
    Chunks: index.chunks.map((chunk) => ({
      Chunk_id: chunk.chunk_id,
      Metadata: chunk.metadata,
      Text_for_embedding: chunk.text_for_embedding,
    })),
  };
}

// ---------------------------------------------------------------------------
// Step 7 — Retrieved Evidence
// ---------------------------------------------------------------------------

function toDocumentedAgentEvidence(evidence: AgentRetrievedEvidence) {
  return {
    agent_query_id: evidence.agent_query_id,
    retrieved_chunks: evidence.retrieved_chunks.map((chunk) => ({
      chunk_id: chunk.chunk_id,
      index_type: chunk.index_type,
      retrieval_mode: chunk.retrieval_mode,
      retrieval_reasons: chunk.retrieval_reasons,
    })),
  };
}

export function toDocumentedRetrievedEvidence(evidence: ClaimRetrievedEvidence) {
  return {
    claim_id: evidence.claim_id,
    agent_evidence: {
      perturbation_evidence: toDocumentedAgentEvidence(evidence.agent_evidence.perturbation_evidence),
      pathway_signature: toDocumentedAgentEvidence(evidence.agent_evidence.pathway_signature),
      robustness_quality: toDocumentedAgentEvidence(evidence.agent_evidence.robustness_quality),
      language_causality: toDocumentedAgentEvidence(evidence.agent_evidence.language_causality),
    },
  };
}

// ---------------------------------------------------------------------------
// Step 8 — Final Claim Verdict and Rewritten Claim
//
// No confidence scores, no per-agent verdict breakdown — final user-facing
// output only. (Internal FinalClaimResult still carries those for
// debugging/UI; see src/lib/finalVerdictAggregator.ts.)
// ---------------------------------------------------------------------------

export function toDocumentedFinalClaimResult(result: FinalClaimResult) {
  return {
    Claim_ID: result.claim_id,
    original_claim_text: result.original_claim_text,
    claim_type: result.claim_type,
    final_verdict: result.final_verdict,
    Reason: result.biologist_friendly_explanation,
    Rewritten_Claim: result.safer_rewrite,
    evidence_basis: {
      dataset_grounded: result.evidence_basis.dataset_grounded,
      chunk_ids_by_agent: result.evidence_basis.chunk_ids_by_agent,
    },
    trace: result.trace,
  };
}

export function toDocumentedFinalVerdictResult(result: FinalVerdictResult) {
  return {
    Interpretation_id: result.interpretation_id,
    Summary: {
      total_claims: result.summary.total_claims,
      supported: result.summary.supported,
      supported_with_caveats: result.summary.supported_with_caveats,
      partially_supported: result.summary.partially_supported,
      overstated: result.summary.overstated,
      unsupported: result.summary.unsupported,
      insufficient_evidence: result.summary.insufficient_evidence,
      needs_review: result.summary.needs_review,
    },
    Claim_results: result.claim_results.map(toDocumentedFinalClaimResult),
  };
}

// ---------------------------------------------------------------------------
// Step 9 — TextSelectionContext for Interactive Annotation
// ---------------------------------------------------------------------------

export function toDocumentedTextSelectionContext(ctx: TextSelectionContext) {
  return {
    selection_id: ctx.selection_id,
    interpretation_id: ctx.interpretation_id,
    selected_text: ctx.selected_text,
    span_start: ctx.span_start,
    span_end: ctx.span_end,
    selection_scope: ctx.selection_scope,
    sentence_id: ctx.matched_sentence_ids,
    claim_id: ctx.matched_claim_ids,
  };
}

// ---------------------------------------------------------------------------
// Step 10 — Interactive Chat Thread
// ---------------------------------------------------------------------------

export function toDocumentedChatThread(thread: InteractiveReviewThread) {
  return {
    thread_id: thread.thread_id,
    selection_id: thread.selection_id,
    messages: thread.messages.map((message) => ({ role: message.role, content: message.content })),
    claim_id: thread.linked_claim_ids,
    chunk_id: thread.linked_evidence_chunk_ids,
  };
}

// ---------------------------------------------------------------------------
// Step 11 — Review Action Plan
// ---------------------------------------------------------------------------

export function toDocumentedActionPlan(plan: ReviewActionPlan) {
  return {
    action_plan_id: plan.action_plan_id,
    selection_id: plan.selection_id,
    requested_action: plan.requested_action,
    selection_scope: plan.scope,
    claim_id: plan.affected_claim_ids,
    sentence_id: plan.affected_sentence_ids,
    chunk_id: plan.evidence_to_reuse,
    agents_to_rerun: plan.agents_to_rerun,
    proposed_changes: plan.proposed_changes.map((change) => ({
      change_id: change.change_id,
      change_type: change.change_type,
      original_text: change.original_text,
      proposed_text: change.proposed_text,
      reason: change.reason,
    })),
    user_decision_options: plan.user_decision_options,
    status: plan.status,
  };
}
