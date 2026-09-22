import type { EvidenceItem, StageId, Study } from "./types";
import { STAGE_BY_ID } from "./stages";
import { claimSupport } from "./evidence/support";

/*
 * Compact study context for a model call.
 *
 * Principles:
 *  - what is cut is said to be cut ("[clipped 412 chars]", "+4 records not shown"), so the model
 *    cannot mistake a truncated context for the whole study;
 *  - evidence is ranked by provenance and relevance, not by array position, and each record carries
 *    the facts a decision needs (identifier, status, one line of findings and limitations);
 *  - decisions the investigator made (selected hypothesis, outcome measure and timing, local facts,
 *    assumptions, unresolved access) are carried explicitly.
 * The full study object remains the source of truth; this is a view, not a store.
 */

export const EVIDENCE_IN_CONTEXT = 12;
/**
 * @deprecated Abstracts are no longer clipped at appraisal (S4/D6): a record the model is asked to
 * annotate is shown whole, and a set too large for one call is split into batches
 * (`scanAppraisalBatches`). Kept for older imports; not used to cut text.
 */
export const ABSTRACT_CHARS_AT_SCAN = 520;
/** Context size the server accepts (mirrors MAX_COMPACT_CHARS in ai.ts). */
export const CONTEXT_LIMIT = 32_000;
/** Room kept for the stage schema, the steer and the batch note. */
export const CONTEXT_MARGIN = 2_500;

export interface CompactOptions {
  /** Scan appraisal: only these records are shown (one batch); others are listed by id. */
  recordIds?: string[];
  batch?: { index: number; of: number };
}

function clip(s: string, n = 900): string {
  const t = (s ?? "").trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n)} [clipped ${t.length - n} chars]`;
}

const STATUS_RANK: Record<EvidenceItem["provenance"]["status"], number> = {
  verified: 0,
  retrieved: 1,
  "check-failed": 2,
  unverified: 3,
  "access-blocked": 3,
  mismatch: 4,
};

/** Ranked selection: verified before retrieved before leads; then relevance (unknown last); then recency. */
export function rankEvidence(items: EvidenceItem[]): EvidenceItem[] {
  return [...items].sort((a, b) => {
    const s = STATUS_RANK[a.provenance?.status ?? "unverified"] - STATUS_RANK[b.provenance?.status ?? "unverified"];
    if (s !== 0) return s;
    const ra = a.relevance ?? -1;
    const rb = b.relevance ?? -1;
    if (ra !== rb) return rb - ra;
    return (b.year ?? 0) - (a.year ?? 0);
  });
}

function evidenceLine(i: EvidenceItem, withAbstract = false): string {
  const id = i.doi ? `doi:${i.doi}` : i.pmid ? `pmid:${i.pmid}` : (i.provenance?.identifiers?.nct ? `nct:${i.provenance.identifiers.nct}` : "no identifier");
  const first = (i.authors ?? "").split(",")[0]?.trim() || "—";
  const flags = [i.publicationStatus === "retracted" || i.publicationStatus === "withdrawn" ? `${i.publicationStatus.toUpperCase()}` : ""].filter(Boolean);
  const parts = [
    `${i.id} | ${i.year ?? "year?"} ${first} — ${i.title} [${i.kind}/${i.grade}/${i.provenance?.status ?? "unverified"}; ${id}${i.source ? `; ${i.source}` : ""}${flags.length ? `; ${flags.join(", ")}` : ""}]`,
  ];
  if (i.keyFindings) parts.push(`  findings: ${clip(i.keyFindings, 600)}`);
  if (i.limitations) parts.push(`  limits: ${clip(i.limitations, 400)}`);
  // At appraisal the record is shown whole: claims must quote it, so nothing may be cut.
  if (withAbstract && i.abstract?.text) parts.push(`  TEXT: ${i.abstract.text.trim()}`);
  else if (withAbstract) parts.push("  TEXT: none stored (metadata only); do not attribute findings to this record.");
  if (withAbstract && i.notes) parts.push(`  notes (commentary, not source text): ${clip(i.notes, 400)}`);
  return parts.join("\n");
}

function isAppraisable(i: EvidenceItem): boolean {
  return i.provenance?.status === "retrieved" || i.provenance?.status === "verified";
}

/**
 * Split the records the model must appraise into batches that each fit the context limit with
 * every record's text whole. One record per batch at minimum; order follows rankEvidence.
 */
export function scanAppraisalBatches(study: Study, limit = CONTEXT_LIMIT - CONTEXT_MARGIN): string[][] {
  const records = rankEvidence(study.scan.items).filter(isAppraisable);
  if (!records.length) return [];
  const base = compactStudy(study, "scan", { recordIds: [] }).length;
  const batches: string[][] = [];
  let current: string[] = [];
  let size = base;
  for (const r of records) {
    const len = evidenceLine(r, true).length + 1;
    if (current.length && size + len > limit) {
      batches.push(current);
      current = [];
      size = base;
    }
    current.push(r.id);
    size += len;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function compactStudy(study: Study, stage: StageId, opts: CompactOptions = {}): string {
  const parts: string[] = [
    `Title: ${study.title}`,
    `Subtitle: ${study.subtitle}`,
    `Family: ${study.family ?? "undetermined"}${study.design.basis ? ` (basis: ${study.design.basis})` : ""}`,
    `Setting: ${study.setting}`,
    `Status: ${study.status}`,
    `Current stage requested: ${STAGE_BY_ID[stage].label}`,
    `Completed: ${study.completedStages.join(", ") || "none"}`,
    `Needs re-review after upstream change: ${(study.needsReview ?? []).join(", ") || "none"}`,
    `PROBLEM raw: ${clip(study.problem.rawNeed)}`,
    `PROBLEM statement: ${clip(study.problem.statement)}`,
    `Who: ${clip(study.problem.whoAffected, 400)}`,
    `What hurts: ${clip(study.problem.whatHurts, 400)}`,
    `Practice: ${clip(study.problem.currentPractice, 400)}`,
    `Constraints: ${clip(study.problem.constraints, 600)}`,
    `Patient goal: ${clip(study.problem.patientCenteredGoal, 400)}`,
  ];
  const facts = study.problem.localFacts ?? [];
  parts.push(
    facts.length
      ? "LOCAL FACTS entered by the investigator (the only basis on which a gate may be called met):\n" +
          facts.map((f) => `- ${f.id}: ${clip(f.text, 400)}`).join("\n")
      : "LOCAL FACTS entered by the investigator: none. Do not describe any approval, resource or agreement as supplied by the investigator.",
  );

  const scan = study.scan;
  if (scan.retrievalEvents?.length) {
    parts.push(
      "SEARCHES ACTUALLY RUN: " +
        scan.retrievalEvents
          .map((e) => `${e.provider}${e.performedBy !== "app" ? ` (${e.performedBy})` : ""}: "${e.query}" → ${e.status}${e.resultCount !== null ? `, ${e.resultCount} hits` : ""}`)
          .join(" | "),
    );
  } else if (scan.items.length) {
    parts.push("SEARCHES ACTUALLY RUN: none — all evidence below is unretrieved leads.");
  }
  if (scan.unresolvedAccess?.length) parts.push(`UNRESOLVED ACCESS: ${scan.unresolvedAccess.join("; ")}`);

  if (scan.items.length) {
    parts.push(`SCAN grade: ${scan.gradeOverall || "unrated"}. ${clip(scan.synthesis, 700)}`);
    const ranked = rankEvidence(scan.items);
    const appraising = stage === "scan";
    const inBatch = opts.recordIds ? new Set(opts.recordIds) : null;
    const shown = appraising ? (inBatch ? ranked.filter((i) => inBatch.has(i.id)) : ranked) : ranked.slice(0, EVIDENCE_IN_CONTEXT);
    const hidden = appraising ? (inBatch ? ranked.filter((i) => !inBatch.has(i.id)) : []) : ranked.slice(EVIDENCE_IN_CONTEXT);
    const counts = scan.items.reduce<Record<string, number>>((acc, i) => {
      const k = i.provenance?.status ?? "unverified";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    parts.push(
      `EVIDENCE (${scan.items.length} records; ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}):\n` +
        shown.map((i) => evidenceLine(i, appraising)).join("\n") +
        (hidden.length
          ? appraising
            ? `\n  ${hidden.length} other records are appraised in other batches (ids: ${hidden.map((h) => h.id).join(", ")}); do not annotate or cite them in this call.`
            : `\n  +${hidden.length} more records not shown (ids: ${hidden.map((h) => h.id).join(", ")}); ask for them by id if needed.`
          : ""),
    );
    if (appraising && opts.batch && opts.batch.of > 1) {
      parts.push(`APPRAISAL BATCH ${opts.batch.index} of ${opts.batch.of}: annotate only the records shown; the synthesis and certainty should cover every record and the claim ledger so far.`);
    }
  }

  if (scan.claims?.length) {
    parts.push(
      "CLAIM LEDGER:\n" +
        scan.claims
          .map((c) => {
            const sup = claimSupport(c, study);
            const flag = sup.blocking ? ` {NOT SUPPORTED BY SOURCE TEXT: ${sup.message}}` : sup.status === "no-source-text" && c.kind === "source-derived" ? " {unchecked: no stored text}" : "";
            return `${c.id} [${c.kind}; ${c.uncertainty} uncertainty] ${clip(c.text, 300)}${c.sourceIds.length ? ` ← ${c.sourceIds.join(", ")}` : ""}${c.location ? ` @ ${c.location}` : ""}${flag}`;
          })
          .join("\n"),
    );
  }

  if (study.map.reading) parts.push(`MAP: ${clip(study.map.reading, 600)}`);
  if (study.map.contexts?.length) parts.push(`CONTEXTS: ${study.map.contexts.join("; ")}`);
  if (study.gaps.items.length) {
    parts.push("GAPS: " + study.gaps.items.map((g) => `${g.title} (${g.kind}, ${g.severity})`).join("; "));
  }
  if (study.hypotheses.items.length) {
    parts.push(
      "HYPOTHESES: " +
        study.hypotheses.items
          .map((h) => `${h.id}${h.id === study.hypotheses.selectedId ? " [SELECTED]" : ""}: ${clip(h.statement, 180)}`)
          .join(" | "),
    );
    if (!study.hypotheses.selectedId) parts.push("Selected hypothesis: none yet.");
  }
  if (study.questions.items.length) {
    parts.push(
      "QUESTIONS: " +
        study.questions.items.map((q) => `${q.id} (${q.framework}): ${q.text}`).join(" | "),
    );
  }
  if (study.design.rationale || study.design.recommended) {
    parts.push(`DESIGN: ${study.design.recommended || "undecided"}. ${clip(study.design.rationale, 500)}`);
  }
  if (study.design.decisions?.length) {
    parts.push(
      "DECISIONS:\n" +
        study.design.decisions
          .map((d) => {
            const gates = d.gates.map((g) => `${g.requirement} [${g.status}]`).join("; ");
            return `${d.id} [${d.kind}; ${d.status}; rev ${d.inputRevision}] ${clip(d.statement, 240)}${d.claimIds.length ? ` ← ${d.claimIds.join(", ")}` : ""}${gates ? `\n  gates: ${gates}` : ""}`;
          })
          .join("\n"),
    );
  }
  if (study.protocol.overview) {
    parts.push(`PROTOCOL: ${clip(study.protocol.overview, 500)}`);
    parts.push(
      "OUTCOMES: " +
        study.protocol.outcomes
          .map((o) => `${o.role}: ${o.name} [${o.measure || "measure?"} @ ${o.timing || "timing?"}${o.patientCentered === null ? "; patient-centred?" : o.patientCentered ? "; patient-centred" : ""}]`)
          .join(", "),
    );
    if (study.protocol.feasibility) parts.push(`FEASIBILITY: ${clip(study.protocol.feasibility, 400)}`);
  }
  if (study.stats.primaryAnalysis) parts.push(`STATS: ${clip(study.stats.primaryAnalysis, 400)}`);
  if (study.ethics.rebPath) parts.push(`ETHICS REB: ${clip(study.ethics.rebPath, 300)}`);
  if (study.voices.items.length) {
    parts.push("VOICES (composite/synthetic unless marked otherwise): " + study.voices.items.map((v) => v.theme).join(", "));
  }

  return parts.join("\n");
}
