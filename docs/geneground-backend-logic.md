Absolutely — below is a **Claude Code–optimized Markdown version** of your backend logic doc. I preserved your actual logic and information, but cleaned the structure, headings, formatting, and JSON readability so Claude Code can parse it more reliably.

You can save this as:

docs/geneground-backend-logic.md  
---

\# GeneGround Backend Logic

This document defines the full backend JSON logic for GeneGround.

Important implementation rules:

\- Do not invent new JSON stages.  
\- Do not change the core logic in this document.  
\- Taxonomy labels are defined separately in \`docs/geneground-taxonomies.md\`.  
\- This backend logic is the source of truth for how the pipeline stages connect.  
\- Field names may be converted to code-friendly camelCase internally if needed, but output JSON should preserve the documented structure unless explicitly changed.  
\- Literature grounding review is intentionally deferred for later.

\# **Processing Method by Stage**

\- Step 1 claim extraction: API.  
\- Step 2 InterpretationClaimMap: deterministic.  
\- Step 3B claim normalization: deterministic.  
\- Step 4 artifact discovery: deterministic.  
\- Step 6 artifact index / chunk building: deterministic.  
\- Step 7 evidence retrieval: deterministic (metadata-first, with local TF-IDF vector fallback).  
\- Step 7B four agent evaluations (after retrieval, before Step 8): API.  
\- Step 8 `final_verdict` label: deterministic.  
\- Step 8 `Reason` and `Rewritten_Claim`: API.

\---

\# **User-Facing Progress Stages**

The `/demo` UI shows 7 plain-language progress stages instead of the raw step numbers above. This mapping is UI presentation only — it does not change what each backend step computes.

1\. Reading interpretation — input parsing \+ sentence splitting.  
2\. Extracting biological claims — Step 1 (API claim extraction) \+ Step 2 (deterministic InterpretationClaimMap).  
3\. Normalizing genes, pathways, cells, and conditions — Step 3B (deterministic mini ontology normalization).  
4\. Indexing Claude Science evidence — Step 4 (Artifact Discovery) \+ Step 6 (artifact index / chunk building, chunk metadata normalization, `Text_for_embedding` generation).  
5\. Retrieving relevant evidence chunks — Step 5 (`AgentQueryPlan`) \+ Step 7 (metadata\_exact / metadata\_partial / local TF-IDF vector fallback retrieval).  
6\. Evaluating claims with specialist agents — Step 7B (API four-agent evaluation).  
7\. Generating grounded rewrite — Step 8 (`final_verdict` deterministic aggregation \+ API `Reason`/`Rewritten_Claim`).

The pipeline visual additionally splits stages 1 and 4 into two parallel conceptual branches — an interpretation branch (Interpretation → Claim extraction → Entity normalization) and a Claude Science handoff branch (Handoff → Artifact discovery → Evidence indexing) — which merge before Evidence retrieval. The branches may run concurrently in the UI since neither depends on the other's output; only the merge step (`AgentQueryPlan` \+ Step 7 retrieval) requires both.

\---

\# Step 1 — Claim Extraction

Individual claims are extracted from the user’s pasted omics analysis.

A claim is a biological claim either expressed as a full sentence or as part of a sentence.

The claim extraction agent outputs the following JSON.

\`\`\`json  
{  
  "Interpretation\_id": "",  
  "Claims": \[  
    {  
      "Claim\_id": "",  
      "Original\_text": "",  
      "Claim\_type": "",  
      "Raw\_Entities": {  
        "Genes": \[\],  
        "Pathways": \[\],  
        "Cell": \[\],  
        "Conditions": \[\],  
        "Direction": \[\]  
      },  
      "Language\_Flags": {  
        "Strength\_Words": \[\],  
        "Causal\_Words": \[\]  
      }  
    }  
  \]  
}

## **Notes**

* `Claim_type` is chosen from the taxonomy rules.  
* `Claim_type` is used for `AgentQueryPlan`, especially by the `language_causality` agent.  
* `Strength_Words` are used by the `language_causality` agent.  
* `Causal_Words` are used by the `language_causality` agent.

---

# **Step 2 — InterpretationClaimMap**

Simultaneously, GeneGround creates an `InterpretationClaimMap`.

This links sentences and claims so every claim keeps its corresponding sentence and position within that sentence.

This is the first bridge between the sentence and the claim.

{  
  "Interpretation\_id": "",  
  "Full\_text": "",  
  "Sentences": \[  
    {  
      "Sentence\_id": "",  
      "Original\_text": "",  
      "Span\_start": "",  
      "Span\_end": "",  
      "Claim\_IDs": \[\]  
    }  
  \],  
  "Claims": \[  
    {  
      "Claim\_id": "",  
      "Sentence\_id": "",  
      "Original\_text": ""  
    }  
  \]  
}

## **Notes**

* One sentence can contain one claim or multiple claims.  
* Every claim should trace back to a `Sentence_id`.  
* `Span_start` and `Span_end` describe where the sentence starts and ends within the full text.

---

# **Step 3A — Raw Entity Categorization and Ontology Normalization**

The raw entities from claim extraction are extracted and categorized.

Then, based on the category, each entity is normalized against the ontology database.

{  
  "Genes": \[  
    {  
      "Raw": "",  
      "Normalized\_symbol": "",  
      "ID-System": "HGNC database"  
    }  
  \],  
  "Pathways": \[  
    {  
      "Raw": "",  
      "Normalized\_name": "",  
      "Candidate\_IDs": \[\],  
      "Source": "Reactome | curated\_immune\_signature | Reactome + curated\_immune\_signature",  
      "Warnings": \[\]  
    }  
  \],  
  "Conditions": \[  
    {  
      "Raw": "",  
      "Candidate\_Dataset\_Values": \[\],  
      "Resolution": ""  
    }  
  \],  
  "Cell\_context": \[  
    {  
      "Raw": "",  
      "Cell\_Type": "found from Cell Ontology database / CL Basic",  
      "Condition\_Candidates": \[\]  
    }  
  \],  
  "Direction": \[  
    {  
      "Raw": "",  
      "Normalized\_Direction": ""  
    }  
  \]  
}

## **Notes**

* `Genes` are normalized against the HGNC database.  
* `Pathways` are normalized against Reactome.  
* `Candidate_Dataset_Values` can include:  
  * `Stim8hr`  
  * `Stim48hr`  
  * `Rest`  
* `Resolution` should be:  
  * ambiguous if multiple possible dataset values apply  
  * the matching value if the condition resolves to one value  
* `Cell_Type` is found from the Cell Ontology database, specifically CL Basic.  
* `Condition_Candidates` should match the relevant `Candidate_Dataset_Values`.  
* `Normalized_Direction` is based on the direction dictionary from the taxonomy rules.

---

# **Step 3B — Normalized Claim JSON**

The claim becomes normalized while keeping its `Claim_id`.

This allows the normalized claim to be traced back to its original text and sentence.

This gives the retriever the key terms it needs to search the Claude Science files for evidence chunks.

\[  
  {  
    "Claim\_id": "",  
    "Normalized\_entities": {  
      "Genes": \[  
        {  
          "Raw": "",  
          "Normalized\_symbol": "",  
          "Source": "HGNC | manual\_alias\_override | unresolved",  
          "Source\_ID": "",  
          "Match\_type": "exact\_symbol | alias\_symbol | previous\_symbol | manual\_alias\_override | unresolved",  
          "Warnings": \[\]  
        }  
      \],  
      "Pathways": \[  
        {  
          "Raw": "",  
          "Normalized\_name": "",  
          "Candidate\_IDs": \[\],  
          "Source": "Reactome | curated\_immune\_signature | Reactome + curated\_immune\_signature | unresolved",  
          "Match\_type": "exact\_name | alias | keyword | curated\_fallback | unresolved",  
          "Warnings": \[\]  
        }  
      \],  
      "Conditions": \[  
        {  
          "Raw": "",  
          "Candidate\_Dataset\_Values": \[\],  
          "Resolution": "resolved | ambiguous | unresolved",  
          "Warnings": \[\]  
        }  
      \],  
      "Cell\_context": \[  
        {  
          "Raw": "",  
          "Cell\_Type": "",  
          "Source": "Cell Ontology | curated\_fallback | unresolved",  
          "Source\_ID": "",  
          "Condition\_Candidates": \[\],  
          "Warnings": \[\]  
        }  
      \],  
      "Direction": \[  
        {  
          "Raw": "",  
          "Normalized\_Direction": "up | down | changed | ambiguous | unresolved",  
          "Match\_type": "curated\_direction\_dictionary | ambiguous | unresolved",  
          "Warnings": \[\]  
        }  
      \]  
    }  
  }  
\]

## **Notes**

* This stage preserves `Claim_id`.  
* `Claim_id` links normalized entities back to:  
  * the original claim text  
  * the corresponding sentence  
  * later retrieved evidence chunks
* `Source` indicates whether the pathway candidate came from Reactome, the curated immune signature dictionary, or both.
* Gene normalization checks the HGNC mini ontology first: approved symbols, alias symbols, and previous symbols. Manual alias overrides are used only as a fallback if HGNC does not yield a match.
* Warnings are included for every normalized entity category so ambiguity, fallback mappings, and normalization caveats are preserved at the claim level.
* `Source` is used only for `Genes` and `Pathways` — not `Cell_context`. Full `Source` and `Match_type` definitions for both are in the taxonomy rules: "Source Taxonomy for Genes and Pathways", "Gene Match_type taxonomy", and "Pathway Match_type taxonomy".

---

# **Step 4 — Artifact Discovery Agent**

While normalization is happening, the attached Claude Science handoff folder is given to the Artifact Discovery Agent.

The Artifact Discovery Agent classifies files and hands them to agent-specific RAG indexes.

This prevents each individual agent from parsing every single file in the attached handoff folder.

As each file is parsed, the following JSON is output.

{  
  "Project\_id": "",  
  "Artifact\_manifest": \[  
    {  
      "File\_name": "",  
      "Artifact\_type": "",  
      "Corresponding\_Index": \[\],  
      "Priority": "",  
      "Reason": ""  
    }  
  \],  
  "Ignored\_files": \[  
    {  
      "File\_name": "",  
      "Reason": ""  
    }  
  \]  
}

## **Notes**

* `Artifact_type` is based on the taxonomy rules.  
* `Artifact_type` is decided by keywords and file content.  
* Artifact types can include:  
  * perturbation evidence  
  * pathway evidence  
  * robustness evidence  
  * language rules  
  * provenance  
  * ontology reference  
  * raw omics data  
  * visualization  
  * report  
* `Corresponding_Index` specifies which chunked index receives the file.  
* Placement rules are defined in the taxonomy rules.  
* Placement is based on key phrases and the artifact type.  
* `Priority` is high, medium, or low.  
* Priority rules are defined in the taxonomy rules.  
* Priority is decided by both index and artifact type.  
* `Reason` is a one-line explanation.  
* Ignored files also include a one-line reason.

---

# **Step 5 — AgentQueryPlan**

While each file is being parsed and categorized by the Artifact Discovery Agent, the `AgentQueryPlan` creates four query IDs.

Within each claim, there are four agent queries:

1. `perturbation_evidence`  
2. `pathway_signature`  
3. `robustness_quality`  
4. `language_causality`

These are the four main biologist agents.

The JSON below tells each agent what kind of evidence to retrieve.

This creates the chain:

sentence\_id → claim\_id → agent\_query\_id

The `question` field serves as a general guiding question for how each agent evaluates each claim.

{  
  "claim\_id": "",  
  "agent\_queries": {  
    "perturbation\_evidence": {  
      "Agent\_query\_id": "formatted as \[claim number\]\_\[agent categorization\]",  
      "index\_type": "perturbation\_evidence\_index",  
      "filters": {  
        "target\_gene\_symbol": "",  
        "conditions": \[\]  
      },  
      "question": ""  
    },  
    "pathway\_signature": {  
      "Agent\_query\_id": "formatted as \[claim number\]\_\[agent categorization\]",  
      "index\_type": "pathway\_signature\_index",  
      "filters": {  
        "target\_gene\_symbol": "",  
        "pathway\_keywords": \["interferon"\],  
        "conditions": \["Stim8hr", "Stim48hr"\]  
      },  
      "question": ""  
    },  
    "robustness\_quality": {  
      "Agent\_query\_id": "formatted as \[claim number\]\_\[agent categorization\]",  
      "index\_type": \["robustness\_quality\_index", "provenance\_index"\],  
      "filters": {  
        "target\_gene\_symbol": "",  
        "conditions": \["Stim8hr", "Stim48hr"\]  
      },  
      "question": ""  
    },  
    "language\_causality": {  
      "Agent\_query\_id": "formatted as \[claim number\]\_\[agent categorization\]",  
      "index\_type": "language\_rules\_index",  
      "filters": {  
        "claim\_type": "retrieve from Step 1 claim JSON",  
        "strength\_words": "retrieve from Step 1 claim JSON",  
        "Causal\_Words": "retrieve from Step 1 claim JSON"  
      },  
      "question": "Is the wording 'suppresses' justified by transcriptomic/pathway evidence?"  
    }  
  }  
}

## **Notes**

* Each agent searches a different index.  
* `claim_type`, `strength_words`, and `Causal_Words` are retrieved from Step 1\.  
* The robustness agent may use both `robustness_quality_index` and `provenance_index`.  
* The query ID format should be based on claim number and agent categorization.

---

# **Step 6 — Artifact Indexes and Potential Chunk Identification**

Once each non-ignored file from the user’s input handoff folder has been placed into an artifact index, information about each index is stored.

Each claim ID is linked to the claim ID from the normalized entities JSON in Step 3\.

This helps identify the correct evidence chunks from the source artifacts.

Chunks are small pieces of relevant evidence cut from a larger file.

Because Claude Science artifacts may be too large, the model should not read all of them every time.

The RAG system uses:

1. normalized ontology codes from Step 3  
2. metadata filtering  
3. semantic embedding retrieval using `Text_for_embedding` if needed

This file is linked to the `AgentQueryPlan`.

The `AgentQueryPlan` identifies:

* each claim  
* what to look for  
* which index type to search

The `AgentQueryPlan` also links directly to the normalized ontology entities JSON in Step 3\.

In simple terms:

Potential chunk IDs are identified in this step based on what to search for and the normalized ontology codes from Steps 3 and 5\.  
 The next step pulls the actual chunk IDs from this potential set instead of searching entire files from the artifact indexes.

{  
  "Index\_type": "",  
  "Source\_artifacts": \[\],  
  "Chunks": \[  
    {  
      "Chunk\_id": "",  
      "Metadata": {  
        "Genes": \[  
          {  
            "Raw": "",  
            "Normalized\_symbol": "",  
            "Source": "HGNC | manual\_alias\_override | unresolved",  
            "Source\_ID": "",  
            "Match\_type": "exact\_symbol | alias\_symbol | previous\_symbol | manual\_alias\_override | unresolved",  
            "Warnings": \[\]  
          }  
        \],  
        "Pathways": \[  
          {  
            "Raw": "",  
            "Normalized\_name": "",  
            "Candidate\_IDs": \[\],  
            "Source": "Reactome | curated\_immune\_signature | Reactome + curated\_immune\_signature | unresolved",  
            "Match\_type": "exact\_name | alias | keyword | curated\_fallback | unresolved",  
            "Warnings": \[\]  
          }  
        \],  
        "Conditions": \[  
          {  
            "Raw": "",  
            "Candidate\_Dataset\_Values": \[\],  
            "Resolution": "resolved | ambiguous | unresolved",  
            "Warnings": \[\]  
          }  
        \],  
        "Cell\_context": \[  
          {  
            "Raw": "",  
            "Cell\_Type": "",  
            "Source": "Cell Ontology | curated\_fallback | unresolved",  
            "Source\_ID": "",  
            "Condition\_Candidates": \[\],  
            "Warnings": \[\]  
          }  
        \],  
        "Direction": \[  
          {  
            "Raw": "",  
            "Normalized\_Direction": "up | down | changed | ambiguous | unresolved",  
            "Match\_type": "curated\_direction\_dictionary | ambiguous | unresolved",  
            "Warnings": \[\]  
          }  
        \],  
        "Evidence\_fields": {  
          "Artifact\_type": "",  
          "File\_name": "",  
          "Evidence\_type": "",  
          "Statistics": {},  
          "Quality\_flags": \[\]  
        }  
      },  
      "Text\_for\_embedding": ""  
    }  
  \]  
}

## **Notes**

* `Source_artifacts` are files placed into this index from Step 4\.  
* `Metadata` helps find the right chunks.  
* `Metadata` describes the evidence chunk itself — its own genes, pathways, conditions, cell context, and direction extracted from the source artifact — not the claim being verified. Claim-level normalized entities come from Step 3B; `AgentQueryPlan` matches Step 3B's normalized claim entities against this chunk-level `Metadata`.  
* Step 6 metadata uses the same mini ontology normalization approach as Step 3B, but applies it to parsed artifact chunks instead of claim entities. This includes HGNC-first gene normalization with manual alias override fallback, Reactome-first pathway normalization with curated immune signature fallback, dataset-specific condition mapping, Cell Ontology cell context mapping, and direction normalization from the curated direction dictionary.  
* `Evidence_type` describes what kind of scientific evidence the chunk contains.  
* `Statistics` stores quantitative or structured values extracted from the chunk. It is a flexible object, not a fixed taxonomy.  
* `Quality_flags` stores warning labels that affect robustness or interpretation.  
* `Evidence_type` and `Quality_flags` values are defined in the taxonomy rules.  
* The taxonomy rules also include a guidance table mapping likely `Evidence_type` values to each of the five artifact indexes ("Evidence_type Values and Their Map to the Five Artifact Indexes"). It is guidance for deterministic chunk classification, not a replacement for the `Evidence_type` taxonomy.  
* `Text_for_embedding` is plain text used for local vector search fallback (see Step 7).  
* Only plain text can be used for vector search.  
* This stage identifies potential chunk IDs.  
* Step 7 retrieves actual chunk IDs from that set.

---

# **Step 7 — Retrieved Evidence**

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

For vector fallback, GeneGround does not embed raw uploaded JSON/CSV/Markdown files. Step 6 first turns each chunk into deterministic `Text_for_embedding` using fixed templates. Step 7 then turns the `AgentQueryPlan` question plus filters into query text and compares that query text against each candidate chunk's `Text_for_embedding` using local TF-IDF cosine similarity. This is provider-free local vector search, not Claude embeddings and not an external vector database. It is a fallback/helper after metadata retrieval.

Manual gene aliases and pathway aliases should be included in query text expansion when available, to improve local vector fallback matching.

TF-IDF similarity scores are not exposed in the output JSON. Retrieval explains matches using `retrieval_mode` and `retrieval_reasons` instead — no `similarity_score` field exists anywhere in this pipeline.

Retrieved results store:

* claim ID  
* agent type  
* agent query ID from `AgentQueryPlan`  
* chunk IDs  
* retrieval mode  
* retrieval reasons

The chunk IDs come directly from the JSON in Step 6\.

This tells the `AgentQueryPlan` where to search instead of making agents search the entire artifact index for each claim.

This creates the trace:

sentence\_id → claim\_id → agent\_query\_id → chunk\_id  
{  
  "claim\_id": "claim\_001",  
  "agent\_evidence": {  
    "perturbation\_evidence": {  
      "agent\_query\_id": "claim\_001\_\_perturbation\_evidence",  
      "retrieved\_chunks": \[  
        {  
          "chunk\_id": "STAT1\_Stim8hr\_DE\_001",  
          "index\_type": "perturbation\_evidence\_index",  
          "retrieval\_mode": "metadata\_exact",  
          "retrieval\_reasons": \[  
            "Matched target\_gene\_symbol \= STAT1",  
            "Matched condition \= Stim8hr"  
          \]  
        },  
        {  
          "chunk\_id": "STAT1\_Stim48hr\_DE\_001",  
          "index\_type": "perturbation\_evidence\_index",  
          "retrieval\_mode": "metadata\_partial",  
          "retrieval\_reasons": \[  
            "Matched target\_gene\_symbol \= STAT1",  
            "Included because condition 'stimulated' maps to Stim48hr"  
          \]  
        }  
      \]  
    },  
    "pathway\_signature": {  
      "agent\_query\_id": "claim\_001\_\_pathway\_signature",  
      "retrieved\_chunks": \[  
        {  
          "chunk\_id": "STAT1\_Stim8hr\_IFN\_001",  
          "index\_type": "pathway\_signature\_index",  
          "retrieval\_mode": "metadata\_exact",  
          "retrieval\_reasons": \[  
            "Matched target\_gene\_symbol \= STAT1",  
            "Matched pathway keyword \= interferon",  
            "Matched direction \= down"  
          \]  
        }  
      \]  
    }  
  }  
}

A single retrieved chunk has this shape:

{  
  "chunk\_id": "",  
  "index\_type": "",  
  "retrieval\_mode": "metadata\_exact | metadata\_partial | local\_vector\_fallback | hybrid\_metadata\_and\_local\_vector | not\_retrieved | manual\_demo",  
  "retrieval\_reasons": \[\]  
}

## **Notes**

* `chunk_id` is identified from Step 6\.  
* `index_type` is identified from Step 6\.  
* `retrieval_mode` records which retrieval order step (see above) produced this chunk. Values are defined in the taxonomy rules.  
* `retrieval_reasons` explain why a specific chunk was chosen.  
* This makes evidence traceability possible.
* No `similarity_score` field is included anywhere in this JSON.

---

# **Step 7B — Four Agent Evaluations**

Each claim is evaluated by four API-powered agents using only the chunks retrieved in Step 7\.

The agents compare the original claim, normalized claim entities, language flags, and retrieved evidence chunks.

Each agent returns an internal verdict, rationale, chunk\_ids, and warnings.

Claude API is used here because this step requires semantic judgment about whether the retrieved evidence supports, weakly supports, contradicts, or is insufficient for each part of the claim.

Claude must not:

* invent chunk\_ids  
* invent verdict labels  
* invent agent names  
* choose the final user-facing final\_verdict  
* override deterministic normalization  
* search raw handoff files directly

Claude may only evaluate the retrieved chunks passed into this step.

{  
  "claim\_id": "",  
  "agent\_results": {  
    "perturbation\_evidence": {  
      "agent": "perturbation\_evidence",  
      "verdict": "supports | supports\_with\_caveats | weak\_support | contradicts | insufficient\_evidence | not\_applicable | needs\_review",  
      "rationale": "",  
      "chunk\_ids": \[\],  
      "warnings": \[\]  
    },  
    "pathway\_signature": {  
      "agent": "pathway\_signature",  
      "verdict": "supports | supports\_with\_caveats | weak\_support | contradicts | insufficient\_evidence | not\_applicable | needs\_review",  
      "rationale": "",  
      "chunk\_ids": \[\],  
      "warnings": \[\]  
    },  
    "robustness\_quality": {  
      "agent": "robustness\_quality",  
      "verdict": "supports | supports\_with\_caveats | weak\_support | contradicts | insufficient\_evidence | not\_applicable | needs\_review",  
      "rationale": "",  
      "chunk\_ids": \[\],  
      "warnings": \[\]  
    },  
    "language\_causality": {  
      "agent": "language\_causality",  
      "verdict": "supports | supports\_with\_caveats | weak\_support | contradicts | insufficient\_evidence | not\_applicable | needs\_review",  
      "rationale": "",  
      "chunk\_ids": \[\],  
      "warnings": \[\]  
    }  
  }  
}

## **Notes**

* `chunk_ids` must be a subset of the chunk\_ids retrieved in Step 7 for that agent query. If an agent uses no chunk evidence, `chunk_ids` should be empty and the verdict should usually be `insufficient_evidence`, `not_applicable`, or `needs_review`.  
* The verdicts in this step are internal agent-level verdicts. They are not the final user-facing claim verdict. The final claim verdict is computed deterministically in the next step using the final verdict aggregation taxonomy.  
* Agent names and verdict labels are defined in the taxonomy rules ("Agent-Level Verdict Guidelines").  
* This step's field name is `chunk_ids`, not `supporting_chunk_ids`.

---

# **Step 8 — Final Claim Verdict and Rewritten Claim**

Each claim is compared against the retrieved chunks from Step 7\.

Each claim is marked with one of the following final verdicts:

* supported  
* supported\_with\_caveats  
* partially\_supported  
* overstated  
* unsupported  
* insufficient\_evidence  
* needs\_review

The final verdict is based on deterministic taxonomy rules.

Confidence scores are intentionally removed because they are not helpful for the final user-facing output and can make scoring more confusing.

All `Rewritten_Claims` are compiled to create a fully rewritten omics analysis that the user can interact with in Step 9\.

`Claim_results` also carries the full per-agent `agent_results` detail from Step 7B forward (verdict, rationale, chunk\_ids, warnings for each of the four agents), plus `retrieval_modes_by_agent`, so the UI's Claim-level audit panel and Evidence Trace view can render agent-level detail and retrieval provenance without a second round trip back through Step 7/7B.

{  
  "Interpretation\_id": "",  
  "Summary": {  
    "total\_claims": "",  
    "supported": "",  
    "supported\_with\_caveats": "",  
    "partially\_supported": "",  
    "overstated": "",  
    "unsupported": "",  
    "insufficient\_evidence": "",  
    "needs\_review": ""  
  },  
  "Claim\_results": \[  
    {  
      "Claim\_ID": "",  
      "original\_claim\_text": "",  
      "claim\_type": "",  
      "final\_verdict": "",  
      "Reason": "",  
      "Rewritten\_Claim": "",  
      "evidence\_basis": {  
        "dataset\_grounded": true,  
        "chunk\_ids\_by\_agent": {  
          "perturbation\_evidence": \[\],  
          "pathway\_signature": \[\],  
          "robustness\_quality": \[\],  
          "language\_causality": \[\]  
        },  
        "retrieval\_modes\_by\_agent": {  
          "perturbation\_evidence": \[\],  
          "pathway\_signature": \[\],  
          "robustness\_quality": \[\],  
          "language\_causality": \[\]  
        }  
      },  
      "agent\_results": {  
        "perturbation\_evidence": {  
          "verdict": "",  
          "rationale": "",  
          "chunk\_ids": \[\],  
          "warnings": \[\]  
        },  
        "pathway\_signature": {  
          "verdict": "",  
          "rationale": "",  
          "chunk\_ids": \[\],  
          "warnings": \[\]  
        },  
        "robustness\_quality": {  
          "verdict": "",  
          "rationale": "",  
          "chunk\_ids": \[\],  
          "warnings": \[\]  
        },  
        "language\_causality": {  
          "verdict": "",  
          "rationale": "",  
          "chunk\_ids": \[\],  
          "warnings": \[\]  
        }  
      },  
      "trace": {  
        "sentence\_id": "",  
        "agent\_query\_ids\_by\_agent": {  
          "perturbation\_evidence": "",  
          "pathway\_signature": "",  
          "robustness\_quality": "",  
          "language\_causality": ""  
        }  
      }  
    }  
  \]  
}

## **Notes**

* `claim_type` is retrieved from Step 1\.  
* `final_verdict` is decided through deterministic rules from the taxonomy document — `agent_results` never overrides it.  
* `Reason` and `Rewritten_Claim` are generated by the API (Claude) after `final_verdict` has already been decided deterministically; they explain and soften wording, they do not change the verdict.  
* `chunk_ids_by_agent` is retrieved directly from Step 7\.  
* `retrieval_modes_by_agent` lists each retrieved chunk's `retrieval_mode` (Step 7's Retrieval Mode Taxonomy), in the same order as `chunk_ids_by_agent`, per agent. No `similarity_score` is included anywhere in this JSON.  
* `agent_results` is carried forward from Step 7B as-is: one `{verdict, rationale, chunk_ids, warnings}` object per agent. `verdict` uses the Agent-Level Verdict Guidelines taxonomy, not the `final_verdict` taxonomy. `chunk_ids` here must remain a subset of that agent's Step 7 retrieved chunks.  
* `warnings` inside `agent_results` are free-text explanatory notes from that agent (e.g. an invented chunk\_id that was dropped, a quality caveat) — they are not the controlled `Quality_flags` taxonomy used in Step 6's `Evidence_fields.Quality_flags`. Do not conflate the two.  
* `sentence_id` is retrieved directly from Step 2\.  
* `agent_query_ids_by_agent` is retrieved directly from Step 5, keyed by agent instead of a flat list, so each query ID is traceable to the specific agent that issued it.  
* `dataset_grounded` is true or false.

---

# **Step 9 — TextSelectionContext for Interactive Annotation**

When the user receives the fully rewritten omics analysis, they can interact directly with it.

One way they can do this is through real-time interactive annotation.

The user can:

* select text  
* double-click on a sentence to select it individually

Once the sentence or text span is selected, a popup window appears.

From this popup, the user can either:

1. check the claim against grounded literature evidence  
2. ask a question

If the user clicks “ask a question,” the following JSON is output first.

If multiple sentences or partial sentences are selected, this JSON is output multiple times, once for each selected sentence or partial sentence.

## **TextSelectionContext**

Captures what the user selected.

{  
  "selection\_id": "sel\_001",  
  "interpretation\_id": "interp\_001",  
  "selected\_text": "suppresses interferon signaling",  
  "span\_start": 16,  
  "span\_end": 47,  
  "selection\_scope": "",  
  "sentence\_id": \["sentence\_001"\],  
  "claim\_id": \["claim\_001"\]  
}

## **Notes**

* `selection_scope` is classified using the taxonomy rules.  
* `sentence_id` traces directly back to Step 2\.  
* `claim_id` is based on the `sentence_id`, guided by Step 2\.

---

# **Step 10 — Interactive Chat Thread**

Once the text has been selected, a chatbot appears.

The chatbot remembers:

* the selection ID  
* the matched claim IDs from Step 9  
* the matched evidence chunk IDs for the corresponding claim

The matched evidence chunk IDs are retrieved directly from Step 7, which indicates which evidence chunks correspond to each claim ID.

{  
  "thread\_id": "thread\_sel\_001",  
  "selection\_id": "sel\_001",  
  "messages": \[  
    {  
      "role": "user",  
      "content": "Can you rewrite this more cautiously?"  
    },  
    {  
      "role": "assistant",  
      "content": "The safer rewrite should avoid implying a direct suppressive mechanism. I recommend: is associated with decreased interferon-response signatures."  
    }  
  \],  
  "claim\_id": \["claim\_001"\],  
  "chunk\_id": \[  
    "STAT1\_Stim8hr\_DE\_001",  
    "STAT1\_Stim8hr\_IFN\_001",  
    "LANG\_SUPPRESSES\_001"  
  \]  
}

## **Notes**

* `claim_id` comes from the selected text context.  
* `chunk_id` comes from the claim’s retrieved evidence chunks in Step 7\.

---

# **Step 11 — Review Action Plan**

The agents use the chunks and claims above to answer a user’s question.

If the user proposes a re-evaluation or change, the agents can re-evaluate.

If they notice something is wrong, could be improved, or should incorporate the user’s change, they propose an action plan.

The user can then:

* approve  
* cancel  
* edit

After approval or editing, GeneGround regenerates a new safely written omics analysis with the changes applied.

There should also be a button that lets users revert to the older version if they change their mind.

{  
  "action\_plan\_id": "action\_001",  
  "selection\_id": "sel\_001",  
  "requested\_action": "rewrite\_cautiously",  
  "selection\_scope": "partial\_claim",  
  "claim\_id": \["claim\_001"\],  
  "sentence\_id": \["sentence\_001"\],  
  "chunk\_id": \[  
    "STAT1\_Stim8hr\_DE\_001",  
    "STAT1\_Stim8hr\_IFN\_001",  
    "LANG\_SUPPRESSES\_001"  
  \],  
  "agents\_to\_rerun": \[  
    "language\_causality"  
  \],  
  "proposed\_changes": \[  
    {  
      "change\_id": "change\_001",  
      "change\_type": "replace\_span",  
      "original\_text": "suppresses interferon signaling",  
      "proposed\_text": "is associated with decreased interferon-response signatures",  
      "reason": "The dataset supports a transcriptomic/signature-level decrease, not necessarily a direct suppressive mechanism."  
    }  
  \],  
  "user\_decision\_options": \[  
    "approve",  
    "cancel",  
    "edit\_before\_apply"  
  \],  
  "status": "awaiting\_user\_approval"  
}

## **Notes**

* `requested_action` is the direct raw prompt from the user.  
* `agents_to_rerun` is decided by AI based on the user request and the changes to be made.  
* `change_type` is classified using the taxonomy rules.  
* The user can approve, cancel, or edit before applying.  
* The app should support reverting to the older version after changes are applied.

---

# **Step 12 — Literature Grounding Review**

When a user selects a piece of text from the revised omics analysis, they can also choose to conduct a literature grounding review by clicking a button in the popup.

This step is intentionally deferred.

Literature grounding review should be implemented later because it may be trickier than the core dataset-grounded review pipeline.

\---

