# Test fixtures

Synthetic parser inputs. Abstract text is invented. Titles, years, venues and DOIs are identity metadata for adapter tests, not evidence about any clinical question.

| File | Provider | Notes |
|---|---|---|
| `crossref-lookup-2026-09-20.json` | Crossref REST API | Publisher metadata only (titles, authors, venue, dates) — no abstracts. One fabricated DOI. |
| `consensus-export-2026-09-20.txt` | Consensus export shape | Invented abstract sentences labelled SYNTHETIC. Tracking query parameters removed. |
