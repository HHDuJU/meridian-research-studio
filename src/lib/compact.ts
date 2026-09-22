import type { EvidenceItem, StageId, Study } from "./types";
import { STAGE_BY_ID } from "./stages";

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
/** At the Scan (appraisal) stage the model must see every record it is asked to annotate, with its abstract. */
export const ABSTRACT_CHARS_AT_SCAN = 520;

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
  const id = i.doi ? `doi:${i.doi}` : i.pmid ? `pmid:${i.pmid}` : "no identifier";
  const first = (i.authors ?? "").split(",")[0]?.trim() || "—";
  const parts = [
    `${i.id} | ${i.year ?? "year?"} ${first} — ${i.title} [${i.kind}/${i.grade}/${i.provenance?.status ?? "unverified"}; ${id}${i.source ? `; ${i.source}` : ""}]`,
  ];
  if (i.keyFindings) parts.push(`  findings: ${clip(i.keyFindings, 220)}`);
  if (i.limitations) parts.push(`  limits: ${clip(i.limitations, 160)}`);
  if (withAbstract && i.abstract?.text) parts.push(`  ${clip(i.abstract.text, ABSTRACT_CHARS_AT_SCAN)}`);
  else if (withAbstract && i.notes) parts.push(`  ${clip(i.notes, ABSTRACT_CHARS_AT_SCAN)}`);
  return parts.join("\n");
}

export function compactStudy(study: Study, stage: StageId): string {
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
    const shown = appraising ? ranked : ranked.slice(0, EVIDENCE_IN_CONTEXT);
    const hidden = appraising ? [] : ranked.slice(EVIDENCE_IN_CONTEXT);
    const counts = scan.items.reduce<Record<string, number>>((acc, i) => {
      const k = i.provenance?.status ?? "unverified";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    parts.push(
      `EVIDENCE (${scan.items.length} records; ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}):\n` +
        shown.map((i) => evidenceLine(i, appraising)).join("\n") +
        (hidden.length ? `\n  +${hidden.length} more records not shown (ids: ${hidden.map((h) => h.id).join(", ")}); ask for them by id if needed.` : ""),
    );
  }

  if (scan.claims?.length) {
    parts.push(
      "CLAIM LEDGER:\n" +
        scan.claims
          .map((c) => `${c.id} [${c.kind}; ${c.uncertainty} uncertainty] ${clip(c.text, 220)}${c.sourceIds.length ? ` ← ${c.sourceIds.join(", ")}` : ""}${c.location ? ` @ ${c.location}` : ""}`)
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
