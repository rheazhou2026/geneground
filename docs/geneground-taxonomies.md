**Condition Mapping Rules**

| Raw condition | Candidate dataset values | Resolution |
| ----- | ----- | ----- |
| Rest | \["Rest"\] | resolved |
| rest | \["Rest"\] | resolved |
| resting | \["Rest"\] | resolved |
| unstimulated | \["Rest"\] | resolved |
| Stim8hr | \["Stim8hr"\] | resolved |
| 8hr | \["Stim8hr"\] | resolved |
| 8 hour | \["Stim8hr"\] | resolved |
| early stimulation | \["Stim8hr"\] | resolved |
| Stim48hr | \["Stim48hr"\] | resolved |
| 48hr | \["Stim48hr"\] | resolved |
| 48 hour | \["Stim48hr"\] | resolved |
| late stimulation | \["Stim48hr"\] | resolved |
| stimulated | \["Stim8hr", "Stim48hr"\] | ambiguous |
| after stimulation | \["Stim8hr", "Stim48hr"\] | ambiguous |
| stimulated conditions | \["Stim8hr", "Stim48hr"\] | ambiguous |
| early and late stimulation | \["Stim8hr", "Stim48hr"\] | resolved\_multiple |
| no condition | \[\] | unresolved |

**Claim Type for Language Causality Agent**

| Claim type | Meaning | Example |
| ----- | ----- | ----- |
| perturbation\_effect | Claim says a perturbation changed something biologically. | “STAT1 knockdown altered inflammatory activation.” |
| gene\_expression\_effect | Claim says a gene or gene set increased/decreased. | “IFIT1 expression decreased after STAT1 knockdown.” |
| pathway\_effect | Claim says a pathway/signature changed. | “STAT1 knockdown suppresses interferon signaling.” |
| cell\_state\_effect | Claim says cells shifted toward a state or phenotype. | “IRF4 perturbation shifts cells toward a Th2-like state.” |
| condition\_specific\_effect | Claim depends on Rest / Stim8hr / Stim48hr / stimulation timing. | “The effect appears only after stimulation.” |
| regulatory\_role | Claim says a gene is a regulator/key regulator/master regulator. | “STAT1 is a key regulator of inflammatory activation.” |
| causal\_mechanism | Claim implies direct mechanism or causality. | “STAT1 causes interferon suppression.” |
| therapeutic\_relevance | Claim connects result to therapeutic targeting/intervention. | “IRF4 is a therapeutic target for immune modulation.” |
| robustness\_claim | Claim says evidence is robust, reproducible, validated, or reliable. | “The effect is consistent across donors.” |
| comparative\_claim | Claim compares two genes, conditions, pathways, or timepoints. | “STAT1 has a stronger effect than IRF1.” |
| novelty\_claim | Claim says something is new, unexpected, or previously unknown. | “This reveals a novel regulator of T cell activation.” |
| summary\_claim | Broad summary statement combining multiple findings. | “Together, these results show broad immune reprogramming.” |
| unsupported\_generalization | Broad claim that may exceed the dataset scope. | “This proves STAT1 controls immune disease.” |
| method\_or\_data\_claim | Claim about data, method, analysis, or dataset rather than biology. | “The Perturb-seq data contains strong guide coverage.” |
| unknown | Fallback when claim type is unclear. | N/A |

**Direction Dictionary for Normalization Step**

| Raw words | Normalized direction |
| ----- | ----- |
| up, increased, increase, increases, upregulated, upregulate, upregulates, higher, elevated, induced, induces, induce, activates, activate, activated, enhances, promotes, enriched | up |
| down, decreased, decrease, decreases, downregulated, downregulate, downregulates, lower, reduced, reduces, reduce, suppressed, suppresses, suppress, inhibits, depleted, attenuated | down |
| altered, alter, alters, changed, change, changes, modulated, modulate, modulates, affected, affect, affects, shifted, shift, shifts, perturbed, rewired | changed |
| drives, causes, controls, regulates, reprograms, rescues without a clear up/down direction | ambiguous |
| No direction detected | unresolved |

## Source Taxonomy for Genes and Pathways

`Source` describes where a normalized gene or pathway mapping came from. It is separate from `Match_type`.

- `Source` = which reference layer produced the mapping.  
- `Match_type` = how the raw text matched within that reference layer.

`Source` is currently used only for Genes and Pathways. Do not add `Source` to Cell\_context.

### Gene Source taxonomy

| Source | Meaning |
| ----- | ----- |
| HGNC | Gene was resolved through the HGNC mini ontology, including approved symbols, alias symbols, or previous symbols. |
| manual\_alias\_override | Gene did not resolve through HGNC but matched the GeneGround manual alias override table. |
| unresolved | Gene could not be resolved through HGNC or manual alias overrides. |

Gene normalization order is HGNC-first: exact\_symbol, alias\_symbol, previous\_symbol, then manual\_alias\_override fallback, then unresolved. Manual alias overrides should not override an HGNC match.

### Pathway Source taxonomy

| Source | Meaning |
| ----- | ----- |
| Reactome | Pathway candidate came from the Reactome mini pathway ontology. |
| curated\_immune\_signature | Pathway/signature candidate came from the GeneGround curated immune signature dictionary. |
| Reactome + curated\_immune\_signature | Both Reactome and curated immune signature candidates were plausible and were preserved. |
| unresolved | Pathway/signature phrase could not be mapped to Reactome or curated immune signatures. |

Pathway normalization should preserve ambiguity. If Reactome and curated immune signatures are both plausible, use Source \= "Reactome + curated\_immune\_signature" and preserve all candidate IDs.

`curated_fallback` is a pathway `Match_type`, not a `Source`. It means the raw pathway/signature phrase did not cleanly resolve to Reactome but mapped to a GeneGround curated immune signature. This is used for terms like Th1-like polarization, Th2-like polarization, exhaustion-like signature, inflammatory response, or interferon response.

## Gene Match\_type taxonomy

| Match\_type | Meaning |
| ----- | ----- |
| exact\_symbol | Raw gene text exactly matches an approved HGNC symbol in the mini HGNC ontology. |
| alias\_symbol | Raw gene text matches an HGNC alias\_symbol entry in the mini HGNC ontology. |
| previous\_symbol | Raw gene text matches an HGNC prev\_symbol entry in the mini HGNC ontology. |
| manual\_alias\_override | Raw gene text did not resolve through HGNC approved/alias/previous symbols, but matched the GeneGround manual alias override table. |
| unresolved | Raw gene text could not be mapped to an HGNC symbol or manual alias override. |

Gene normalization order is HGNC-first: exact\_symbol, alias\_symbol, previous\_symbol, then manual\_alias\_override fallback. Manual alias overrides should not override an HGNC match.

## Pathway Match\_type taxonomy

| Match\_type | Meaning |
| ----- | ----- |
| exact\_name | Raw pathway text exactly matches a Reactome pathway name or curated signature display name. |
| alias | Raw pathway text matches a known alias from Reactome-derived aliases or curated immune signature aliases. |
| keyword | Raw pathway text matches pathway/signature keywords such as interferon, cytokine, inflammatory, NF-kB, JAK-STAT, T cell, cell cycle, apoptosis, or proliferation. |
| curated\_fallback | Raw pathway text does not cleanly resolve to Reactome but maps to a curated immune signature such as Th1-like polarization, Th2-like polarization, exhaustion-like signature, inflammatory response, or interferon response. |
| unresolved | Raw pathway text could not be mapped to Reactome or a curated immune signature. |

Pathway normalization should preserve multiple candidates. Do not force one Reactome ID when Reactome plus curated immune signatures are both plausible.

**Strength Word Dictionary for Language Causality Agent**

| Word Type | Keywords/signals |
| ----- | ----- |
| **Low-risk/cautious** | **associated with, consistent with, suggests, may, candidate, linked to. correlated with, appears to, observed, shows evidence of** |
| **Medium-risk** | **affects, modulates, alters, shifts, reduces, increases, suppresses, activates, enriches, depletes, promotes, impairs, regulates** |
| **High-risk** | **drives, controls, determines, establishes, reprograms, rescues, confirms, validates, proves, demonstrates, master regulator, central regulator, key regulator, therapeutic target, drug target, mechanism, causal mechanism** |

**Causal Word Dictionary for Language Causality Agent**

| Format | Keywords/signals |
| ----- | ----- |
| **Word list** | **causes, drives, leads to, results in, is required for, is necessary for, is sufficient for, controls, determines, mediates, through, via, mechanism, mechanistically, reprograms, rescues, restores, establishes, proves** |
| **Phrase patterns** | **X is required for Y, X is sufficient to induce Y, X acts through Y, X mediates Y, X controls Y, X establishes Y state, X proves Y mechanism** |

**User-Inputted Handoff Folder File Artifact Type**

| Artifact type | Keywords/signals | Corresponding index | Priority |
| ----- | ----- | ----- | ----- |
| **perturbation\_evidence** | **perturbation, DE\_stats, differential\_expression, gene\_level\_de, log\_fc, adj\_p\_value, zscore, top\_changed\_genes, ontarget** | **perturbation\_evidence\_index** | **High if compact structured evidence file such as .json, .csv, .tsv, or .parquet. Medium if report text summarizes DE evidence but is not row-structured. Low if only a figure/plot. Ignored if huge .h5ad/matrix file intended for Claude Science processing rather than web MVP.** |
| **pathway\_evidence** | **pathway, signature, enrichment, Reactome, Hallmark, interferon, NF-kB, overlap\_genes, padj** | **pathway\_signature\_index** | **High if compact pathway/signature enrichment table or packet, especially .json, .csv, .tsv, .gmt, or .parquet. Medium if analysis/report text contains pathway evidence. Low if visualization only. Ignored if huge pathway database dump or unsupported binary.** |
| **robustness\_evidence** | **robustness, guide, donor, pseudobulk, low\_target\_gex, neighboring\_gene\_KD, distal\_offtarget\_flag, n\_cells\_target, keep\_for\_DE, QC** | **robustness\_quality\_index** | **High if compact guide/donor/QC/robustness summary file. Medium if QC report text or provenance report describes caveats. Low if only a QC visualization. Ignored if raw pseudobulk matrix is huge and not already summarized.** |
| **language\_rules** | **language\_rules, claim\_language, causal\_words, strength\_words, safer\_rewrites, master regulator, therapeutic target, mechanism** | **language\_rules\_index** | **High if structured JSON/TSV/CSV rules or curated rule file. Medium if rules are embedded in a report or markdown note. Low if incomplete scratch notes. Usually never ignored unless irrelevant or unreadable, because language rules are small and directly useful.** |
| **provenance** | **provenance, manifest, import\_log, dataset\_inventory, schema\_map, source\_files, processing\_report, thresholds, caveats** | **provenance\_index** | **High if it contains schema maps, dataset inventory, source file mapping, thresholds, or processing caveats needed for auditability. Medium if general import/session report. Low if vague notes with little machine-readable content. Ignored only if irrelevant or duplicate.** |
| **demo\_claims** | **demo\_claims, gold\_verdicts, example\_claims, expected\_verdicts, demo\_examples** | **usually demo\_examples\_index** | **Medium by default because useful for MVP testing but not biological evidence. High only in demo/dev mode if needed to populate examples. Low if outdated or incomplete. Ignored in production mode or once real Claude Science evidence is available.** |
| **ontology\_reference** | **hgnc, cell\_ontology, cl-basic, reactome, ontology, dataset\_terms** | **no artifact evidence index; used for normalization** | **High for normalization if compact/current mini ontology or dataset terms file. Medium if full ontology/source reference that needs preprocessing. Low if outdated, duplicate, or too broad. Ignored for artifact evidence indexes because ontology files support entity normalization, not claim evidence verdicts. Not placed into an artifact evidence index\!** |
| **raw\_omics\_data** | **.h5ad, .h5mu, .loom, .mtx, raw\_cell, assigned\_guide, huge matrix** | **ignored for web MVP** | **Ignored for web MVP if large raw matrix. Low only if tiny toy/demo matrix. Medium only in a backend/offline processing mode. Never High for the browser-facing artifact index flow because raw omics data should be processed in Claude Science first and exported as compact evidence packets.** |
| **visualization** | **.png, .jpg, .svg, plot, figure, UMAP** | **usually ignored or provenance/report only** | **Low by default because figures are hard to chunk into structured evidence. Medium if figure has a paired caption/report or is important for provenance/audit display. Ignored if decorative, duplicate, or not machine-readable. Not High unless you later add figure OCR/vision parsing, which I would avoid for MVP.** |
| **report** | **.md, .txt, .pdf, summary, analysis\_report, final\_report** | **usually provenance\_index, sometimes evidence index if content is structured** | **Medium by default. High if the report contains structured tables, explicit thresholds, caveats, or summarized evidence that can be parsed into chunks. Low if narrative-only or redundant. Ignored if unrelated, outdated, or impossible to parse safely.** |
| **unsupported** | **unsupported file type** | **ignored** | **Ignored. Use ignored\_unsupported\_type or needs\_manual\_review.** |
| **irrelevant** | **unrelated file** | **ignored** | **Ignored. Use ignored\_irrelevant.** |
| **unknown** | **insufficient signals** | **manual review** | **Low if potentially relevant but unclear. Ignored / needs\_manual\_review if no useful signals. Do not assign High unless the Artifact Discovery Agent finds strong content signals after previewing the file.** |

**Artifact Index Placement Guidelines**

| Artifact type | Corresponding index |
| ----- | ----- |
| **perturbation\_evidence** | **perturbation\_evidence\_index** |
| **pathway\_evidence** | **pathway\_signature\_index** |
| **robustness\_evidence** | **robustness\_quality\_index** |
| **language\_rules** | **language\_rules\_index** |
| **provenance** | **provenance\_index** |
| **demo\_claims** | **demo\_examples\_index** |
| **ontology\_reference** | **none** |
| **raw\_omics\_data** | **none** |
| **visualization** | **usually none, sometimes provenance\_index** |
| **report** | **usually provenance\_index; optionally evidence index if structured content is detected** |
| **unsupported / irrelevant / unknown** | **none** |

**Agent-to-Index Mapping**

| Agent | Primary index |
| ----- | ----- |
| perturbation\_evidence | perturbation\_evidence\_index |
| pathway\_signature | pathway\_signature\_index |
| robustness\_quality | robustness\_quality\_index |
| language\_causality | language\_rules\_index, provenance\_index |

**Evidence Type Taxonomy for Chunk Metadata (Step 6 `Evidence_fields.Evidence_type`)**

* `differential_expression`  
* `target_gene_effect`  
* `pathway_enrichment`  
* `signature_score`  
* `gene_set_overlap`  
* `guide_robustness`  
* `donor_robustness`  
* `cell_count_quality`  
* `off_target_flag`  
* `low_target_expression_flag`  
* `analysis_thresholds`  
* `dataset_provenance`  
* `language_rule`  
* `rewrite_rule`  
* `unknown`

**Evidence\_type Values and Their Map to the Five Artifact Indexes**

| Index | Likely Evidence\_type values |
| ----- | ----- |
| perturbation\_evidence\_index | differential\_expression, target\_gene\_effect |
| pathway\_signature\_index | pathway\_enrichment, signature\_score, gene\_set\_overlap |
| robustness\_quality\_index | guide\_robustness, donor\_robustness, cell\_count\_quality, off\_target\_flag, low\_target\_expression\_flag |
| language\_rules\_index | language\_rule, rewrite\_rule |
| provenance\_index | analysis\_thresholds, dataset\_provenance |
| fallback | unknown |

This table is guidance for deterministic chunk classification. It does not replace the Evidence\_type taxonomy. If a chunk cannot be confidently classified, use Evidence\_type \= "unknown" and add a relevant Quality\_flags value such as "parse\_warning" or "not\_specified".

**Quality Flags Taxonomy for Chunk Metadata (Step 6 `Evidence_fields.Quality_flags`)**

| Quality\_flag | Meaning |
| ----- | ----- |
| low\_target\_gex | Target gene has low baseline expression or weak measurable expression, making perturbation interpretation less reliable. |
| neighboring\_gene\_KD | Perturbation may affect a neighboring gene or nearby target region. |
| distal\_offtarget\_flag | Perturbation has a possible distal off-target effect. |
| low\_n\_cells\_target | Too few cells support the target/condition evidence chunk. |
| single\_guide\_only | Evidence relies on only one guide or weak guide coverage. |
| weak\_donor\_support | Effect is not robust across donors or donor support is limited. |
| weak\_guide\_support | Effect is not robust across guides or guide support is limited. |
| missing\_condition | Condition was missing from the parsed evidence chunk. |
| ambiguous\_condition | Condition maps to multiple dataset values or is underspecified. |
| missing\_direction | Direction could not be extracted from the evidence chunk. |
| ambiguous\_pathway\_mapping | Pathway phrase maps ambiguously to multiple possible pathways/signatures. |
| multiple\_pathway\_candidates | Multiple candidate pathway/signature IDs are plausible and should be preserved. |
| cell\_state\_not\_cell\_identity | A cell-state/signature phrase should not be treated as proof of a fully verified cell type. |
| knockout\_language\_but\_crispri\_dataset | Claim or artifact uses knockout language even though the demo dataset uses CRISPRi/knockdown-style perturbation. |
| missing\_required\_statistics | Important expected quantitative fields such as padj, log\_fc, n\_guides, donor\_score, or overlap\_genes are missing. |
| parse\_warning | File/chunk was parsed with uncertainty or incomplete structure. |
| not\_specified | Value was not specified in the parsed artifact. |

Quality\_flags are warning labels used by robustness\_quality and language\_causality. They should not automatically make a claim unsupported, but they can push verdicts toward supports\_with\_caveats, weak\_support, insufficient\_evidence, or needs\_review depending on the evidence.

**Retrieval Mode Taxonomy for Chunk Retrieval (Step 7 `retrieval_mode`)**

| Retrieval\_mode | Meaning |
| ----- | ----- |
| metadata\_exact | Chunk matched the relevant normalized metadata filters exactly, such as gene, condition, pathway/signature, and direction where applicable. |
| metadata\_partial | Chunk matched some important metadata filters but not all required filters. |
| local\_vector\_fallback | Chunk was retrieved by local TF-IDF vector fallback comparing AgentQueryPlan query text against Text\_for\_embedding. |
| hybrid\_metadata\_and\_local\_vector | Chunk was supported by both metadata matching and local TF-IDF vector fallback. |
| not\_retrieved | No suitable chunk was retrieved for that agent query. |
| manual\_demo | Chunk was included by a fixed demo fixture or manually curated demo path. |

Step 7 retrieval is metadata-first. Local TF-IDF vector fallback is used only when metadata retrieval finds too little or needs semantic backup. Do not expose similarity\_score in output JSON; use retrieval\_mode and retrieval\_reasons instead.

**Retrieval Reason Template Taxonomies for Chunk Retrieval in AgentQueryPlan**

Matched target\_gene\_symbol \= {gene}  
Matched condition \= {condition}  
Included because condition '{raw\_condition}' maps to {condition}  
Matched pathway keyword \= {keyword}  
Matched pathway candidate ID \= {candidate\_id}  
Matched normalized direction \= {direction}  
Matched language trigger word \= {word}  
Matched claim\_type \= {claim\_type}  
Retrieved from primary index for agent \= {agent\_name}  
Included because provenance may affect robustness interpretation  
Retrieved by semantic fallback using text\_for\_embedding  
No exact metadata match; included as nearest available evidence

**Agent-Level Verdict Guidelines**

These are the internal agent verdicts returned by the API-powered `agent_results` output in backend-logic.md Step 7B — Four Agent Evaluations. They are not the final user-facing claim verdict.

| Agent-level verdict | Meaning |
| ----- | ----- |
| supports | This agent’s evidence clearly supports the relevant part of the claim. |
| supports\_with\_caveats | Evidence supports the claim component, but has ambiguity, quality caveats, or wording limits. |
| weak\_support | Evidence points in the same direction but is incomplete, indirect, weak, or too broad. |
| contradicts | Evidence points against the claim or opposite direction. |
| insufficient\_evidence | This agent could not retrieve enough relevant evidence to judge. |
| not\_applicable | This agent’s evidence type is not relevant to this claim. |
| needs\_review | Evidence is conflicting, ambiguous, or too messy for deterministic judgment. |

**Agent-Level Verdicts by Agent (As The Four Listed Below)**

**Perturbation\_Evidence Agent**

| Verdict | Use when |
| ----- | ----- |
| `supports` | Target gene/perturbation matches, condition matches, DE evidence exists, direction is compatible if direction is claimed. |
| `supports_with_caveats` | DE evidence exists, but condition is ambiguous, effect is moderate, or some fields are missing. |
| `weak_support` | Perturbation has some signal, but not clearly tied to the claim’s direction/pathway/object. |
| `contradicts` | DE evidence points opposite to the claimed direction or no perturbation effect where claim says strong effect. |
| `insufficient_evidence` | No relevant perturbation chunks retrieved. |
| `not_applicable` | Claim is not about perturbation or gene effect. |
| `needs_review` | Multiple chunks disagree across conditions/timepoints. |

**Pathway\_Signature Agent**

| Verdict | Use when |
| ----- | ----- |
| `supports` | Pathway/signature matches and direction matches. |
| `supports_with_caveats` | Pathway matches, but multiple candidate signatures exist or condition is ambiguous. |
| `weak_support` | Related pathway evidence exists but not exact pathway, condition, or direction. |
| `contradicts` | Pathway evidence points opposite to the claim. |
| `insufficient_evidence` | No relevant pathway/signature chunks retrieved. |
| `not_applicable` | Claim is gene-level/method-only and not about pathway/signature/cell state. |
| `needs_review` | Conflicting pathway candidates or mixed enrichment results. |

**Robustness\_Quality Agent**

| Verdict | Use when |
| ----- | ----- |
| `supports` | Evidence has enough guide/donor support and no major QC/off-target flags. |
| `supports_with_caveats` | Evidence is usable but has minor caveats, such as condition ambiguity or moderate donor/guide support. |
| `weak_support` | Evidence exists but has serious limitations: single guide, low target expression, weak donor support, low cells. |
| `contradicts` | Quality data says the evidence should not be trusted or should be excluded. |
| `insufficient_evidence` | No robustness/QC chunks retrieved. |
| `not_applicable` | Rare. Most biological claims can use robustness review, but method-only claims may not need it. |
| `needs_review` | QC/provenance signals conflict. |

**Language\_Causality Agent**

| Verdict | Use when |
| ----- | ----- |
| `supports` | Claim uses cautious language like “associated with,” “consistent with,” “suggests,” or directional wording fully supported by evidence. |
| `supports_with_caveats` | Wording is mostly okay but should specify dataset/condition/signature-level evidence. |
| `weak_support` | Wording is stronger than evidence, but a softened version would be valid. |
| `contradicts` | Language asserts something directly contradicted by evidence. Rare for this agent. |
| `insufficient_evidence` | Language claim requires evidence not present, such as therapeutic validation or mechanism. |
| `not_applicable` | Very rare; almost every claim has wording. |
| `needs_review` | Wording has multiple risky interpretations. |

**Claim-Level Verdict Guidelines (Uses Agent Guidelines From Above)**

| Final verdict | Meaning | Agent-level pattern |
| ----- | ----- | ----- |
| supported | Dataset evidence supports the claim and wording is appropriately cautious. | Perturbation \= supports; pathway \= supports or not\_applicable; robustness \= supports; language \= supports. |
| supported\_with\_caveats | Core claim is supported, but there are robustness, ambiguity, condition, pathway, or wording caveats. | Biology agents mostly supports / supports\_with\_caveats; robustness or language has supports\_with\_caveats; no agent contradicts. |
| partially\_supported | Some parts are supported, but other parts are missing, too broad, or too strong. | At least one biology agent supports, but another key biology agent is weak\_support or insufficient\_evidence; language may be supports\_with\_caveats or weak\_support. |
| overstated | Evidence points in the same general direction, but wording is stronger than the data supports. | Perturbation/pathway are supports, supports\_with\_caveats, or weak\_support, but language \= weak\_support or insufficient\_evidence due to high-risk words like “master regulator,” “therapeutic target,” “causes,” “proves,” “mechanism.” |
| unsupported | Retrieved evidence does not support the claim or points against it. | Perturbation or pathway \= contradicts; or key evidence directly conflicts with claimed direction/object. |
| insufficient\_evidence | Not enough relevant evidence was retrieved. | Perturbation and pathway are both insufficient\_evidence, or most relevant agents are insufficient\_evidence; no clear contradiction. |
| needs\_review | Conflicting/ambiguous results require human review. | Strong conflict between agents, mixed condition-specific findings, contradictory chunks, or agent verdicts include needs\_review. |

**User Requested Annotation Action Taxonomy**

| User says | Requested action |
| ----- | ----- |
| “Why was this flagged?” | explain\_verdict |
| “Show me the evidence” | show\_evidence |
| “Rewrite this more cautiously” | rewrite\_cautiously |
| “Can you re-check this?” | reevaluate\_selection |
| “Split this into claims” | split\_claim |
| “Check the literature” | check\_literature\_grounding |
| “Use the safer version” | apply\_existing\_rewrite |
| “What changed?” | compare\_original\_and\_rewrite |

**Agents to Rerun for User-Annotated Changes (Conditions)**

| User request | Agents to rerun |
| ----- | ----- |
| “Rewrite this more cautiously” | language\_causality, final\_aggregator |
| “Is this pathway actually supported?” | pathway\_signature, final\_aggregator |
| “Is the gene perturbation evidence strong?” | perturbation\_evidence, robustness\_quality, final\_aggregator |
| “Is this robust across donors/guides?” | robustness\_quality, final\_aggregator |
| “Does literature support this?” | literature\_grounding |
| “Reevaluate this whole sentence” | all four agents \+ final\_aggregator |
| “Just show evidence” | none |
| “Apply rewrite” | none |

**User Annotation Selection Scope Taxonomy**

| Selection | Scope |
| ----- | ----- |
| One risky word like “drives” | word\_or\_phrase |
| Phrase inside a claim like “suppresses interferon signaling” | partial\_claim |
| Whole claim but not whole sentence | full\_claim |
| One full sentence | sentence |
| More than one sentence | multi\_sentence |
| Whole paragraph | paragraph |
| Cannot classify | unknown |

**User Proposed Change Type Dictionary**

| Change type | Meaning |
| ----- | ----- |
| replace\_span | Replace selected phrase only. |
| replace\_sentence | Replace the whole sentence/claim. |
| add\_caveat | Add cautious language without replacing claim. |
| specify\_condition | Add Rest / Stim8hr / Stim48hr specificity. |
| split\_sentence | Split one sentence into multiple claims/sentences. |
| remove\_claim | Remove unsupported claim. |
| no\_change | Answer question but do not edit text. |

**Action Plan Status Taxonomy**

| Status | Meaning |
| ----- | ----- |
| awaiting\_user\_approval | Change is proposed but not applied. |
| approved | User approved the plan. |
| edited\_before\_apply | User modified proposed text before applying. |
| applied | Change was applied to rewritten omics analysis. |
| cancelled | User rejected/cancelled. |
| reverted | User reverted to older version. |
| failed | Change failed technically. |

**Rewrite Rule Taxonomy for Revised Omics Analysis**

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

