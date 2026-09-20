# AGENTS.md

Instructions for coding agents working in this repository.

## Product

Meridian is a local-first research studio (anesthesia / pain / QI). See README and `docs/`.

## Do

- Keep types in `src/lib/types.ts` as the contract; update panels + `apply-ai.ts` together
- Preserve citation honesty: `landmark` | `verify` | `ai-lead`
- One primary outcome; parsimony comments stay visible
- QI ≠ RCT in copy and in `FAMILY_META`
- `npm run typecheck` before you consider a change done

## Don't

- Invent PMIDs, DOIs, or patient quotations
- Add a literature crawler, auth wall, or database for studies unless an issue asks so
- Restyle globally or swap the paper/ink palette
- Mention host internals (ports, sandbox paths) in user-facing UI copy
- Commit `.env`, `.grok/`, `.vercel/`, or `node_modules`

## Touch map

| Change | Also touch |
|---|---|
| New stage field | `types.ts`, seed study, panel, `ai.ts` schema, `apply-ai.ts` |
| New study family | `stages.ts` `FAMILY_META`, method compass usage, seed if needed |
| Illuminate behaviour | `ai.ts` + `apply-ai.ts` + compact context |
