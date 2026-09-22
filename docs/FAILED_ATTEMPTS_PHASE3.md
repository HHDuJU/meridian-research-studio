# Preserved failed attempts (D20 fix + L1 + receipt)

1. `stage-frame.tsx` trusted `payload.investigatorConfirmsEmptySearch` from model JSON. Negative test `forged_model_boolean_does_not_complete_empty_scan` now fails closed.
2. First `applyLookupOutcome` fixtures used `10.0/...` which `normalizeDoi` rejects (`10.` needs 4+ digits). Checks were never attached. Replaced with `10.1234/...`.
3. `evidenceRevision` prefix `ev2-` broke compact's `ev1-` regex. Scientific inputs still hash; prefix restored to `ev1-`.
4. Empty-scan GRADE migration first treated seed studies (leads, no retrieval) as empty. Restricted to `items.length === 0`.
5. D22: `downloadStudyJson` dispatched a click event and then called `a.click()`, so one Export JSON click produced two identical files. `a.click()` removed; `one_export_click_dispatches_one_download` counts both paths.
6. D20(c): an omitted `gradeOverall` left a stale high grade on an empty scan because `compactPatch` dropped `undefined`. Empty scans now write `gradeOverall: ""`.
7. D20(d): model-only leads with `gradeOverall: "high"` were applied because `emptyDiscovery` required zero items. Certainty is refused when no retrieved/verified record exists.
8. `npm test` chained template scripts with `&&` before the product tests, so 12 template failures hid the library. Product tests now run as `npm run test:lib` / `npm test` through a declared `tsx` devDependency.