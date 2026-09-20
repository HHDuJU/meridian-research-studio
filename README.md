# Meridian

**AI research studio for anesthesiology, pain medicine, and quality improvement.**

Meridian walks a study from a clinical need to a manuscript-shaped protocol: scan evidence, rank it (GRADE), map context, find gaps, generate hypotheses and questions, pick a design, write protocol + stats + ethics, bring in patient/family/expert voices, and produce a draft paper. One primary outcome. Parsimony over kitchen-sink methods.

This repo is the collaboration copy. Other humans and AIs: start at [docs/REVIEW.md](docs/REVIEW.md).

## What it does

Thirteen stages, adaptive by study family (systematic review, pragmatic trial, cohort, QI/SQUIRE, mixed methods, qualitative, and more):

| Stage | Job |
|---|---|
| Problem | Frame who is hurt, current practice, why now |
| Scan | Evidence list + GRADE certainty (leads, not live crawl) |
| Map | Context graph — papers, settings, mechanisms, people |
| Gaps | Evidence, method, equity, and error opportunities |
| Hypotheses | Scored on novelty, need, practice change, feasibility, parsimony |
| Questions | PICO / PCC / SQUIRE-shaped questions |
| Design | Family + reporting spine (PRISMA, CONSORT, SPIRIT, SQUIRE, GRADE…) |
| Protocol | Outcomes, procedures, parsimony meter |
| Analysis | SAP sketch, overfitting guards |
| Ethics | TCPS 2 / ICH-GCP, equity (PROGRESS-Plus), costs, grants |
| Voices | Patients, families, experts, partners — labelled as composite |
| Manuscript | IMRaD draft, tables, figures, honest limits |
| Audit | Self-check: bias, complexity, patient-centredness |

## Stack

- React 19 + TanStack Start (file routes) + Tailwind v4 + shadcn/ui
- Zustand persist (local-first studies; no login required)
- Grok via server function for **Illuminate** (structured JSON per stage)
- Recharts + SVG evidence constellation
- Local seed studies so the studio is reviewable without an API key

## Run

```bash
npm install
npm run dev
```

Open the printed local URL. Three example studies load on first visit.

Illuminate needs a Grok/xAI API path in the host environment. Seed studies work without it.

```bash
npm run typecheck
npm run build
```

## Domain stance (non-negotiable)

- Do not invent PMIDs, DOIs, or quotes from real patients
- Citations marked `landmark` | `verify` | `ai-lead` — treat `ai-lead` as a search hint
- One primary outcome; refuse covariate hunting
- Simplest design that answers the question
- QI is not a trial; a trial is not QI
- Safety work is systems work (SEIPS), not person-blame
- Patient-important outcomes over surrogates
- Equity, feasibility, and REB path named explicitly

## Repo map for reviewers

| Path | Why it matters |
|---|---|
| [src/lib/types.ts](src/lib/types.ts) | Study + stage contracts |
| [src/lib/stages.ts](src/lib/stages.ts) | Pipeline + study families + reporting spines |
| [src/lib/ai.ts](src/lib/ai.ts) | Grok system prompt + per-stage JSON schemas |
| [src/lib/apply-ai.ts](src/lib/apply-ai.ts) | JSON patch → store |
| [src/lib/seed.ts](src/lib/seed.ts) | Three complete example studies |
| [src/lib/guidelines.ts](src/lib/guidelines.ts) | Method compass (PRISMA, CONSORT, SQUIRE, GRADE…) |
| [src/lib/store.ts](src/lib/store.ts) | Zustand persist |
| [src/components/studio/](src/components/studio/) | Stage UI, graph, illuminate |
| [docs/REVIEW.md](docs/REVIEW.md) | What other AIs should critique |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit |

## Collaboration

Open issues and PRs. Label reviews with `review/ai` or `review/method`. See [CONTRIBUTING.md](CONTRIBUTING.md).

Known limits are listed in [docs/REVIEW.md](docs/REVIEW.md) so reviewers do not waste time rediscovering them.

## License

MIT. Clinical decisions remain the clinician’s. Meridian is a methodologist, not a REB or a journal.
