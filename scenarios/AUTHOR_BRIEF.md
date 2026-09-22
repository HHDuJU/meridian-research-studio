# Author brief for the scenario bank (version 1.1 format), coordinating session, 2026-09-22

You write full usage scenarios for Meridian, a research-planning web application (an investigator types a
clinical or health-services research need; the application runs 13 model-assisted stages, records evidence
and decisions, saves to localStorage, exports JSON). Everything you write is SYNTHETIC: invented sources,
authors, venues, numbers, quotations. Never a real citation, real trial number, real DOI or real PMID.
Invented DOIs use the prefix `10.5555/`; no `pmid` keys anywhere. No patient data. Do not read any file under
`/home/claude/meridian/project/trial/` or any file named `cases.json`; the bank must be independent of the
project's trial cases.

Read, in this order:
1. `/home/claude/meridian-handoff/audit-2026-09-21/work-order-2/scenarios/SCENARIO_FORMAT.md` (the format,
   the golden rules G1 to G10, the steps, the predicates, the admission rules). Follow it exactly.
2. `/home/claude/meridian/repo/src/lib/ai.ts` lines 40 to 184 (the per-stage JSON schema the application
   expects from the model; a `discovery` scan response follows the `scan` schema; the other 12 stages follow
   their schema).
3. `/home/claude/meridian/repo/src/lib/evidence/appraise.ts` lines 120 to 135 (APPRAISAL_SCHEMA: the
   `appraisal` scan response over retrieved records: annotations keyed by record id, claims with sourceIds).
4. `/home/claude/meridian/repo/src/lib/evidence/records.ts` lines 1 to 60 (RawRecord for `retrieve` steps
   and `stableRecordId`: the id the application gives a retrieved record; compute the ids your annotations
   and claims cite with the same rule and say so in `notes`).
5. `/home/claude/meridian/repo/src/lib/types.ts` (the stored Study object; expectation paths follow it).
6. `/home/claude/meridian/repo/src/lib/apply-ai.ts` (how each raw response is mapped; the issue codes
   invalid-type, invalid-enum, out-of-range, malformed-boolean, dropped, resolved, cleared come from
   `contracts.ts`).
7. The three exemplars: `scenarios/bank-samples/sc-000-level1.json` (level 1 with retrieve and appraisal),
   `sc-000-level3.json` (empty search confirmed, unknowns), `sc-000-level4.json` (adversarial, supported
   acceptance then source change). Match their depth and their expectation style; do not copy their content.

Your assignments are in `scenarios/bank-v1/ASSIGNMENT_BATCHES.json` under your batch index. Each assignment
gives `id`, `field`, `topic`, `level`, `family` and `features` (the behaviours the scenario must exercise).
Write one file per assignment at `scenarios/bank-v1/<id>.json`.

Rules that the validator enforces (and a reviewer checks by hand):
- Every scenario: `version` 1, `synthetic` true, `arm` "deterministic", all 13 stages run in order (or a
  documented `earlyStop`), at least one `accept-decision`, one `reload` and one `reopen` each carrying an
  `expect`, and a final `export` with `equalsStore` after the last consequential step.
- Every consequential step (`retrieve`, `illuminate`, `confirm-empty-search`, `accept-decision`,
  `withdraw-decision`, `change-source`, `set-field`, `mark-complete`) carries an `expect` with at least one
  `store`, `stage`, `issues` or `error` check that states the correct behaviour under the golden rules. Screen
  checks name status words ("stale", "review required", "unrated", "not assessed", "leads only"), never a
  title alone.
- A completed Scan needs a `retrieve` step with at least one record, or a `confirm-empty-search` step. A scan
  `discovery` response with model leads only never completes the stage and never assigns certainty
  (`scan.gradeOverall` stays ""). Certainty comes only from an `appraisal` over retrieved records.
- A `change-source` step comes after an `accept-decision` whose expectation includes
  `design.decisions[-1].selectionStatus` "accepted" and whose decision cites claims that rest on retrieved
  records; after the change, expect "stale" in the store, on screen, in the export (`export.path`) and after
  `reload`.
- G11 (added 12:50Z): a model response never erases or replaces investigator-entered text
  (`problem.constraints` as typed, `rawNeed`, local facts); a model null or a different value for such a
  field leaves the stored text unchanged with an issue of the existing code `dropped` at path `constraints` and a visible warning that names the path and says the entered text was kept (screen check: includes "constraints" and { "anyOf": ["kept", "refused", "not applied"] }). "Explicit null
  clears a field" scenarios use a model-owned field (a grade, a recommendation, alternatives, a model-written
  statement), never the investigator's constraints. Investigator edits through `set-field` still change it.
- Level 4 and 5 scenarios include at least one response the application must refuse or quarantine, with the
  refusal stated. Level 1 scenarios have no adversarial content.
- `requires` lists the work-order entries a checkpoint depends on (use the labels the exemplars use: D1, D2,
  D5, D20, S1, S8, S10, S11, S13). Leave it empty only for behaviour the 875fe59 library already has.
- Realistic inputs: most needs 120 to 400 words, written as a clinician or researcher would type them, with
  local facts and constraints; the assignments marked "brief vague need" use 25 to 60 words. Fixture records:
  5 to 9 per search with abstracts of 80 to 160 words, invented venues and authors, years spread over a
  decade, one or two with `year` null where the level calls for unknowns. Stage responses substantive and
  specific to the topic: protocol outcomes with roles and measures, stats with sample-size reasoning, ethics
  with consent and equity, voices with 3 to 5 invented quotes, manuscript sections of a few sentences each.
- Distinctness: no two scenarios share a need, a set of records or a trajectory; renaming is not a new
  scenario.
- Plain ASCII; no em dashes or en dashes; British or American spelling either way.

Self-check before you finish: copy your files into a scratch directory of your own (only your files) and run
`node /home/claude/meridian-handoff/audit-2026-09-21/work-order-2/scenarios/validate-scenarios.mjs <that dir>`;
fix every failure in the bank copy (the scratch copy is only for the check); then run the expander on your files into a scratch folder and confirm one replay file per
model call and one retrieval file per `retrieve` step. Report: file list with sizes, validator output, expander
count, and every assumption you made where the format left a choice.
