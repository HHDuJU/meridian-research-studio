# Work order 2: amendment sheet A4 (coordinating session, 2026-09-22T14:15Z; C3 reconciled 15:05Z)

Consolidation of every correction issued since A3.3 (most relayed to the owner by the investigator's reviewer
while the coordinating session authored the scenario bank), the acceptance state of the archives received,
the corrected scenario bank delivery, and the next product entries. A4 wins over A3 to A3.3 where they differ.
No new audit, no new process layer, no push, no spending.

## 1. Archives received and their acceptance state (reviewer checks; coordinating session's own checks where
stated)

| Archive (sha256 prefix) | Scope | State |
|---|---|---|
| l1b 9bd95de3 | L1 integration, P1, P2, R1, S17 first version | ACCEPTED for packaging, scripts, build, tests and smoke by the coordinating session (receipt `RECEIPT_l1b_2026-09-22.md`); behavioural claims checked later on the combined archive |
| phase3 de620041 | phase 3 (D16, D11, D12, F3) | accepted at scope by the reviewer (182/182 hashes, 95/95 library tests, 9/13 boundary probes); D23 to D28 raised from it (A3.2) |
| a33-receipt 08fdd17d | D25 first version, D26, D28 first version, R1 production gate | D26 accepted through the real screen (stale scan completion withdrawn to 0 of 13 with review required); D25 and D28 corrected below |
| runnerfix e404df77 | S17 per A3.3 | ACCEPTED: false-PASS controls (missing predicates, zero-byte storage, lossy export) now FAIL with exit 1; positive control passes; issue predicates and refusal text recorded; exports equal the persisted studies |
| a33-constraints 4fd6672a | G11 | ACCEPTED: the model never writes `problem.constraints`; investigator edits and clears retained; issue code `dropped` |
| a33-d25 0a1b0136 | D25 second version | two defects found and corrected in the next archive (section 2, C4) |
| combined 2d1db519 | D25, F3 negatives, G11 visible warning, source digest | D25 original rehydrate controls 6 of 6, F3 full-text controls 5 of 5, G11 visible refusal persists reload and export (4,909 bytes); standard suite 170 of 171 during a concurrent build, 1 of 1 on the stable rerun; one correction open (C1) |

Qualifying full workflows executed on any archive so far: 0. Owner attempts on the three samples: 19 of 19,
22 of 22 and 23 of 24 actions executed (change-source unsupported on the screen), all correctly FAIL with
`executedWorkflow: false`. Unit tests are not workflows: 161 or 170 passing tests count for nothing here.

## 2. Corrections to deliver in the next archive (each with a focused regression check; originals and failed
attempts preserved)

- C1 Source digest. `sourceManifest` includes 71 generated files under `.vercel/output`; 21 changed or
  disappeared during a concurrent build and the pinned-digest test failed. Exclude generated `.vercel` output
  from the SOURCE digest and the pack walk (keep the genuine source sensitivity). Controls: a source change
  changes the digest; a generated-output change does not. Keep the initial failure recorded.
- C2 Runner `treeSha256`: filled from the pinned source digest in every result record, never blank.
- C3 G11 on screen (reconciled 2026-09-22T15:05Z with the combined receipt, which verifies a visible
  refusal that persists reload and export). Accepted as delivered: refused model values for
  investigator-entered text are issues with the existing code `dropped` at the path (`constraints`) with a
  message naming the investigator's authority; the screen shows a concise warning naming the path and the
  refusal, also after reload. The bank's goldens check the path word and the refusal semantically
  (`{ "anyOf": ["kept", "refused", "not applied"] }`), never a single literal; if the delivered wording uses
  none of these three words, say which word it uses and the goldens adopt it by a dated amendment (a spec
  error, not a product failure). Regressions kept: null, empty and replacement values refused; investigator
  edit and keyboard clear retained; omission leaves the text unchanged.
- C4 D25 boundary (from the a33-d25 receipt). A schema-4 rehydrate that adds `documents: []` and
  `claim.origin: "unknown"` without repair ids made `isConsequentialReconciliation` false, so the next save
  destroyed the pre-repair raw; a corrupt prior backup plus a quota failure bypassed the refusal;
  `createGuardedStorage` trusted any existing `meridian-studio-v2.backup.4.*` key without reading it. Rule:
  preserve the raw original whenever migration or reconciliation changes the study; verify the recovery bytes
  for the state being repaired; on backup failure keep the original and refuse the destructive write with a
  durable, visible failure record; ordinary autosaves create no backups. The combined archive passes the six
  original rehydrate controls; keep them and add the existing-backup controls (corrupt backup; stale valid
  backup with newer investigator notes).
- C5 F3 full-text binding. `treatAsFullTextRead` returned true with `documents: []`, with a matching
  `documentId` but another `recordId` and abstract scope, with a different `documentId` of the same record,
  and with `complete: true` and an unread section. Rule: exact item, document and version binding, full-text
  scope, non-empty stored body, non-empty all-read section manifest; absence of documents is unknown, never
  proof. The combined archive passes 5 of 5; keep the controls.
- C6 Durable rules in the owner's docs. `docs/REGRESSION_RULES.md`: rule 6 becomes the source-bound typed
  date requirement with Unicode-aware informative title matching (an exact DOI or title with a different year
  is not automatically a date variant; empty or non-informative titles never verify; a failed comparison never
  records a successful check); rule 14 becomes same-version backup plus quota refusal; rule 15 becomes
  withdrawal of an existing completion when eligibility ceases; add the runner negative controls (missing
  predicates, zero-byte storage, lossy export, non-zero exit) as a short list. No new process layer.
- C7 Editing method (a live tool defect: two library files were overwritten and then restored from copies).
  Every edit asserts the exact count of the old text before replacing it on the original file, followed by an
  immediate diff and a retained-export check; `SNAPSHOT.md` lists each edited file with before and after
  hashes. The coordinating session checks the list against the tree hashes.
- C8 Runner accounting (per A3.3, largely delivered): every result record separates authored, executed
  attempts and qualifying full workflows; per-action route; `executedWorkflow` set only by the runner; FAIL
  exits non-zero; the hashed artifact inventory is finalised last; two real hydrate divergences (level 1
  adds `migrationBackupHash`, `migrationEvents`, `repairsApplied` and four `claim.origin: "unknown"`; level 3
  adds `documents` and the three migration fields) are reported as divergences, never hidden by stripping
  fields; recursive equality ignores key order only.
- C9 Retrieval replay and the `fixture` provider (scenario mode only). `MERIDIAN_RETRIEVAL_MODE=replay` serves
  `<REPLAY_DIR>/<key>/retrieval/<provider>.<n>.json` through the existing `recordedTransport`; the `fixture`
  adapter parses `{ "total", "records": RawRecord[] }` and records a `RetrievalEvent` with `performedBy`
  "app"; both exist only under the scenario-mode flags of A3.1; a replay run is never reported as live
  integration. This is the path the bank's `retrieve` steps use (119 of the 103 scenarios' retrieval
  recordings).

## 3. Scenario bank delivery (coordinator-owned)

`Meridian_Scenario_Bank_v1_*.zip`: 103 scenarios (`sc-001` to `sc-103`; 30 fields, 21 families, levels
1 to 5: 15, 26, 26, 21, 15) plus the three samples at version 3; every file passes validator 1.2 (36-check
self-test green); 1,542 replay files (1,423 model, 119 retrieval) plus 46 for the samples; `INDEX.json`
marks eligibility only. Independence: the authors received no trial file; a local overlap check against the
six trial cases gives a maximum token Jaccard of 0.041 (evidence file in the packet, topics not printed).
The sample goldens of A3 (v1) and the v2 set are preserved under `bank-samples/original-v1/` and
`original-v2/` as failure evidence; version 3 supersedes them (G11, `dropped`).

Run policy (A3.1 item 4, restated): fix smoke and targeted failures on the samples first; run the whole bank
in `ui` mode on each releasable candidate and on the final tree; ship `results/<runId>/`; the coordinating
session reruns the same command on the same bytes. Expected on the current tree: most scenarios FAIL on
`capability absent` for the entries in section 4; those are listed against the entries, never counted.

## 4. Next product entries, in order (the first unfinished ones that block the samples)

1. S11 with its phase-5 dependencies (D2 part 1, D3 part 1, D4): `acceptDecision` and `withdrawDecision`
   with `selectionStatus` (proposed, accepted, withdrawn, stale) separate from `actionStatus` (blocked,
   ready), accepted through the screen; a supported decision cites ledger claims resting on retrieved
   records; an unsupported or contradictory selection is refused with the reason shown.
2. The source-change screen route (D5 with S10): a control on the Scan panel that changes a stored record's
   field (`abstract`, `keyFindings`, `year`, `status`) through the store's own action, recorded as a
   consequential change that makes accepted decisions stale on screen, in the store, in the export and after
   reload.
3. C9 (retrieval replay and the fixture provider) with the Scan search action on screen (D18 part), so
   `retrieve` steps run through the screen.
4. Then the phase order of the work order (phase 4 onward) as amended.

## 5. Owner reply format per archive

Unchanged from A3 section 5, plus: the results folder of the sample runs, the counts authored / executed
attempts / qualifying full workflows, and the C7 edit list with hashes.
