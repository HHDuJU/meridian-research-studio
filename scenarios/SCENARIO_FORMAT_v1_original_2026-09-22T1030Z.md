# Full usage scenario format, version 1 (coordinating session, 2026-09-22)

One scenario is one complete use of the application by one investigator: a study is created from a realistic
need, every stage the scenario names is run, decisions are made, the study is saved, reloaded, reopened and
exported, and where the scenario says so a cited source is changed afterwards. The scenario carries the model
responses the application receives at each stage (recorded, synthetic) so that the deterministic arm runs
without any model call and without spending. Live integration and scientific validation are separate arms with
their own records; a scenario file never mixes arms.

## Files

- `scenarios/bank-v1/<id>.json`: one scenario per file, `id` matches the file name (`sc-001` to `sc-1xx`).
- `scenarios/bank-v1/INDEX.json`: `[{ "id", "title", "field", "level", "family", "requires", "sha256" }]`.
- `scenarios/replay/<id>/<stage>.<n>.json`: the model response for call `n` (1-based) of that stage, generated
  from the scenario file by `scenarios/expand-replay.mjs` (the coordinator ships the expander; the owner may
  regenerate but never edits a replay file by hand).
- `scenarios/replay/<id>/retrieval/<provider>.<n>.json`: recorded provider responses for scenarios that
  declare `retrieval` (phases 6 onward); absent for the others.

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

Level meaning. 1: clean inputs, well-formed responses, one clear design. 2: ordinary ambiguity (two candidate
designs, a missing constraint, one null field). 3: demanding (unresolved family, conflicting evidence,
unknown year and scores, a gate that stays unknown, an explicit null clearing a field, reopen after partial
work). 4: adversarial (invented citation, forged quotation, out-of-range score, id collision with an existing
record, a design claim the sources do not support, a response that is not JSON, a stage repeated with a
revised response, a source changed after acceptance). 5: expert (multi-arm or multi-site design, dependency
closure across stages, economic or diagnostic families, long inputs near the compact budget, two decisions
where the second withdraws the first).

## Steps

Every step has `do`; most have `expect`. Steps run in order; a failed `expect` marks the checkpoint FAIL and
the run continues unless `stopOnFail` is true. Unknown `do` values are a scenario error, never a skip.

| `do` | fields | meaning |
|---|---|---|
| `create` | | submit the create form with `inputs.need`, `inputs.constraints`, `inputs.localFacts` and the replay key `id` |
| `illuminate` | `stage`, `response` (object) or `responseText` (string, for non-JSON or fenced text), `call` (default 1) | run the stage; the application receives exactly `response` or `responseText` as the model output |
| `set-field` | `path`, `value` | edit a field through the screen when a control exists, otherwise through the store (the runner records which) |
| `accept-decision` | `which` ("latest" or a decision index) | the investigator accepts the current design decision |
| `withdraw-decision` | `which` | the investigator withdraws it |
| `mark-complete` | `stage` | the investigator marks a stage complete by hand |
| `change-source` | `record` (match by `title`), `field` (`abstract`, `keyFindings`, `year`, `status`), `value` | change the stored source through the store's own action (never a label edit) |
| `reload` | | browser reload on the same route |
| `reopen` | | go to the home route, then open the study from the list |
| `export` | | click Export JSON, save the file, parse it |
| `wait` | `ms` | bounded wait (max 5000) |

`expect` is an object of checks, all evaluated:

```
"expect": {
  "store":  { "<study path>": <predicate>, ... },     // the persisted study (localStorage key meridian-studio-v2)
  "screen": { "includes": [...], "excludes": [...] }, // visible text of the studio route after the step
  "issues": { "includes": [{ "path": "items[2].year", "code": "invalid-type" }], "count": <predicate> },
  "export": { "equalsStore": true, "path": { "<study path>": <predicate> } },
  "stage":  { "<stage>": "complete" | "incomplete" | "needs-review" },
  "error":  { "shown": true, "includes": "no recorded response" }
}
```

Predicates: a literal (deep equality); `{ "oneOf": [...] }`; `{ "includes": "text" }`; `{ "length": n }`;
`{ "min": n }`, `{ "max": n }`; `{ "isNull": true }`; `{ "absent": true }` (the key must not exist);
`{ "notEquals": x }`; `{ "matches": "regex" }`.

Study paths follow the stored `Study` object (`scan.gradeOverall`, `scan.items[0].year`,
`design.decisions[-1].kind`, `completedStages`, `needsReview`, `problem.constraints`). A negative index counts
from the end. Paths introduced by work order 2 (for example `design.decisions[-1].selectionStatus`,
`scan.quarantine.items`, `claims[0].origin`) are valid; when the delivered tree lacks the field, the check is
FAIL with reason `capability absent` and the scenario's `requires` list names the entry.

## What a full scenario must contain (bank acceptance rule)

- All 13 stages run (`problem` to `audit`), or a documented early stop that the scenario is about (for
  example the model returns non-JSON at `scan` and the investigator retries with `call` 2).
- At least one decision step, one `reload`, one `reopen`, one `export` with `equalsStore`.
- Realistic responses: the scan lists between 3 and 12 items with invented but plausible titles, authors,
  journals, years and findings; abstracts or key findings are written out; claims name their supporting items.
- Expected values are the correct behaviour of the application, not the current one. Where the correct
  behaviour depends on a work-order entry, `requires` names it.
- Level 4 and 5 scenarios contain at least one response the application must refuse or quarantine, and the
  expectation states the refusal (issue code, quarantine entry, stale status, blocked action).
- No real citation, author, trial number, DOI or PMID; no content that identifies the held-out trial cases;
  no patient data. Invented DOIs use the reserved prefix `10.5555/`; invented PMIDs are omitted.

## Result record (written by the runner, one folder per scenario and run)

`results/<runId>/<scenarioId>/result.json`:

```
{ "scenarioId", "runId", "mode": "ui" | "store", "startedAt", "finishedAt", "treeSha256", "appVersion",
  "status": "PASS" | "FAIL" | "BLOCKED" | "INCOMPLETE",
  "checkpoints": [{ "step": 3, "do": "illuminate", "stage": "scan", "check": "store.scan.gradeOverall",
                    "expected": "moderate", "observed": "low", "ok": false, "reason": "" }],
  "consoleErrors": [], "pageErrors": [], "artifacts": ["export.json", "store-final.json", "screen-07.png"] }
```

`results/<runId>/summary.jsonl` has one line per scenario. A rerun gets a new `runId`; nothing is deleted.
BLOCKED means the run could not start (server down, replay files missing); INCOMPLETE means the run stopped
before the last step for a reason other than a failed check. A PASS needs every checkpoint ok.
