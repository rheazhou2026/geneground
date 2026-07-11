# GeneGround

**Claim-level grounding for AI-generated omics interpretations.**

GeneGround audits AI-generated biological interpretations against Claude Science evidence. It decomposes an omics interpretation into individual claims, retrieves relevant evidence from a Claude Science handoff, flags unsupported or overstated language, and produces an evidence-linked grounded rewrite.

**Live demo:** https://geneground.vercel.app  
**GitHub:** https://github.com/rheazhou2026/geneground  

Built for **Built with Claude: Life Sciences** as a Builder track project.

---

## Why GeneGround

AI can now write fluent biological interpretations, but fluency is not the same as evidence.

In high-dimensional workflows like Perturb-seq and single-cell analysis, an AI-generated summary might correctly describe a gene-expression pattern while subtly overreaching into claims about regulatory roles, mechanisms, or distinct biological programs. Those wording differences matter: they can influence which genes researchers prioritize, which experiments they run next, and which narratives make it into papers or grant proposals.

GeneGround is designed for that gap. It turns AI-generated omics narratives into auditable, claim-level scientific objects.

---

## What GeneGround does

GeneGround takes:

- an AI-generated omics interpretation
- a Claude Science handoff zip
- evidence packets from a Perturb-seq analysis

and returns:

- a **grounded rewritten interpretation**
- **claim-level verdicts** such as `supported_with_caveats`, `partially_supported`, and `overstated`
- an interactive **claim audit panel**
- a transparent **technical pipeline**
- an **evidence trace** linking each verdict back to the exact chunks used by the agents

The goal is not to replace the scientist. The goal is to make AI-assisted scientific interpretation easier to inspect, challenge, and revise.

---

## Demo example

The live demo uses a primary human CD4+ T cell Perturb-seq interpretation involving CRISPRi perturbations of transcription factors including **NFKB2**, **GATA3**, **STAT1**, and **BATF**.

GeneGround identifies that most claims are supported with caveats, while more interpretive language receives stricter treatment. For example:

- a broad NFKB2 differential-expression claim is marked **supported with caveats**
- a regulatory-role inference is marked **partially supported**
- a synthesis claim about “distinct arms” of the CD4+ T cell response is marked **overstated**
- methodological caveats about pseudobulk DE and CRISPRi knockdown are preserved

This demonstrates the core behavior: GeneGround does not simply approve or reject an entire interpretation. It checks where each claim sits relative to the evidence.

---

## How it works

GeneGround combines deterministic infrastructure with Claude-powered reasoning.

### 1. Claim extraction

Claude extracts biological claims from the pasted interpretation, including perturbation effects, pathway claims, robustness claims, and higher-level biological interpretations.

### 2. Biological normalization

GeneGround deterministically normalizes biological entities:

- genes → HGNC symbols
- pathways → Reactome or curated immune signatures
- conditions → dataset values such as `Rest`, `Stim8hr`, and `Stim48hr`
- directions → standardized values such as `up`, `down`, or `changed`

This creates structured search keys for retrieval.

### 3. Evidence indexing

The Claude Science handoff is parsed into evidence indexes:

- perturbation evidence
- pathway/signature evidence
- robustness and QC evidence
- provenance
- claim wording rules

Instead of asking a model to reread entire files, GeneGround packages the handoff into small evidence chunks with metadata.

### 4. Evidence retrieval

For each claim, GeneGround retrieves relevant evidence chunks using metadata matching first. When metadata alone is not enough, it falls back to local TF-IDF retrieval over embedding-ready chunk summaries.

This keeps retrieval fast, transparent, and cost-efficient.

### 5. Specialist agent evaluation

Each claim is evaluated by specialist Claude-powered agents:

- **Perturbation Evidence Agent**
- **Pathway Signature Agent**
- **Robustness Quality Agent**
- **Language Causality Agent**

Claude only sees the retrieved evidence chunks for the claim, not the entire dataset.

### 6. Deterministic final verdict

Final verdicts are assigned by deterministic aggregation rules based on the specialist agent outputs.

The user-facing verdicts are:

- `supported`
- `supported_with_caveats`
- `partially_supported`
- `overstated`
- `unsupported`
- `insufficient_evidence`
- `needs_review`

This keeps the final classification auditable instead of making it another black-box judgment.

---

## Claude usage

GeneGround uses Claude in three layers.

### Claude Science

Claude Science was used to explore the Perturb-seq analysis and generate the scientific artifacts that become the evidence layer for GeneGround.

### Claude Code

Claude Code was used to build and iterate the full application, including the Next.js interface, evidence pipeline, Claude API routes, review UI, and deployment-ready polish.

### Claude API

Inside the product, Claude powers:

- claim extraction
- specialist agent evaluations
- natural-language rationales
- grounded rewrites
- interactive review/chat actions

Deterministic code handles normalization, evidence indexing, retrieval, provenance, and final verdict aggregation.

The key design choice is that Claude performs biological reasoning only after GeneGround has constrained the context to retrieved evidence.

---

## Product features

- **Chat-style input** for pasted omics interpretations
- **Claude Science handoff upload**
- **Grounded rewrite** with highlighted claim spans
- **Claim-level audit cards**
- **Interactive review assistant** for selected text
- **Action plans** for cautious rewrites
- **Technical pipeline** showing extraction, indexing, retrieval, and API usage
- **Evidence trace** from sentence → claim → agent query → evidence chunk
- **Source provenance** for evidence layers and underlying analysis artifacts

---

## Tech stack

- **Next.js**
- **TypeScript**
- **Claude API**
- **Tailwind CSS**
- **Deterministic retrieval and verdict aggregation**
- **Local TF-IDF fallback retrieval**
- **Vercel deployment**

---

## Running locally

Clone the repository:

```bash
git clone https://github.com/rheazhou2026/geneground.git
cd geneground
```

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env.local
```

Add your Claude API key:

```bash
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_MODEL=claude-sonnet-5
NEXT_PUBLIC_GENEGROUND_USE_CLAUDE_API=true
```

Run the development server:

```bash
npm run dev
```

Then open:

```bash
http://localhost:3000
```

---

## Deployment

GeneGround is deployed on Vercel:

```text
https://geneground.vercel.app
```

For production deployment, set:

```bash
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_MODEL=claude-sonnet-5
NEXT_PUBLIC_GENEGROUND_USE_CLAUDE_API=true
```

---

## Project status

GeneGround is an MVP prototype built for the **Built with Claude: Life Sciences** hackathon. The current demo focuses on Perturb-seq claim grounding using a compact Claude Science evidence handoff.

Future directions include:

- literature grounding through scientific connectors
- broader omics dataset support
- richer evidence provenance
- workspace-level saved runs
- exportable audit reports for scientific review

---

## License

MIT License
