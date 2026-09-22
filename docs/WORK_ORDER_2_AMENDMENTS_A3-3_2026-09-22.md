# Work order 2: amendment sheet A3.3 (coordinating session, 2026-09-22T11:55Z)

S17 scenario runner: release blocker in the delivered `scripts/run-scenarios.mjs`. A3.3 wins over A3 S17 where they differ.

Required:
1. Every action either executes through the real browser page or is recorded as `unsupported` with the reason in the checkpoint.
2. The `ui` mode reads the persisted study from `localStorage` key `meridian-studio-v2` through `page.evaluate`; `reload` is `page.reload()`; `reopen` navigates home and opens the study from the list by title.
3. `export` waits for the browser download event, writes `export.json`, deep-equals the persisted study, records download count (D22).
4. `consoleErrors` and `pageErrors` come from the page's `console` and `pageerror` events.
5. `store` mode stays labelled `mode: "store"` and is never merged into a `ui` result.
6. Acceptance: three version 2 samples run in `ui` mode with every action executed or recorded unsupported; result folders contain `export.json`, `store-final.json`, screenshots, and real error arrays.
