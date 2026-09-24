# Meridian on Cowork (from 24 September 2026)

The investigator's decision of 24 September: stop waiting for Grok Build and let Claude run Meridian inside
his Claude account. This file says what the Cowork edition is, what differs from the server build, how to
build and publish it, and what is still open. Tags: [verified] checked here on the named bytes or run;
[computed] produced here by a named run.

## 1. What it is

- **A private page in the investigator's Claude account** (Artifact "Meridian Research Studio", published
  from this repository by the integration owner's Cowork session). It opens in claude.ai and the Claude apps.
  Nobody else can open it unless he shares it.
- **The same app:** every page, the store, the evidence rules (S1 claim support, D10 approvals, D37 manual
  checks, appraisal batching) and the export are the server build's code, unchanged. Four modules are swapped
  at build time (`vite.cowork.config.ts`):
  - `@/lib/ai` becomes `src/cowork/ai.ts`: the model call goes to Claude through the page's `sample`
    capability, most capable tier ("complex"), on the viewer's own Claude plan. The prompt is the server
    build's, word for word (`src/lib/prompt.ts`, shared by both builds; same fingerprint hash).
  - `@/lib/evidence-server` becomes `src/cowork/evidence-server.ts`: literature search through the viewer's
    PubMed and Clinical Trials connectors (`mcp` capability); identity checks through PubMed.
  - The root route renders no document shell (`src/cowork/root.tsx`); navigation lives in memory.
  - `@tanstack/react-start` becomes `src/cowork/no-server.ts`, which refuses any server call with a
    readable message.
- **Export** goes through the viewer's save prompt (`downloads` capability), because an artifact frame
  ignores link downloads (`setFileSaver` in `src/lib/export.ts`).

## 2. What differs from the server build

- **Model:** Claude instead of xAI Grok 4.5. Each run record names provider `claude-cowork` and the tier that
  answered. No API key, no separate bill; each call counts against the viewer's Claude plan, and the first call
  in a page view asks the viewer to allow it.
- **Sources:** PubMed and ClinicalTrials.gov only. OpenAlex and Crossref have no connector; the search panel
  shows only the sources this build can reach.
- **Identity checks:** PubMed answers them (DOI to PMID, then the PubMed record). A registry does not confirm
  its own records: a record retrieved from PubMed is not sent back to PubMed (`doisToCheck` in
  `src/lib/evidence/requests.ts`), so "verified" keeps meaning an independent registry agreed. A DOI PubMed
  does not index comes back "not found", which changes no status.
- **Storage:** each study stays in the page's browser storage (the page opens instantly) and is also kept in
  the artifact's database under the viewer's private path (`data/users/<id>/meridian/studies/<study>`), so
  studies follow the investigator between the Claude app, a browser and the phone (`src/cowork/sync.ts`). A
  database document holds at most 256 KiB, so a study is stored in parts of 80,000 characters under a head
  document that carries the parts count and the study's SHA-256; a study whose parts disagree with its head is
  skipped, never loaded. Per study, the side that changed since the last sync wins; if both changed, the later
  save wins. The three seed studies ship with every copy and are not synced. Export JSON remains the
  investigator's own backup.

## 3. Build and publish

- `npm run build:cowork` writes `dist-cowork/meridian.html` (the page: title, stylesheet, mount point,
  script), `app.js`, `app.css` and `cowork-build.json` (sizes and sha256 of both files).
- Publish with the Artifact tool: `file_path` `dist-cowork/meridian.html`, `files`
  `{"app.js": "dist-cowork/app.js", "app.css": "dist-cowork/app.css"}`, `capabilities`
  `{"sample": {}, "mcp": {"servers": [{"server": "PubMed", "tools": ["search_articles", "get_article_metadata", "convert_article_ids"]}, {"server": "Clinical Trials", "tools": ["search_trials", "get_trial_details"]}]}, "downloads": true, "db": {}, "user": {}}`.
  A republish from the same session keeps the URL; from another session pass the artifact URL as `url`.
- Tests: `tests/cowork.test.ts` (connector payload mapping with payloads shaped like real connector replies,
  refused and missing connectors, partial registrations, identity checks, the prompt equality, the model call's
  success and failure paths) and `tests/cowork-sync.test.ts` (parts, which copy wins, two devices, a
  half-written study, private paths).

## 4. Open

1. **First live runs with Claude through the page**, once the investigator allows Claude and the two
   connectors for the page.
2. **Studies across devices:** tested with an in-memory database; confirm on the Mac and the phone once the
   investigator has used the page on both.
3. **Sources:** OpenAlex and Crossref come back only if a connector for them exists; until then Meridian on
   Cowork says so in the search panel and in each blocked retrieval event.
