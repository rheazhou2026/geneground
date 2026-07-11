"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { DemoComposer, type InterpretationSource } from "@/components/DemoComposer";
import { GroundingPipelineMap } from "@/components/GroundingPipelineMap";
import { SummaryStatsBar } from "@/components/SummaryStatsBar";
import { ClaimAuditPanel } from "@/components/ClaimAuditPanel";
import { TechnicalPipelinePanel, type PipelineSources } from "@/components/TechnicalPipelinePanel";
import { EvidenceTracePanel } from "@/components/EvidenceTracePanel";
import { EvidenceLinkedReviewEditor, type EvidenceLinkedReviewEditorHandle } from "@/components/EvidenceLinkedReviewEditor";
import { ClaudeApiStatusBadge } from "@/components/ClaudeApiStatusBadge";
import { extractClaimsMock } from "@/lib/claimExtractionMock";
import { categorizeBiologicalEntitiesMock } from "@/lib/entityCategorizationMock";
import { normalizeCategorizedEntities } from "@/lib/entityNormalization";
import { buildArtifactIndexesFromMockHandoff, buildArtifactIndexesFromDiscoveryResult } from "@/lib/artifactIndexes";
import { buildAgentQueryPlansForInterpretation } from "@/lib/agentQueryPlan";
import { retrieveEvidenceForInterpretation } from "@/lib/evidenceRetrieval";
import { runFourMockAgentsForClaim } from "@/lib/mockAgents";
import { aggregateFinalVerdictsForInterpretation, claimNeedsRewrite } from "@/lib/finalVerdictAggregator";
import { discoverArtifactsFromMockHandoff, discoverArtifactsFromHandoffImport } from "@/lib/artifactDiscovery";
import { DEFAULT_HANDOFF_IMPORT_CONFIG, importClaudeScienceHandoffFiles, importClaudeScienceHandoffZip } from "@/lib/handoffImport";
import { isRecognizedInterpretationFileName, shouldIgnoreDemoFixtureFileForMainRun } from "@/lib/interpretationFileDetection";
import { MOCK_HANDOFF_PROJECT } from "@/lib/mockHandoff";
import { initialPipelineNodeStatus, type PipelineNodeId, type PipelineNodeStatus } from "@/lib/pipelineStages";
import type {
  AgentQueryPlanResult,
  AgentVerdictResult,
  ArtifactIndexes,
  ClaimAgentResults,
  ClaimExtractionResult,
  ClaimRetrievedEvidence,
  EntityCategorizationResult,
  EntityNormalizationResult,
  EvidenceRetrievalResult,
  ExtractedClaim,
  FinalClaimResult,
  FinalVerdictResult,
  InterpretationInput,
  NormalizedClaimEntities,
} from "@/lib/schemas";

// Interpretation files (optionally loaded into the composer — see
// DemoComposer/interpretationFileDetection.ts) and demo/evaluation fixture
// files (gold verdicts, stress-test variants, canned demo claims) are not
// biological evidence. They're excluded here, upstream of Artifact Discovery
// and indexing, so the deterministic evidence pipeline never sees them —
// this is the only place this feature touches the grounding pipeline file.
function isNonEvidenceHandoffFile(fileName: string): boolean {
  return isRecognizedInterpretationFileName(fileName) || shouldIgnoreDemoFixtureFileForMainRun(fileName);
}

// Client-visible toggle only (see .env.example). Server-side Claude usage
// always depends on ANTHROPIC_API_KEY regardless of this flag — this just
// controls whether the demo UI attempts the /api/claude/* round trip at all.
const USE_CLAUDE_API = process.env.NEXT_PUBLIC_GENEGROUND_USE_CLAUDE_API !== "false";

async function postJson<TResponse>(url: string, body: unknown): Promise<TResponse | null> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return null;
    return (await res.json()) as TResponse;
  } catch {
    return null;
  }
}

interface StepResult<T> {
  data: T;
  source: "claude" | "mock";
  warning?: string;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runExtractionStep(interpretationId: string, fullText: string): Promise<StepResult<ClaimExtractionResult>> {
  const fallback = () => extractClaimsMock({ ...DEFAULT_INTERPRETATION, interpretation_id: interpretationId, full_text: fullText });

  if (!USE_CLAUDE_API) return { data: fallback(), source: "mock" };

  const response = await postJson<{ source: "claude" | "mock"; data: ClaimExtractionResult; warning?: string }>("/api/claude/extract-claims", {
    interpretation_id: interpretationId,
    full_text: fullText,
  });
  if (!response) return { data: fallback(), source: "mock", warning: "Network error calling /api/claude/extract-claims." };
  return response;
}

async function runAgentEvaluationStep(
  extractedClaim: ExtractedClaim,
  normalizedClaim: NormalizedClaimEntities,
  claimEvidence: ClaimRetrievedEvidence,
): Promise<StepResult<ClaimAgentResults>> {
  const fallback = () => runFourMockAgentsForClaim(claimEvidence);

  if (!USE_CLAUDE_API) return { data: fallback(), source: "mock" };

  const response = await postJson<{ source: "claude" | "mock"; data: ClaimAgentResults; warning?: string }>("/api/claude/evaluate-agents", {
    extractedClaim,
    normalizedClaim,
    claimEvidence,
  });
  if (!response) return { data: fallback(), source: "mock", warning: "Network error calling /api/claude/evaluate-agents." };
  return response;
}

async function runFinalRewriteStep(finalClaimResult: FinalClaimResult, claimAgentResults: ClaimAgentResults): Promise<StepResult<FinalClaimResult>> {
  if (!USE_CLAUDE_API) return { data: finalClaimResult, source: "mock" };

  const response = await postJson<{ source: "claude" | "mock"; data: FinalClaimResult; warning?: string }>("/api/claude/final-rewrite", {
    finalClaimResult,
    claimAgentResults,
  });
  if (!response) return { data: finalClaimResult, source: "mock", warning: "Network error calling /api/claude/final-rewrite." };
  return response;
}

const DEFAULT_INTERPRETATION: InterpretationInput = {
  interpretation_id: "demo-interp-001",
  source_label: "Demo interpretation — CD4+ T cell Perturb-seq",
  full_text:
    "Across CRISPRi perturbations in primary human CD4+ T cells, several transcription factors show clear, reproducible perturbation-linked transcriptional responses that are consistent with their expected T cell biology. Knockdown of NFKB2 in 8-hour-stimulated cells produced a strong on-target reduction in NFKB2 expression (on-target effect size -32.6, significant at 10% FDR) and was associated with a broad response of 1,350 differentially expressed genes (761 up, 589 down). Genes upregulated after NFKB2 knockdown were enriched for an NF-kB / inflammatory signature and the Hallmark 'TNF-alpha signaling via NF-kB' gene set, consistent with altered NF-kB-associated transcriptional activity; this directional pattern was reproducible across four donors and both guides and recurred at 48 hours and, more weakly, at rest. This reproducible upregulation points to a regulatory role for NFKB2 in restraining the inflammatory program in stimulated cells. Knockdown of GATA3 (Stim8hr; on-target -20.0, 1,239 DE genes) was associated with coordinated downregulation of a Th2-polarization signature, including lower IL5, IL13, CCR8 and IL10, which is consistent with GATA3's established association with the Th2 program. In contrast, STAT1 knockdown (Stim8hr) produced a much smaller, more focused response (46 DE genes) in which downregulated genes were enriched for an interferon-response signature (e.g. GBP1, GBP4, IFITM3), consistent with reduced interferon-stimulated gene expression. A BATF knockdown result (Stim8hr) pointed in a similar activation-related direction but is reported here as exploratory because it rests on relatively few cells (135) with only 6 of 8 donor-guide pseudobulks passing quality control. Together, these knockdowns begin to define distinct arms of the CD4+ T cell response — inflammatory, Th2, and interferon. All of these are transcriptional associations from pseudobulk differential expression against non-targeting controls; CRISPRi represses rather than fully knocks out the target, and none of these results establishes a causal mechanism on its own.",
  handoff_project_id: MOCK_HANDOFF_PROJECT.handoff_project_id,
  created_at: "2026-07-01T09:15:00Z",
};

// Built-in demo handoff — precomputed once, used whenever the user doesn't
// attach a real Claude Science handoff of their own.
const MOCK_ARTIFACT_INDEXES = buildArtifactIndexesFromMockHandoff();
const MOCK_ARTIFACT_DISCOVERY = discoverArtifactsFromMockHandoff();

type TabId = "rewrite" | "technical" | "trace";
const TABS: { id: TabId; label: string }[] = [
  { id: "rewrite", label: "Grounded Rewrite" },
  { id: "technical", label: "Technical Pipeline" },
  { id: "trace", label: "Evidence Trace" },
];

export default function DemoPage() {
  const [phase, setPhase] = useState<"composer" | "running" | "done">("composer");
  const [activeTab, setActiveTab] = useState<TabId>("rewrite");
  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);
  const reviewEditorRef = useRef<EvidenceLinkedReviewEditorHandle>(null);

  const [nodeStatuses, setNodeStatuses] = useState(initialPipelineNodeStatus());
  const [pipelineWarnings, setPipelineWarnings] = useState<string[]>([]);
  const [pipelineSources, setPipelineSources] = useState<PipelineSources>({ extraction: "mock", perClaim: {} });
  // Purely a display echo of what was submitted — captured once at grounding
  // start so attached files stay visible while the composer itself is
  // unmounted during the running/done phases. Never touched by pipeline logic.
  const [submittedAttachments, setSubmittedAttachments] = useState<{ name: string; size: number }[]>([]);
  const [interpretationSource, setInterpretationSource] = useState<InterpretationSource>("pasted");

  const [extraction, setExtraction] = useState<ClaimExtractionResult | null>(null);
  const [categorization, setCategorization] = useState<EntityCategorizationResult | null>(null);
  const [normalization, setNormalization] = useState<EntityNormalizationResult | null>(null);
  const [agentQueryPlan, setAgentQueryPlan] = useState<AgentQueryPlanResult | null>(null);
  const [evidenceRetrieval, setEvidenceRetrieval] = useState<EvidenceRetrievalResult | null>(null);
  const [agentVerdicts, setAgentVerdicts] = useState<AgentVerdictResult | null>(null);
  const [finalVerdict, setFinalVerdict] = useState<FinalVerdictResult | null>(null);
  const [artifactIndexes, setArtifactIndexes] = useState<ArtifactIndexes>(MOCK_ARTIFACT_INDEXES);

  function setNodeStatus(id: PipelineNodeId, status: PipelineNodeStatus) {
    setNodeStatuses((prev) => ({ ...prev, [id]: status }));
  }

  async function handleGround(text: string, files: File[], meta: { interpretationSource: InterpretationSource }) {
    if (text.trim().length === 0) return;
    setSubmittedAttachments(files.map((f) => ({ name: f.name, size: f.size })));
    setInterpretationSource(meta.interpretationSource);
    setPhase("running");
    setActiveTab("rewrite");
    setActiveClaimId(null);
    setNodeStatuses(initialPipelineNodeStatus());
    setExtraction(null);
    setCategorization(null);
    setNormalization(null);
    setAgentQueryPlan(null);
    setEvidenceRetrieval(null);
    setAgentVerdicts(null);
    setFinalVerdict(null);
    setPipelineWarnings([]);

    const warnings: string[] = [];
    const claimSources: PipelineSources["perClaim"] = {};

    // Branch A — interpretation pipeline: Claude claim extraction, then
    // deterministic sentence/claim mapping and mini-ontology normalization.
    async function runInterpretationBranch() {
      setNodeStatus("interpretation", "running");
      await wait(150);
      setNodeStatus("interpretation", "complete");

      setNodeStatus("claim_extraction", "running");
      const extractionStep = await runExtractionStep(DEFAULT_INTERPRETATION.interpretation_id, text);
      if (extractionStep.warning) warnings.push(extractionStep.warning);
      setNodeStatus("claim_extraction", extractionStep.source === "claude" ? "complete" : "fallback");

      setNodeStatus("entity_normalization", "running");
      const categorizationResult = categorizeBiologicalEntitiesMock(extractionStep.data.claims);
      const normalizationResult = normalizeCategorizedEntities(extractionStep.data.claims, categorizationResult.categorized_claims);
      await wait(200);
      setNodeStatus("entity_normalization", "complete");

      return {
        extraction: extractionStep.data,
        categorization: categorizationResult,
        normalization: normalizationResult,
        extractionSource: extractionStep.source,
      };
    }

    // Branch B — handoff pipeline: import the attached handoff (or fall back
    // to the built-in demo handoff), classify artifacts, build indexes.
    async function runHandoffBranch() {
      setNodeStatus("handoff", "running");
      await wait(files.length > 0 ? 0 : 150);
      setNodeStatus("handoff", "complete");

      setNodeStatus("artifact_discovery", "running");

      if (files.length === 0) {
        await wait(200);
        setNodeStatus("artifact_discovery", "complete");
        setNodeStatus("evidence_indexing", "running");
        await wait(200);
        setNodeStatus("evidence_indexing", "complete");
        return { discovery: MOCK_ARTIFACT_DISCOVERY, indexes: MOCK_ARTIFACT_INDEXES };
      }

      try {
        const isSingleZip = files.length === 1 && files[0].name.toLowerCase().endsWith(".zip");
        const importResult = isSingleZip
          ? await importClaudeScienceHandoffZip(files[0], DEFAULT_HANDOFF_IMPORT_CONFIG, isNonEvidenceHandoffFile)
          : await importClaudeScienceHandoffFiles(files, DEFAULT_HANDOFF_IMPORT_CONFIG, isNonEvidenceHandoffFile);

        if (importResult.accepted_files_count === 0) {
          warnings.push("The attached handoff had no usable files — used the built-in demo handoff evidence instead.");
          setNodeStatus("artifact_discovery", "fallback");
          setNodeStatus("evidence_indexing", "fallback");
          return { discovery: MOCK_ARTIFACT_DISCOVERY, indexes: MOCK_ARTIFACT_INDEXES };
        }

        const discovery = discoverArtifactsFromHandoffImport(importResult);
        setNodeStatus("artifact_discovery", "complete");
        setNodeStatus("evidence_indexing", "running");
        const indexes = buildArtifactIndexesFromDiscoveryResult(discovery, importResult);
        setNodeStatus("evidence_indexing", "complete");
        return { discovery, indexes };
      } catch (err) {
        warnings.push(`Handoff import failed — used the built-in demo handoff evidence instead. (${err instanceof Error ? err.message : String(err)})`);
        setNodeStatus("artifact_discovery", "fallback");
        setNodeStatus("evidence_indexing", "fallback");
        return { discovery: MOCK_ARTIFACT_DISCOVERY, indexes: MOCK_ARTIFACT_INDEXES };
      }
    }

    const [branchA, branchB] = await Promise.all([runInterpretationBranch(), runHandoffBranch()]);

    setExtraction(branchA.extraction);
    setCategorization(branchA.categorization);
    setNormalization(branchA.normalization);
    setArtifactIndexes(branchB.indexes);

    // Merge — evidence retrieval needs both branches' output.
    setNodeStatus("evidence_retrieval", "running");
    const agentQueryPlanResult = buildAgentQueryPlansForInterpretation(
      branchA.normalization.normalized_claims,
      branchA.categorization.categorized_claims,
      branchA.extraction.claims,
    );
    const evidenceRetrievalResult = retrieveEvidenceForInterpretation(agentQueryPlanResult, branchB.indexes);
    await wait(150);
    setNodeStatus("evidence_retrieval", "complete");
    setAgentQueryPlan(agentQueryPlanResult);
    setEvidenceRetrieval(evidenceRetrievalResult);

    // Step 8B — one Claude call per claim, each independently falling back.
    setNodeStatus("agent_evaluation", "running");
    const claimAgentResultsList: ClaimAgentResults[] = [];
    let anyAgentFallback = false;
    for (const claimEvidence of evidenceRetrievalResult.retrieved_evidence_by_claim) {
      const extractedClaim = branchA.extraction.claims.find((c) => c.claim_id === claimEvidence.claim_id);
      const normalizedClaim = branchA.normalization.normalized_claims.find((c) => c.claim_id === claimEvidence.claim_id);
      if (!extractedClaim || !normalizedClaim) continue;
      const agentStep = await runAgentEvaluationStep(extractedClaim, normalizedClaim, claimEvidence);
      if (agentStep.warning) warnings.push(`${claimEvidence.claim_id}: ${agentStep.warning}`);
      if (agentStep.source !== "claude") anyAgentFallback = true;
      claimSources[claimEvidence.claim_id] = { agentEval: agentStep.source, rewrite: "mock" };
      claimAgentResultsList.push(agentStep.data);
    }
    setNodeStatus("agent_evaluation", anyAgentFallback ? "fallback" : "complete");
    const agentVerdictResult: AgentVerdictResult = {
      interpretation_id: branchA.extraction.interpretation_id,
      claim_agent_results: claimAgentResultsList,
    };
    setAgentVerdicts(agentVerdictResult);

    // Step 9 — final_verdict is always deterministic first; Claude only
    // overlays Reason + Rewritten_Claim on top, per claim, and only when a
    // rewrite is actually needed (claimNeedsRewrite) — supported claims (and
    // already-cautious supported_with_caveats claims) skip the API call
    // entirely and keep their original wording.
    setNodeStatus("grounded_rewrite", "running");
    const deterministicFinalVerdict = aggregateFinalVerdictsForInterpretation(agentVerdictResult);
    const enhancedClaimResults: FinalClaimResult[] = [];
    let anyRewriteFallback = false;
    for (const claimResult of deterministicFinalVerdict.claim_results) {
      const claimAgentResults = claimAgentResultsList.find((c) => c.claim_id === claimResult.claim_id);
      if (!claimAgentResults) {
        enhancedClaimResults.push(claimResult);
        continue;
      }

      const extractedClaim = branchA.extraction.claims.find((c) => c.claim_id === claimResult.claim_id);
      const rewriteNeeded = extractedClaim
        ? claimNeedsRewrite(claimResult.final_verdict, extractedClaim, claimAgentResults.agent_results)
        : true;

      if (!rewriteNeeded) {
        const existingSource = claimSources[claimResult.claim_id];
        if (existingSource) existingSource.rewrite = "skipped";
        enhancedClaimResults.push({ ...claimResult, safer_rewrite: claimResult.original_claim_text, rewrite_needed: false });
        continue;
      }

      const rewriteStep = await runFinalRewriteStep(claimResult, claimAgentResults);
      if (rewriteStep.warning) warnings.push(`${claimResult.claim_id}: ${rewriteStep.warning}`);
      if (rewriteStep.source !== "claude") anyRewriteFallback = true;
      const existingSource = claimSources[claimResult.claim_id];
      if (existingSource) existingSource.rewrite = rewriteStep.source;
      enhancedClaimResults.push({ ...rewriteStep.data, rewrite_needed: true });
    }
    setNodeStatus("grounded_rewrite", anyRewriteFallback ? "fallback" : "complete");
    setFinalVerdict({ ...deterministicFinalVerdict, claim_results: enhancedClaimResults });

    setPipelineSources({ extraction: branchA.extractionSource, perClaim: claimSources });
    setPipelineWarnings(warnings);
    setPhase("done");
  }

  function handleSelectClaim(claimId: string | null) {
    setActiveClaimId(claimId);
    reviewEditorRef.current?.highlightClaim(claimId);
  }

  function handleReset() {
    setPhase("composer");
  }

  const resultsReady =
    phase === "done" && finalVerdict && extraction && evidenceRetrieval && agentVerdicts && categorization && normalization && agentQueryPlan;

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-black">
      <header className="border-b border-zinc-200 dark:border-zinc-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link href="/" className="group flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="font-mono text-sm font-semibold tracking-tight text-zinc-900 group-hover:opacity-70 dark:text-zinc-100">
              GeneGround
            </span>
          </Link>
          <ClaudeApiStatusBadge />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {phase === "composer" && (
          <div className="mx-auto max-w-2xl py-10">
            <div className="text-center">
              <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">GeneGround</h1>
              <p className="mt-3 text-base leading-relaxed text-zinc-500 dark:text-zinc-400">
                Ground AI-generated omics interpretations against Claude Science evidence.
              </p>
            </div>
            <div className="mt-8">
              {/* DemoComposer only renders during phase "composer" and unmounts the
                  instant handleGround flips phase to "running", so `submitting`
                  is always false in this branch by construction — it's still
                  wired through (rather than hardcoded) so the button correctly
                  shows a "Grounding…" state if that mount condition ever
                  changes. Attached-file visibility *during* grounding itself is
                  handled below via submittedAttachments, not by keeping the
                  composer mounted. */}
              <DemoComposer defaultValue={DEFAULT_INTERPRETATION.full_text} onSubmit={handleGround} submitting={false} />
            </div>
          </div>
        )}

        {phase !== "composer" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleReset}
                className="text-xs font-medium text-zinc-400 hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-200"
              >
                ← New interpretation
              </button>

              {submittedAttachments.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-600">Handoff:</span>
                  {submittedAttachments.map((f, i) => (
                    <span
                      key={`${f.name}-${i}`}
                      className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400"
                    >
                      {f.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {!resultsReady && <GroundingPipelineMap statuses={nodeStatuses} done={phase === "done"} />}

            {resultsReady && (
              <div className="space-y-5">
                <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
                  {TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                        activeTab === tab.id
                          ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                          : "border-transparent text-zinc-400 hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-300"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {activeTab === "rewrite" && (
                  <div className="space-y-5">
                    <SummaryStatsBar summary={finalVerdict.summary} />
                    <div className="grid gap-5 lg:h-[calc(100vh-16rem)] lg:grid-cols-[minmax(0,1fr)_22rem]">
                      <div className="lg:min-h-0 lg:overflow-y-auto lg:pr-1">
                        <EvidenceLinkedReviewEditor
                          ref={reviewEditorRef}
                          sourceText={extraction.source_text}
                          extractedClaims={extraction.claims}
                          finalVerdictResult={finalVerdict}
                          evidenceRetrieval={evidenceRetrieval}
                        />
                      </div>
                      <div className="lg:min-h-0 lg:overflow-y-auto lg:pr-1">
                        <ClaimAuditPanel
                          claimResults={finalVerdict.claim_results}
                          activeClaimId={activeClaimId}
                          onSelectClaim={handleSelectClaim}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "technical" && (
                  <TechnicalPipelinePanel
                    data={{
                      extraction,
                      agentQueryPlan,
                      evidenceRetrieval,
                      finalVerdict,
                      artifactIndexes,
                    }}
                    pipelineSources={pipelineSources}
                    pipelineWarnings={pipelineWarnings}
                    submittedAttachments={submittedAttachments}
                    interpretationSource={interpretationSource}
                  />
                )}

                {activeTab === "trace" && <EvidenceTracePanel finalVerdict={finalVerdict} evidenceRetrieval={evidenceRetrieval} />}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
