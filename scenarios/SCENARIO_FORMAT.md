# Full usage scenario format, version 1.3 (coordinating session, 2026-09-23T19:10Z)

Version 1.3 adds one golden rule and three investigator steps to version 1.2 (kept as
`SCENARIO_FORMAT_v1-2_original_2026-09-23T1910Z.md`), from work order 2 entry D10 (solution contract S5:
unknown resources and permissions must not become facts):

- G12 (below): a model never sets a gate; every decision is ready only with the investigator's record of the
  work's research ethics status; approvals the investigator's own facts leave open block until acted on; what
  the model writes about approvals is shown to check and settles nothing.
- `confirm-gate`: the investigator confirms gates the model proposed as met.
- `record-determination`: the investigator records the status of one kind of approval for this work: approved,
  with its reference, or not required, with the reason.
- `settle-open-item`: the investigator acts, for one decision, on one of their own facts that leaves an approval
  open: given (with the reference) or not concerning the decision (with the reason).

Ninety-seven bank scenarios and two samples are amended to version 1.3:

- a confirm-gate step after each Design step whose gates the model proposed and the investigator's facts
  support (110 steps, 179 gates);
- a record-determination step before acceptance in 49 bank scenarios and one sample, recording the ethics
  status: 16 bank scenarios and the sample cite an ethics gate the investigator confirmed, 12 cite the
  investigator's own fact, 21 are reviews of published literature;
- settle-open-item steps in 2 scenarios, where the investigator sets aside a fact that does not concern the
  decision (a board decision the review informs; local data a literature review does not use);
- 12 scenarios now expect the accepted decision blocked: in 11 the investigator's facts give no ethics status,
  and in 1 their own fact leaves the board's approval of the design open.

The amendment sheet is `docs/amendments/WORK_ORDER_2_AMENDMENTS_D10_2026-09-23.md`; each amended file names
its kept version in `supersedes`.

Version 1.2 added to version 1.1 (kept as `SCENARIO_FORMAT_v1-1_original_2026-09-22T2045Z.md`): the
`late` illuminate step with its `during` actions, the executable form of a G6 late reply (section "Late replies"
under Steps). Version 1.1 replaces version 1 (kept as `SCENARIO_FORMAT_v1_original_2026-09-22T1030Z.md`). The
changes: expected values are defined by the golden rules below, never by the current behaviour of any build; a
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
- G11 Investigator authority over investigator-entered text (added 2026-09-22T12:50Z, from the master
  prompt's local-fact and authority sections). Text the investigator entered (`problem.rawNeed`,
  `problem.constraints` as typed at creation or edited on screen, local facts) is never erased or replaced by
  a model response: a model `null`, empty string or different value for such a field leaves the stored text
  unchanged and records an issue with the existing code `dropped` at that path (`constraints`) whose message
  names the investigator's authority; the application applies the rest of the response and shows a concise
  partial-apply warning that names the path and the refusal (wording such as "kept", "refused" or "not
  applied"; a scenario checks it with a screen entry `{ "anyOf": ["kept", "refused", "not applied"] }`, never
  a single brittle literal), also after reload. The investigator can still edit or clear the field through the screen. Explicit null keeps
  its clearing meaning for model-owned fields (grades, recommendations, alternatives, model-written
  statements). A scenario that tests "explicit null clears a field" uses a model-owned field. (Issue code
  aligned with the owner's implementation on 2026-09-22T13:30Z: `dropped`, not a new enum member.)

- G12 Local facts and approvals are the investigator's (added 2026-09-23, work order 2 entry D10, solution
  contract S5). (a) A model never sets a gate: a model "met" is stored as the model's proposal, the gate's
  status stays "unknown" and `proposal.status` is "met" with the model's evidence, the investigator facts it
  points to and Meridian's concerns; an issue `ungrounded-gate` is recorded only when there is a concern. The
  investigator confirms on screen (`confirm-gate`), which sets the gate "met" with `setBy` "investigator".
  (b) Every decision, whatever its kind, has `actionStatus` "ready" only when the investigator has recorded on
  it the research ethics status of the work (`record-determination`, body `ethics`): approved with the
  reference, or not required with the reason ("No people, records or practice are involved in this decision."
  for a decision that leads to no work). Only this explicit record counts; a confirmed ethics gate is offered as
  its reference. (c) A statement in the investigator's own facts or constraints that leaves an approval,
  permission, agreement or consent unknown, pending, outstanding, in draft, requested or still needed blocks
  every decision until the investigator acts on that statement for that decision (`settle-open-item`: given
  with the reference, or aside with the reason); no record or gate settles it. (d) What the model writes about
  approvals ("no REB review is needed", "the custodian has approved") is listed for the investigator to check;
  it settles nothing and blocks nothing by itself. A model claim of kind local-fact (or an assumption, scenario
  or inference that states a local permission or resource) that a decision rests on blocks until the
  investigator's facts establish it. Stored decisions are re-derived when a study is loaded; a stored "ready"
  is never trusted.

## Files

- `scenarios/bank-v1/<id>.json`: one scenario per file, `id` equal to the file name (`sc-001` to `sc-1xx`).
- `scenarios/bank-v1/INDEX.json`: `[{ "id", "title", "field", "level", "family", "requires", "sha256", "eligible" }]` (`eligible` is the author's admission mark; `executedWorkflow` exists only in runner result records).
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
    "need": "free text as an investigator would type it (20 to 700 words; most 120 to 400)",
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
| `illuminate` | `stage`, `shape` (scan only: `discovery` or `appraisal`), `response` (object) or `responseText` (string), `call` (required on a repeated stage, equal to its order), `late` and `during` (format 1.2, see "Late replies") | run the stage; the application receives exactly `response` or `responseText` as the model output |
| `confirm-empty-search` | | the investigator confirms on screen that the search was run and returned nothing |
| `set-field` | `path`, `value` | edit a field through the screen when a control exists, otherwise through the store (the runner records which) |
| `accept-decision` | `which` ("latest" or a decision index) | the investigator accepts the current design decision |
| `confirm-gate` | `which`, optional `gates` (ids; all open proposals when absent) | format 1.3: the investigator confirms on screen that gates the model proposed as met are met (G12) |
| `record-determination` | `which`, `body` (`ethics`, `consent` or `data`), `reason`, optional `status` (`met`: approved, with the reference; `not-required`, the default: with the reason) | format 1.3: the investigator records on the decision the status of this kind of approval for the work (G12) |
| `settle-open-item` | `which`, `match` (words of the investigator's fact), `how` (`given` or `aside`), `note` (the reference, or why it does not concern the decision) | format 1.3: the investigator acts on one of their own open facts for this decision (G12) |
| `withdraw-decision` | `which` | the investigator withdraws it |
| `mark-complete` | `stage` | the investigator marks a stage complete by hand |
| `change-source` | `record` (match by `title`), `field` (`abstract`, `keyFindings`, `year`, `status`), `value` | change the stored source through the store's own action (never a label edit) |
| `reload` | | browser reload on the same route |
| `reopen` | | go to the home route, then open the study from the list |
| `export` | | click Export JSON, save the file, parse it |
| `wait` | `ms` | bounded wait (max 5000); never the release of a held reply |

### Late replies (format 1.2)

A G6 check needs a model reply that was produced against one revision of the study and arrives after the
investigator changed the study. The executable form is an `illuminate` step with `"late": true` and a `during`
array of one to three investigator actions (`set-field`, `confirm-empty-search`, `accept-decision`,
`withdraw-decision`, `change-source`, `mark-complete`; never a model call, a retrieval, `reload`, `reopen`,
`export` or `wait`). Each `during` action has its own `expect`, evaluated after that action is saved and before
the reply is released; the illuminate step's own `expect` is evaluated after the release and states the refusal
(`error.shown` true with the refusal text, nothing of the reply applied, the investigator's edit intact, the
refusal logged) or, when the actions did not change the revision, the applied reply. The runner (R-11):
dispatches the request through the screen (the application captures `studyRevision` at that moment), holds the
recorded reply (in `ui` mode by intercepting the model request; in `store` mode by deferring the commit), runs
the `during` actions through the screen on their own stages, returns to the illuminate stage, releases the reply,
waits for the application to process it, then evaluates. The `call` number of a late step counts like any other
call of that stage (replay file `<stage>.<n>.json`); the `during` actions are recorded in the result's action
routes like top-level actions and count toward the route rule (all `ui` for a qualifying workflow).

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
  "screen": { "includes": [...], "excludes": [...] }, // visible text of the studio route after the step; an includes entry is a string or { "anyOf": [strings] }
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
