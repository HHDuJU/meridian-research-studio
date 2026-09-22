# Delivery rules (work order 2, amendment A2 item 12)

Binding for every Meridian delivery from 2026-09-22 onward.

## Roles

- One writer per file: the implementation owner writes product code.
- The coordinating session writes orders, verifications and records.
- The reviewer writes findings in his own folder and routes them through the coordinating session.

## Cycle

Defect or feature with evidence → owner revision → delivered archive with sidecar hash → independent check on those bytes (harness, probes, install, build, run, save, reload, export, evidence-source change) → next cycle.

## Statuses (every entry, every delivery)

| Status | Meaning |
|---|---|
| NOT STARTED | No product change for this entry |
| IMPLEMENTED | Code present, no passing test |
| TESTED | Unit or acceptance test green on the delivered tree; baseline red or new-capability recorded |
| END-TO-END | Exercised through the running application by the coordinating session's check |

Split entries (D3 part 1 / part 2) report each part.

A skip never turns a required check green. Missing private fixtures: FAIL or INCOMPLETE.

## Archives

Delivery is private: no push, no pull request, no merge in this increment. Each archive is a downloadable working tree plus an external `<archive>.sha256` sidecar. The archive does not contain its own final SHA-256. MANIFEST.json hashes payload files only.

## Probes

Keep `probes/audit-probes.mjs` unchanged. Schema-4 field reads go through `probes/schema4-adapter.mjs`. The scientific assertion of every probe stays.

## Facts

A record keeps its retrieval event and text. A fact keeps its origin. An unknown stays unknown. A status the code cannot prove is `"unknown"`, never a default.

## Runner negative controls

`docs/REGRESSION_RULES.md` rule 17 is binding. `expect.issues` and `expect.error` are evaluated; a skip is a FAIL. `{min:N}` and required refusal text fail when the page does not show them. `reload` / `reopen` FAIL if `meridian-studio-v2` is missing. `export.equalsStore` is whole-study recursive JSON (key order ignored only). `result.json` is written after artifacts exist. FAIL / BLOCKED / INCOMPLETE exits nonzero. Store results are never merged into a UI result.

## Editing

Before changing a file, retain an exact before-copy of its current bytes. Do not use a whole-file rewrite or a patch format that truncates the file. For a narrow edit, replace one exact unique old-text span and immediately inspect the diff against that copy and the retained exports. If the file is damaged, restore the saved bytes — do not reconstruct from memory. No extra framework.
