# Meridian handoff, 23 September 2026, afternoon: the Grok a45 line and the integrity branch in one tree

Written by the Claude orchestrator session in Cowork (integration owner since the coordinating Fable session handed over at 23:35 UTC on 22 September). It says where the code is, what was checked and how, what was taken from each line and why, what is still open, and what not to undo. Tags: [verified] checked here against the named bytes or run; [computed] produced here by a named run; [unverified] reported by someone else and not checked here.

## 1. Where things are

- **Integration branch:** `claude/meridian-integration-a45`. Trunk: the a45 snapshot. On top: a merge of `claude/meridian-integrity-20260922`, the items adopted from the coordinating session, and the gate-grounding refinement in section 3. Not merged to `main`.
- **Snapshots of Grok Build deliveries (branches, one commit each):** `snapshot/grok-a33-d25-g11-f3`, `snapshot/grok-a4`, `snapshot/grok-a41` (157f7fd), `snapshot/grok-d8b` (b03c139), `snapshot/grok-a45` (1ffbc3c, parent b03c139). Tag `baseline-e27921e` is GitHub `main` before any of this.
- **Earlier branch:** `claude/meridian-integrity-20260922` (03af9b7) stays as history; its content now lives in the integration branch.
- **Grok Build:** holds since 23:29 UTC on 22 September (no D10, no edits). This session sent nothing to Grok; it read the thread and fetched the a45 archives from the preview origin, which answered again on 23 September.
- **One coordinator for Grok at a time.** The coordinating session's roles clause ("the coordinator never edits product code") no longer describes this line: the investigator gave this session code authority. The rule that survives is one writer per file.

## 2. The a45 delivery, checked on the bytes

- Tree `meridian-a45-20260922.tar.gz` 4,841,925 bytes, sha256 d355530b3dc179709595ed2bf3454fa72d328ff63f78490e1632fa7475267abc; results 4,508,478 bytes, sha256 cf8e6d6f51558787dd09097ab9249d473068155b0a035d1e79176c4fef25b103; both equal to the sidecars [verified].
- `scripts/verify-archive.mjs`: 2,137 of 2,137 files, treeSha256 877d7256..., walkSha256 c89c6b59... [verified]. `npm ci`, `tsc --noEmit`, `npm run build` pass; 229 of 229 tests [verified].
- Scenario mode, UI route: samples 3 of 3 qualifying; bank 103 of 103 PASS and qualifying [computed: runs a45-samples and a45-bank, 23 September]. Scenario by scenario identical to the owner's run: same statuses, 17,918 checkpoints, 2,136 screen actions, 0 actions off the screen route, same treeSha256, with Chromium 141 here against 153 there [verified].
- The goldens are the coordinating session's: all 120 files of `scenarios/bank-v1` and the four regenerated replay files are byte-identical to its A4.5 packet (sha256 b89a799c...) [verified]. The 103 of 103 was not obtained by editing expectations.
- Three counts on the a45 bytes: authored 106, executed attempts 106, qualifying full workflows 106 [computed]. Earlier: a42 76, d8b 71 (73 with four amended goldens), a41 35 [unverified here; the coordinating session's receipts].

## 3. What the integration changed

- **Claim support:** a45's S1 (`evidence/support.ts` with `numbers.ts`: a quotation must be an exact span, every attributed number must resolve in the same source sentence as its endpoint and time window, typed derivations, null-value intervals, number words, hyphenated durations, identifier tokens) is the one authority. The integrity branch's own number matcher is gone. Its other checks moved to `evidence/grounding.ts`.
- **`grounding.ts`:** `checkClaim` re-runs S1 on the current stored texts wherever a claim is shown, counted or used for a decision, and adds the text-title check (a stored text sharing no content word with its record's title blocks claims that cite it). Gate and local-fact grounding: a gate a model marks met needs an anchor in text the investigator entered (identifier, figure, five-word phrase), or one positive investigator sentence that states the requirement itself (at least three content words and 60 percent of them; bank sc-083 paraphrased a local fact). Sentences that say something is pending, refused or unknown, or that negate ("no", "not", "without"), never count. An identifier the investigator never supplied refuses the gate outright.
- **Decisions:** a45's T-6 acceptance rule plus two checks from the integrity branch: model gates are grounded at proposal and re-checked at every evaluation, and acceptance re-runs S1 on each cited claim. Evidence revision v1 keeps a45's formula (with year); v2 adds each record's grade and design label and the investigator's local facts; stored decisions are compared in the version they were stamped with.
- **Identifiers:** a45's D31 rule (an id suffix must contain a digit) replaces the integrity branch's list of hyphenated words; the patch is cloned before marking (the stale-batch defect of the 22 September live run), enumerated fields are never rewritten, and objects the investigator wrote are never rewritten.
- **Manual identity checks:** a45's D37 (a manual check records a result and a required note; a manual "match" never sets "verified") replaces the integrity branch's status allow-list.
- **Appraisal:** a45's quarantine store for claims S1 refuses, plus the integrity branch's claim merge: investigator claims stay, replaced model claims go to `supersededClaims`, colliding ids are renamed. The call that starts an appraisal (one call or batch 1 of n) also replaces the model's earlier claims that cite no record; later batches of the same run keep them.
- **Kept from the integrity branch without change:** production search (PubMed, OpenAlex, ClinicalTrials.gov) and Crossref identity checks through server functions, the per-host request gate and retries, sentence-query refusal, whole-record appraisal context with batching, investigator-only local facts (start page and Problem stage), model-run and evidence-run records, the status panel, `scripts/live-e2e.mjs`.

## 4. Measurements on the integrated tree

- `tsc --noEmit` clean; 260 of 260 tests (`npx tsx --test tests/*.test.ts`); `npm run build` passes [verified].
- Probes (`probes/integrity-v2-probes.ts`): SAFE 5 of 5. a45 alone: 1 of 5 (hand-set "verified" is refused by D37; a model gate citing an approval never entered is met, a decision resting on a fabricated number is accepted, the appraisal context cuts a long abstract, a re-appraisal erases the investigator's claims) [computed].
- Bank, scenario mode, UI route (run integ4, 23 September): samples 3 of 3 and bank 103 of 103 qualifying, so the three counts are unchanged from a45 at authored 106, executed attempts 106, qualifying full workflows 106; 17,918 checkpoints and 2,136 screen actions as on a45, none off the screen route; pinned source digest (`scripts/tree-digest.mjs`) caa5a365... in every result and on the committed tree [computed]. Two earlier runs on this tree were cut by container restarts (16 and 67 scenarios done, all PASS) and one full run before the refinement in section 3 gave 102 of 103 (sc-083, the paraphrased local fact); all kept under `/home/claude/runs` in the session workspace.
- Live, on the owner's Mac, real registries, no model calls (`scenarios/live/gate-check.json`, four studies at once): every study PubMed 20 of 253, OpenAlex 20 of 7,681, ClinicalTrials.gov 20 of 50; Crossref 32 verified, 0 mismatch, 5 not found, 2 unresolved, 0 failed; no HTTP 429; no page errors; search 18 to 21 s, identity check 7 to 11 s [computed]. `scripts/app-smoke.mjs`: 9 of 9 [computed].

## 5. From the coordinating session's line: adopted, adapted, not adopted

- **Adopted:** the a45 tree as trunk (phases 1 to 4 of work order 2 and every A4.4 and A4.5 entry); the scenario bank in format 1.2 with validator 1.3 and the three-count rule; the statuses NOT STARTED, IMPLEMENTED, TESTED, END-TO-END; the boundaries (no held-out topics in any tree, a replay run is never live integration, a blocked host or model limit is never a scientific finding, no push or merge without the investigator); `scripts/app-smoke.mjs`, `scripts/bank/aggregate-bank-run.py`, `scripts/bank/triage-bank-failures.py`.
- **Adapted:** trial cases A to D became live plans `scenarios/live/trial-*.json` (need, setting and local facts as the investigator supplied them; unknowns kept as unknowns). The trial's recorded searches and stand-in outputs were not imported: they carry publisher abstracts and come from an older code line. Held-out cases E and F were not opened.
- **Not adopted:** `verify-owner-branch.sh` and `make-owner-pipeline.sh` (archive intake against the 875fe59 harness stubs; this line is git-based and has its own `verify-archive.mjs`, tests and bank); the harness baseline sources and stubs (superseded by the a45 tests); `git/patches/*` and the cowork bundle (already inside the trees; re-applying duplicates work).

## 6. Open, ranked

1. **One trunk for Grok.** Grok's sandbox holds a45. If Grok resumes there (D10 is its next entry) the two lines split again. Either Grok resumes from this branch (an archive of it and a short order, sent only with the investigator's approval), or Grok stays on hold while work continues here.
2. **D10 / S5 remainder.** Covered here: the model cannot write local facts; a model gate needs investigator anchors; pending, refused and negated statements never ground a gate (SYN-LOCAL-01 and -02 in spirit). Not covered: a permission's scope (another study's approval, SYN-LOCAL-05), conflicting facts (-06), data-population coverage (-03), a "needs no approval" statement against an unknown approval (-04).
3. **Gate scope.** A model can attach gates that belong to a rejected alternative ("funding for a comparative trial" on a quality improvement decision); the unmet gate then blocks the chosen decision (live run 3, 22 September).
4. **Registered analysis runs.** Manuscript numbers are not checked against any run; stage prerequisites and approval bound to a content hash are also missing.
5. **Live runs with Grok 4.5.** Every live model call so far was a Claude stand-in. Run the four seed plans and the trial A to D plans with `XAI_API_KEY`; record `liveTested` only from such a run.
6. **Work order phases 5 to 11** (D2, D3, D4; D6, D18, F2; D9, D15; F1 work plan, D13; D14, D17; D5, D19, F4; F5). The integrity branch covers parts of D6 (whole records, batching), D18 (visible retrieval events), F2 (ClinicalTrials.gov), F4 (model-run and evidence-run records) and F1 (investigator-only local facts), each TESTED, none END-TO-END until bank scenarios exercise them.
7. **Housekeeping.** `appVersion` still reads "a33"; set `MERIDIAN_CONTACT_EMAIL` for the Crossref and NCBI polite pools; the start page ships seed studies.

## 7. Do not undo

- S1 in `support.ts` as the single claim-support authority; no second number matcher for claim support.
- The clone before `markUnknownIdsInPatch` (`apply-ai.ts`), the enumerated `QUOTED_KEYS`, and the skip of investigator-written objects (`ids.ts`).
- Investigator-only local facts; model gates grounded in investigator text; D37 manual checks.
- The per-host request gate and retries (`evidence/live.ts`); the sentence-query refusal; registry records keeping "retrieved" when a cross-check fails.
- The snapshot branches and the `baseline-e27921e` tag.
- From the coordinating session: do not reset a Grok tree, regenerate evidence ids, overwrite `model-scan.original-ids.json`, alter `project/reviews/rubric.md`, repair record `ev-0pl99j2`, or re-apply `git/patches/*`; never read or send held-out cases E and F; never weaken a golden to make a scenario pass.

## 8. How to run

- Checks: `npm ci && npx tsc --noEmit && npx tsx --test tests/*.test.ts && npm run build`.
- Bank: `VITE_SCENARIO_MODE=true MERIDIAN_MODEL_MODE=replay MERIDIAN_RETRIEVAL_MODE=replay MERIDIAN_REPLAY_DIR=$PWD/scenarios/replay npx vite dev --port 8094`, then `npx tsx scripts/run-scenarios.mjs scenarios/bank-v1 results/bank --mode ui --base-url http://127.0.0.1:8094` (and `scenarios/bank-samples`); read `COUNTS.json`; `python3 scripts/bank/triage-bank-failures.py <run-dir>`. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when the installed Playwright has no matching browser.
- Live: `npm run dev`, then `npx tsx scripts/live-e2e.mjs scenarios/live/<plan>.json runs/<name> --base-url http://127.0.0.1:8080`; model calls need `XAI_API_KEY`.
