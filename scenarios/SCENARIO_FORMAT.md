# Full usage scenario format, version 1.1 (coordinating session, 2026-09-22T11:50Z)

Version 1.1 replaces version 1 (kept as `SCENARIO_FORMAT_v1_original_2026-09-22T1030Z.md`). The changes:
expected values are defined by the golden rules below, never by the current behaviour of any build; a
recorded retrieval step gives scenarios a genuine synthetic provider-response path; the scan model call has
two shapes (discovery leads, or appraisal of retrieved records); empty scans are representable; a source
change is tested only after an accepted, supported decision; screen checks carry status text.

One scenario is one complete use of the application by one investigator: a study is created from a realistic
need, every stage the scenario names is run, decisions are made, the study is saved, reloaded, reopened and
exported, and where the scenario says so a cited source is changed afterwards. The scenario carries the model
responses and the provider responses the application receives, so the deterministic arm runs without a model
call, without a network call and without spending. Live integration and scientific validation are separate
arms with their own records; a replay run is never reported as either.

## Golden rules (the correct behaviour; the answer key never encodes a current defect)

- G1 Certainty is assigned only over inspected evidence. A scan with zero retrieved records, or with model
  leads only (no retrieval event), has `scan.gradeOverall` "" (unassessed) and no certainty label on screen or
  in the export, whatever the model wrote. A `gradeOverall` from the model over zero records is dropped with an
  issue.
- G2 The Scan stage completes only when at least one record was retrieved through a recorded retrieval event,
  or when the investigator confirms on screen that the search was run and empty (`confirm-empty-search`); a
  model field can never confirm it.
- G3 A model lead (discovery item) is stored with `provenance.origin` "model", `status` unverified and
  `access` unknown; it never becomes "verified" without a recorded `SourceCheck`; a "landmark" label is a
  model label, not verification.
- G4 Unknown stays unknown: year null, scores null, grade "unrated" when not given; never 2020, 50, "low".
- G5 A model response that is not JSON, not an object, or fails the contract (`ok` false) changes nothing:
  no merge, no completion, an error or the issues shown.
- G6 A reply produced against an earlier revision of the study is refused when the study changed in between
  (`studyRevision` guard); nothing is applied and the refusal is logged.
- G7 A decision is acceptable only when it is supported (its claims exist in the ledger and rest on retrieved
  records, no contradiction); acceptance (`selectionStatus` accepted) is separate from permission to act
  (`actionStatus` ready or blocked by gates). A consequential change to a cited record after acceptance makes
  the decision stale (`selectionStatus` stale) in the store, on screen (the text "stale" in the decision
  panel), in the export and after reload.
- G8 An upstream change after a downstream stage was completed flags the downstream stage for review
  (`needsReview`); a flagged stage is shown as review required and not counted as complete.
- G9 Migration never invents: no investigator or system authority, no verified provenance, no certainty over
  an empty scan; an empty scan loses its stale certainty and completion on migration.
- G10 Export bytes equal the stored study (same revision); one click, one file.
- G11 Investigator-entered `problem.constraints` are not model-editable. A model null, empty string, or replacement is dropped with an issue; the stored text remains. Direct human UI editing and clearing remain. Model-owned nulls (`family`, `gradeOverall`, `synthesis`, `recommended`) still clear.

## Files

- `scenarios/bank-v1/<id>.json`: one scenario per file, `id` equal to the file name (`sc-001` to `sc-1xx`).
- `scenarios/bank-v1/INDEX.json`: `[{ "id", "title", "field", "level", "family", "requires", "sha256" }]`.
- `scenarios/replay/<id>/<stage>.<n>.json`: the model response for call `n` (1-based) of that stage, written
  from the scenario file by `scenarios/expand-replay.mjs`; never edited by hand.
- `scenarios/replay/<id>/retrieval/<provider>.<n>.json`: the provider response for call `n` of that provider,
  written by the expander from the scenario's `retrieve` steps: `{ "status", "body", "note" }` where `body`
  is the JSON text the provider adapter parses.

## Scenario object

```
{
  "id": "sc-014",
  "version": 1,
  "title": "Rural emergency department: pre-hospital tranexamic acid pathway audit",
  "field": "emergency-medicine",             // one of the FIELDS list below
  "level": 3,                                 // 1 routine, 2 ordinary, 3 demanding, 4 adversarial, 5 expert
  "family": "qi-pdsa",                        // the design the correct path arrives at, or "unresolved"
  "arm": "deterministic",
  "synthetic": true,                          // always true; every source, author, number and quote is invented
  "requires": ["D2", "S11"],                  // work-order entries whose absence makes some checkpoints FAIL
  "notes": "what this scenario exercises and which failure it would catch",
  "inputs": {
    "need": "free text as an investigator would type it (120 to 600 words)",
    "constraints": "free text or empty",
    "localFacts": ["one line each; facts the investigator asserts about the setting"]
  },
  "steps": [ ...step objects, in order... ]
}
```

FIELDS: anesthesia, pain-medicine, critical-care, emergency-medicine, surgery, obstetrics, pediatrics,
oncology, cardiology, neurology, psychiatry, geriatrics, primary-care, nursing, pharmacy, physiotherapy,
public-health, epidemiology, health-services, medical-education, implementation-science, health-economics,
digital-health, laboratory-medicine, radiology, infectious-disease, palliative-care, dentistry, veterinary,
social-work.

Level meaning. 1: clean inputs, a recorded search with well-formed records, one clear design. 2: ordinary
ambiguity (two candidate designs, a missing constraint, one null field, a search with few hits). 3: demanding
(unresolved family, conflicting evidence, unknown year and scores, a gate that stays unknown, an explicit null
clearing a field, an empty search confirmed by the investigator, reopen after partial work). 4: adversarial
(invented citation, forged quotation, out-of-range score, id collision with a retrieved record, a design
claim the records do not support, a response that is not JSON, a stage repeated with a revised response, a
source changed after an accepted supported decision). 5: expert (multi-arm or multi-site design, dependency
closure across stages, economic or diagnostic families, long inputs near the compact budget, two decisions
where the second withdraws the first, a late response refused after an edit).

## Steps

Every step has `do`; most have `expect`. Steps run in order; a failed `expect` marks the checkpoint FAIL and
the run continues unless `stopOnFail` is true. Unknown `do` values are a scenario error, never a skip.

| `do` | fields | meaning |
|---|---|---|
| `create` | | submit the create form with `inputs.need`, `inputs.constraints`, `inputs.localFacts` and the replay key `id` |
| `retrieve` | `provider` (`fixture`, or `openalex`, `crossref`, `pubmed`, `consensus` for provider-format bodies), `query`, `response` (`{ "status": 200, "total": n, "records": [RawRecord...] }` for `fixture`; `{ "status", "body" }` for a real-provider format; `status` 0, 429 or 500 for a blocked or failed channel) | the application runs its scan search; the replay transport serves this recording for the next call to that provider |
| `illuminate` | `stage`, `shape` (scan only: `discovery` or `appraisal`), `response` (object) or `responseText` (string), `call` (required on a repeated stage, equal to its order) | run the stage; the application receives exactly `response` or `responseText` as the model output |
| `confirm-empty-search` | | the investigator confirms on screen that the search was run and returned nothing |
| `set-field` | `path`, `value` | edit a field through the screen when a control exists, otherwise through the store (the runner records which) |
| `accept-decision` | `which` ("latest" or a decision index) | the investigator accepts the current design decision |
| `withdraw-decision` | `which` | the investigator withdraws it |
| `mark-complete` | `stage` | the investigator marks a stage complete by hand |
| `change-source` | `record` (match by `title`), `field` (`abstract`, `keyFindings`, `year`, `status`), `value` | change the stored source through the store's own action (never a label edit) |
| `reload` | | browser reload on the same route |
| `reopen` | | go to the home route, then open the study from the list |
| `export` | | click Export JSON, save the file, parse it |
| `wait` | `ms` | bounded wait (max 5000) |

RawRecord for `fixture`: `{ "title", "authors", "year" (number or null), "venue", "doi" (optional,
`10.5555/...`), "providerType" (optional), "abstract" (optional), "url" (optional) }`. The `fixture` provider
exists only in scenario mode; it parses this normalized shape and records a `RetrievalEvent` with
`provider` "fixture", `performedBy` "app" and `status` from the response. It proves the application's own
retrieval path with synthetic records; it proves nothing about a real provider (that is the live arm).

Scan shapes. `discovery`: the legacy schema (`query`, `items[]`, `gradeOverall`, ...) where `items` are model
leads; an empty `items` array is valid. `appraisal`: the schema of `APPRAISAL_SCHEMA` (`annotations[]` keyed
by existing record ids, `claims[]` with `sourceIds`, `synthesis`, `gradeOverall`, `gradeRationale`,
`summary`) over records retrieved earlier in the scenario. A scenario may run both: a `retrieve`, then an
`appraisal` call. Golden rule G1 applies to both.

`expect` is an object of checks, all evaluated:

```
"expect": {
  "store":  { "<study path>": <predicate>, ... },     // the persisted study (localStorage key meridian-studio-v2)
  "screen": { "includes": [...], "excludes": [...] }, // visible text of the studio route after the step
  "issues": { "includes": [{ "path": "items[2].year", "code": "invalid-type" }], "count": <predicate> },
  "export": { "equalsStore": true, "path": { "<study path>": <predicate> } },
  "stage":  { "<stage>": "complete" | "incomplete" | "needs-review" },
  "error":  { "shown": true, "includes": "no recorded response" },
  "downloads": { "count": 1 }
}
```

Predicates: a literal (deep equality); `{ "oneOf": [...] }`; `{ "includes": "text" }`; `{ "length": n }`
(arrays and strings); `{ "min": n }`, `{ "max": n }` (numbers and array lengths); `{ "isNull": true }`;
`{ "absent": true }`; `{ "notEquals": x }`; `{ "matches": "regex" }`.

Study paths follow the stored `Study` object (`scan.gradeOverall`, `scan.items[0].year`,
`scan.retrievalEvents[0].status`, `scan.items[0].provenance.status`, `design.decisions[-1].kind`,
`design.decisions[-1].selectionStatus`, `completedStages`, `needsReview`, `problem.constraints`). A negative
index counts from the end. Paths introduced by work order 2 are valid; when the delivered tree lacks the
field, the check is FAIL with reason `capability absent` and the scenario's `requires` list names the entry.
Screen checks for a status must name the status text (for example "stale", "review required", "unrated",
"not assessed"); a title alone never proves a status.

## What a full scenario must contain (bank acceptance rule)

- All 13 stages run (`problem` to `audit`), or a documented early stop that the scenario is about
  (top-level `earlyStop`, for example the model returns non-JSON at `scan` and the investigator retries with
  `call` 2).
- At least one decision step, one `reload`, one `reopen`, one `export` with `equalsStore`, and for every
  scenario that reaches a completed Scan either a `retrieve` step with at least one record or a
  `confirm-empty-search` step.
- Realistic content: fixture records with invented but plausible titles, authors, venues, years and
  abstracts; annotations and claims that name their supporting records; every stage response substantive
  and specific to the scenario.
- Expected values follow the golden rules, not the current build. Where a rule depends on a work-order
  entry, `requires` names it.
- Level 4 and 5 scenarios contain at least one response the application must refuse or quarantine, with the
  refusal stated (issue code, quarantine entry, stale status, blocked action). A `change-source` step follows
  an `accept-decision` of a supported decision (a positive predecessor whose acceptance is expected to
  succeed) and then checks stale status in the store, on screen, in the export and after reload.
- No real citation, author, trial number, DOI or PMID; no content that identifies the held-out trial cases;
  no patient data. Invented DOIs use the reserved prefix `10.5555/`; invented PMIDs are omitted.

## Counting

A scenario counts as one executed full workflow only when every step ran on the tree under test and no
checkpoint ended as `capability absent` or BLOCKED; a scenario with such checkpoints is listed against the
entries it requires and is not counted. The tranche's 100 are counted on the final tree.

## Result record (written by the runner, one folder per scenario and run)

`results/<runId>/<scenarioId>/result.json`:

```
{ "scenarioId", "runId", "mode": "ui" | "store", "startedAt", "finishedAt", "treeSha256", "appVersion",
  "status": "PASS" | "FAIL" | "BLOCKED" | "INCOMPLETE",
  "checkpoints": [{ "step": 3, "do": "illuminate", "stage": "scan", "check": "store.scan.gradeOverall",
                    "expected": "", "observed": "low", "ok": false, "reason": "" }],
  "consoleErrors": [], "pageErrors": [], "artifacts": ["export.json", "store-final.json", "screen-07.png"] }
```

`results/<runId>/summary.jsonl` has one line per scenario. A rerun gets a new `runId`; nothing is deleted.
BLOCKED means the run could not start (server down, replay files missing); INCOMPLETE means the run stopped
before the last step for a reason other than a failed check. A PASS needs every checkpoint ok.
