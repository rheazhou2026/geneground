# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## GeneGround

GeneGround is a claim-level verification app for AI-assisted single-cell RNA-seq and Perturb-seq interpretation.

### Product goal

Users paste an AI-generated genomics interpretation. GeneGround extracts individual biological claims, normalizes entities, retrieves relevant evidence from precomputed Claude Science artifacts, and returns a verdict for each claim.

Verdict labels:
- supported
- partially_supported
- overstated
- unsupported
- insufficient_evidence

For each claim, GeneGround shows:
- original claim
- claim type
- normalized entities
- matched evidence
- supported parts
- unsupported or overstated parts
- missing evidence
- safer rewrite
- biologist-friendly explanation

### Demo context

The demo uses the Primary Human CD4+ T Cell Perturb-seq dataset from Virtual Cell Models.

Claude Science is used outside this app to generate analysis artifacts:
- perturbation evidence packets
- pathway enrichment packets
- pseudobulk robustness summaries
- dataset schema maps
- demo claims and gold verdicts

The web app should ingest compact JSON evidence files only. Do not load huge `.h5ad` files in the web app.

### Scientific rules

Do not overstate biology.

Be careful with terms like:
- drives
- causes
- proves
- master regulator
- rescues
- reprograms
- mechanism
- therapeutic target

These require stronger evidence than differential expression alone.

Prefer cautious rewrites:
- "is associated with"
- "is consistent with"
- "shows a perturbation-linked transcriptional response"
- "suggests, but does not establish"

Dataset evidence is primary. Literature context is optional and secondary.

### Verification pipeline (four-agent architecture)

GeneGround flow:
claim → categorized entities → normalized entities → AgentQueryPlan → retriever gets chunks from Artifact Indexes → four agents inspect those chunks → final aggregator combines results into a claim-level verdict and reason.

Four verification agents, one per claim:
- `perturbation_evidence` — did the perturbation produce a significant, on-target expression change?
- `pathway_signature` — did the relevant pathway/signature move in the claimed direction?
- `robustness_quality` — is the evidence reliable (guides, donors, quality flags)?
- `language_causality` — evaluates whether the claim's wording implies causality, mechanism, therapeutic relevance, regulatory strength, or certainty beyond what the evidence supports.

Use `language_causality` for the agent name and `language_rules_index` for its evidence index — not `language`, `causality_agent`, or `language_index`. These are the fixed names used throughout schemas, builders, and the demo UI.

Artifact Indexes and which agent uses each:
- `perturbation_evidence_index` — used by the `perturbation_evidence` agent.
- `pathway_signature_index` — used by the `pathway_signature` agent.
- `robustness_quality_index` — used by the `robustness_quality` agent.
- `language_rules_index` — used by the `language_causality` agent.
- `provenance_index` — mainly used by the audit UI / final report; sometimes the `robustness_quality` agent for caveats. Not queried for every claim.
- `demo_examples_index` — MVP/demo/testing only.

Artifact Discovery Agent classifies files from the Claude Science handoff bundle into artifact types and target indexes. Verification agents never directly choose individual source files. They query typed Artifact Indexes. The indexes know which files contributed relevant evidence.

Use `language_causality` for the agent name and `language_rules_index` for the evidence index. The language_causality agent evaluates whether claim wording implies causality, mechanism, therapeutic relevance, regulatory strength, or certainty beyond what the evidence supports.

### MVP technical stack

Use:
- Next.js App Router
- TypeScript
- Tailwind CSS
- Zod
- Claude API through ANTHROPIC_API_KEY
- Local JSON demo files in /data

Avoid for MVP:
- database
- authentication
- live `.h5ad` processing
- MCP
- multi-user workspaces
- unnecessary backend complexity

### Required app flow

1. User opens landing page.
2. User goes to demo page.
3. User pastes an AI-generated biological interpretation.
4. App extracts claims.
5. App retrieves matching evidence.
6. Claude API verifies each claim.
7. App displays claim cards with verdicts, evidence, caveats, and safer rewrites.
8. User can highlight/report-comment a sentence and ask GeneGround to critique it.

### Required files/components

All application code lives under `src/`, matching the existing scaffolded structure and the `@/*` tsconfig alias (`@/*` → `./src/*`). Do not create a root-level `app/`, `components/`, `lib/`, `prompts/`, or `data/` directory — everything nests under `src/`.

Create:
- src/app/page.tsx
- src/app/demo/page.tsx
- src/app/api/extract-claims/route.ts
- src/app/api/verify-claims/route.ts
- src/app/api/annotate/route.ts
- src/components/ClaimInput.tsx
- src/components/ClaimCard.tsx
- src/components/EvidencePanel.tsx
- src/components/VerdictBadge.tsx
- src/components/ReportViewer.tsx
- src/components/AnnotationPopover.tsx
- src/lib/schemas.ts
- src/lib/retrieveEvidence.ts
- src/lib/normalizeEntities.ts
- src/lib/claude.ts
- src/prompts/claim_extractor.md
- src/prompts/claim_verifier.md
- src/prompts/annotation_reviewer.md
- src/data/demo_interpretations.json
- src/data/geneground_evidence_bundle.json

### Development behavior

Make small, reviewable changes.
Run typecheck/lint after meaningful edits.
Use mock data before integrating the Claude API.
Keep the UI understandable to a non-expert judge.
