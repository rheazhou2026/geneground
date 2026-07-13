# GeneGround Backend Logic

This document defines the full backend JSON logic for GeneGround: what each pipeline stage computes, which stages are deterministic versus API-powered, and how stages connect via `sentence_id` / `claim_id` / `agent_query_id` / `chunk_id` traceability. Controlled vocabularies, dictionaries, and deterministic templates referenced throughout (`Source`, `Match_type`, `Evidence_type`, `Quality_flags`, `retrieval_mode`, agent-level verdicts, `final_verdict`, and the `Text_for_embedding` / `AgentQueryPlan` question templates) are defined in [`docs/geneground-taxonomies.md`](./geneground-taxonomies.md) — this document is the source of truth for how the pipeline stages connect; the taxonomy document is the source of truth for the exact controlled values.

Implementation rules:

- Do not invent new JSON stages.
- Do not change the core logic in this document.
- Taxonomy labels are defined separately in `docs/geneground-taxonomies.md`.
- Field names may be converted to code-friendly camelCase internally if needed, but output JSON should preserve the documented structure unless explicitly changed.
- Literature grounding review (Step 12) is intentionally deferred.

## Processing Method by Stage

| Stage | Processing method |
| ----- | ----- |
| Step 1 — Claim extraction | API |
| Step 2 — InterpretationClaimMap | Deterministic |
| Step 3A — Raw entity categorization and ontology normalization | Deterministic |
| Step 3B — Normalized claim JSON | Deterministic |
| Step 4 — Artifact Discovery Agent | Deterministic |
| Step 5 — AgentQueryPlan | Deterministic |
| Step 6 — Artifact indexes and potential chunk identification | Deterministic |
| Step 7 — Evidence retrieval | Deterministic (metadata-first, with local TF-IDF vector fallback) |
| Step 7B — Four agent evaluations | API |
| Step 8 — `final_verdict` label | Deterministic |
| Step 8 — `Reason` and `Rewritten_Claim` | API |
| Step 9 — TextSelectionContext | Deterministic |
| Step 10 — Interactive chat thread | API |
| Step 11 — Review action plan | API |
| Step 12 — Literature grounding review | Deferred (not implemented) |

---

## User-Facing Progress Stages

The `/demo` UI shows **6** plain-language progress stages instead of the raw step numbers above. This mapping is UI presentation only — it does not change what each backend step computes.

1. Reading interpretation — input parsing + sentence splitting, plus the Claude Science handoff branch running internally (Step 4 Artifact Discovery, Step 6 evidence indexing / chunk metadata normalization / `Text_for_embedding` generation).
2. Extracting biological claims — Step 1 (API claim extraction) + Step 2 (deterministic InterpretationClaimMap).
3. Normalizing genes, pathways, cells, and conditions — Step 3A/3B (deterministic mini ontology normalization).
4. Retrieving relevant evidence chunks — Step 5 (`AgentQueryPlan`) + Step 7 (`metadata_exact` / `metadata_partial` / local TF-IDF vector fallback retrieval).
5. Evaluating claims with specialist agents — Step 7B (API four-agent evaluation).
6. Generating grounded rewrite — Step 8 (`final_verdict` deterministic aggregation + API `Reason`/`Rewritten_Claim`).

Artifact discovery and evidence indexing (Step 4 and Step 6) still run — they are not skipped — but they are **not a separate visible stage**. The UI folds them into stage 1 ("Reading interpretation") because, from the user's point of view, indexing the Claude Science handoff bundle is part of getting the interpretation ready to check, not a distinct step they need to track. Internally, the pipeline still models this as two concurrent branches that merge before retrieval — an interpretation branch (Interpretation → Claim extraction → Entity normalization) and a Claude Science handoff branch (Handoff → Artifact discovery → Evidence indexing) — and the underlying node statuses for both branches are tracked individually; only the coarser 6-stage grouping shown to the user folds the handoff branch's three nodes into stage 1.

---

## Step 1 — Claim Extraction

Individual claims are extracted from the user's pasted omics analysis.

A claim is a biological claim either expressed as a full sentence or as part of a sentence.

The claim extraction agent outputs the following JSON:

```json
{
  "Interpretation_id": "",
  "Claims": [
    {
      "Claim_id": "",
      "Original_text": "",
      "Claim_type": "",
      "Raw_Entities": {
        "Genes": [],
        "Pathways": [],
        "Cell": [],
        "Conditions": [],
        "Direction": []
      },
      "Language_Flags": {
        "Strength_Words": [],
        "Causal_Words": []
      }
    }
  ]
}
```

### Notes

- `Claim_type` is chosen from the taxonomy rules ("Claim Type for Language Causality Agent").
- `Claim_type` is used for `AgentQueryPlan`, especially by the `language_causality` agent.
- `Strength_Words` are used by the `language_causality` agent.
- `Causal_Words` are used by the `language_causality` agent.

---

## Step 2 — InterpretationClaimMap

Simultaneously, GeneGround creates an `InterpretationClaimMap`.

This links sentences and claims so every claim keeps its corresponding sentence and position within that sentence.

This is the first bridge between the sentence and the claim.

```json
{
  "Interpretation_id": "",
  "Full_text": "",
  "Sentences": [
    {
      "Sentence_id": "",
      "Original_text": "",
      "Span_start": "",
      "Span_end": "",
      "Claim_IDs": []
    }
  ],
  "Claims": [
    {
      "Claim_id": "",
      "Sentence_id": "",
      "Original_text": ""
    }
  ]
}
```

### Notes

- One sentence can contain one claim or multiple claims.
- Every claim should trace back to a `Sentence_id`.
- `Span_start` and `Span_end` describe where the sentence starts and ends within the full text.

---

## Step 3A — Raw Entity Categorization and Ontology Normalization

The raw entities from claim extraction are extracted and categorized.

Then, based on the category, each entity is normalized against the ontology database.

```json
{
  "Genes": [
    {
      "Raw": "",
      "Normalized_symbol": "",
      "ID-System": "HGNC database"
    }
  ],
  "Pathways": [
    {
      "Raw": "",
      "Normalized_name": "",
      "Candidate_IDs": [],
      "Source": "Reactome | curated_immune_signature | Reactome + curated_immune_signature",
      "Warnings": []
    }
  ],
  "Conditions": [
    {
      "Raw": "",
      "Candidate_Dataset_Values": [],
      "Resolution": ""
    }
  ],
  "Cell_context": [
    {
      "Raw": "",
      "Cell_Type": "found from Cell Ontology database / CL Basic",
      "Condition_Candidates": []
    }
  ],
  "Direction": [
    {
      "Raw": "",
      "Normalized_Direction": ""
    }
  ]
}
```

### Notes

- `Genes` are normalized against the HGNC database.
- `Pathways` are normalized against Reactome.
- `Candidate_Dataset_Values` can include `Stim8hr`, `Stim48hr`, `Rest`.
- `Resolution` should be `ambiguous` if multiple possible dataset values apply, or the matching value if the condition resolves to one value.
- `Cell_Type` is found from the Cell Ontology database, specifically CL Basic.
- `Condition_Candidates` should match the relevant `Candidate_Dataset_Values`.
- `Normalized_Direction` is based on the direction dictionary from the taxonomy rules.

---

## Step 3B — Normalized Claim JSON

The claim becomes normalized while keeping its `Claim_id`.

This allows the normalized claim to be traced back to its original text and sentence.

This gives the retriever the key terms it needs to search the Claude Science files for evidence chunks.

```json
[
  {
    "Claim_id": "",
    "Normalized_entities": {
      "Genes": [
        {
          "Raw": "",
          "Normalized_symbol": "",
          "Source": "HGNC | manual_alias_override | unresolved",
          "Source_ID": "",
          "Match_type": "exact_symbol | alias_symbol | previous_symbol | manual_alias_override | unresolved",
          "Warnings": []
        }
      ],
      "Pathways": [
        {
          "Raw": "",
          "Normalized_name": "",
          "Candidate_IDs": [],
          "Source": "Reactome | curated_immune_signature | Reactome + curated_immune_signature | unresolved",
          "Match_type": "exact_name | alias | keyword | curated_fallback | unresolved",
          "Warnings": []
        }
      ],
      "Conditions": [
        {
          "Raw": "",
          "Candidate_Dataset_Values": [],
          "Resolution": "resolved | ambiguous | unresolved",
          "Warnings": []
        }
      ],
      "Cell_context": [
        {
          "Raw": "",
          "Cell_Type": "",
          "Source": "Cell Ontology | curated_fallback | unresolved",
          "Source_ID": "",
          "Condition_Candidates": [],
          "Warnings": []
        }
      ],
      "Direction": [
        {
          "Raw": "",
          "Normalized_Direction": "up | down | changed | ambiguous | unresolved",
          "Match_type": "curated_direction_dictionary | ambiguous | unresolved",
          "Warnings": []
        }
      ]
    }
  }
]
```

### Notes

- This stage preserves `Claim_id`.
- `Claim_id` links normalized entities back to the original claim text, the corresponding sentence, and later retrieved evidence chunks.
- `Source` indicates whether the pathway candidate came from Reactome, the curated immune signature dictionary, or both.
- Gene normalization checks the HGNC mini ontology first: approved symbols, alias symbols, and previous symbols. Manual alias overrides are used only as a fallback if HGNC does not yield a match — they never override a successful HGNC match.
- Warnings are included for every normalized entity category so ambiguity, fallback mappings, and normalization caveats are preserved at the claim level.
- `Source` is used only for `Genes` and `Pathways` — not `Cell_context`. Full `Source` and `Match_type` definitions for both are in the taxonomy rules: "Gene Source Values", "Pathway Source Values", and "Match Types for Genes and Pathways".

---

## Step 4 — Artifact Discovery Agent

While normalization is happening, the attached Claude Science handoff folder is given to the Artifact Discovery Agent.

The Artifact Discovery Agent classifies files and hands them to agent-specific RAG indexes.

This prevents each individual agent from parsing every single file in the attached handoff folder.

As each file is parsed, the following JSON is output:

```json
{
  "Project_id": "",
  "Artifact_manifest": [
    {
      "File_name": "",
      "Artifact_type": "",
      "Corresponding_Index": [],
      "Priority": "",
      "Reason": ""
    }
  ],
  "Ignored_files": [
    {
      "File_name": "",
      "Reason": ""
    }
  ]
}
```

### Notes

- `Artifact_type` is based on the taxonomy rules ("User-Inputted Handoff Folder File Artifact Type") and decided by keywords and file content.
- Artifact types can include: perturbation evidence, pathway evidence, robustness evidence, language rules, provenance, ontology reference, raw omics data, visualization, report.
- `Corresponding_Index` specifies which chunked index receives the file. Placement rules are defined in the taxonomy rules ("Artifact Index Placement Guidelines") and based on key phrases and artifact type.
- `Priority` is high, medium, or low, decided by both index and artifact type per the taxonomy rules.
- `Reason` is a one-line explanation. Ignored files also include a one-line reason.

---

## Step 5 — AgentQueryPlan

While each file is being parsed and categorized by the Artifact Discovery Agent, the `AgentQueryPlan` creates four query IDs.

Within each claim, there are four agent queries:

1. `perturbation_evidence`
2. `pathway_signature`
3. `robustness_quality`
4. `language_causality`

These are the four main biologist agents. The JSON below tells each agent what kind of evidence to retrieve.

This creates the chain:

```
sentence_id → claim_id → agent_query_id
```

The `question` field serves as a general guiding question for how each agent evaluates each claim. Questions are generated deterministically from fixed templates — see "Deterministic Question Templates for AgentQueryPlan" in the taxonomy document. Claude is not called to generate `AgentQueryPlan` questions.

```json
{
  "claim_id": "",
  "agent_queries": {
    "perturbation_evidence": {
      "Agent_query_id": "formatted as [claim number]_[agent categorization]",
      "index_type": "perturbation_evidence_index",
      "filters": {
        "target_gene_symbol": "",
        "conditions": []
      },
      "question": ""
    },
    "pathway_signature": {
      "Agent_query_id": "formatted as [claim number]_[agent categorization]",
      "index_type": "pathway_signature_index",
      "filters": {
        "target_gene_symbol": "",
        "pathway_keywords": ["interferon"],
        "conditions": ["Stim8hr", "Stim48hr"]
      },
      "question": ""
    },
    "robustness_quality": {
      "Agent_query_id": "formatted as [claim number]_[agent categorization]",
      "index_type": ["robustness_quality_index", "provenance_index"],
      "filters": {
        "target_gene_symbol": "",
        "conditions": ["Stim8hr", "Stim48hr"]
      },
      "question": ""
    },
    "language_causality": {
      "Agent_query_id": "formatted as [claim number]_[agent categorization]",
      "index_type": "language_rules_index",
      "filters": {
        "claim_type": "retrieve from Step 1 claim JSON",
        "strength_words": "retrieve from Step 1 claim JSON",
        "Causal_Words": "retrieve from Step 1 claim JSON"
      },
      "question": "Is the wording 'suppresses' justified by transcriptomic/pathway evidence?"
    }
  }
}
```

### Notes

- Each agent searches a different index.
- `claim_type`, `strength_words`, and `Causal_Words` are retrieved from Step 1.
- The robustness agent may use both `robustness_quality_index` and `provenance_index`.
- The query ID format is based on claim number and agent categorization.

---

## Step 6 — Artifact Indexes and Potential Chunk Identification

Once each non-ignored file from the user's input handoff folder has been placed into an artifact index, information about each index is stored.

Each claim ID is linked to the claim ID from the normalized entities JSON in Step 3B.

This helps identify the correct evidence chunks from the source artifacts.

Chunks are small pieces of relevant evidence cut from a larger file. Because Claude Science artifacts may be too large, the model should not read all of them every time.

The RAG system uses:

1. normalized ontology codes from Step 3
2. metadata filtering
3. semantic embedding retrieval using `Text_for_embedding` if needed

This file is linked to the `AgentQueryPlan`. The `AgentQueryPlan` identifies each claim, what to look for, and which index type to search — it also links directly to the normalized ontology entities JSON in Step 3.

In simple terms: potential chunk IDs are identified in this step based on what to search for and the normalized ontology codes from Steps 3 and 5. The next step (Step 7) pulls the actual chunk IDs from this potential set instead of searching entire files from the artifact indexes.

```json
{
  "Index_type": "",
  "Source_artifacts": [],
  "Chunks": [
    {
      "Chunk_id": "",
      "Metadata": {
        "Genes": [
          {
            "Raw": "",
            "Normalized_symbol": "",
            "Source": "HGNC | manual_alias_override | unresolved",
            "Source_ID": "",
            "Match_type": "exact_symbol | alias_symbol | previous_symbol | manual_alias_override | unresolved",
            "Warnings": []
          }
        ],
        "Pathways": [
          {
            "Raw": "",
            "Normalized_name": "",
            "Candidate_IDs": [],
            "Source": "Reactome | curated_immune_signature | Reactome + curated_immune_signature | unresolved",
            "Match_type": "exact_name | alias | keyword | curated_fallback | unresolved",
            "Warnings": []
          }
        ],
        "Conditions": [
          {
            "Raw": "",
            "Candidate_Dataset_Values": [],
            "Resolution": "resolved | ambiguous | unresolved",
            "Warnings": []
          }
        ],
        "Cell_context": [
          {
            "Raw": "",
            "Cell_Type": "",
            "Source": "Cell Ontology | curated_fallback | unresolved",
            "Source_ID": "",
            "Condition_Candidates": [],
            "Warnings": []
          }
        ],
        "Direction": [
          {
            "Raw": "",
            "Normalized_Direction": "up | down | changed | ambiguous | unresolved",
            "Match_type": "curated_direction_dictionary | ambiguous | unresolved",
            "Warnings": []
          }
        ],
        "Evidence_fields": {
          "Artifact_type": "",
          "File_name": "",
          "Evidence_type": "",
          "Statistics": {},
          "Quality_flags": []
        }
      },
      "Text_for_embedding": ""
    }
  ]
}
```

### Notes

- `Source_artifacts` are files placed into this index from Step 4.
- `Metadata` describes the evidence chunk itself — its own genes, pathways, conditions, cell context, and direction extracted from the source artifact — not the claim being verified. Claim-level normalized entities come from Step 3B; `AgentQueryPlan` matches Step 3B's normalized claim entities against this chunk-level `Metadata`.
- Step 6 metadata uses the same mini ontology normalization approach as Step 3B, but applies it to parsed artifact chunks instead of claim entities. This includes HGNC-first gene normalization with manual alias override fallback, Reactome-first pathway normalization with curated immune signature fallback, dataset-specific condition mapping, Cell Ontology cell context mapping, and direction normalization from the curated direction dictionary.
- `Evidence_type` describes what kind of scientific evidence the chunk contains; values and their meanings are defined in the taxonomy rules ("Evidence Type Taxonomy").
- `Statistics` stores quantitative or structured values extracted from the chunk. It is a flexible object, not a fixed taxonomy — see "Recommended Statistics Keys for Evidence Fields" in the taxonomy document for the expected keys per artifact type.
- `Quality_flags` stores warning labels that affect robustness or interpretation; values are defined in the taxonomy rules ("Quality Flags Taxonomy").
- The taxonomy rules also include a guidance table mapping likely `Evidence_type` values to each of the five artifact indexes ("Evidence_Type Values and Their Map to the Five Artifact Indexes"). It is guidance for deterministic chunk classification, not a replacement for the `Evidence_type` taxonomy.
- `Text_for_embedding` is generated deterministically from artifact type, chunk metadata, and structured payload using the fixed templates in the taxonomy document ("Deterministic Text_for_Embedding Templates for Each Artifact Index"). Claude is not called to generate embedding text. Missing fields are replaced with `"not specified"` rather than dropping the template. `Text_for_embedding` is plain text used for local vector search fallback (see Step 7); only plain text can be used for vector search.
- This stage identifies potential chunk IDs. Step 7 retrieves actual chunk IDs from that set.

---

## Step 7 — Retrieved Evidence

The `AgentQueryPlan`, with its claim ID, agent type, and agent query ID, is used to search the five artifact indexes:

1. `perturbation_evidence`
2. `pathway_signature`
3. `robustness_quality`
4. `language_rules`
5. `provenance`

These indexes are populated by the Artifact Discovery Agent.

Retrieval pulls the actual chunks for each claim from the Step 6 chunk pool — it does not search raw source files. Retrieval is metadata-first: `AgentQueryPlan`'s filters, built from Step 3B's normalized claim entities, are matched against each candidate chunk's Step 6 `Metadata`. If metadata matching is insufficient, a local TF-IDF vector fallback runs over `Text_for_embedding`.

Retrieval order:

1. `metadata_exact`
2. `metadata_partial`
3. `local_vector_fallback`
4. `hybrid_metadata_and_local_vector`

For vector fallback, GeneGround does not embed raw uploaded JSON/CSV/Markdown files. Step 6 first turns each chunk into deterministic `Text_for_embedding` using fixed templates. Step 7 then turns the `AgentQueryPlan` question plus filters into query text and compares that query text against each candidate chunk's `Text_for_embedding` using local TF-IDF cosine similarity. This is provider-free local vector search — not Claude embeddings and not an external vector database. It is a fallback/helper after metadata retrieval, used only when metadata retrieval finds too little or needs semantic backup.

Manual gene aliases and pathway aliases should be included in query text expansion when available, to improve local vector fallback matching.

TF-IDF similarity scores are not exposed in the output JSON: there is no similarity_score field anywhere in this pipeline. Retrieval explains matches using `retrieval_mode` and `retrieval_reasons` instead.

Retrieved results store:

- claim ID
- agent type
- agent query ID from `AgentQueryPlan`
- chunk IDs
- retrieval mode
- retrieval reasons

The chunk IDs come directly from the JSON in Step 6.

This tells the `AgentQueryPlan` where to search instead of making agents search the entire artifact index for each claim.

This creates the trace:

```
sentence_id → claim_id → agent_query_id → chunk_id
```

```json
{
  "claim_id": "claim_001",
  "agent_evidence": {
    "perturbation_evidence": {
      "agent_query_id": "claim_001__perturbation_evidence",
      "retrieved_chunks": [
        {
          "chunk_id": "STAT1_Stim8hr_DE_001",
          "index_type": "perturbation_evidence_index",
          "retrieval_mode": "metadata_exact",
          "retrieval_reasons": [
            "Matched target_gene_symbol = STAT1",
            "Matched condition = Stim8hr"
          ]
        },
        {
          "chunk_id": "STAT1_Stim48hr_DE_001",
          "index_type": "perturbation_evidence_index",
          "retrieval_mode": "metadata_partial",
          "retrieval_reasons": [
            "Matched target_gene_symbol = STAT1",
            "Included because condition 'stimulated' maps to Stim48hr"
          ]
        }
      ]
    },
    "pathway_signature": {
      "agent_query_id": "claim_001__pathway_signature",
      "retrieved_chunks": [
        {
          "chunk_id": "STAT1_Stim8hr_IFN_001",
          "index_type": "pathway_signature_index",
          "retrieval_mode": "metadata_exact",
          "retrieval_reasons": [
            "Matched target_gene_symbol = STAT1",
            "Matched pathway keyword = interferon",
            "Matched direction = down"
          ]
        }
      ]
    }
  }
}
```

A single retrieved chunk has this shape:

```json
{
  "chunk_id": "",
  "index_type": "",
  "retrieval_mode": "metadata_exact | metadata_partial | local_vector_fallback | hybrid_metadata_and_local_vector | not_retrieved",
  "retrieval_reasons": []
}
```

### Notes

- `chunk_id` and `index_type` are identified from Step 6.
- `retrieval_mode` records which retrieval order step (see above) produced this chunk. Values are defined in the taxonomy rules ("Retrieval Mode Taxonomy").
- `retrieval_reasons` explain why a specific chunk was chosen, generated from the fixed templates in the taxonomy rules ("Retrieval Reason Template Taxonomies"). This makes evidence traceability possible.
- No `similarity_score` field is included anywhere in this JSON.

---

## Step 7B — Four Agent Evaluations

Each claim is evaluated by four API-powered agents using only the chunks retrieved in Step 7.

The agents compare the original claim, normalized claim entities, language flags, and retrieved evidence chunks.

Each agent returns an internal verdict, rationale, chunk_ids, and warnings.

Claude API is used here because this step requires semantic judgment about whether the retrieved evidence supports, weakly supports, contradicts, or is insufficient for each part of the claim. One API evaluation per claim returns all four agent results — this is one API call per claim, not four separate API calls.

Claude evaluates only retrieved chunks. Claude must not:

- invent chunk_ids
- invent verdict labels
- invent agent names
- choose the final user-facing `final_verdict`
- override deterministic normalization
- search raw handoff files directly

```json
{
  "claim_id": "",
  "agent_results": {
    "perturbation_evidence": {
      "agent": "perturbation_evidence",
      "verdict": "supports | supports_with_caveats | weak_support | contradicts | insufficient_evidence | not_applicable | needs_review",
      "rationale": "",
      "chunk_ids": [],
      "warnings": []
    },
    "pathway_signature": {
      "agent": "pathway_signature",
      "verdict": "supports | supports_with_caveats | weak_support | contradicts | insufficient_evidence | not_applicable | needs_review",
      "rationale": "",
      "chunk_ids": [],
      "warnings": []
    },
    "robustness_quality": {
      "agent": "robustness_quality",
      "verdict": "supports | supports_with_caveats | weak_support | contradicts | insufficient_evidence | not_applicable | needs_review",
      "rationale": "",
      "chunk_ids": [],
      "warnings": []
    },
    "language_causality": {
      "agent": "language_causality",
      "verdict": "supports | supports_with_caveats | weak_support | contradicts | insufficient_evidence | not_applicable | needs_review",
      "rationale": "",
      "chunk_ids": [],
      "warnings": []
    }
  }
}
```

### Notes

- `chunk_ids` must be a subset of the chunk_ids retrieved in Step 7 for that agent query. If an agent uses no chunk evidence, `chunk_ids` should be empty and the verdict should usually be `insufficient_evidence`, `not_applicable`, or `needs_review`.
- The verdicts in this step are internal agent-level verdicts. They are not the final user-facing claim verdict. The final claim verdict is computed deterministically in the next step using the final verdict aggregation taxonomy.
- Agent names and verdict labels are defined in the taxonomy rules ("Agent-Level Verdict Guidelines" and "Agent-Level Verdicts by Agent").
- This step's field name is `chunk_ids`, not `supporting_chunk_ids`.

---

## Step 8 — Final Claim Verdict and Rewritten Claim

Each claim is compared against the retrieved chunks from Step 7.

Each claim is marked with one of the following final verdicts:

- supported
- supported_with_caveats
- partially_supported
- overstated
- unsupported
- insufficient_evidence
- needs_review

The `final_verdict` label is a deterministic final verdict computed from the "Claim-Level Verdict Guidelines" taxonomy rules — it is never chosen or overridden by the API.

Confidence scores are intentionally removed because they are not helpful for the final user-facing output and can make scoring more confusing.

All `Rewritten_Claims` are compiled to create a fully rewritten omics analysis that the user can interact with in Step 9.

`Claim_results` also carries the full per-agent `agent_results` detail from Step 7B forward (verdict, rationale, chunk_ids, warnings for each of the four agents), plus `retrieval_modes_by_agent`, so the UI's claim-level audit panel and evidence trace view can render agent-level detail and retrieval provenance without a second round trip back through Step 7/7B.

Rewrite behavior is determined by `final_verdict`, per the taxonomy's "Rewrite Behavior by Final Verdict" table:

| `final_verdict` | Rewrite behavior |
| ----- | ----- |
| supported | no rewrite needed |
| supported_with_caveats | rewrite only if the original wording is risky, causal, or overstrong |
| partially_supported | rewrite |
| overstated | rewrite |
| unsupported | rewrite or flag/remove |
| insufficient_evidence | rewrite as hypothesis-generating, or mark unevaluable |
| needs_review | rewrite cautiously, or ask the user to review |

```json
{
  "Interpretation_id": "",
  "Summary": {
    "total_claims": "",
    "supported": "",
    "supported_with_caveats": "",
    "partially_supported": "",
    "overstated": "",
    "unsupported": "",
    "insufficient_evidence": "",
    "needs_review": ""
  },
  "Claim_results": [
    {
      "Claim_ID": "",
      "original_claim_text": "",
      "claim_type": "",
      "final_verdict": "",
      "Reason": "",
      "Rewritten_Claim": "",
      "evidence_basis": {
        "dataset_grounded": true,
        "chunk_ids_by_agent": {
          "perturbation_evidence": [],
          "pathway_signature": [],
          "robustness_quality": [],
          "language_causality": []
        },
        "retrieval_modes_by_agent": {
          "perturbation_evidence": [],
          "pathway_signature": [],
          "robustness_quality": [],
          "language_causality": []
        }
      },
      "agent_results": {
        "perturbation_evidence": {
          "verdict": "",
          "rationale": "",
          "chunk_ids": [],
          "warnings": []
        },
        "pathway_signature": {
          "verdict": "",
          "rationale": "",
          "chunk_ids": [],
          "warnings": []
        },
        "robustness_quality": {
          "verdict": "",
          "rationale": "",
          "chunk_ids": [],
          "warnings": []
        },
        "language_causality": {
          "verdict": "",
          "rationale": "",
          "chunk_ids": [],
          "warnings": []
        }
      },
      "trace": {
        "sentence_id": "",
        "agent_query_ids_by_agent": {
          "perturbation_evidence": "",
          "pathway_signature": "",
          "robustness_quality": "",
          "language_causality": ""
        }
      }
    }
  ]
}
```

### Notes

- `claim_type` is retrieved from Step 1.
- `final_verdict` is decided through deterministic rules from the taxonomy document ("Claim-Level Verdict Guidelines") — `agent_results` never overrides it.
- `Reason` and `Rewritten_Claim` are generated by the API (Claude) after `final_verdict` has already been decided deterministically; they explain and soften wording, they do not change the verdict.
- `chunk_ids_by_agent` is retrieved directly from Step 7.
- `retrieval_modes_by_agent` lists each retrieved chunk's `retrieval_mode` (Step 7's Retrieval Mode Taxonomy), in the same order as `chunk_ids_by_agent`, per agent. No `similarity_score` is included anywhere in this JSON.
- `agent_results` is carried forward from Step 7B as-is: one `{verdict, rationale, chunk_ids, warnings}` object per agent. `verdict` uses the Agent-Level Verdict Guidelines taxonomy, not the `final_verdict` taxonomy. `chunk_ids` here must remain a subset of that agent's Step 7 retrieved chunks.
- `warnings` inside `agent_results` are free-text explanatory notes from that agent (e.g. an invented chunk_id that was dropped, a quality caveat) — they are not the controlled `Quality_flags` taxonomy used in Step 6's `Evidence_fields.Quality_flags`. Do not conflate the two.
- `sentence_id` is retrieved directly from Step 2.
- `agent_query_ids_by_agent` is retrieved directly from Step 5, keyed by agent instead of a flat list, so each query ID is traceable to the specific agent that issued it.
- `dataset_grounded` is true or false.

---

## Step 9 — TextSelectionContext for Interactive Annotation

When the user receives the fully rewritten omics analysis, they can interact directly with it.

One way they can do this is through real-time interactive annotation.

The user can:

- select text
- double-click on a sentence to select it individually

Once the sentence or text span is selected, a popup window appears.

From this popup, the user can either:

1. check the claim against grounded literature evidence
2. ask a question

If the user clicks "ask a question," the following JSON is output first.

If multiple sentences or partial sentences are selected, this JSON is output multiple times, once for each selected sentence or partial sentence.

`TextSelectionContext` captures what the user selected:

```json
{
  "selection_id": "sel_001",
  "interpretation_id": "interp_001",
  "selected_text": "suppresses interferon signaling",
  "span_start": 16,
  "span_end": 47,
  "selection_scope": "",
  "sentence_id": ["sentence_001"],
  "claim_id": ["claim_001"]
}
```

### Notes

- `selection_scope` is classified using the taxonomy rules ("User Annotation Selection Scope Taxonomy").
- `sentence_id` traces directly back to Step 2.
- `claim_id` is based on the `sentence_id`, guided by Step 2.

---

## Step 10 — Interactive Chat Thread

Once the text has been selected, a chatbot appears.

The chatbot remembers:

- the selection ID
- the matched claim IDs from Step 9
- the matched evidence chunk IDs for the corresponding claim

The matched evidence chunk IDs are retrieved directly from Step 7, which indicates which evidence chunks correspond to each claim ID.

```json
{
  "thread_id": "thread_sel_001",
  "selection_id": "sel_001",
  "messages": [
    {
      "role": "user",
      "content": "Can you rewrite this more cautiously?"
    },
    {
      "role": "assistant",
      "content": "The safer rewrite should avoid implying a direct suppressive mechanism. I recommend: is associated with decreased interferon-response signatures."
    }
  ],
  "claim_id": ["claim_001"],
  "chunk_id": [
    "STAT1_Stim8hr_DE_001",
    "STAT1_Stim8hr_IFN_001",
    "LANG_SUPPRESSES_001"
  ]
}
```

### Notes

- `claim_id` comes from the selected text context.
- `chunk_id` comes from the claim's retrieved evidence chunks in Step 7.
- Chat is grounded in the selected claim's retrieved evidence — the assistant answers using `selection_id`, `claim_id`, and these chunk IDs, not by re-searching raw handoff files.

---

## Step 11 — Review Action Plan

The agents use the chunks and claims above to answer a user's question.

If the user proposes a re-evaluation or change, the agents can re-evaluate.

If they notice something is wrong, could be improved, or should incorporate the user's change, they propose an action plan.

The user can then:

- approve
- cancel
- edit

After approval or editing, GeneGround regenerates a new safely written omics analysis with the changes applied.

There should also be a button that lets users revert to the older version if they change their mind.

```json
{
  "action_plan_id": "action_001",
  "selection_id": "sel_001",
  "requested_action": "rewrite_cautiously",
  "selection_scope": "partial_claim",
  "claim_id": ["claim_001"],
  "sentence_id": ["sentence_001"],
  "chunk_id": [
    "STAT1_Stim8hr_DE_001",
    "STAT1_Stim8hr_IFN_001",
    "LANG_SUPPRESSES_001"
  ],
  "agents_to_rerun": [
    "language_causality"
  ],
  "proposed_changes": [
    {
      "change_id": "change_001",
      "change_type": "replace_span",
      "original_text": "suppresses interferon signaling",
      "proposed_text": "is associated with decreased interferon-response signatures",
      "reason": "The dataset supports a transcriptomic/signature-level decrease, not necessarily a direct suppressive mechanism."
    }
  ],
  "user_decision_options": [
    "approve",
    "cancel",
    "edit_before_apply"
  ],
  "status": "awaiting_user_approval"
}
```

### Notes

- `requested_action` is the direct raw prompt from the user, classified using the taxonomy rules ("User Requested Annotation Action Taxonomy").
- `agents_to_rerun` is decided by AI based on the user request and the changes to be made, per the taxonomy rules ("Agents to Rerun for User-Annotated Changes").
- `change_type` is classified using the taxonomy rules ("User Proposed Change Type Dictionary").
- `status` follows the taxonomy rules ("Action Plan Status Taxonomy").
- The user can approve, cancel, or edit before applying.
- The app should support reverting to the older version after changes are applied.

---

## Step 12 — Literature Grounding Review

When a user selects a piece of text from the revised omics analysis, they can also choose to conduct a literature grounding review by clicking a button in the popup.

This step is intentionally deferred / future work.

Literature grounding review should be implemented later because it may be trickier than the core dataset-grounded review pipeline. Dataset-grounded verdicts (Steps 1–8) remain the primary, always-on verification path; literature grounding is an optional secondary check layered on top, not a dependency of the core pipeline.

---

## Traceability Summary

GeneGround's backend maintains a continuous trace from text to evidence:

```
Full interpretation
  → sentence_id
  → claim_id
  → normalized entities
  → agent_query_id
  → retrieved chunk_id
  → agent-level verdict
  → final verdict
  → rewritten claim
  → interactive selection and action plan
```

This is the key architecture that makes GeneGround auditable instead of another black-box summarization tool.
