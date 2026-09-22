# Work order 2: amendment sheet A4.1 (coordinating session, 2026-09-22T16:30Z)

Adds to A4 after the coordinating session's own runs on the combined archive (2d1db519...; receipt
`RECEIPT_combined-2d1db519_2026-09-22.md`). A4.1 wins over A4 where they differ. Owner acknowledgement of A4
was observed at 15:33Z ("A4 is accepted").

## 1. Runner corrections (S17)

- R-1 `scripts/run-scenarios.mjs` self-start path: `spawn` is used at line 729 without an import from
  `node:child_process`; the self-start never ran in your own runs (they used `--base-url`). Add the import
  and a control that starts the server once in a test.
- R-2 Browser executable: honour `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (fallback `CHROMIUM_PATH`) in
  `chromium.launch`, and record the browser build and executable in every result record; without it a machine
  that lacks Playwright's exact bundled build fails every scenario at start.
- R-3 Screen entries `{ "anyOf": [strings] }` (A4 C3, format 1.1): the runner reads the object as a literal.
  An `anyOf` entry is satisfied when any listed wording is visible; record which one matched.
- R-4 Screen vocabulary: an unrated record shows the stored status word "unrated" (L1.5 rendering); a null
  score shows "not assessed"; the bank and samples check these words. If the screen uses other words today,
  change the screen, not the goldens.
- R-5 `treeSha256`: the digest must exclude `scenarios/` (bank installs) as well as generated output (A4 C1),
  so the same source gives the same digest with or without the bank installed; results carried 95cca131...
  against the manifest's 839bcada... for that reason.

## 2. Results the coordinating session obtained on the combined bytes

- Three version 3 samples, `ui` mode, every action through the screen except two unsupported actions on
  level 4 (accept-decision, change-source): level 1 185 checks 15 fail (5 capability absent S11; 10 S13: the
  appraisal over retrieved records is not applied, item grades stay unrated with 14 issues); level 3 193
  checks 16 fail (9 S11; 7 screen words and the anyOf form); level 4 212 checks 67 fail (14 S11, S1, S8; 52
  S13, id-collision quarantine absent, screen words; 1 unsupported). `executedWorkflow` false for all three.
- The 103-scenario bank, `ui` mode: results and the three counts are appended to this sheet's companion
  file `BANK_RUN_2026-09-22.md` once the run completes; expected: FAIL on every scenario until S11, S13, the
  quarantine and the source-change route land.

## 3. Product objective (investigator's instruction, 2026-09-22, recorded in `OPERATING_CONTRACT.md`
section 8)

Meridian is to become vastly superior to Research OS for the investigator's own research, so that he uses
Meridian alone, and later to be sellable as a subscription. Superiority is demonstrated through the
application: research relevance and scientific defensibility of what it produces, feasibility of what it
proposes, reliable complete workflows (the qualifying count of the tranche), and less investigator re-entry
and rework; no score, no feature count. Integrations and recovery belong in the application, not in hidden
coordinator steps. Subscription readiness is a later milestone with its own evidence (use by other
researchers without bespoke supervision, account and data separation, access controls, operations and
support, measured service costs). Nothing here authorizes a launch, payments, purchases or infrastructure
now; the current work order and its phase order are unchanged; roles unchanged.

## 4. Order of work (unchanged from A4 section 4)

S11 with its phase-5 dependencies; the source-change screen route (D5 with S10); C9 and the Scan search
action on screen; then the phase order. R-1 to R-5 ride with the next archive.
