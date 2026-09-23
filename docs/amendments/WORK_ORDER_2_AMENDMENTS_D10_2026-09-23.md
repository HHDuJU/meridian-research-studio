# Work order 2: amendment sheet D10 (integration owner, 2026-09-23)

Entry D10 (solution contract S5): unknown local resources and permissions must not become facts. This sheet
records the design that implements it, why it replaced three earlier designs, the scenario-bank amendment it
required, the measurements, and the known limits. Tags: [verified] checked here on the named bytes or run;
[computed] produced here by a named run.

## 1. The rule (G12 in `scenarios/SCENARIO_FORMAT.md`, format 1.3)

- **Gates.** A model never sets a gate. A model "met" is stored as the model's proposal: the gate stays
  "unknown", with the model's evidence, the investigator facts it points to and Meridian's concerns. The
  investigator confirms it on screen. Gate and decision ids are Meridian's (a model id that repeats is replaced).
- **The ethics record.** Every decision, whatever its kind, is ready to act on only when the investigator has
  recorded on it the research ethics status of the work: approved with the reference, or not required with the
  reason. Only this record counts: it is written by the record form (`addGate`, marked `record`), and no model
  reply, confirmed gate or decision label stands in for it. Meridian offers the investigator's own fact about
  this work, or a confirmed ethics gate, as the reference; the investigator still records it.
- **Open items.** A statement in the investigator's own facts or constraints that leaves an approval,
  permission, agreement or consent unknown, pending, outstanding, in draft, requested or still needed blocks
  every decision until the investigator acts on that statement for that decision: given (with the reference)
  or not concerning this decision (with the reason). Nothing else settles it. At the record step the
  investigator sees all of their statements about approvals.
- **The model's statements** about approvals ("no REB review is needed", "the custodian has approved") are
  listed for the investigator to check. They settle nothing and block nothing. A model claim of kind local-fact
  (or an assumption, scenario or inference that states a local permission or resource) that a decision rests
  on still blocks until the investigator's facts establish it.
- **Storage.** Stored decisions are re-derived when a study is loaded, and the header and sidebar show the
  evaluated status; a stored "ready" is never trusted. A withdrawn decision cannot be accepted.

Consent is not folded into the ethics record for open items: a consent statement the investigator's facts
leave open blocks until acted on. The model's consent claims are advisory like its other claims.

## 2. Why this design (four independent reviews, 23 September)

Each review was a separate Claude subagent with read-only access, writing probes in its own folder.

1. **Anchors (v1, v2).** Grounding a model "met" in the investigator's words was bypassed by rewording and
   refused real facts (reviews 1 and 2, before this sheet).
2. **Confirmation design (v3).** A model "met" became a proposal. Review 3 found gate ids the model chose could
   collide so one confirmation set another gate; "no approval needed" detection missed 30 of 33 wordings and
   blocked 10 of 14 plain sentences; local-fact establishment accepted doubted facts; a 2,001-sentence fact list
   took 61 s. All fixed with tests.
3. **Fail-closed claim detection (v3b).** Review 4 found 49 of 60 new wordings missed and 21 of 46 plain
   protocol sentences blocked, plus settlement by unrelated gates and by facts about other work. Conclusion:
   no reader of the model's wording can carry a safety rule. The design moved to structure.
4. **Structural (v4).** Review 5 found the decision kind (a model label) decided whether the record was
   needed; confirmed gates counted as the record by their wording; one record cleared every open item.
5. **Final (v5).** Every decision needs the explicit record; open items are settled one by one. Review 6
   found a model gate that copied the record's exact wording could become the record after one confirmation
   (fixed: the `record` mark, and model gates using that wording are renamed); open-fact reading missed 31 of
   52 open facts (now 3 of 52, with 5 false positives of 40, on the reviewer's own list [computed]); gate
   suggestions offered other work (now filtered). Classes closed by the reviewer's probes: wording bypasses,
   the kind label, settlement by unrelated gates, settlement by facts about other work, consent following
   ethics, forged fields in model replies, late replies, cross-decision records [verified by review 6].

## 3. The scenario-bank amendment

`scenarios/amend-d10.py` applies it from the untouched bank, in two parts; every amended file keeps its previous
version in `original-v<n>/` and states what changed in `supersedes`. Model responses, needs, records and all other
expectations are unchanged; no check was removed [verified by review 6's diff of all 97 files].

- **Part 1, proposals (97 bank scenarios, 2 samples).** For each Design step whose gates the model called met
  and the investigator's facts support (the build before this design, 11016b6, kept them met), the step now
  expects "unknown" with `proposal.status` "met", and a `confirm-gate` step has the investigator confirm them
  (110 steps, 179 gates).
- **Part 2, the ethics record (49 bank scenarios, 1 sample).** A `record-determination` step before acceptance:
  - citing an ethics gate the investigator confirmed (16 scenarios and the level-1 sample): sc-006, sc-011,
    sc-012, sc-019, sc-045, sc-048, sc-057, sc-061, sc-065, sc-067, sc-069 (two decisions), sc-070, sc-077,
    sc-084, sc-085, sc-100; approved, or not required for determinations (sc-048, sc-061, sc-065, sample);
  - citing the investigator's own fact (12): sc-001, sc-007, sc-014, sc-015 (approved: the board's waiver of
    consent), sc-020, sc-022, sc-024, sc-030 (two decisions), sc-042, sc-073 (a quality committee's QI
    screening), sc-076, sc-081;
  - reviews of published literature, "not required" (21): sc-004, sc-021, sc-023, sc-025, sc-032, sc-033,
    sc-039, sc-040, sc-044, sc-051, sc-053, sc-068, sc-071, sc-086, sc-087, sc-090, sc-093, sc-097, sc-098,
    sc-101, sc-102.
- **Open items acted on (2 scenarios).** sc-004 sets aside "The board will decide on the extended opening hours
  scheme" (the decision the review informs) and "requires the data governance lead's approval" (the decision is
  a review of published studies and uses none of the authority's data); sc-023 sets aside "The ICB commissioning
  board will consider link worker funding" (the decision the review informs).
- **Expected blocked (12 scenarios).** The investigator's facts give no research ethics status: sc-003, sc-016,
  sc-046, sc-066, sc-078, sc-079, sc-088, sc-092, sc-095, sc-096, sc-099. The investigator's own fact leaves
  the board's approval of the design open: sc-019 (decision 2). sc-079 (an education research committee
  approved use of de-identified data) and sc-096 (a data governance office approved use of logs) are the
  closest calls: both approvals are about data use, not the ethics status, so the stricter reading was kept.

## 4. Measurements

- `npx tsx --test tests/*.test.ts`: 294 of 294 [verified]. `tsc --noEmit` clean; `npm run build` passes
  [verified]. New tests: `tests/local-facts-review3.test.ts` (13 tests, each review finding as a case).
- Store-mode runner on the whole bank against the build before this work (11016b6): no new failing check in
  any scenario; sc-019 gains six passing checks (a withdrawn decision stays withdrawn) [computed].
- Bank and samples in UI mode on the final tree (f1dbc9a, digest 317e1307...): bank 103 of 103, samples 3 of 3,
  19,557 checkpoints, 2,366 screen actions, none off the screen route (run x8ui) [computed]; receipts in HANDOFF
  section 4.
- Speed: Meridian's reading of 2,001 fact sentences that share one reference number took 61 s before the
  memoised conflict scan and takes about 0.2 s now; the claim reader stops at 40,000 characters and is
  advisory [computed].

## 5. Known limits

- Open items are read from the investigator's own wording: on the reviewer's list 3 of 52 open facts are
  missed ("The custodian said she would look at our request after the audit season", "2025 data are not yet
  covered" after a clause about 2024, "The pharmacy has not said yes yet") and 5 of 40 plain facts are
  flagged. A miss cannot come from the model; at the record step the investigator sees every statement of
  theirs about approvals.
- The one-click "No people, records or practice are involved" is offered for decisions the model labelled
  defer, refer or no new study; it is the investigator's statement when they click it.
- Stored data are trusted as written (there is no import in the app); a hand-edited browser store could forge
  a record.
- An approval's date of expiry and its ward or site scope are not read (advisory concerns only).
