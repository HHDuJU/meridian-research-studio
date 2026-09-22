# Meridian handoff, 23 September 2026 (for Astra)

Written by the Claude orchestrator session (Cowork, "primary orchestrator" for the night of 22 September). One page on where the code is, what changed, what was measured, what is still wrong, and what to do next.

## 1. Where things are

- **This branch:** `claude/meridian-integrity-20260922`, 9 commits on top of the a41 snapshot; head is the commit that adds this file. Not merged, not pushed (see section 8).
- **Snapshots of Grok Build deliveries, preserved as branches:** `snapshot/grok-a33-d25-g11-f3` (2ea16ae), `snapshot/grok-a4` (529aaf3), `snapshot/grok-a41` (157f7fd, archive sha256 6c11cceb...), `snapshot/grok-d8b` (b03c139, archive sha256 7b68d3e9...). Tag `baseline-e27921e` is GitHub `main` before any of this.
- **GitHub (checked 00:25 on 23 September):** `main` e27921e and `app/complete-v1` 3c25f26 only. GitHub holds the library shell; the product has lived in Grok archives. Nobody pushed tonight.
- **Two coordinating sessions ran in parallel tonight.** The Fable "Meridian Repository Reconciliation" session kept directing Grok: it received a42 (76 of 106 qualifying full workflows on the updated bank) and d8b (71 of 106; D8 "S1" claim-number quarantine accepted as mapper and quarantine, not end to end), and sent amendment sheets A4.4 and A4.5. Its packets are in the Mac intake folder `fable-late/`. This branch started from a41 before those deliveries existed.

## 2. What this branch adds (by commit)

- **142c413, 11923df (evidence and studio):** production literature search through server functions (PubMed esearch then efetch with whole structured abstracts, OpenAlex with abstracts rebuilt from the inverted index, ClinicalTrials.gov v2 with registry facts), Crossref identity checks in chunks of 20; claim support against stored source text (quoted passage must occur, every stated number must occur); gates a model marks "met" must be anchored in text the investigator entered; investigator "local facts" (entered on the start page or the Problem stage; the model cannot write them); hand-set status cannot claim "verified" or "retrieved"; appraisal shows each record whole and batches large sets; append-only model-run and evidence-run records; status panel with a next step.
- **cf71bc8 (first live run):** discovery asks for a Boolean search string; sentence-like queries are refused with a reason; OpenAlex and ClinicalTrials.gov get the query without PubMed field tags; a failed cross-check no longer demotes a registry record; any record with stored text is batched; retries on HTTP 429 and 5xx; `scripts/live-e2e.mjs` drives a study through the real UI and records what the app shows and stores.
- **5a76634 (second live run):** batched appraisal no longer goes stale. The id linter matched the claim kind "local-fact" as an unknown id and rewrote it to "⟦unresolved:local-fact⟧" in place, on objects shared with the stored study, so every batch after the first was refused. The patch is now cloned before marking, enumerated fields are never rewritten, and hyphenated vocabulary is not an id. Also: a narrow "not in place" guard for gate grounding (pending, declined, submitted without a decision), and 6,000 output tokens for appraisal calls.
- **b90acb4, 17501d9 (third live run and bank):** one request at a time per registry host with spacing (NCBI 400 ms, Crossref 300 ms) and two retries; optional `MERIDIAN_NCBI_API_KEY`; a stored text that shares no content word with its record title is flagged and blocks claims citing it; all 20 study families on the start page (it showed 8); fractions in words ("about three quarters") are approximate figures, not fabricated numbers.

## 3. Measurements

- **Unit tests:** 216 of 216 pass (`npx tsx --test tests/*.test.ts`); `tsc --noEmit` clean. New tests are in `tests/integrity-v2.test.ts`; the stale-batch test fails on the code before 5a76634.
- **Probes** (`probes/integrity-v2-probes.ts`, same script on each tree): a41 UNSAFE 5 of 5; d8b UNSAFE 5 of 5; this branch SAFE 5 of 5 (hand-set "verified", model gate citing an approval never entered, accepting a decision on a fabricated number, appraisal context cutting the abstract, appraisal erasing investigator claims).
- **Replay bank, 103 scenarios, UI mode, as shipped in a41:** a41 33 PASS, 489 failing checks; this branch 33 PASS, 479 failing checks. Differences: sc-002 now passes (id linter); sc-083 and sc-087 fail by design (a paraphrased local fact is not an anchor; a gate citing an investigator edit that never happened is refused); sc-063 and sc-079 lose one failing check each. These counts are not comparable with the coordinating session's 71 and 76 of 106, which use the updated bank on newer Grok bytes.
- **Live runs on the owner's Mac (real PubMed, OpenAlex, ClinicalTrials.gov, Crossref; model = Claude stand-in answering the xAI-compatible endpoint because no xAI key was available; every request and reply is kept):** see `docs/LIVE_RUNS_2026-09-22.md`. Seeds: IV ketamine for refractory neuropathic pain, colorectal ERAS unplanned extra night, overnight PCA programming errors; fresh: point-of-care gastric ultrasound in patients on GLP-1 receptor agonists (diagnostic accuracy). Before (a41, live): model leads only, no search control, no identity check, decision refused for lack of retrieved evidence. After: 20 to 60 registry records per study with stored abstracts (plus 7 or 8 model leads), Crossref verification, claims checked against the stored text, gates grounded in the investigator's documented facts (PH-2026-091, PO-2026-117, QIS-2026-131, EU-2026-044), decisions refused or blocked for stated reasons. Pacing check with four studies at once: no HTTP 429, same records and checks in all four.

## 4. Defects found tonight and their state

| Found by | Defect | State |
|---|---|---|
| Probes | Hand-set "verified"; model gate citing an approval never entered; decision accepted on a fabricated number; appraisal context cut the abstract; appraisal erased investigator claims | Fixed here; still present in d8b |
| Live run 1 | Model sentence queries: PubMed 0, 0 and 358,453 hits; ClinicalTrials.gov HTTP 400 | Fixed (cf71bc8) |
| Live run 1 | One failed Crossref chunk demoted 20 PubMed records to "check-failed", which pushed them out of appraisal batching and past the context limit | Fixed here; demotion still in d8b `verify.ts:126` |
| Live run 2 | OpenAlex attached a stroke thrombectomy abstract to a CMAJ medication-error paper; Crossref still matched the title | Flagged and blocking (17501d9) |
| Live run 2 | Every appraisal batch after the first refused as stale; "local-fact" claim kinds corrupted | Fixed here; both causes still in d8b (`ids.ts:4`, `ids.ts:114`, `apply-ai.ts:137`) |
| Live run 3 | HTTP 429 from NCBI and Crossref with four studies at once | Fixed (b90acb4), confirmed live |
| Live run 3 | A model can attach gates that belong to a rejected alternative ("funding for a comparative trial" on a QI decision); the unmet gate then blocks the chosen decision for good | Open |
| Bank | "about three quarters" read as the number 3; not-in-place guard false alarms ("do not need review", "requested the review") | Fixed |

## 5. Open problems, ranked

1. **Two code lines.** Grok's line (a42, d8b, next archive under A4.5) carries many bank fixes and the sentence-bound D8 claim check; this branch carries production retrieval, investigator facts, grounding and the live fixes. A trial merge of this branch onto d8b conflicts in 8 files: `evidence/support.ts` (both added it), `apply-ai.ts`, `store.ts`, `ids.ts`, `contracts.ts`, `defaults.ts`, `stage-frame.tsx`, `home-page.tsx`.
2. **Gate scope.** Gates need a scope (this decision versus a rejected alternative) or an investigator "not required for this decision, because" action.
3. **No registered analysis runs.** Manuscript numbers are not checked against any run (Research OS adoption item 1). Stage prerequisites and approval bound to a content hash are also missing (items 3 and 4).
4. **Appraisal cost.** 40 to 60 records need 3 to 6 appraisal calls of about ten records each. With a real model this is seconds per call; with the stand-in it was 5 to 40 minutes. Consider a relevance screen before whole-text appraisal.
5. **Not run with Grok.** Every live model call tonight was a Claude stand-in. Grok 4.5 may differ on query format, quoting and output length.
6. **Housekeeping.** `appVersion` still reads "a33" in results; the start page ships seed studies (the live driver reads the study id from the URL for that reason); set `MERIDIAN_CONTACT_EMAIL` for the Crossref and NCBI polite pools.

## 6. Next steps for Astra, in order

1. **Pick one trunk.** Recommended: Grok's latest archive as the trunk, this branch as the source of a port. Keep one coordinator for Grok (the Fable session or you, not both).
2. **Port onto the Grok line** in this order, each with its tests: (a) 5a76634 id-linter clone and enum keys; (b) the `verify.ts` status rule from cf71bc8; (c) local facts and gate grounding (142c413, 11923df, 5a76634 guard); (d) decision-time claim check (P3) on top of D8's mapper quarantine; (e) production retrieval, identity checks and the per-host gate (142c413, cf71bc8, b90acb4); (f) text-title flag, discovery schema and appraisal token budget. For S1 keep D8's sentence-bound `support.ts` as the authority and move this branch's module to another name; its test cases (fractions, number words, "under-18s", "SGLT2", the null value in an interval) are ready-made controls for D8-a to D8-d.
3. **Run the live suite with Grok:** `XAI_API_KEY=... npm run dev`, then `npx tsx scripts/live-e2e.mjs scenarios/live/live-d-gastric-us.json runs/d --base-url http://127.0.0.1:8080` (and the other three plans). Record `registry.ts` `liveTested` only from such a run.
4. **Close gate scope (problem 2) and registered runs (problem 3).**

## 7. Do not overwrite or undo

- The clone before `markUnknownIdsInPatch` in `apply-ai.ts` and `NOT_IDS` / enumerated `QUOTED_KEYS` in `evidence/ids.ts` (the stale-batch bug returns without them).
- Investigator-only local facts; manual statuses limited to `MANUAL_SOURCE_STATUSES`; model "met" gates needing anchors in investigator text.
- The per-host request gate and retries in `evidence/live.ts`; the sentence-query refusal.
- Registry records keeping "retrieved" when a cross-check fails.
- The snapshot branches and the `baseline-e27921e` tag.

## 8. Push status

This session could not push: the container has read access to GitHub but no write credential, and the Mac could not resolve github.com tonight. A git bundle with every branch above is in the Mac intake folder (`git/meridian-claude-20260923.bundle`); the push command is in the note next to it.
