# Architecture

Local-first research studio. Studies live in the browser (Zustand + `localStorage`). Illuminate calls Grok on the server and patches the active stage.

```
Home (need → create study)
  └─ Studio /:studyId
       ├─ left rail   13 stages
       ├─ centre      stage panel
       └─ right rail  reporting spine, parsimony, ethics flags
  Method compass /method
```

## Data

`Study` in [src/lib/types.ts](../src/lib/types.ts) is the source of truth. Each stage owns a typed slice (`problem`, `scan`, `map`, …). `stageStatus` tracks `idle | generating | ready | error`.

Seed injection: [src/lib/seed.ts](../src/lib/seed.ts) → [src/lib/store.ts](../src/lib/store.ts) persist key `meridian-studio-v2`. Bump the key if seed shape changes.

## Illuminate path

1. Stage panel **Illuminate** → [src/components/studio/stage-frame.tsx](../src/components/studio/stage-frame.tsx)
2. Compact study context [src/lib/compact.ts](../src/lib/compact.ts)
3. Server fn [src/lib/ai.ts](../src/lib/ai.ts) `runMeridian` — Grok, JSON only
4. [src/lib/apply-ai.ts](../src/lib/apply-ai.ts) maps JSON → stage patch (+ optional title/family)
5. Store merge; UI re-renders

The server returns `json: string` (not a raw object) so TanStack Start can serialize it.

## Study families

[src/lib/stages.ts](../src/lib/stages.ts) `FAMILY_META` binds a family to reporting guidelines and a question frame (PICO, PCC, SQUIRE, …). The method compass is [src/lib/guidelines.ts](../src/lib/guidelines.ts).

## Evidence graph

[src/components/studio/evidence-graph.tsx](../src/components/studio/evidence-graph.tsx) — SVG constellation (nodes + edges). Labels live in chips under the canvas to avoid overlap.

## What is scaffold vs product

TanStack Start, Vite/Nitro, shadcn, auth/app-data, PWA plugins are host scaffold. **Product logic is `src/lib/{types,stages,ai,apply-ai,seed,store,guidelines,compact}.ts` and `src/components/{studio,home,method,layout}`.**

Auth is unused for Meridian studies (local persist). Do not assume a user table.
