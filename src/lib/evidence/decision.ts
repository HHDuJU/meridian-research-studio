import type { DecisionCriterion, DecisionGate, DecisionKind, DecisionRecord, Study, StudyFamily } from "../types";
import { STUDY_FAMILIES } from "../types";
import { Issues, enumOrResolve, isRecord, objectArray, stringArray, stringOrUndefined } from "../contracts";
import type { Issue } from "../contracts";
import { uid, nowIso } from "../utils";
import { treatAsFullTextRead } from "./access";
import { isWithdrawnResult } from "./publication-status";
import { emptySearchConfirmationValid } from "../defaults";
import { checkClaim, gateGrounding, investigatorText } from "./grounding";

/*
 * Evidence-backed decisions.
 *
 *  evidenceRevision(study)   content hash of what a decision can rest on: records (id, status,
 *                            identifiers), claims and the investigator's constraints. Cheap,
 *                            deterministic, browser-safe. A changed revision means the ground moved.
 *  applyDecision(raw, study) validate a model-proposed decision; unknown claim ids are dropped and
 *                            reported; the record is stamped with the current revision.
 *  evaluateDecision(d, study) derive status and blockers from data — stale input, unmet or unknown
 *                            gates, defeating criteria met, claims resting on mismatched sources.
 *  isStaleRequest(...)       reject a model response produced against an older revision.
 */

const KINDS: readonly DecisionKind[] = ["pursue", "narrow", "defer", "no-new-study", "refer", "implementation", "replicate"];
const GATE_STATUS = ["met", "unmet", "unknown"] as const;
const CRITERION_ROLE = ["justifies", "defeats"] as const;

/** FNV-1a 32-bit, hex. Not cryptographic; it detects change, it does not certify integrity. */
export function contentHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Content hash of what a decision can rest on. Each prefix names one formula, so a stored stamp is always
 * compared with the formula that made it and upgrading never marks stored decisions stale by itself:
 *   ev1  a45: records (with year), claims, documents, constraints, synthesis;
 *   ev2  integrity branch of 22 September: ev1 without year, plus each record's certainty grade and
 *        design label (D24: re-grading a record stales the decisions resting on it) and local facts;
 *   ev3  current: ev1 plus grade, design label and local facts.
 */
export function evidenceRevision(study: Study): string {
  return evidenceRevisionFor(study, 3);
}

export function evidenceRevisionFor(study: Study, version: 1 | 2 | 3): string {
  const items = [...study.scan.items]
    .map(
      (i) =>
        `${i.id}|${i.provenance?.status ?? "?"}|${i.doi ?? ""}|${i.pmid ?? ""}|${version === 2 ? "" : `${i.year ?? ""}|`}${i.title}|${i.abstract?.sha256 ?? ""}|${i.notes}|${i.keyFindings ?? ""}|${i.limitations ?? ""}|${i.publicationStatus ?? ""}|${(i.contextTags ?? []).slice().sort().join(",")}` +
        (version === 1 ? "" : `|${i.grade ?? ""}|${i.kind ?? ""}`),
    )
    .sort();
  const claims = [...(study.scan.claims ?? [])]
    .map((c) => `${c.id}|${c.kind}|${c.uncertainty}|${c.sourceIds.slice().sort().join(",")}|${c.text}|${c.passage ?? ""}|${c.interpretation ?? ""}`)
    .sort();
  const docs = [...(study.documents ?? [])].map((d) => `${d.id}|${d.sha256}`).sort();
  const constraints = study.problem.constraints ?? "";
  const synthesis = study.scan.synthesis ?? "";
  const parts = [items.join("\n"), claims.join("\n"), docs.join("\n"), constraints, synthesis];
  if (version === 1) return `ev1-${contentHash(parts.join("\n#\n"))}`;
  parts.push((study.problem.localFacts ?? []).map((f) => `${f.id}|${f.text}`).sort().join("\n"));
  return `ev${version}-${contentHash(parts.join("\n#\n"))}`;
}

/** The current revision in the same version as a stored decision's stamp. */
export function currentRevisionFor(study: Study, stamp: string): string {
  return evidenceRevisionFor(study, stamp.startsWith("ev1-") ? 1 : stamp.startsWith("ev2-") ? 2 : 3);
}

/** Revision of the whole study content (excluding bookkeeping, usage, and audit log entries). D27: openFixes / improvementNotes / lastReview count. */
export function studyRevision(study: Study): string {
  const { updatedAt: _u, audit, usage: _usage, activity: _act, modelRuns: _runs, evidenceRuns: _eruns, ...rest } = study as Study & Record<string, unknown>;
  const auditSubstance = audit
    ? { openFixes: audit.openFixes, improvementNotes: audit.improvementNotes, lastReview: audit.lastReview }
    : null;
  return `st1-${contentHash(JSON.stringify({ ...rest, auditSubstance }))}`;
}

export function isStaleRequest(study: Study, requestRevision: string): boolean {
  return studyRevision(study) !== requestRevision;
}

export interface DecisionApplyResult {
  decision: DecisionRecord | null;
  issues: Issue[];
}

export function applyDecision(raw: unknown, study: Study, actor: DecisionRecord["actor"] = "model"): DecisionApplyResult {
  const issues = new Issues();
  if (!isRecord(raw)) {
    issues.add("decision", "not-an-object", "decision payload is not an object");
    return { decision: null, issues: issues.list };
  }
  const kind = enumOrResolve(KINDS, raw.kind, "decision.kind", issues);
  const statement = stringOrUndefined(raw.statement, "decision.statement", issues);
  if (!kind || !statement?.trim()) {
    issues.add("decision", "dropped", "decision needs a valid kind and a statement");
    return { decision: null, issues: issues.list };
  }
  const known = new Set((study.scan.claims ?? []).map((c) => c.id));
  const requestedIds = stringArray(raw.claimIds, "decision.claimIds", issues) ?? [];
  const droppedClaimIds: string[] = [];
  const claimIds = requestedIds.filter((id) => {
    if (known.has(id)) return true;
    droppedClaimIds.push(id);
    issues.add("decision.claimIds", "dropped", `unknown claim id "${id}" — a decision may rest only on ledger claims`);
    return false;
  });
  const criteria: DecisionCriterion[] = (objectArray(raw.criteria, "decision.criteria", issues) ?? []).flatMap((c, n) => {
    const p = `decision.criteria[${n}]`;
    const text = stringOrUndefined(c.text, `${p}.text`, issues);
    const role = enumOrResolve(CRITERION_ROLE, c.role, `${p}.role`, issues);
    if (!text?.trim() || !role) {
      issues.add(p, "dropped", "criterion needs text and a role (justifies|defeats)");
      return [];
    }
    return [
      {
        id: typeof c.id === "string" && c.id.trim() ? c.id : `crit-${n + 1}`,
        text,
        role,
        status: enumOrResolve(GATE_STATUS, c.status, `${p}.status`, issues, "unknown") ?? "unknown",
        claimIds: (stringArray(c.claimIds, `${p}.claimIds`, issues) ?? []).filter((id) => known.has(id)),
      },
    ];
  });
  const gates: DecisionGate[] = (objectArray(raw.gates, "decision.gates", issues) ?? []).flatMap((g, n) => {
    const p = `decision.gates[${n}]`;
    const requirement = stringOrUndefined(g.requirement, `${p}.requirement`, issues);
    if (!requirement?.trim()) {
      issues.add(p, "dropped", "gate needs a requirement");
      return [];
    }
    const evidence = stringOrUndefined(g.evidence, `${p}.evidence`, issues);
    let status = enumOrResolve(GATE_STATUS, g.status, `${p}.status`, issues, "unknown") ?? "unknown";
    let grounding: string | undefined;
    if (status === "met" && !evidence?.trim()) {
      // A model cannot declare a gate met without pointing at evidence — that is the whole point of a gate.
      issues.add(`${p}.status`, "resolved", '"met" without evidence resolved to "unknown"');
      status = "unknown";
    } else if (status === "met" && actor === "model") {
      // D10/S5: the evidence must be anchored in text the investigator entered (need, constraints,
      // local facts). An approval number or figure the investigator never supplied cannot meet a gate.
      const g2 = gateGrounding(requirement, evidence ?? "", investigatorText(study));
      grounding = g2.reason;
      if (!g2.grounded) {
        issues.add(`${p}.status`, "ungrounded-gate", `"met" refused: the evidence ${g2.reason}; resolved to "unknown"`);
        status = "unknown";
      }
    }
    return [
      {
        id: typeof g.id === "string" && g.id.trim() ? g.id : `gate-${n + 1}`,
        requirement,
        status,
        setBy: actor,
        ...(evidence?.trim() ? { evidence } : {}),
        ...(grounding ? { grounding } : {}),
      },
    ];
  });
  const decision: DecisionRecord = {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : uid("dec"),
    at: nowIso(),
    actor,
    kind,
    statement,
    question: stringOrUndefined(raw.question, "decision.question", issues) ?? "",
    claimIds,
    ...(droppedClaimIds.length ? { droppedClaimIds } : {}),
    criteria,
    gates,
    alternatives: stringArray(raw.alternatives, "decision.alternatives", issues) ?? [],
    inputRevision: evidenceRevision(study),
    status: "proposed",
    selectionStatus: "proposed",
    actionStatus: "blocked",
    ...(typeof raw.recommendedFamily === "string" &&
    (STUDY_FAMILIES as readonly string[]).includes(raw.recommendedFamily)
      ? { recommendedFamily: raw.recommendedFamily as StudyFamily }
      : { recommendedFamily: null }),
    ...(stringOrUndefined(raw.note, "decision.note", issues)?.trim() ? { note: raw.note as string } : {}),
  };
  return { decision, issues: issues.list };
}

export interface DecisionEvaluation {
  status: DecisionRecord["status"];
  selectionStatus: DecisionRecord["selectionStatus"];
  actionStatus: DecisionRecord["actionStatus"];
  /** Conditions that must change before anyone acts on the decision. */
  blockers: string[];
  warnings: string[];
  canAct: boolean;
  sourceCounts: { items: number; verified: number; mismatch: number; retrieved: number };
}

export function evaluateDecision(d: DecisionRecord, study: Study): DecisionEvaluation {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const currentRevision = currentRevisionFor(study, d.inputRevision);
  const stale = d.inputRevision !== currentRevision;
  if (stale) blockers.push(`made against evidence revision ${d.inputRevision}; the evidence/ledger is now ${currentRevision} — re-review before acting`);

  const claimsById = new Map((study.scan.claims ?? []).map((c) => [c.id, c]));
  const itemsById = new Map(study.scan.items.map((i) => [i.id, i]));
  const missing = d.claimIds.filter((id) => !claimsById.has(id));
  if (missing.length) blockers.push(`rests on claims that no longer exist: ${missing.join(", ")}`);
  const supporting = d.claimIds.map((id) => claimsById.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
  for (const c of supporting) {
    const sources = c.sourceIds.map((s) => itemsById.get(s)).filter((s): s is NonNullable<typeof s> => !!s);
    if (sources.some((s) => s.provenance.status === "mismatch")) blockers.push(`claim ${c.id} rests on a source whose identifier resolved to a different work`);
    if (sources.some((s) => isWithdrawnResult(s))) {
      blockers.push(`claim ${c.id} rests on a withdrawn or retracted result that cannot support an active recommendation`);
    }
    if (c.supportStatus === "quarantined" || c.supportStatus === "unsupported" || c.assertion?.supportStatus === "quarantined") {
      blockers.push(`claim ${c.id} is unsupported or quarantined`);
    }
  }
  for (const c of supporting) {
    const sup = checkClaim(c, study);
    if (sup.blocking) blockers.push(`claim ${c.id}: ${sup.message}`);
    else if (sup.status === "no-source-text" && c.kind === "source-derived") warnings.push(`claim ${c.id}: ${sup.message}`);
  }
  const sourceDerived = supporting.filter((c) => c.kind === "source-derived");
  if (sourceDerived.length) {
    const anyVerified = sourceDerived.some((c) => c.sourceIds.some((s) => itemsById.get(s)?.provenance.status === "verified"));
    if (!anyVerified) warnings.push("no supporting source-derived claim rests on an identity-verified source yet");
    const fullText = sourceDerived.some((c) => c.sourceIds.some((s) => {
      const item = itemsById.get(s);
      return item ? treatAsFullTextRead(item, study.documents ?? []) : false;
    }));
    if (!fullText) warnings.push("all supporting sources were read at abstract/metadata level; no full text inspected");
  }
  if (d.kind === "pursue" && d.claimIds.length === 0) blockers.push("a 'pursue' decision with no supporting claims");
  const invText = investigatorText(study);
  for (const g of d.gates) {
    if (g.status === "unmet") blockers.push(`gate unmet: ${g.requirement}`);
    if (g.status === "unknown") blockers.push(`gate unknown: ${g.requirement}`);
    if (g.status === "not-required") {
      if (g.setBy === "investigator" && g.evidence?.trim()) warnings.push(`gate "${g.requirement}" marked not required for this decision by the investigator: ${g.evidence}`);
      else blockers.push(`gate "${g.requirement}" is marked not required, but only the investigator can waive a gate, with a reason`);
    }
    if (g.status === "met" && g.setBy !== "investigator") {
      // Re-checked every time: removing the local fact a gate rested on reopens the gate.
      const gr = gateGrounding(g.requirement, g.evidence ?? "", invText);
      if (!gr.grounded) blockers.push(`gate "${g.requirement}" was declared met by the model, but its evidence ${gr.reason}`);
    }
  }
  for (const c of d.criteria) {
    if (c.role === "defeats" && c.status === "met") blockers.push(`defeating condition holds: ${c.text}`);
    if (c.role === "justifies" && c.status === "unknown") warnings.push(`justifying condition not yet assessed: ${c.text}`);
  }
  if (d.alternatives.length === 0 && (d.kind === "pursue" || d.kind === "narrow")) warnings.push("no simpler alternative recorded as considered");

  const sourceCounts = {
    items: study.scan.items.length,
    verified: study.scan.items.filter((i) => i.provenance.status === "verified").length,
    mismatch: study.scan.items.filter((i) => i.provenance.status === "mismatch").length,
    retrieved: study.scan.items.filter((i) => i.provenance.status === "retrieved").length,
  };
  warnings.push(`source counts: ${sourceCounts.items} items, ${sourceCounts.verified} verified, ${sourceCounts.mismatch} mismatch, ${sourceCounts.retrieved} retrieved`);
  const status: DecisionRecord["status"] = d.status === "withdrawn" ? "withdrawn" : stale ? "stale" : d.status === "accepted" ? "accepted" : "proposed";
  const selectionStatus: DecisionRecord["selectionStatus"] = status;
  const actionStatus: DecisionRecord["actionStatus"] = blockers.length === 0 && status === "accepted" ? "ready" : "blocked";
  return { status, selectionStatus, actionStatus, blockers, warnings, canAct: actionStatus === "ready", sourceCounts };
}

/** Re-derive the stored status of every decision after the evidence changes. Never deletes. */
export function refreshDecisionStatuses(study: Study): Study {
  const decisions = (study.design.decisions ?? []).map((d) => {
    const e = evaluateDecision(d, study);
    const next: DecisionRecord = {
      ...d,
      status: e.status,
      selectionStatus: e.selectionStatus,
      actionStatus: e.actionStatus,
    };
    return d.status === next.status && d.selectionStatus === next.selectionStatus && d.actionStatus === next.actionStatus ? d : next;
  });
  return { ...study, design: { ...study.design, decisions } };
}

/** S11 / T-6: refuse a dropped or unresolved claim, a claim that does not rest on a retrieved or verified record, and a pursue/implementation/replicate with neither such a claim nor a valid empty-search confirmation over zero records. defer/narrow/refer/no-new-study may be accepted with no claims. */
export function decisionIsSupported(d: DecisionRecord, study: Study): { ok: boolean; reason: string } {
  if (d.criteria.some((c) => c.role === "defeats" && c.status === "met")) {
    return { ok: false, reason: "contradictory selection: a defeating condition holds" };
  }
  const dropped = [...(d.droppedClaimIds ?? [])];
  const marked = `${d.statement ?? ""}\n${d.question ?? ""}\n${d.note ?? ""}`;
  for (const m of marked.matchAll(/⟦unresolved:([^⟧]+)⟧/g)) {
    if (!dropped.includes(m[1])) dropped.push(m[1]);
  }
  if (dropped.length) {
    return { ok: false, reason: `unsupported selection: claim ${dropped.join(", ")} is not in the ledger` };
  }
  const claimsById = new Map((study.scan.claims ?? []).map((c) => [c.id, c]));
  const itemsById = new Map(study.scan.items.map((i) => [i.id, i]));
  let restsOnRetrieved = false;
  for (const id of d.claimIds) {
    const c = claimsById.get(id);
    if (!c) return { ok: false, reason: `unsupported selection: claim ${id} is not in the ledger` };
    if (c.supportStatus === "quarantined" || c.supportStatus === "unsupported" || c.assertion?.supportStatus === "quarantined") {
      return { ok: false, reason: `unsupported selection: claim ${id} is quarantined and cannot authorize action` };
    }
    const sources = c.sourceIds.map((s) => itemsById.get(s)).filter((s): s is NonNullable<typeof s> => !!s);
    if (!sources.length) return { ok: false, reason: `unsupported selection: claim ${id} has no bound sources` };
    if (sources.some((s) => s.provenance.status === "mismatch")) {
      return { ok: false, reason: `contradictory selection: claim ${id} rests on a source whose identifier resolved to a different work` };
    }
    if (sources.some((s) => isWithdrawnResult(s))) {
      return { ok: false, reason: `contradictory selection: claim ${id} rests on a withdrawn or retracted result` };
    }
    const retrieved = sources.some((s) => s.provenance.status === "retrieved" || s.provenance.status === "verified");
    if (!retrieved) return { ok: false, reason: `unsupported selection: claim ${id} does not rest on a retrieved record` };
    const sup = checkClaim(c, study);
    if (sup.blocking) return { ok: false, reason: `unsupported selection: claim ${id}: ${sup.message}` };
    restsOnRetrieved = true;
  }
  const commitsToAct = d.kind === "pursue" || d.kind === "implementation" || d.kind === "replicate";
  if (commitsToAct && !restsOnRetrieved) {
    const retrievedRecords = study.scan.items.filter(
      (i) => i.provenance?.status === "retrieved" || i.provenance?.status === "verified",
    ).length;
    if (retrievedRecords === 0 && emptySearchConfirmationValid(study)) return { ok: true, reason: "" };
    return { ok: false, reason: "unsupported selection: no ledger claims on retrieved records" };
  }
  return { ok: true, reason: "" };
}

export const DECISION_SCHEMA = `"decision": {
  "kind": "pursue"|"narrow"|"defer"|"no-new-study"|"refer"|"implementation"|"replicate",
  "statement": string (one sentence: what should happen next and why),
  "question": string (the question this decision answers),
  "claimIds": string[] (ledger claim ids it rests on),
  "criteria": [{ "id": string, "text": string, "role": "justifies"|"defeats", "status": "met"|"unmet"|"unknown", "claimIds": string[] }],
  "gates": [{ "id": string, "requirement": string (an authorization, resource or fact that must exist before acting), "status": "met"|"unmet"|"unknown", "evidence": string (document/approval that shows it is met; omit if unknown) }],
  "alternatives": string[] (simpler credible options considered),
  "note": string
}`;
