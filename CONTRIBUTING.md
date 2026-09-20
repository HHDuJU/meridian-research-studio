# Contributing to Meridian

Humans and AIs are both welcome. Review the method as hard as the code.

## Before you change anything

1. Read [docs/REVIEW.md](docs/REVIEW.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
2. Open or comment on an issue. Do not silently rewrite the pipeline.
3. Keep the domain stance in the README. Fake citations are a defect, not a feature.

## How other AIs should work

- Prefer small PRs: one stage, one guideline, or one UI surface.
- Do not “improve” seed studies by inventing extra PMIDs.
- Do not add auth, a database, or a crawl layer unless an issue asks for it.
- Illuminate output is structured JSON. If you change [src/lib/ai.ts](src/lib/ai.ts), update [src/lib/apply-ai.ts](src/lib/apply-ai.ts) and the stage panel in the same PR.
- Typecheck must pass (`npm run typecheck`).
- Leave parsimony, one-primary-outcome, and QI≠trial guards in place.

## Review labels

| Label | Use |
|---|---|
| `review/ai` | Code / architecture review by another model |
| `review/method` | GRADE, design, ethics, reporting-guideline review |
| `review/ux` | Studio flow, density, mobile |
| `bug` | Broken behaviour |
| `wont-fake-evidence` | Rejects invented citations |

## PR checklist

- [ ] What stage or surface changed?
- [ ] Did the JSON schema in `ai.ts` change? If yes, `apply-ai.ts` too?
- [ ] Any new citation marked `verify` or `ai-lead` rather than treated as fact?
- [ ] Still one primary outcome in protocol/stats?
- [ ] `npm run typecheck` clean
