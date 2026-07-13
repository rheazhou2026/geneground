# GeneGround

**A claim-level grounding checker for AI-assisted genomics interpretation.**

GeneGround decomposes AI-generated omics summaries into individual biological claims, checks each one against the underlying dataset and published literature, and returns an auditable, evidence-linked verdict — so a scientist can trust an AI interpretation before it shapes a paper, presentation, or downstream experiment.

Built for the **Built with Claude: Life Sciences** hackathon (Builder track), powered by **Claude Code** and **Claude Science**, and demoed on the Gladstone/UCSF T cell Perturb-seq dataset.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Built with Claude](https://img.shields.io/badge/Built%20with-Claude-6A5ACD)](https://www.anthropic.com/news/claude-science-ai-workbench)
[![Next.js](https://img.shields.io/badge/Next.js-000000?logo=next.js&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?logo=vercel)](https://geneground.vercel.app)

**[Live Demo](https://geneground.vercel.app)** · **[Demo Video](https://www.youtube.com/watch?v=aILeQ9WDXzs)** · **[Report an Issue](https://github.com/rheazhou2026/geneground/issues)**

---

## Table of Contents

- [The Problem](#the-problem)
- [What GeneGround Does](#what-geneground-does)
- [Key Features](#key-features)
- [Documentation](#documentation)
- [How It Works](#how-it-works)
- [Verdict Taxonomy](#verdict-taxonomy)
- [Tech Stack](#tech-stack)
- [Architecture at a Glance](#architecture-at-a-glance)
- [Getting Started](#getting-started)
- [Usage](#usage)
- [Project Structure](#project-structure)
- [Demo Dataset](#demo-dataset)
- [Roadmap](#roadmap)
- [Acknowledgments](#acknowledgments)
- [License](#license)

---

## The Problem

Researchers increasingly rely on LLMs to summarize and interpret large omics datasets — but those summaries are not always faithful to the underlying statistics. A model might:

- Call a gene a **"top regulator"** when its effect size is marginal
- **Reverse the direction** of a regulatory relationship
- Treat a **non-significant association** as biologically meaningful
- Turn a **weak pathway enrichment signal** into a confident mechanistic claim

In a Perturb-seq or single-cell workflow, these are not cosmetic errors — they can change which genes get prioritized for follow-up, which pathways are investigated, and which hypotheses move into real experiments.

This gap between AI enthusiasm and AI trust is well documented:

- **77%** of life sciences labs expect to use AI within the next two years, and AI remains the #1 lab investment priority for the third year running — yet **34%** now cite a lack of skilled people as a barrier to adoption, up from 23% the year before ([Pistoia Alliance, 2025 Lab of the Future Survey](https://pistoiaalliance.org/news/survey-ai-adoption-life-sciences-labs-skills-gap/)).
- Only **22%** of life-sciences leaders report having successfully scaled AI, and just **9%** report significant returns on their AI investment ([Deloitte, 2026 Life Sciences Outlook](https://www.deloitte.com/us/en/insights/industry/health-care/life-sciences-and-health-care-industry-outlooks/2026-life-sciences-executive-outlook.html)).

Science is becoming increasingly data-rich, and analysis — not data collection — is now the bottleneck. Gladstone's Data Science and Biotechnology Institute frames its own mission around exactly this challenge: building "new technologies and platforms that enable researchers to extract useful knowledge from the massive data sets collected from modern experiments" ([Gladstone Institutes](https://gladstone.org/science/data-science-and-biotechnology-institute)). As AI-assisted interpretation becomes embedded in that pipeline, the same auditing expectations that are emerging around high-stakes clinical AI will inevitably extend to computational biology: the ability to trace a claim back to data, check it against known biology, and document that check as part of the scientific record.

GeneGround exists to make that auditing step fast, structured, and trustworthy — turning AI-generated interpretation from an opaque narrative block into a set of testable, evidence-linked units.

## What GeneGround Does

GeneGround ingests two things from a computational biologist's workflow:

1. **The analysis output** — a ranked gene table with effect sizes, p-values, FDR values, perturbation labels, and pathway annotations.
2. **The AI-generated interpretation** — the plain-language summary Claude (or any LLM) produced about which genes and pathways matter.

It then:

- Breaks the interpretation into **discrete, traceable biological claims**
- **Normalizes** every gene, pathway, cell type, condition, and direction mentioned against standard ontologies (HGNC, Reactome, Cell Ontology)
- Routes each claim to **four specialized evaluation agents** that independently check it against perturbation evidence, pathway signatures, robustness/quality flags, and language-causality risk
- Cross-references high-confidence claims against **published literature priors** via a Claude Science literature-grounding layer
- Returns a **claim-by-claim verdict** — supported, supported with caveats, partially supported, overstated, unsupported, insufficient evidence, or needs review — with the exact data rows and citations used to reach that verdict
- Lets the researcher **interactively re-check or rewrite** any sentence in real time, with every proposed edit backed by an approvable, revertible action plan

The goal isn't to replace the scientist's judgment — it's to give them an evidence-linked review layer before an AI-generated interpretation shapes a paper, a grant, or a downstream experiment.

## Key Features

- **Claim-level decomposition** — every sentence in an AI-written interpretation is parsed into atomic, individually checkable biological claims, each traceable back to its exact character span in the original text.
- **Deterministic entity normalization** — genes, pathways, cell types, conditions, and directional language are normalized against HGNC, Reactome, and Cell Ontology (CL Basic), with manual alias overrides and curated immune-signature tables as fallbacks.
- **Four independent evaluation agents** — `perturbation_evidence`, `pathway_signature`, `robustness_quality`, and `language_causality` each render an independent verdict, so no single agent can unilaterally validate a claim.
- **Five specialized RAG indexes** — an Artifact Discovery Agent classifies every file in a research handoff folder (perturbation evidence, pathway evidence, robustness evidence, language rules, provenance) so no agent has to parse the entire corpus for every claim.
- **Cost-efficient local retrieval** — a lexical TF-IDF vector search runs entirely locally as a fallback layer; because omics terminology is highly structured, metadata filtering does most of the retrieval work, and no external vector database is required.
- **Literature-grounding layer** — high-confidence claims are cross-checked against published biological priors via Claude Science, distinguishing "statistically supported and consistent with known biology" from "statistically supported but speculative" or "in tension with the literature."
- **Full end-to-end traceability** — every verdict can be traced sentence → claim → agent query → evidence chunk, with the retrieval mode and reasoning recorded at each hop.
- **Interactive, real-time annotation** — select or double-click any sentence in the rewritten interpretation to check it against grounded evidence or ask a follow-up question in a claim-aware chat.
- **Auditable, revertible edits** — every AI-proposed rewrite is issued as an action plan the user can approve, cancel, or edit before it's applied, with a one-click revert to the previous version.

## Documentation

Two companion docs define the exact backend spec and controlled vocabularies the app is built against:

| Doc | What it covers |
|---|---|
| [`docs/geneground-backend-logic.md`](https://github.com/rheazhou2026/geneground/blob/main/docs/geneground-backend-logic.md) | The full stage-by-stage backend spec: every pipeline step, whether it's deterministic or Claude-powered, and the exact JSON each step outputs (claim extraction, entity normalization, artifact discovery, agent query planning, retrieval, four-agent evaluation, final verdict, interactive annotation, chat, and action plans). |
| [`docs/geneground-taxonomies.md`](https://github.com/rheazhou2026/geneground/blob/main/docs/geneground-taxonomies.md) | The canonical controlled vocabularies referenced throughout the backend logic doc and this README: condition mapping rules, the 15-type claim taxonomy, direction/strength/causal word dictionaries, gene/pathway `Source` and `Match_type` values, artifact-type classification + RAG index routing, `Evidence_type` and `Quality_flags` taxonomies, retrieval modes, agent-level and final verdict rules, and rewrite behavior. |

## How It Works

GeneGround's pipeline is deliberately split between **deterministic steps** (fast, reproducible, rule-based) and **Claude-powered steps** (reasoning-heavy, used only where judgment is actually required). Twelve stages carry a claim from raw text to a fully rewritten, evidence-linked interpretation:

| # | Stage | Type | What Happens |
|---|-------|------|--------------|
| 1 | **Claim Extraction** | Claude API | Individual biological claims are extracted from the pasted omics interpretation, each tagged with a claim type, raw entities, and language flags (strength/causal words). |
| 2 | **Interpretation ↔ Claim Map** | Deterministic | Every claim is linked back to its source sentence and exact character span, forming the first sentence → claim bridge. |
| 3 | **Entity Normalization** | Deterministic | Raw genes, pathways, conditions, cell types, and direction are normalized against HGNC, Reactome, and Cell Ontology. |
| 4 | **Normalized Claim Entities** | Deterministic | Claims are finalized with fully normalized entities (plus warnings), giving the retriever the exact terms it needs to find evidence. |
| 5 | **Artifact Discovery** | Deterministic | Every file in the user's research handoff folder is classified by artifact type and routed to one of five evidence indexes, with a priority and reason attached. |
| 6 | **Agent Query Planning** | Deterministic | Four agent-specific queries are generated per claim — `perturbation_evidence`, `pathway_signature`, `robustness_quality`, `language_causality` — each with its own filters and guiding question. |
| 7 | **Evidence Chunk Indexing** | Deterministic | Each artifact index is chunked into small, retrievable evidence units with both raw and normalized metadata, plus an embedding-ready sentence summarizing the chunk. |
| 8 | **Chunk Retrieval** | Deterministic | A three-tier retrieval strategy — exact metadata match → partial metadata + vector fallback → full TF-IDF lexical vector search — pulls the actual evidence chunks for each agent query. |
| 9 | **Four-Agent Evaluation** | Claude API (1 call/claim) | All four agents evaluate the claim against their retrieved evidence in a single call and each render a verdict, rationale, and any warnings. |
| 10 | **Final Verdict & Rewrite** | Deterministic + Claude | A rules-based taxonomy combines the four agent verdicts into one final verdict per claim, and a safely rewritten version of the claim is generated and compiled into a fully rewritten interpretation. |
| 11 | **Interactive Selection** | Deterministic | The user selects or double-clicks text in the rewritten interpretation; the selection is mapped back to its sentence and claim IDs. |
| 12 | **Grounded Chat & Action Plans** | Claude API | A claim-aware chatbot answers questions or proposes an approvable, editable, revertible action plan to rewrite the selection using the same evidence chunks. |

Every stage is chained by ID — `sentence_id → claim_id → agent_query_id → chunk_id` — so any final verdict can be traced all the way back to the exact data row, statistic, or literature reference that produced it.

**Example: an agent query plan for a single claim**

```json
{
  "claim_id": "claim_001",
  "agent_queries": {
    "pathway_signature": {
      "agent_query_id": "claim_001__pathway_signature",
      "index_type": "pathway_signature_index",
      "filters": {
        "target_gene_symbol": "STAT1",
        "pathway_keywords": ["interferon"],
        "conditions": ["Stim8hr", "Stim48hr"],
        "direction": "down"
      },
      "question": "Did STAT1 perturbation show down evidence for interferon pathway/signature activity in Stim8hr or Stim48hr cells?"
    }
  }
}
```

**Example: a final claim-level verdict**

```json
{
  "Claim_ID": "claim_001",
  "original_claim_text": "STAT1 knockout suppresses interferon signaling.",
  "final_verdict": "supported_with_caveats",
  "Reason": "Transcriptomic evidence supports a decrease in interferon-response signatures, but the wording implies a direct suppressive mechanism that the dataset alone does not establish.",
  "Rewritten_Claim": "STAT1 knockout is associated with decreased interferon-response signatures.",
  "evidence_basis": {
    "dataset_grounded": true,
    "chunk_ids_by_agent": {
      "perturbation_evidence": ["STAT1_Stim8hr_DE_001"],
      "pathway_signature": ["STAT1_Stim8hr_IFN_001"],
      "language_causality": ["LANG_SUPPRESSES_001"]
    }
  }
}
```

## Verdict Taxonomy

Every claim resolves to exactly one of the following final verdicts:

| Verdict | Meaning |
|---|---|
| `supported` | Fully consistent with the dataset and, where applicable, published literature. |
| `supported_with_caveats` | Statistically supported, but the wording overstates certainty or mechanism. |
| `partially_supported` | Some but not all components of a compound claim hold up. |
| `overstated` | The underlying effect is real but meaningfully smaller/weaker than claimed. |
| `unsupported` | Not borne out by the dataset. |
| `insufficient_evidence` | No relevant evidence chunk was retrievable to evaluate the claim. |
| `needs_review` | Agents disagree or the claim requires human judgment. |

*(Note: earlier iterations of the pipeline included numeric confidence scores per claim; these were deliberately removed in favor of a discrete verdict + rationale, since confidence scores tended to obscure rather than clarify the actual basis for a judgment.)*

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js](https://nextjs.org/) (full-stack React) |
| Language | [TypeScript](https://www.typescriptlang.org/) |
| UI | [React](https://react.dev/) — claim cards, grounded rewrite view, review assistant, technical pipeline view, evidence trace explorer |
| Styling | [Tailwind CSS](https://tailwindcss.com/) |
| AI Reasoning | [Claude Code](https://www.anthropic.com/claude-code) + [Claude Science](https://www.anthropic.com/news/claude-science-ai-workbench) (Anthropic) |
| Retrieval | Local lexical TF-IDF vector search (no external vector database) |
| Ontology References | HGNC (genes), Reactome (pathways), Cell Ontology / CL Basic (cell types) |
| Deployment | [Vercel](https://vercel.com/) |

## Architecture at a Glance

```
 INPUT A: AI-Generated Interpretation      INPUT B: Research Handoff Folder
            │                                          │
            ▼                                          ▼
 ┌───────────────────────────┐            ┌───────────────────────────┐
 │ 1. Claim Extraction        │            │ 5. Artifact Discovery     │
 │    (Claude)                │            │    Agent → 5 RAG indexes  │
 └────────────┬───────────────┘            └────────────┬───────────────┘
              ▼                                          ▼
 ┌───────────────────────────┐            ┌───────────────────────────┐
 │ 2–4. Sentence/Claim Map +  │            │ 7. Evidence Chunking      │
 │ Entity Normalization       │            │    (deterministic)        │
 │    (deterministic)         │            └────────────┬───────────────┘
 └────────────┬───────────────┘                          │
              ▼                                          │
 ┌───────────────────────────┐                           │
 │ 6. Agent Query Plan        │                           │
 │    (deterministic)         │───────────────────────────┘
 └────────────┬───────────────┘
              ▼
 ┌───────────────────────────────────────────────────────┐
 │ 8. Chunk Retrieval — metadata match → TF-IDF fallback  │
 └────────────────────────────┬────────────────────────────┘
                              ▼
 ┌───────────────────────────────────────────────────────┐
 │ 9. Four Evaluation Agents (1 Claude call per claim)    │
 │    perturbation · pathway · robustness · causality     │
 └────────────────────────────┬────────────────────────────┘
                              ▼
 ┌───────────────────────────────────────────────────────┐
 │ 10. Final Verdict + Rewritten Claim                    │
 │     (deterministic rules + Claude)                     │
 └────────────────────────────┬────────────────────────────┘
                              ▼
 ┌───────────────────────────────────────────────────────┐
 │ 11–12. Interactive Annotation, Grounded Chat,          │
 │        Approvable / Revertible Action Plans            │
 └─────────────────────────────────────────────────────────┘
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18.17 or later
- An [Anthropic API key](https://console.anthropic.com/) with access to Claude (and Claude Science, if using the literature-grounding layer)

### Installation

```bash
# Clone the repository
git clone https://github.com/rheazhou2026/geneground.git
cd geneground

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
```

Add your credentials to `.env.local`:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

### Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

### Build for production

```bash
npm run build
npm run start
```

## Usage

1. **Upload or paste your analysis output** — a ranked gene table (CSV/TSV) with columns for gene symbol, effect size, p-value, FDR, perturbation label, and pathway annotation.
2. **Paste the AI-generated interpretation** you want checked — the plain-language summary you'd otherwise drop straight into a paper or presentation.
3. **(Optional) Attach a research handoff folder** — any supporting artifacts (perturbation results, pathway evidence, robustness/QC reports, provenance notes) that GeneGround's Artifact Discovery Agent can index as additional evidence.
4. **Run GeneGround** — the pipeline parses your interpretation into claims, retrieves relevant evidence, runs all four evaluation agents, and returns a claim-by-claim grounding report alongside a fully rewritten, safer version of your interpretation.
5. **Interact with the result** — select any sentence in the rewritten interpretation to inspect its evidence trail, ask a follow-up question, or request a rewrite. Every proposed change can be approved, edited, cancelled, or reverted.

## Project Structure

```
geneground/
├── app/                    # Next.js app router — pages & API routes
│   ├── api/                # Backend endpoints (claim extraction, agent evaluation, chat)
│   └── (routes)/           # UI routes: upload, report, evidence trace
├── components/             # React components — claim cards, evidence viewer, chat panel
├── lib/
│   ├── agents/             # Four evaluation agents + prompt templates
│   ├── ontology/           # HGNC / Reactome / Cell Ontology normalization helpers
│   ├── retrieval/          # Artifact indexing + TF-IDF lexical vector search
│   └── pipeline/           # Deterministic pipeline stages (steps 2–8, 10–11)
├── public/                 # Static assets
├── .env.example            # Environment variable template
└── package.json
```

## Demo Dataset

GeneGround's initial demo and evaluation case uses the **T cell Perturb-seq dataset** from Gladstone Institutes and UCSF ([GEO: GSE278572](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE278572)) — a genome-scale CRISPR perturbation screen paired with single-cell RNA-seq across hundreds of thousands of T cells. This is exactly the kind of high-dimensional, high-stakes screen where researchers are most tempted to lean on LLMs for interpretation — and where a wrong "top regulator" call or a flipped direction of effect can send follow-up experiments in the wrong direction.

## Roadmap

- [ ] Extend claim-level grounding beyond Perturb-seq to bulk RNA-seq and proteomics workflows
- [ ] Broaden ontology coverage (e.g., ChEBI, Gene Ontology) alongside HGNC/Reactome/Cell Ontology
- [ ] Team/lab collaboration mode for shared review of grounding reports
- [ ] Exportable, citation-complete grounding reports for inclusion in papers and grant appendices
- [ ] Deeper Claude Science literature-grounding integration for automatic prior-art surfacing

## Acknowledgments

GeneGround was built for the **Built with Claude: Life Sciences** hackathon, extending the claim-level grounding and audit principles originally developed for [Vellum](https://github.com/rheazhou2026), an AI validation platform for clinical documentation, into life sciences research workflows. It is powered by [Claude Code and Claude Science](https://www.anthropic.com/news/claude-science-ai-workbench) and demoed on the Gladstone/UCSF T cell Perturb-seq dataset ([GSE278572](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE278572)), in the spirit of [Gladstone's Data Science and Biotechnology Institute](https://gladstone.org/science/data-science-and-biotechnology-institute) mission to turn data-rich experiments into useful biological knowledge.

## License

This project is licensed under the [MIT License](./LICENSE).

---

Built by [Rhea Zhou](https://github.com/rheazhou2026) · [Live Demo](https://geneground.vercel.app) · [Demo Video](https://www.youtube.com/watch?v=aILeQ9WDXzs)
