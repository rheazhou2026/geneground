# GeneGround Taxonomies

This document defines the controlled vocabularies, deterministic matching rules, retrieval modes, agent verdicts, and rewrite behavior used throughout the GeneGround pipeline. It is the canonical reference for every enum, dictionary, and template that [`docs/geneground-backend-logic.md`](./geneground-backend-logic.md) relies on — the backend logic document describes *when* each stage runs and *what* JSON it produces; this document defines the exact controlled values, matching rules, and deterministic templates those stages use.

Labels defined here (claim types, `Source`, `Match_type`, `Evidence_type`, `Quality_flags`, `retrieval_mode`, agent-level verdicts, and `final_verdict`) are fixed vocabularies. Application code should treat them as enums, not free text.

## Contents

- [Condition Mapping Rules](#condition-mapping-rules)
- [Claim Type for Language Causality Agent](#claim-type-for-language-causality-agent)
- [Direction Dictionary for Normalization Step](#direction-dictionary-for-normalization-step)
- [Strength Word Dictionary for Language Causality Agent](#strength-word-dictionary-for-language-causality-agent)
- [Causal Word Dictionary for Language Causality Agent](#causal-word-dictionary-for-language-causality-agent)
- [Source Taxonomy for Genes and Pathways](#source-taxonomy-for-genes-and-pathways)
  - [Gene Source Values](#gene-source-values)
  - [Pathway Source Values](#pathway-source-values)
- [Match Types for Genes and Pathways](#match-types-for-genes-and-pathways)
  - [Gene Match_type taxonomy](#gene-match_type-taxonomy)
  - [Pathway Match_type taxonomy](#pathway-match_type-taxonomy)
- [User-Inputted Handoff Folder File Artifact Type](#user-inputted-handoff-folder-file-artifact-type)
- [Artifact Index Placement Guidelines](#artifact-index-placement-guidelines)
- [Agent-to-Index Mapping](#agent-to-index-mapping)
- [Evidence Type Taxonomy](#evidence-type-taxonomy)
- [Evidence_Type Values and Their Map to the Five Artifact Indexes](#evidence_type-values-and-their-map-to-the-five-artifact-indexes)
- [Quality Flags Taxonomy](#quality-flags-taxonomy)
- [Recommended Statistics Keys for Evidence Fields](#recommended-statistics-keys-for-evidence-fields)
- [Deterministic Text_for_Embedding Templates for Each Artifact Index](#deterministic-text_for_embedding-templates-for-each-artifact-index)
- [Deterministic Question Templates for AgentQueryPlan](#deterministic-question-templates-for-agentqueryplan)
- [Retrieval Reason Template Taxonomies](#retrieval-reason-template-taxonomies)
- [Retrieval Mode Taxonomy](#retrieval-mode-taxonomy)
- [Agent-Level Verdict Guidelines](#agent-level-verdict-guidelines)
- [Agent-Level Verdicts by Agent](#agent-level-verdicts-by-agent)
- [Claim-Level Verdict Guidelines](#claim-level-verdict-guidelines)
- [User Requested Annotation Action Taxonomy](#user-requested-annotation-action-taxonomy)
- [Agents to Rerun for User-Annotated Changes](#agents-to-rerun-for-user-annotated-changes)
- [User Annotation Selection Scope Taxonomy](#user-annotation-selection-scope-taxonomy)
- [User Proposed Change Type Dictionary](#user-proposed-change-type-dictionary)
- [Action Plan Status Taxonomy](#action-plan-status-taxonomy)
- [Rewrite Rule Taxonomy for Revised Omics Analysis](#rewrite-rule-taxonomy-for-revised-omics-analysis)
- [Rewrite Behavior by Final Verdict](#rewrite-behavior-by-final-verdict)

---

## Condition Mapping Rules

| Raw condition | Candidate dataset values | Resolution |
| ----- | ----- | ----- |
| Rest | `["Rest"]` | resolved |
| rest | `["Rest"]` | resolved |
| resting | `["Rest"]` | resolved |
| unstimulated | `["Rest"]` | resolved |
| Stim8hr | `["Stim8hr"]` | resolved |
| 8hr | `["Stim8hr"]` | resolved |
| 8 hour | `["Stim8hr"]` | resolved |
| early stimulation | `["Stim8hr"]` | resolved |
| Stim48hr | `["Stim48hr"]` | resolved |
| 48hr | `["Stim48hr"]` | resolved |
| 48 hour | `["Stim48hr"]` | resolved |
| late stimulation | `["Stim48hr"]` | resolved |
| stimulated | `["Stim8hr", "Stim48hr"]` | ambiguous |
| after stimulation | `["Stim8hr", "Stim48hr"]` | ambiguous |
| stimulated conditions | `["Stim8hr", "Stim48hr"]` | ambiguous |
| early and late stimulation | `["Stim8hr", "Stim48hr"]` | resolved_multiple |
| no condition | `[]` | unresolved |

---

## Claim Type for Language Causality Agent

| Claim type | Meaning | Example |
| ----- | ----- | ----- |
| perturbation_effect | Claim says a perturbation changed something biologically. | "STAT1 knockdown altered inflammatory activation." |
| gene_expression_effect | Claim says a gene or gene set increased/decreased. | "IFIT1 expression decreased after STAT1 knockdown." |
| pathway_effect | Claim says a pathway/signature changed. | "STAT1 knockdown suppresses interferon signaling." |
| cell_state_effect | Claim says cells shifted toward a state or phenotype. | "IRF4 perturbation shifts cells toward a Th2-like state." |
| condition_specific_effect | Claim depends on Rest / Stim8hr / Stim48hr / stimulation timing. | "The effect appears only after stimulation." |
| regulatory_role | Claim says a gene is a regulator/key regulator/master regulator. | "STAT1 is a key regulator of inflammatory activation." |
| causal_mechanism | Claim implies direct mechanism or causality. | "STAT1 causes interferon suppression." |
| therapeutic_relevance | Claim connects result to therapeutic targeting/intervention. | "IRF4 is a therapeutic target for immune modulation." |
| robustness_claim | Claim says evidence is robust, reproducible, validated, or reliable. | "The effect is consistent across donors." |
| comparative_claim | Claim compares two genes, conditions, pathways, or timepoints. | "STAT1 has a stronger effect than IRF1." |
| novelty_claim | Claim says something is new, unexpected, or previously unknown. | "This reveals a novel regulator of T cell activation." |
| summary_claim | Broad summary statement combining multiple findings. | "Together, these results show broad immune reprogramming." |
| unsupported_generalization | Broad claim that may exceed the dataset scope. | "This proves STAT1 controls immune disease." |
| method_or_data_claim | Claim about data, method, analysis, or dataset rather than biology. | "The Perturb-seq data contains strong guide coverage." |
| unknown | Fallback when claim type is unclear. | N/A |

---

## Direction Dictionary for Normalization Step

| Raw words | Normalized direction |
| ----- | ----- |
| up, increased, increase, increases, upregulated, upregulate, upregulates, higher, elevated, induced, induces, induce, activates, activate, activated, enhances, promotes, enriched | up |
| down, decreased, decrease, decreases, downregulated, downregulate, downregulates, lower, reduced, reduces, reduce, suppressed, suppresses, suppress, inhibits, depleted, attenuated | down |
| altered, alter, alters, changed, change, changes, modulated, modulate, modulates, affected, affect, affects, shifted, shift, shifts, perturbed, rewired | changed |
| drives, causes, controls, regulates, reprograms, rescues without a clear up/down direction | ambiguous |
| No direction detected | unresolved |

---

## Strength Word Dictionary for Language Causality Agent

| Word Type | Keywords/signals |
| ----- | ----- |
| Low-risk/cautious | associated with, consistent with, suggests, may, candidate, linked to, correlated with, appears to, observed, shows evidence of |
| Medium-risk | affects, modulates, alters, shifts, reduces, increases, suppresses, activates, enriches, depletes, promotes, impairs, regulates |
| High-risk | drives, controls, determines, establishes, reprograms, rescues, confirms, validates, proves, demonstrates, master regulator, central regulator, key regulator, therapeutic target, drug target, mechanism, causal mechanism |

---

## Causal Word Dictionary for Language Causality Agent

| Format | Keywords/signals |
| ----- | ----- |
| Word list | causes, drives, leads to, results in, is required for, is necessary for, is sufficient for, controls, determines, mediates, through, via, mechanism, mechanistically, reprograms, rescues, restores, establishes, proves |
| Phrase patterns | X is required for Y, X is sufficient to induce Y, X acts through Y, X mediates Y, X controls Y, X establishes Y state, X proves Y mechanism |

---

## Source Taxonomy for Genes and Pathways

`Source` describes where a normalized gene or pathway mapping came from. It is separate from `Match_type`:

- `Source` = which reference layer produced the mapping.
- `Match_type` = how the raw text matched within that reference layer.

`Source` is used only for `Genes` and `Pathways`. Do not add `Source` to `Cell_context`.

### Gene Source Values

| Source | Meaning |
| ----- | ----- |
| HGNC | Gene was resolved through the HGNC mini ontology, including approved symbols, alias symbols, or previous symbols. |
| manual_alias_override | Gene did not resolve through HGNC but matched the GeneGround manual alias override table. |
| unresolved | Gene could not be resolved through HGNC or manual alias overrides. |

Gene normalization is **HGNC-first**: exact_symbol, then alias_symbol, then previous_symbol, then manual_alias_override fallback, then unresolved. Manual alias overrides are a fallback only and never override a successful HGNC match.

### Pathway Source Values

| Source | Meaning |
| ----- | ----- |
| Reactome | Pathway candidate came from the Reactome mini pathway ontology. |
| curated_immune_signature | Pathway/signature candidate came from the GeneGround curated immune signature dictionary. |
| Reactome + curated_immune_signature | Both Reactome and curated immune signature candidates were plausible and were preserved. |
| unresolved | Pathway/signature phrase could not be mapped to Reactome or curated immune signatures. |

Pathway normalization preserves ambiguity. If Reactome and curated immune signatures are both plausible, use `Source = "Reactome + curated_immune_signature"` and preserve all candidate IDs rather than forcing a single Reactome ID.

---

## Match Types for Genes and Pathways

### Gene Match_type taxonomy

| Match_type | Meaning |
| ----- | ----- |
| exact_symbol | Raw gene text exactly matches an approved HGNC symbol in the mini HGNC ontology. |
| alias_symbol | Raw gene text matches an HGNC alias_symbol entry in the mini HGNC ontology. |
| previous_symbol | Raw gene text matches an HGNC prev_symbol entry in the mini HGNC ontology. |
| manual_alias_override | Raw gene text did not resolve through HGNC approved/alias/previous symbols, but matched the GeneGround manual alias override table. |
| unresolved | Raw gene text could not be mapped to an HGNC symbol or manual alias override. |

### Pathway Match_type taxonomy

| Match_type | Meaning |
| ----- | ----- |
| exact_name | Raw pathway text exactly matches a Reactome pathway name or curated signature display name. |
| alias | Raw pathway text matches a known alias from Reactome-derived aliases or curated immune signature aliases. |
| keyword | Raw pathway text matches pathway/signature keywords such as interferon, cytokine, inflammatory, NF-kB, JAK-STAT, T cell, cell cycle, apoptosis, or proliferation. |
| curated_fallback | Raw pathway text does not cleanly resolve to Reactome but maps to a curated immune signature such as Th1-like polarization, Th2-like polarization, exhaustion-like signature, inflammatory response, or interferon response. |
| unresolved | Raw pathway text could not be mapped to Reactome or a curated immune signature. |

Pathway normalization preserves multiple candidates. Do not force one Reactome ID when Reactome and curated immune signatures are both plausible.

---

## User-Inputted Handoff Folder File Artifact Type

| Artifact type | Keywords/signals | Corresponding index | Priority |
| ----- | ----- | ----- | ----- |
| perturbation_evidence | perturbation, DE_stats, differential_expression, gene_level_de, log_fc, adj_p_value, zscore, top_changed_genes, ontarget | perturbation_evidence_index | High if compact structured evidence file such as `.json`, `.csv`, `.tsv`, or `.parquet`. Medium if report text summarizes DE evidence but is not row-structured. Low if only a figure/plot. Ignored if huge `.h5ad`/matrix file intended for Claude Science processing rather than web MVP. |
| pathway_evidence | pathway, signature, enrichment, Reactome, Hallmark, interferon, NF-kB, overlap_genes, padj | pathway_signature_index | High if compact pathway/signature enrichment table or packet, especially `.json`, `.csv`, `.tsv`, `.gmt`, or `.parquet`. Medium if analysis/report text contains pathway evidence. Low if visualization only. Ignored if huge pathway database dump or unsupported binary. |
| robustness_evidence | robustness, guide, donor, pseudobulk, low_target_gex, neighboring_gene_KD, distal_offtarget_flag, n_cells_target, keep_for_DE, QC | robustness_quality_index | High if compact guide/donor/QC/robustness summary file. Medium if QC report text or provenance report describes caveats. Low if only a QC visualization. Ignored if raw pseudobulk matrix is huge and not already summarized. |
| language_rules | language_rules, claim_language, causal_words, strength_words, safer_rewrites, master regulator, therapeutic target, mechanism | language_rules_index | High if structured JSON/TSV/CSV rules or curated rule file. Medium if rules are embedded in a report or markdown note. Low if incomplete scratch notes. Usually never ignored unless irrelevant or unreadable, because language rules are small and directly useful. |
| provenance | provenance, manifest, import_log, dataset_inventory, schema_map, source_files, processing_report, thresholds, caveats | provenance_index | High if it contains schema maps, dataset inventory, source file mapping, thresholds, or processing caveats needed for auditability. Medium if general import/session report. Low if vague notes with little machine-readable content. Ignored only if irrelevant or duplicate. |
| demo_claims | demo_claims, gold_verdicts, example_claims, expected_verdicts, demo_examples | usually demo_examples_index | Medium by default because useful for MVP testing but not biological evidence. High only in demo/dev mode if needed to populate examples. Low if outdated or incomplete. Ignored in production mode or once real Claude Science evidence is available. |
| ontology_reference | hgnc, cell_ontology, cl-basic, reactome, ontology, dataset_terms | no artifact evidence index; used for normalization | High for normalization if compact/current mini ontology or dataset terms file. Medium if full ontology/source reference that needs preprocessing. Low if outdated, duplicate, or too broad. Ignored for artifact evidence indexes because ontology files support entity normalization, not claim evidence verdicts. Not placed into an artifact evidence index. |
| raw_omics_data | `.h5ad`, `.h5mu`, `.loom`, `.mtx`, raw_cell, assigned_guide, huge matrix | ignored for web MVP | Ignored for web MVP if large raw matrix. Low only if tiny toy/demo matrix. Medium only in a backend/offline processing mode. Never High for the browser-facing artifact index flow because raw omics data should be processed in Claude Science first and exported as compact evidence packets. |
| visualization | `.png`, `.jpg`, `.svg`, plot, figure, UMAP | usually ignored or provenance/report only | Low by default because figures are hard to chunk into structured evidence. Medium if figure has a paired caption/report or is important for provenance/audit display. Ignored if decorative, duplicate, or not machine-readable. Not High unless figure OCR/vision parsing is added later (avoided for MVP). |
| report | `.md`, `.txt`, `.pdf`, summary, analysis_report, final_report | usually provenance_index, sometimes evidence index if content is structured | Medium by default. High if the report contains structured tables, explicit thresholds, caveats, or summarized evidence that can be parsed into chunks. Low if narrative-only or redundant. Ignored if unrelated, outdated, or impossible to parse safely. |
| unsupported | unsupported file type | ignored | Ignored. Use `ignored_unsupported_type` or `needs_manual_review`. |
| irrelevant | unrelated file | ignored | Ignored. Use `ignored_irrelevant`. |
| unknown | insufficient signals | manual review | Low if potentially relevant but unclear. Ignored / `needs_manual_review` if no useful signals. Do not assign High unless the Artifact Discovery Agent finds strong content signals after previewing the file. |

---

## Artifact Index Placement Guidelines

| Artifact type | Corresponding index |
| ----- | ----- |
| perturbation_evidence | perturbation_evidence_index |
| pathway_evidence | pathway_signature_index |
| robustness_evidence | robustness_quality_index |
| language_rules | language_rules_index |
| provenance | provenance_index |
| demo_claims | demo_examples_index |
| ontology_reference | none |
| raw_omics_data | none |
| visualization | usually none, sometimes provenance_index |
| report | usually provenance_index; optionally evidence index if structured content is detected |
| unsupported / irrelevant / unknown | none |

---

## Agent-to-Index Mapping

| Agent | Primary index |
| ----- | ----- |
| perturbation_evidence | perturbation_evidence_index |
| pathway_signature | pathway_signature_index |
| robustness_quality | robustness_quality_index |
| language_causality | language_rules_index, provenance_index |

---

## Evidence Type Taxonomy

`Evidence_type` (Step 6 `Evidence_fields.Evidence_type`) describes what kind of scientific evidence a chunk contains.

| Evidence_type | Meaning |
| ----- | ----- |
| differential_expression | Evidence describing gene-level differential expression after a perturbation or comparison. |
| target_gene_effect | Evidence describing the direct measured effect of perturbing a target gene, such as on-target knockdown strength or target-gene expression change. |
| pathway_enrichment | Evidence describing enrichment or depletion of a pathway after perturbation or comparison. |
| signature_score | Evidence describing a pathway-like or cell-state-like gene signature score, such as interferon response, exhaustion-like signature, or Th2-like polarization. |
| gene_set_overlap | Evidence describing overlap between observed differentially expressed genes and a pathway/signature gene set. |
| guide_robustness | Evidence describing whether effects are consistent across guides. |
| donor_robustness | Evidence describing whether effects are consistent across donors or biological replicates. |
| cell_count_quality | Evidence describing whether enough cells support the target/condition/chunk. |
| off_target_flag | Evidence describing possible off-target perturbation effects. |
| low_target_expression_flag | Evidence describing low baseline or weak measurable expression of the target gene. |
| analysis_thresholds | Evidence describing filtering thresholds, statistical cutoffs, or inclusion/exclusion rules. |
| dataset_provenance | Evidence describing source files, dataset scope, Claude Science session details, schema notes, or processing provenance. |
| language_rule | Evidence describing how risky biological wording should be interpreted, such as "drives," "suppresses," "therapeutic target," or "mechanism." |
| rewrite_rule | Evidence describing how to rewrite overstrong biological language into safer dataset-grounded language. |
| unknown | Evidence type could not be confidently classified. |

---

## Evidence_Type Values and Their Map to the Five Artifact Indexes

| Index | Likely Evidence_type values |
| ----- | ----- |
| perturbation_evidence_index | differential_expression, target_gene_effect |
| pathway_signature_index | pathway_enrichment, signature_score, gene_set_overlap |
| robustness_quality_index | guide_robustness, donor_robustness, cell_count_quality, off_target_flag, low_target_expression_flag |
| language_rules_index | language_rule, rewrite_rule |
| provenance_index | analysis_thresholds, dataset_provenance |
| fallback | unknown |

This table is guidance for deterministic chunk classification. It does not replace the `Evidence_type` taxonomy. If a chunk cannot be confidently classified, use `Evidence_type = "unknown"` and add a relevant `Quality_flags` value such as `parse_warning` or `not_specified`.

---

## Quality Flags Taxonomy

`Quality_flags` (Step 6 `Evidence_fields.Quality_flags`) are warning labels used by `robustness_quality` and `language_causality`. They do not automatically make a claim unsupported, but they can push verdicts toward `supports_with_caveats`, `weak_support`, `insufficient_evidence`, or `needs_review` depending on the evidence.

| Quality_flag | Meaning |
| ----- | ----- |
| low_target_gex | Target gene has low baseline expression or weak measurable expression, making perturbation interpretation less reliable. |
| neighboring_gene_KD | Perturbation may affect a neighboring gene or nearby target region. |
| distal_offtarget_flag | Perturbation has a possible distal off-target effect. |
| low_n_cells_target | Too few cells support the target/condition evidence chunk. |
| single_guide_only | Evidence relies on only one guide or weak guide coverage. |
| weak_donor_support | Effect is not robust across donors or donor support is limited. |
| weak_guide_support | Effect is not robust across guides or guide support is limited. |
| missing_condition | Condition was missing from the parsed evidence chunk. |
| ambiguous_condition | Condition maps to multiple dataset values or is underspecified. |
| missing_direction | Direction could not be extracted from the evidence chunk. |
| ambiguous_pathway_mapping | Pathway phrase maps ambiguously to multiple possible pathways/signatures. |
| multiple_pathway_candidates | Multiple candidate pathway/signature IDs are plausible and should be preserved. |
| cell_state_not_cell_identity | A cell-state/signature phrase should not be treated as proof of a fully verified cell type. |
| knockout_language_but_crispri_dataset | Claim or artifact uses knockout language even though the demo dataset uses CRISPRi/knockdown-style perturbation. |
| missing_required_statistics | Important expected quantitative fields such as `padj`, `log_fc`, `n_guides`, `donor_score`, or `overlap_genes` are missing. |
| parse_warning | File/chunk was parsed with uncertainty, incomplete structure, or fallback parsing. |
| not_specified | Value was not specified in the parsed artifact. |

---

## Recommended Statistics Keys for Evidence Fields

`Evidence_fields.Statistics` is a flexible object, not a fixed taxonomy — but chunks built from each artifact type should populate the following recommended keys where available, so that `Text_for_embedding` generation and agent evaluation have consistent fields to draw from.

**Perturbation Evidence**

```json
"Statistics": {
  "n_total_de_genes": 142,
  "top_up": ["IFIT1", "ISG15", "MX1"],
  "top_down": ["IL2RA", "CCR7"],
  "ontarget_effect_size": -1.2,
  "ontarget_significant": true,
  "log_fc": -0.8,
  "adj_p_value": 0.0004,
  "p_value": 0.00001
}
```

**Pathway Significance**

```json
"Statistics": {
  "pathway_name": "Interferon Signaling",
  "direction": "down",
  "enrichment_score": -2.1,
  "normalized_enrichment_score": -1.8,
  "padj": 0.003,
  "overlap_genes": ["IFIT1", "IFIT2", "ISG15", "MX1"]
}
```

**Robustness**

```json
"Statistics": {
  "n_guides": 3,
  "donor_score": 0.82,
  "guide_score": 0.76,
  "n_cells_target": 1240,
  "keep_for_DE": true
}
```

**Provenance**

```json
"Statistics": {
  "thresholds": {
    "adj_p_value": 0.05,
    "min_log_fc": 0.25
  },
  "dataset_scope": "Primary human CD4+ T cell Perturb-seq",
  "session_name": "Claude Science handoff"
}
```

**Language Rules**

```json
"Statistics": {
  "risk_level": "medium",
  "trigger_word": "suppresses",
  "claim_type": "pathway_effect"
}
```

---

## Deterministic Text_for_Embedding Templates for Each Artifact Index

`Text_for_embedding` is generated deterministically from artifact type, chunk metadata, and structured payload using fixed templates below — Claude is not called to generate embedding text. If a field is missing, replace it with `"not specified"` rather than dropping the whole template.

**Shared variables:** `{target_gene}` `{perturbation_type}` `{condition}` `{conditions}` `{cell_context}` `{assay_context}` `{direction}`

**Default fallbacks:**

- `{perturbation_type}` = `"perturbation"`
- `{cell_context}` = `"cells"`
- `{assay_context}` = `"single-cell analysis"`
- missing values = `"not specified"`

**Perturbation Evidence**

> {target_gene} {perturbation_type} in {condition} {cell_context} from {assay_context} produced {n_total_de_genes} differentially expressed genes. Top upregulated genes include {top_up}. Top downregulated genes include {top_down}. On-target effect size was {ontarget_effect_size}; on-target significant = {ontarget_significant}. This chunk supports gene-level perturbation evidence for {target_gene} in {condition} {cell_context}.

**Pathway Evidence**

> {target_gene} {perturbation_type} in {condition} {cell_context} from {assay_context} shows {direction} pathway or signature evidence for {pathway_name}. Overlap genes include {overlap_genes}. Enrichment score is {enrichment_score}; adjusted p-value is {padj}. This chunk supports pathway/signature evidence for {pathway_name} after {target_gene} perturbation in {cell_context}.

**Robustness**

> {target_gene} {perturbation_type} in {condition} {cell_context} from {assay_context} has {n_guides} guide support, donor robustness {donor_score}, guide robustness {guide_score}, and {n_cells_target} target cells. Low target expression flag = {low_target_gex}; off-target flags = {offtarget_flags}; keep for differential expression = {keep_for_DE}. This chunk supports robustness and quality assessment for {target_gene} evidence in {condition} {cell_context}.

**Provenance**

> This evidence was generated from source file {source_file} during Claude Science session {session_name}. The analysis used {assay_context} data with cell context {cell_context}. Processing used thresholds {thresholds}. Dataset scope was {dataset_scope}. Caveats include {caveats}. This chunk supports provenance, auditability, schema interpretation, and filtering context for GeneGround evidence review.

**Language Rules**

> Language rule for claim type {claim_type}: the phrase "{trigger_word}" is a {risk_level} wording signal because it may imply {implied_meaning}. Required evidence includes {required_evidence}. If evidence is insufficient, use safer wording such as "{safer_rewrite_pattern}". This chunk supports language_causality review for strength words, causal words, mechanism claims, regulatory claims, pathway/signature claims, cell-state claims, and therapeutic relevance claims.

---

## Deterministic Question Templates for AgentQueryPlan

`AgentQueryPlan` questions are generated deterministically from agent type, normalized claim entities, `claim_type`, language flags, and the fixed templates below — Claude is not called to generate `AgentQueryPlan` questions.

**Shared variables:** `{target_gene}` `{perturbation_type}` `{conditions}` `{cell_context}` `{direction}` `{pathway_keywords}` `{claim_type}` `{strength_words}` `{causal_words}`

**Default fallbacks:**

- `{perturbation_type}` = `"perturbation"`
- `{cell_context}` = `"cells"`
- missing values = `"not specified"`

**Perturbation Evidence**

- General: "Did {target_gene} {perturbation_type} produce relevant differential expression evidence in {conditions} {cell_context}?"
- If direction exists: "Did {target_gene} {perturbation_type} produce differential expression evidence consistent with a {direction} effect in {conditions} {cell_context}?"

**Pathway Signature**

- "Did {target_gene} {perturbation_type} show {direction} evidence for {pathway_keywords} pathway/signature activity in {conditions} {cell_context}?"

**Robustness Quality**

- "Is the evidence for {target_gene} {perturbation_type} in {conditions} {cell_context} reliable across guides, donors, cells, and quality flags?"

**Language Causality**

- General: "Is the claim wording justified by the retrieved dataset evidence, especially claim type {claim_type}, strength words {strength_words}, and causal words {causal_words}?"
- For a specific risky word: "Is the wording '{strength_word}' justified by transcriptomic, pathway/signature, perturbation, or cell-state evidence, or should it be softened?"

---

## Retrieval Reason Template Taxonomies

Chunk retrieval reasons (Step 7 `retrieval_reasons`) are generated from the following fixed templates:

- Matched target_gene_symbol = {gene}
- Matched condition = {condition}
- Included because condition '{raw_condition}' maps to {condition}
- Matched pathway keyword = {keyword}
- Matched pathway candidate ID = {candidate_id}
- Matched normalized direction = {direction}
- Matched language trigger word = {word}
- Matched claim_type = {claim_type}
- Retrieved from primary index for agent = {agent_name}
- Included because provenance may affect robustness interpretation
- Retrieved by semantic fallback using text_for_embedding
- No exact metadata match; included as nearest available evidence

---

## Retrieval Mode Taxonomy

`retrieval_mode` (Step 7) records how a chunk was retrieved for a given agent query.

| Retrieval_mode | Meaning |
| ----- | ----- |
| metadata_exact | Chunk matched the relevant normalized metadata filters exactly, such as gene, condition, pathway/signature, and direction where applicable. |
| metadata_partial | Chunk matched some important metadata filters but not all required filters. |
| local_vector_fallback | Chunk was retrieved by local TF-IDF vector fallback comparing `AgentQueryPlan` query text against `Text_for_embedding`. |
| hybrid_metadata_and_local_vector | Chunk was supported by both metadata matching and local TF-IDF vector fallback. |
| not_retrieved | No suitable chunk was retrieved for that agent query. |

Retrieval is metadata-first. Local TF-IDF vector fallback is used only when metadata retrieval finds too little or needs semantic backup. Do not expose `similarity_score` in output JSON; use `retrieval_mode` and `retrieval_reasons` instead.

> **Note on `manual_demo`:** the `RetrievalMode` type also reserves a `manual_demo` value for chunks sourced from a fixed demo fixture or manually curated demo path. The live retrieval pipeline (`evidenceRetrieval.ts`) never produces this value today — it only emits `metadata_exact`, `metadata_partial`, `local_vector_fallback`, `hybrid_metadata_and_local_vector`, or `not_retrieved`. Treat `manual_demo` as reserved for future dev/demo fixtures, not as an active retrieval mode.

---

## Agent-Level Verdict Guidelines

These are the internal agent verdicts returned by the API-powered `agent_results` output in [`docs/geneground-backend-logic.md`](./geneground-backend-logic.md) Step 7B — Four Agent Evaluations. They are not the final user-facing claim verdict.

| Agent-level verdict | Meaning |
| ----- | ----- |
| supports | This agent's evidence clearly supports the relevant part of the claim. |
| supports_with_caveats | Evidence supports the claim component, but has ambiguity, quality caveats, or wording limits. |
| weak_support | Evidence points in the same direction but is incomplete, indirect, weak, or too broad. |
| contradicts | Evidence points against the claim or opposite direction. |
| insufficient_evidence | This agent could not retrieve enough relevant evidence to judge. |
| not_applicable | This agent's evidence type is not relevant to this claim. |
| needs_review | Evidence is conflicting, ambiguous, or too messy for deterministic judgment. |

---

## Agent-Level Verdicts by Agent

### Perturbation_Evidence Agent

| Verdict | Use when |
| ----- | ----- |
| `supports` | Target gene/perturbation matches, condition matches, DE evidence exists, direction is compatible if direction is claimed. |
| `supports_with_caveats` | DE evidence exists, but condition is ambiguous, effect is moderate, or some fields are missing. |
| `weak_support` | Perturbation has some signal, but not clearly tied to the claim's direction/pathway/object. |
| `contradicts` | DE evidence points opposite to the claimed direction or no perturbation effect where claim says strong effect. |
| `insufficient_evidence` | No relevant perturbation chunks retrieved. |
| `not_applicable` | Claim is not about perturbation or gene effect. |
| `needs_review` | Multiple chunks disagree across conditions/timepoints. |

### Pathway_Signature Agent

| Verdict | Use when |
| ----- | ----- |
| `supports` | Pathway/signature matches and direction matches. |
| `supports_with_caveats` | Pathway matches, but multiple candidate signatures exist or condition is ambiguous. |
| `weak_support` | Related pathway evidence exists but not exact pathway, condition, or direction. |
| `contradicts` | Pathway evidence points opposite to the claim. |
| `insufficient_evidence` | No relevant pathway/signature chunks retrieved. |
| `not_applicable` | Claim is gene-level/method-only and not about pathway/signature/cell state. |
| `needs_review` | Conflicting pathway candidates or mixed enrichment results. |

### Robustness_Quality Agent

| Verdict | Use when |
| ----- | ----- |
| `supports` | Evidence has enough guide/donor support and no major QC/off-target flags. |
| `supports_with_caveats` | Evidence is usable but has minor caveats, such as condition ambiguity or moderate donor/guide support. |
| `weak_support` | Evidence exists but has serious limitations: single guide, low target expression, weak donor support, low cells. |
| `contradicts` | Quality data says the evidence should not be trusted or should be excluded. |
| `insufficient_evidence` | No robustness/QC chunks retrieved. |
| `not_applicable` | Rare. Most biological claims can use robustness review, but method-only claims may not need it. |
| `needs_review` | QC/provenance signals conflict. |

### Language_Causality Agent

| Verdict | Use when |
| ----- | ----- |
| `supports` | Claim uses cautious language like "associated with," "consistent with," "suggests," or directional wording fully supported by evidence. |
| `supports_with_caveats` | Wording is mostly okay but should specify dataset/condition/signature-level evidence. |
| `weak_support` | Wording is stronger than evidence, but a softened version would be valid. |
| `contradicts` | Language asserts something directly contradicted by evidence. Rare for this agent. |
| `insufficient_evidence` | Language claim requires evidence not present, such as therapeutic validation or mechanism. |
| `not_applicable` | Very rare; almost every claim has wording. |
| `needs_review` | Wording has multiple risky interpretations. |

---

## Claim-Level Verdict Guidelines

`final_verdict` is computed deterministically from the pattern of agent-level verdicts above.

| Final verdict | Meaning | Agent-level pattern |
| ----- | ----- | ----- |
| supported | Dataset evidence supports the claim and wording is appropriately cautious. | Perturbation = supports; pathway = supports or not_applicable; robustness = supports; language = supports. |
| supported_with_caveats | Core claim is supported, but there are robustness, ambiguity, condition, pathway, or wording caveats. | Biology agents mostly supports / supports_with_caveats; robustness or language has supports_with_caveats; no agent contradicts. |
| partially_supported | Some parts are supported, but other parts are missing, too broad, or too strong. | At least one biology agent supports, but another key biology agent is weak_support or insufficient_evidence; language may be supports_with_caveats or weak_support. |
| overstated | Evidence points in the same general direction, but wording is stronger than the data supports. | Perturbation/pathway are supports, supports_with_caveats, or weak_support, but language = weak_support or insufficient_evidence due to high-risk words like "master regulator," "therapeutic target," "causes," "proves," "mechanism." |
| unsupported | Retrieved evidence does not support the claim or points against it. | Perturbation or pathway = contradicts; or key evidence directly conflicts with claimed direction/object. |
| insufficient_evidence | Not enough relevant evidence was retrieved. | Perturbation and pathway are both insufficient_evidence, or most relevant agents are insufficient_evidence; no clear contradiction. |
| needs_review | Conflicting/ambiguous results require human review. | Strong conflict between agents, mixed condition-specific findings, contradictory chunks, or agent verdicts include needs_review. |

Note the naming distinction: the agent-level taxonomy above uses `supports_with_caveats`, while the claim-level (final, user-facing) verdict uses `supported_with_caveats`. These are deliberately different labels for different layers of the pipeline — do not use them interchangeably.

---

## User Requested Annotation Action Taxonomy

| User says | Requested action |
| ----- | ----- |
| "Why was this flagged?" | explain_verdict |
| "Show me the evidence" | show_evidence |
| "Rewrite this more cautiously" | rewrite_cautiously |
| "Can you re-check this?" | reevaluate_selection |
| "Split this into claims" | split_claim |
| "Check the literature" | check_literature_grounding |
| "Use the safer version" | apply_existing_rewrite |
| "What changed?" | compare_original_and_rewrite |

---

## Agents to Rerun for User-Annotated Changes

| User request | Agents to rerun |
| ----- | ----- |
| "Rewrite this more cautiously" | language_causality, final_aggregator |
| "Is this pathway actually supported?" | pathway_signature, final_aggregator |
| "Is the gene perturbation evidence strong?" | perturbation_evidence, robustness_quality, final_aggregator |
| "Is this robust across donors/guides?" | robustness_quality, final_aggregator |
| "Does literature support this?" | literature_grounding |
| "Reevaluate this whole sentence" | all four agents + final_aggregator |
| "Just show evidence" | none |
| "Apply rewrite" | none |

---

## User Annotation Selection Scope Taxonomy

| Selection | Scope |
| ----- | ----- |
| One risky word like "drives" | word_or_phrase |
| Phrase inside a claim like "suppresses interferon signaling" | partial_claim |
| Whole claim but not whole sentence | full_claim |
| One full sentence | sentence |
| More than one sentence | multi_sentence |
| Whole paragraph | paragraph |
| Cannot classify | unknown |

---

## User Proposed Change Type Dictionary

| Change type | Meaning |
| ----- | ----- |
| replace_span | Replace selected phrase only. |
| replace_sentence | Replace the whole sentence/claim. |
| add_caveat | Add cautious language without replacing claim. |
| specify_condition | Add Rest / Stim8hr / Stim48hr specificity. |
| split_sentence | Split one sentence into multiple claims/sentences. |
| remove_claim | Remove unsupported claim. |
| no_change | Answer question but do not edit text. |

---

## Action Plan Status Taxonomy

| Status | Meaning |
| ----- | ----- |
| awaiting_user_approval | Change is proposed but not applied. |
| approved | User approved the plan. |
| edited_before_apply | User modified proposed text before applying. |
| applied | Change was applied to rewritten omics analysis. |
| cancelled | User rejected/cancelled. |
| reverted | User reverted to older version. |
| failed | Change failed technically. |

---

## Rewrite Rule Taxonomy for Revised Omics Analysis

| Original risky wording | Safer replacement |
| ----- | ----- |
| drives | is associated with |
| causes | is consistent with / is associated with |
| proves | is consistent with |
| master regulator | candidate regulator |
| key regulator | candidate regulator or potential regulator |
| therapeutic target | candidate for further study |
| mechanism | possible mechanism or remove |
| suppresses | is associated with decreased |
| activates | is associated with increased |
| reprograms | is associated with changes in |
| rescues | partially restores only if directly supported; otherwise soften |

---

## Rewrite Behavior by Final Verdict

| Final verdict | Rewrite behavior |
| ----- | ----- |
| supported | no rewrite needed |
| supported_with_caveats | only rewrite if original wording contains risky/causal/overstrong language |
| partially_supported | rewrite |
| overstated | rewrite |
| unsupported | rewrite or flag/remove |
| insufficient_evidence | rewrite as hypothesis-generating or mark unevaluable |
| needs_review | rewrite cautiously or ask user to review |
