# SNAPSHOT.md — library hosting edits (deliverable 1b / L1)

Library files stay byte-equal to 875fe59 except the edits listed here. App-side files exist to host that library on the screen.

## Library files (875fe59 → this tree)

| File | Reason |
|---|---|
| `src/lib/types.ts` | `Study.family` may be `null`; `replayKey`; investigator-only empty-search fields; schema 4 documents/claims; `lastIlluminate`. |
| `src/lib/defaults.ts` | `scanMayComplete` requires a retrieved record or a valid `emptySearchConfirmation` (queryHash + revision). Leads-only is incomplete. Repair ids on every migrate. Scan completion is withdrawn when that gate fails; a legacy actor flag cannot keep it. `createStudy` always emits `documents`, `repairsApplied`, `migrationEvents`, `migrationBackupHash`. Same-version hydrate (`alreadyV4`) does not invent a migration event. |
| `src/lib/stages.ts` | `FAMILY_BY_ID.null` is Undetermined (does not throw); `familyOf()`; `guessFamily` may return `null`. |
| `src/lib/store.ts` | L1.6: write audit entries first, then the audit stage patch so `openFixes` / `improvementNotes` / `lastReview` survive; seeds/restore go through `migrateStudy`; `illuminateApply`; `mergeStageIfRevision`; `confirmEmptySearch`; `acceptDecision` / `withdrawDecision`; `hydrated` flag; `recordIlluminateFailure`; persist write-back of repaired studies after same-version rehydrate. `applyRetrieval` merges by id/DOI/title-year, stores `idAliases`, and keeps later `contentVersions`. |
| `src/lib/apply-ai.ts` | Fourth argument is the current study; `ok: false` applies nothing; model gates dropped; `family` may be null. Investigator `problem.constraints` is never written by the model (null / empty / replacement dropped; exact echo is a no-op). Unknown active ids in free text are marked `⟦unresolved:id⟧` with a blocking `unresolved-reference` issue; quoted `passage` is not rewritten. |
| `src/lib/ai.ts` | `family` may be `null`; optional `replayKey`; replay branch only when `VITE_SCENARIO_MODE=true` and `MERIDIAN_MODEL_MODE=replay`; production ignores both. Record mode deferred. |
| `src/lib/compact.ts` | Family line prints `undetermined` when `family` is null. |
| `src/lib/export.ts` | Export JSON is new (A2 item 7). Envelope adds `meta.modelMode` and `meta.replayKey`. Clipboard fallback for preview iframe. |
| `src/lib/illuminate.ts` | Single commit rule: honor `applied.ok`, revision, empty-scan gate; strip model authority keys. |
| `src/lib/evidence/**` | 875fe59 library plus schema-4 identity/documents work from phases 1–3 (listed here because those files are in the tree). Appraisal claims carry `origin: "model"`. |

## New library helpers (not in 875fe59)

| File | Reason |
|---|---|
| `src/lib/replay-key.ts` | Client-safe `replayKey` / mode parsing (no `fs`). Replay requires the compile-time `VITE_SCENARIO_MODE` permission AND `MERIDIAN_MODEL_MODE=replay`. |
| `src/lib/model-runtime.ts` | Server-only replay file IO. Record writes deferred (A3.1). Counters on `globalThis` so reset hits the same map. Path must stay under the replay root. |
| `src/lib/runtime-meta.ts` | Last-known model mode for export envelope. |
| `src/lib/studio-availability.ts` | D21 loading vs missing. |
| `src/lib/persist-backup.ts` | D25: backup before consequential migration/repair; existing `backup.N.*` is valid only when its bytes equal the current original; stale/corrupt keys cannot authorize overwrite; autosaves do not add copies. Same-version schema-4 rehydrate that fills `documents:[]` or `claim.origin` with no new repair id is still a reconciliation (`migrationChangedStudy`). |
| `src/lib/evidence/fixture-adapter.ts` | Scenario-mode synthetic provider. |
| `src/lib/evidence/fulltext.ts` | F3: stored body + completed section manifest before `access` may rise to full-text. A URL or failed fetch is not a read. |
| `src/lib/evidence/publication-status.ts` | F3: retracted/withdrawn results cannot support an active recommendation; status survives recheck errors. |

## App-side files that call the library

| File | Reason |
|---|---|
| `src/components/studio/stage-frame.tsx` | Illuminate captures `studyRevision`, calls `runMeridian` with `family` + `replayKey`, applies through `illuminateApply` (refuses `ok: false` and stale). Parse/transport failures go through `recordIlluminateFailure`. Successful apply with dropped issues shows `Applied with notes.` plus path and message (`data-meridian-partial-apply`, `toast.warning`) without rejecting allowed fields. |
| `src/components/studio/studio-view.tsx` | `familyOf`; needsReview is "review required" and is not counted complete; family picker when undetermined; export confirmation + clipboard; model mode badge. |
| `src/components/studio/stage-panels.tsx` | `VerifyBadge` from `provenance.status`; ScoreBar null = not assessed; investigator empty-search button; Accept/Withdraw on decisions. |
| `src/components/studio/bits.tsx` | Unrated is neutral; null scores "not assessed"; verification from provenance only. |
| `src/components/home/home-page.tsx` | Create stores `family: null` when unresolved; never substitutes mixed-methods; scenario key when `VITE_SCENARIO_MODE=true`. |
| `src/routes/studio.$studyId.tsx` | Loading state until persist hydration; "missing" only after. |

## Template scaffolding (outside the product path)

`src/lib/auth/`, `src/lib/db.ts` (pg, pglite) and `src/lib/multiplayer/` shipped in deliverable 1. They are App Builder template scaffolding. `VITE_AUTH_ENABLED=false` keeps them disabled. No Meridian product path imports them. They are not a work-order boundary breach and must stay out of scan, illuminate, export and evidence code.

## Packaging / runner / durable rules

| File | Reason |
|---|---|
| `scripts/verify-archive.mjs` | P1. |
| `scripts/pack-archive.mjs` | P2 observed `packedAt`. Walk and payload hashes come from `scripts/tree-digest.mjs`. |
| `scripts/tree-digest.mjs` | Pinned source digest: SHA-256 of sorted `path\\0sha256\\n` over the same walk pack-archive uses. Runner writes that value to `result.treeSha256`. |
| `scripts/run-scenarios.mjs` | S17 store and ui modes. A3.3 runnerfix: one evaluated result per declared assertion (`evalIssues` / `evalError` / `evalExpect`); recursive JSON equality ignores object-key order only; reload/reopen read `meridian-studio-v2` or FAIL; export compared to persisted bytes; artifacts hashed on disk before `result.json`; nonzero `process.exitCode` on FAIL/BLOCKED/INCOMPLETE; UI `change-source` recorded unsupported and `change-source.content` FAILs unless the stored field actually changed. `treeSha256` is the pinned source digest computed once per run. `executedWorkflow` stays false until a UI sample passes without unsupported/store-fallback/capability-absent. |
| `scenarios/**` | Format, validator, expander, three samples, replay files from A3 packet. |
| `docs/REGRESSION_RULES.md` | a33-receipt 08fdd17d: rule 6 matches repaired `compareWithRegistry`. Rule 14 same-version raw backup + quota refusal. Rule 15 withdraws existing Scan completion. Rule 17 runner negative controls. Rule 18 investigator `problem.constraints` not model-editable. |
| `docs/DELIVERY_RULES.md` | Pointer to rule 17. Editing: exact before-copy; no whole-file rewrite or truncating patch; one exact unique old-text span; inspect diff and retained exports; restore saved bytes on damage. |
| `docs/FAILED_ATTEMPTS.md` | Retained; adds the version-2 constraints-cleared golden. |
| `scenarios/bank-samples/sc-000-level3.json` | Version 3: supersedes version 2's harmful null-clears golden. Version 2 kept at `original-v2/`. |

## A3.3 runnerfix sample rerun (2026-09-22)

Do not read these as END-TO-END or `executedWorkflow: true`. S11 (`selectionStatus` / `actionStatus`) is still absent. UI `change-source` is unsupported. Three UI attempts remain failures; zero qualifying full workflows.

Store rerun after G11 (2026-09-22T13:04Z): sc-000-level3 constraints checks PASS (create, illuminate null, reopen, export). Remaining fails are S11 and store-mode screen text. sc-000-level1 and sc-000-level4 `issues.count` 0 after problem Illuminate now FAIL because those goldens still expect a silent model rewrite of constraints; not superseded here — flag to Claude.

| Sample | store | ui |
|---|---|---|
| sc-000-level1 | FAIL 184 / 13 (was 12; extra `issues.count` after model rewrite of constraints) | not rerun this increment |
| sc-000-level3 | FAIL 192 / 14; all `problem.constraints` checks PASS | not rerun this increment |
| sc-000-level4 | FAIL 205 / 31 (was 30; extra `issues.count` after model rewrite of constraints) | not rerun this increment |

## Phase 3 (D16 / D11 / D12 / F3) — 2026-09-22

Zero qualifying full workflows. S11 still NOT STARTED. `executedWorkflow` remains runner-observed.

| Entry | Status | Notes |
|---|---|---|
| D16 | TESTED | `markUnknownIds` on apply free text with blocking `unresolved-reference`; quoted `passage` not rewritten; `idAliases` stored by `applyRetrieval` / `mergeIngested`. Required tests in `tests/phase3.test.ts`. |
| D11 | TESTED | Identity comparison and mismatch retention already in `verify.ts` / `appraise.ts`; required tests remain in `tests/phase3.test.ts`. |
| D12 | TESTED | `mergeIngested` keeps later `contentVersions` and flags `suspect-content-pairing`; wired through `applyRetrieval`. |
| F3 | TESTED | `retracted_record_cannot_support_active_recommendation`; `access_rises_to_full_text_only_after_store_put`. `treatAsFullTextRead` requires exact document/item binding, full-text scope, nonempty body, nonempty all-read manifest; empty documents is false. Live routes unused. |

## D25 rehydrate + G11 partial-apply (2026-09-22)

Zero qualifying full workflows. Sample FAILs are not readiness. `executedWorkflow` remains false. CUA `fill("")` miss is not a product failure.

| Entry | Status | Notes |
|---|---|---|
| D25 | TESTED | Same-version schema-4 rehydrate that fills `documents:[]` / `claim.origin` with no new repair id now backs up the pre-repair raw. Corrupt prior backup + quota on that path refuses MAIN_KEY. Twelve ordinary autosaves create no backups. Tests in `tests/receipt-fixes.test.ts`. |
| G11 | TESTED | Successful apply with dropped investigator constraints shows `Applied with notes.` plus path and message (`data-meridian-partial-apply`, `toast.warning`). Allowed fields still apply. Null/empty/replacement protection and human clear remain. |

