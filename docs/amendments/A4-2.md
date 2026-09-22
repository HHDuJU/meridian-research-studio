# Work order 2: amendment sheet A4.2 (coordinating session, 2026-09-22T17:05Z)

Adds to A4 and A4.1 after the coordinating session's own runs on the A4 archive (06e4816d...) and the A4.1
archive (6c11cceb...). Wins over earlier sheets where they differ.

## 1. Verified on the bytes (coordinating session)

- A4 archive 06e4816d: manifest 2,576, install, typecheck, build pass, product tests 178 of 178, smoke 9 of 9;
  samples in `ui` mode with the retrieval replay flag: level 1 FAIL 185/4 (S13), level 3 PASS 193/0
  (`executedWorkflow` true), level 4 FAIL 210/6. Qualifying: 1. Receipt `RECEIPT_a4-06e4816d_2026-09-22.md`.
- A4.1 archive 6c11cceb: manifest 2,660, install, typecheck, build pass, product tests 188 of 188, smoke 9 of 9,
  R-1 to R-5 present; samples: level 1 PASS 185/0, level 3 PASS 193/0, level 4 FAIL 210/1 (one check, section
  2 D29). Qualifying samples: 2. The whole bank, `ui` mode, on the same bytes
  (`project/tests/owner-a41-6c11cceb-20260922/runner-bank-ui/run-2026-09-22T16-29-46-365Z`): 103 executed
  attempts, **33 qualifying full workflows**, 70 FAIL; 2,109 screen-route actions, 31 unsupported
  (`set-field` 14, `mark-complete` 11, `accept-decision` 5, `withdraw-decision` 1); no capability-absent
  checkpoints. By level: 1: 10 of 15; 2: 9 of 26; 3: 9 of 26; 4: 5 of 21; 5: 0 of 15. Per-scenario table in
  `BANK_RUN_a41_2026-09-22.md`. Total qualifying on the A4.1 bytes: 35 of 106 authored.

## 2. Defects found on the A4.1 bytes

- D29 D16 reference marking is not idempotent. On the second design reply (level 4, step 13) the withdrawn
  decision's statement, already marked `⟦unresolved:claim-9⟧` at the first reply, is marked again
  (`⟦unresolved:⟦unresolved:claim-9⟧⟧`) and two issues are logged for text the model did not send. Marking
  runs once per reference; an already-marked reference is left as it is; issues are logged only for new
  references. The golden (`issues.count` 0 at that step) stands. Test: `unresolved_marker_applied_once`.
- R-6 Runner: an uncaught `page.waitForEvent("download")` timeout (10 s) at `runUi` aborts the whole bank
  run (the A4 bytes run stopped after 31 scenarios, exit 1, no summary). Any step error becomes that
  scenario's FAIL checkpoint with the error text; the run continues; the summary is always written.
- R-7 Runner: `unsupported` routes remain for `set-field` (14), `mark-complete` (11), `accept-decision` (5)
  and `withdraw-decision` (1) on scenarios the screen should support (fields with a control, the manual
  complete button, decisions listed on the Design panel). Report per action which control is missing and add
  it, or say why the action is out of scope on the screen.

## 3. Triage of the bank's remaining failures (owner answers each with evidence: product defect fixed, or
golden error with the observed rule, which the coordinating session then amends by a dated version)

| Item | Check (count) | Example | Expected vs observed | Question |
|---|---|---|---|---|
| T-1 | `create` `screen.includes` (23) | sc-004 step 1, sc-010 step 1 | the typed need text visible after create; the screen shows the need cut short in the study header | Is the full `rawNeed` rendered anywhere on the studio route (Problem panel)? If only truncated, that is a product gap: the investigator must see what was entered; if a panel is collapsed, the runner expands it before the check |
| T-2 | `create` `store.design.basis` (14) | sc-005 (expected inferred), sc-019 (expected explicit) | observed "unresolved" at create | Does the create path still run `classifyFamily` and store `basis` explicit or inferred when the need names or cues a design (A1 D4 rule)? L1.4 asked for an undetermined state only for unresolved needs |
| T-3 | `illuminate design` `store.family` (11) | sc-012 steps 9, 11 | expected unchanged (null) until acceptance; observed set by the proposed recommendation | S11: a proposed recommendation never changes `family`; acceptance does |
| T-4 | `recommendedFamily` (10) | sc-005 step 11 (qualitative vs implementation), sc-019 step 9 (rct vs pragmatic-trial) | the model's recommended family replaced by another value | Which rule overrides the recommended family? If a classifier of the need does, it must not overwrite a valid explicit recommendation |
| T-5 | `illuminate scan` `store.scan.gradeOverall` (8) | sc-011 step 5, sc-015 step 5 | appraisal over retrieved records gave moderate or low; observed "" | S13 mapping gap in these orderings (discovery before or after appraisal); report which path drops the grade |
| T-6 | `accept-decision` screen words and status (7, 6) | sc-021 step 10 (expected refused: proposed, blocked; observed accepted), sc-063 step 11 (expected accepted; observed proposed) | | For sc-021 a decision resting on no ledger claims was accepted; for sc-063 a supported decision stayed proposed. Give the acceptance rule as implemented and the screen text for each status |
| T-7 | `set-field`, `reload`, `accept-decision` `screen.includes` (10, 6, 7) | sc-005 step 3, sc-021 step 15 | status or field text not visible on the route after the action | Which route shows the field after `set-field`, and where do decision statuses appear after reload |

## 4. Run policy for the next archive

Fix D29, R-6, R-7 and the product defects of section 3; deliver with the three samples and the whole bank
run in `ui` mode before packing; the coordinating session reruns both on the bytes. The count that matters is
the qualifying full workflows on the delivered bytes, reproduced here; today's are 35 of 106.
