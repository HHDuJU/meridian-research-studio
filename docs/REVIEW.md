# Review brief for collaborating AIs

You are reviewing **Meridian**, a methodologist-shaped studio for anesthesia, pain, and QI research. Be a senior clinician-scientist plus a careful frontend engineer. Do not flatter. Do not invent papers.

Repo: this tree. Product heart: `src/lib` + `src/components/studio`.

## Product intent

A clinician types a need. Meridian should:

- rank evidence (GRADE, method quality, relevance) without pretending it crawled PubMed live
- connect papers to context (setting, mechanism, equity, night-shift, resources)
- find gaps and errors
- propose hypotheses/questions with novelty × need × practice-change × feasibility × parsimony
- map question → design → reporting guideline
- keep one primary outcome
- name ethics (TCPS 2 when Canadian), equity (PROGRESS-Plus), cost, patient/family partnership
- write scholarly IMRaD, not grant-brochure English
- stay flexible across reviews, trials, observational, mixed methods, QI/PDSA/SQUIRE

## Known limits (do not file as surprises)

1. **No live literature crawl.** Scan items are seed data or Grok leads. Verification is manual (PubMed, OpenEvidence, Cochrane).
2. **Citations can be wrong.** Every AI item is `landmark` | `verify` | `ai-lead`. Treat anything not landmark as a search query.
3. **Voices are composite.** Not identifiable patients. Labelling must stay honest.
4. **Illuminate is stage-local.** It does not re-derive the whole pipeline unless the user runs later stages.
5. **Auth/DB scaffold is unused** for studies. LocalStorage only.
6. **Host-coupled.** Vite plugins, PWA, preview-host-bridge exist for the Grok app host. Don’t rip them out without a run-path.

## What to review first

### Method (highest value)

- [src/lib/ai.ts](../src/lib/ai.ts) — system prompt, schemas, anti-hallucination rules. Are they strong enough? Missing SPIRIT items, estimands, estimand vs QI measures?
- [src/lib/guidelines.ts](../src/lib/guidelines.ts) — completeness vs clutter. Wrong guideline for a family?
- [src/lib/seed.ts](../src/lib/seed.ts) — are the three studies *methodologically honest*? Ketamine neuropathic pain; ERAS unplanned overnight stay; night-shift opioid programming errors.
- Outcomes: is the primary outcome patient-important? Surrogate creep?
- Ethics/equity: token or usable?
- Overfitting / over-complexity / over-optimization guards — real or slogans?

### Architecture

- Stage contract in `types.ts` vs what panels actually render
- `apply-ai.ts` dropping fields
- Persist migrations (`meridian-studio-v2`)
- Graph readability (`evidence-graph.tsx`)

### UX

- Can a tired anesthesiologist finish Problem → Design without a tutorial?
- Mobile: stage chips, Illuminate, manuscript
- Density vs journal calm (paper/ink palette)

### Safety / integrity

- Prompt injection via study text into Grok
- Invented REB language that could be copy-pasted into a real submission
- Any path that presents `ai-lead` as peer-reviewed fact

## How to file work

Open an issue:

```
Title: [method|code|ux] short claim
Body: file:line, what’s wrong, what “good” looks like, severity (block / should / nit)
Label: review/ai or review/method
```

PRs: smallest change that proves the claim. Do not restyle the whole studio.

## Three seed studies to walk

1. Intravenous ketamine for refractory neuropathic pain — synthesis + pragmatic trial flavour
2. Unplanned overnight stays after elective colorectal ERAS — SQUIRE / PDSA
3. Opioid infusion programming errors on night shift — mixed methods / SEIPS

If a review does not mention at least one of these, it is too abstract.
