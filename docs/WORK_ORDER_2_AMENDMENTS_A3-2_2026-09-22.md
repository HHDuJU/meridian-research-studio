# Work order 2: amendment sheet A3.2 (coordinating session, 2026-09-22T11:58Z)

A3.2 adds to A3 and A3.1 and wins where they differ. Part 1 corrects the sample scenarios shipped with A3,
which encoded an old defect as the answer key; part 2 routes the reviewer's findings on the phase 3 archive
and two transfer checks; part 3 fixes the counting rule for the scenario tranche. Nothing here restarts an
audit or adds a framework.

## 1. Completion and certainty contract (replaces the A3 sample oracles)

The three sample scenarios in the A3 packet expected the Scan stage to complete with model leads only and
level 1 expected `gradeOverall` "low" as a default. Both expectations were wrong; they described the baseline
defect D20, not the required behaviour. Do not implement against them. Any change made to satisfy them (for
example "restrict empty-scan completion to zero items so model-lead scans can still complete") is withdrawn.
The corrected packet (`Meridian_Scenarios_v1-1_*.zip`) carries format version 1.1 with golden rules G1 to G10
and the three re-versioned samples (`"version": 2`, `supersedes` naming the v1 file); the v1 originals are kept
under `bank-samples/original-v1/` for the record only.

The contract, binding for D20, S13 and every later phase:
- Certainty (`scan.gradeOverall`) is assigned only over inspected evidence: records retrieved through a
  recorded `RetrievalEvent` with status ok or partial. Over zero retrieved records, and over model leads only,
  the value is "" (unassessed), whatever the model wrote; a model value over zero records is dropped with an
  issue. An update that omits the grade never leaves an earlier grade in place over an empty scan.
- The Scan stage completes only when at least one record was retrieved, or when the investigator confirms on
  screen that the search was run and returned nothing. The confirmation is a store record written by a screen
  action (`scan.emptySearchConfirmation: { by: "investigator", at, queryHash, revision }`), never a model
  field; a model payload carrying a confirmation key is dropped with an issue.
- Model leads are useful preliminary discovery and are kept with `provenance.origin` "model", status
  unverified, no certainty; a leads-only scan shows its honest status ("leads only, evidence not inspected")
  and stays incomplete. Nothing blocks the investigator from continuing to later stages as drafts; the
  drafts carry the incomplete status and the decision gates reflect it.
- Tests: `empty_scan_assigns_no_certainty_and_no_completion` (A2), `leads_only_scan_stays_incomplete`,
  `omitted_grade_over_empty_scan_resolves_unassessed`, `empty_search_confirmation_is_investigator_action`.

## 2. Findings on the phase 3 archive and the transfer checks (reviewer, 2026-09-22; to be confirmed by the
coordinating session on the bytes; each gets a numbered entry)

- D23 Repair on every hydrate and import path. `persist.rehydrate` of storage already at schema version 4
  bypasses `migrateStudy`, so an existing empty scan keeps "very-low", completed scan and protocol, empty
  `needsReview`, and the export still shows very low. Run the idempotent repair (the same function the
  migration runs, keyed by a repair id so it applies once per defect) on every path that brings a study into
  memory: fresh initialisation, rehydrate of any version, restore of missing seeds, import. Test:
  `same_version_hydrate_applies_repairs_once`.
- D24 Consequential source fields in the revision. Changing a cited record's `keyFindings` through
  `mergeStage` ("Observed benefit" to "Correction: no observed benefit") leaves `evidenceRevision` unchanged
  and an accepted decision stays accepted; a change to the abstract or its hash does invalidate (positive
  control passes). Include `keyFindings`, `limitations`, `synthesis` and the annotation fields in the
  revision; the reviewer's scenario becomes the test: valid accepted predecessor, changed meaning, stale in
  store, on screen, in the export and after reload (`accepted_decision_goes_stale_on_key_findings_change`).
- D25 A backup is bytes, not a hash. The migration writes only `meridian-studio-v2`; the original JSON is
  absent and `migrationBackupHash` is a hash only, while `docs/REGRESSION_RULES.md` says the original JSON is
  preserved. Preserve the immutable original once before the first mutating migration
  (`meridian-studio-v2.backup.<fromVersion>.<at>`, written once, never rewritten), handle a storage quota
  failure honestly (the migration reports "no backup written: quota" and asks before proceeding), and correct
  the document. Test: `migration_writes_one_immutable_backup_or_reports_none`.
- D26 The empty-search confirmation is tied to what it confirms. After confirming an empty search for query
  A, changing the query to an unrelated B through `mergeStage` leaves the confirmation byte-identical,
  `scanMayComplete` stays true, manual completion succeeds and Illuminate for B returns complete. Store the
  query hash and the study revision in the confirmation (section 1) and invalidate it on any consequential
  scan change; the unchanged-query positive control keeps working. Tests:
  `empty_search_confirmation_invalidated_by_query_change`, `empty_search_confirmation_survives_no_change`.
- D27 Substantive audit content is part of the revision. Edits to `audit.openFixes` and
  `audit.improvementNotes` through `store.update` leave `studyRevision` unchanged, so a pending audit reply is
  accepted and completes. Include substantive audit content in `studyRevision`; exclude audit log entries and
  bookkeeping (a log-only edit correctly does not stale a reply). Fix together with L1.6 and test after L1.6;
  no overwrite is claimed on the current tree because the L1.6 collision drops audit patches first.
- D28 Date variants in identity comparison. `compareWithRegistry` treats a year gap above one year as a
  wrong-work mismatch even when the title and DOI match exactly. The reviewer resolved one such case against
  the registry's own record: the same article carries an electronic date in one year and a print date three
  years later. Rule: with an exact DOI match, or an exact normalised title match, a year difference is a
  date variant (`identity: match, dateVariant: { recordYear, registryYears }`), never a wrong-work mismatch;
  without such a match the existing rule stands. No tolerance is widened; no claim or full-text status is
  upgraded. Keep the original comparison results; add the dated resolution as a new check record. Test:
  `date_variant_with_exact_title_is_not_a_mismatch`.
- Still open from earlier findings: an update that omits the grade keeps a high grade; model-only leads get
  a high certainty; green Landmark on an unverified lead (L1.5); silent mixed-methods default (L1.4); D21
  hydration flash; D22 double download.

## 3. Counting rule for the scenario tranche (replaces the `executedWorkflow` field in INDEX.json)

- Authors mark eligibility only. The runner sets `executedWorkflow: true` in a result record only when every
  required action, checkpoint, reload, reopen and the final export actually ran, each action records its
  route (`ui` or `store-fallback`), and no checkpoint ended as capability absent or BLOCKED. A scenario whose
  actions used a store fallback for a missing screen control is a recorded run, not a full successful screen
  workflow, and is listed separately. A non-empty `requires` list proves nothing either way; the count comes
  from observed run records.
- Bank admission (validator, coordinating session's side): meaningful expectations at every consequential
  checkpoint (each illuminate, decision, change-source, confirm step carries at least one store, stage,
  issues or error check), reload and reopen carry verification, the final export comes after the last
  consequential step, semantic duplicates (same need or same trajectory under new ids) are rejected, a
  `retrieve` step is validated and expanded or the scenario is marked INCOMPLETE. Brief or vague investigator
  needs (20 to 120 words) are admitted as a realistic input class; the 120-to-600-word range is a guide, not
  an admission rule.
