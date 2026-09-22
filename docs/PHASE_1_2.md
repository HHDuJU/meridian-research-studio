# Deliverable 2 — phases 1 and 2 (private)

Builds on deliverable 1 archive SHA-256 `963c43b8addd6f6e62d57fb886b119b257589e0f9bd80c3eb958983fb95224dc`.
No push, no PR, no merge.

## What this phase does

- Phase 1 (D7): public consensus fixture is invented SYNTHETIC prose; tracking query removed; parser tests retargeted.
- Phase 2 (D1, F4 types, D20): schema 4 frozen (`STUDY_SCHEMA_VERSION = 4`); `SourceDocument` / `StoredText`; ingestion writes abstracts; appraisal cannot overwrite them or lower access; empty scan assigns no GRADE label and does not complete; Export JSON click + byte equality tests.

## Failed attempt (preserved)

`tests/apply-ai.test.ts` #11 first failed after the empty-scan rule wrote `gradeOverall: ""` for an invalid enum `"excellent"`. The rule now refuses only a *valid* grade when no retrieved records exist; invalid enums stay absent from the patch.

## Tests

Command: `tsx --test tests/*.test.ts`  
Result: 78 pass, 0 fail (2026-09-22). Typecheck: `tsc --noEmit` exit 0.

16 original probes: not run (AUDIT_PACKET_ROOT unset). Status INCOMPLETE for probe END-TO-END, not a green skip.

## Statuses in this increment

| Entry | Status |
|---|---|
| D7 | TESTED (`public_fixture_contains_only_declared_synthetic_abstracts`) |
| D1 | TESTED (`appraisal_preserves_retrieved_abstract_and_access`, `preserve_original_abstract`, `migration_moves_abstract_prefix_out_of_notes`) |
| D20a | TESTED (`empty_scan_assigns_no_certainty_and_no_completion`) |
| D20b | TESTED (`export_json_bytes_equal_store`) |
| D20c | TESTED (`downloadStudyJson_clicks_anchor_with_store_bytes`) — unit runner, not browser iframe |
| F4 | IMPLEMENTED (UsageEvent / ActivityEvent types only) |
| D2–D6, D8–D19, F1–F3, F5–F6 | NOT STARTED |

## Not done

- S1–S2, S4–S16 behaviour (except S3/S16/S14 fragments above)
- Whole-abstract batching (D6)
- Decision acceptance (D3)
- Evidence-mention classifier (D4)
- UI screens for blockers (D5)
- 16 probes against trial packet
- 79 acceptance catalogue remaining
- Live registry requests
