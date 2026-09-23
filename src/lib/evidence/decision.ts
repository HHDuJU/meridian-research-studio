import type { DecisionCriterion, DecisionGate, DecisionKind, DecisionRecord, GateProposal, Study, StudyFamily } from "../types";
import { STUDY_FAMILIES } from "../types";
import { Issues, enumOrResolve, isRecord, objectArray, stringArray, stringOrUndefined } from "../contracts";
import type { Issue } from "../contracts";
import { uid, nowIso } from "../utils";
import { sha256Hex } from "./hash";
import { treatAsFullTextRead } from "./access";
import { isWithdrawnResult } from "./publication-status";
import { emptySearchConfirmationValid } from "../defaults";
import { assertsLocalResource, checkClaim, factClauses, gateGrounding, gateSupport, investigatorFactText, localFactEstablished, normalizeForMatch, statusOpen, studyOwnText } from "./grounding";
import { ACTIONABLE_KINDS, OTHER_WORK, approvalFacts, authorityClaims, ethicsGateCandidates, ethicsRecord, isRecordWording, localAssertions, openApprovalItems } from "./authority";
import type { AuthorityBody, OpenItem } from "./authority";

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

/** A gate about approval, review, consent or an exemption determination. */

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
        status: (() => {
          const st = enumOrResolve(GATE_STATUS, c.status, `${p}.status`, issues, "unknown") ?? "unknown";
          // D10 / S5: a criterion that states a local approval or resource as met is a local fact the
          // model cannot establish; it stays unknown (a justifying criterion that is unknown only warns).
          if (st === "met" && actor === "model" && assertsLocalResource(text) && !(stringArray(c.claimIds, `${p}.claimIds`, new Issues()) ?? []).some((id) => known.has(id))) {
            issues.add(`${p}.status`, "resolved", `"met" for a local approval or resource is the investigator's to establish; resolved to "unknown"`);
            return "unknown";
          }
          return st;
        })(),
        claimIds: (stringArray(c.claimIds, `${p}.claimIds`, issues) ?? []).filter((id) => known.has(id)),
      },
    ];
  });
  // Meridian owns gate identity: ids are unique within a decision whatever the model sends, so a
  // confirmation changes exactly the gate on screen.
  const gateIds = new Set<string>();
  const uniqueGateId = (wanted: unknown, n: number): string => {
    const base = typeof wanted === "string" && wanted.trim() ? wanted.trim() : `gate-${n + 1}`;
    let id = base;
    for (let k = 2; gateIds.has(id); k++) id = `${base}-${k}`;
    gateIds.add(id);
    return id;
  };
  const gates: DecisionGate[] = (objectArray(raw.gates, "decision.gates", issues) ?? []).flatMap((g, n) => {
    const p = `decision.gates[${n}]`;
    const requirement = stringOrUndefined(g.requirement, `${p}.requirement`, issues);
    if (!requirement?.trim()) {
      issues.add(p, "dropped", "gate needs a requirement");
      return [];
    }
    // The record form's wording belongs to the investigator's records; a model gate that uses it is renamed.
    if (isRecordWording(requirement)) issues.add(`${p}.requirement`, "resolved", "a model gate may not use the wording of an investigator record; renamed");
    const evidence = stringOrUndefined(g.evidence, `${p}.evidence`, issues);
    let status = enumOrResolve(GATE_STATUS, g.status, `${p}.status`, issues, "unknown") ?? "unknown";
    let grounding: string | undefined;
    let proposal: GateProposal | undefined;
    if (status === "met" && !evidence?.trim()) {
      // A model cannot declare a gate met without pointing at evidence — that is the whole point of a gate.
      issues.add(`${p}.status`, "resolved", '"met" without evidence resolved to "unknown"');
      status = "unknown";
    } else if (status === "met" && actor === "model") {
      // D10 / S5: a model never sets a gate. Its "met" is a proposal the investigator confirms; Meridian's
      // reading of the investigator's facts (supporting facts, concerns) is shown to help, with no authority.
      const read = readProposal(requirement, evidence ?? "", study);
      proposal = read.proposal;
      grounding = read.grounding;
      // The proposal itself is the record; an issue is raised only when Meridian sees something to check.
      if (proposal.concerns.length) {
        issues.add(`${p}.status`, "ungrounded-gate", `"met" is the model's proposal; the gate stays "unknown" until the investigator confirms it (${proposal.concerns[0]})`);
      }
      status = "unknown";
    }
    return [
      {
        id: uniqueGateId(g.id, n),
        requirement: isRecordWording(requirement) ? `Model proposal: ${requirement}` : requirement,
        status,
        setBy: actor,
        ...(evidence?.trim() ? { evidence } : {}),
        ...(grounding ? { grounding } : {}),
        ...(proposal ? { proposal } : {}),
      },
    ];
  });
  const decision: DecisionRecord = {
    // Meridian owns decision identity too: a model id already used by another decision is replaced.
    id: typeof raw.id === "string" && raw.id.trim() && !(study.design.decisions ?? []).some((x) => x.id === raw.id) ? raw.id : uid("dec"),
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

/** A model sentence about approvals or local facts, shown to the investigator to check (advisory). */
export interface ModelStatement {
  kind: "authority" | "local";
  text: string;
  bodies: AuthorityBody[];
}

/** Where a decision stands on approvals (D10 / S5). */
export interface ApprovalReview {
  /** The investigator has not recorded, on this decision, the research ethics status of the work. */
  ethicsRecordMissing: boolean;
  /** The decision's kind leads to no work: the record can say so in one click. */
  leadsToNoWork: boolean;
  /** The investigator's own facts that leave an approval open and that they have not acted on for this decision. */
  openItems: OpenItem[];
  /** What the model's text says about approvals and local facts: advisory, it settles and blocks nothing. */
  modelStatements: ModelStatement[];
  /** References the investigator may use for the record: a confirmed ethics gate's evidence, or their own fact about this work. */
  suggestedEthicsRecord?: string;
  /** Where the suggestion comes from: a gate the investigator confirmed (the model's words), or their own fact. */
  suggestionSource?: "gate" | "fact";
  /** All of the investigator's statements about approvals, for them to check when they record (nothing is inferred). */
  approvalFacts: string[];
}

const flat = (t: string) => normalizeForMatch(t).replace(/\s+/g, " ").trim();

/** Every text the model wrote that a decision acts on. */
function modelTexts(d: DecisionRecord, study: Study): string[] {
  const claimsById = new Map((study.scan.claims ?? []).map((c) => [c.id, c]));
  const gates = d.gates ?? [];
  const criteria = d.criteria ?? [];
  const e = study.ethics;
  const texts = [
    d.statement,
    d.question ?? "",
    d.note ?? "",
    ...(d.alternatives ?? []),
    study.design.rationale ?? "",
    study.design.whyNotMoreComplex ?? "",
    ...(study.design.alternatives ?? []),
    ...criteria.map((c) => c.text),
    // The model's words for a gate stay the model's after the investigator confirms the gate.
    ...gates.flatMap((g) => [g.setBy !== "investigator" ? `${g.requirement}. ${g.evidence ?? ""}` : "", g.proposal?.evidence ?? ""]),
    ...(e ? [e.rebPath, e.consent, e.data, e.risks, e.limitations, e.partnerships, e.equity].map((x) => x ?? "") : []),
  ];
  const cited = [...(d.claimIds ?? []), ...criteria.flatMap((c) => c.claimIds ?? [])].map((id) => claimsById.get(id));
  for (const c of cited) if (c && c.origin !== "investigator") texts.push(c.text);
  return texts.filter((t) => t && t.trim());
}

/*
 * D10 / S5. Action is blocked by structure, never by the model's wording: a decision that leads to work needs
 * the investigator's record of the research ethics status of this work, and an approval the investigator's own
 * facts leave open blocks until the investigator records the determination for that kind of body or sets the
 * fact aside for this decision. The model's statements about approvals and local facts are listed for the
 * investigator to check; they settle nothing and block nothing.
 */
export function approvalReview(d: DecisionRecord, study: Study): ApprovalReview {
  const gates = d.gates ?? [];
  const invText = investigatorFactText(study);
  const own = studyOwnText(study);
  const acted = new Set((d.settledItems ?? []).map((x) => flat(x.text)));
  const ethicsRecordMissing = !ethicsRecord(gates);
  const openItems = openApprovalItems(invText).filter((it) => !acted.has(flat(it.text)));
  const modelStatements: ModelStatement[] = [];
  if (d.actor !== "investigator") {
    const seen = new Set<string>();
    const facts = (study.problem.localFacts ?? []).filter((f) => f.by === "investigator").map((f) => f.text);
    for (const t of modelTexts(d, study)) {
      for (const claim of authorityClaims(t)) {
        if (seen.has(flat(claim.sentence))) continue;
        seen.add(flat(claim.sentence));
        modelStatements.push({ kind: "authority", text: claim.sentence, bodies: claim.bodies });
      }
      for (const clause of localAssertions(t)) {
        if (seen.has(flat(clause)) || localFactEstablished(clause, facts) || gateGrounding(clause, clause, invText, own).grounded) continue;
        seen.add(flat(clause));
        modelStatements.push({ kind: "local", text: clause, bodies: [] });
      }
    }
  }
  const fromGate = ethicsGateCandidates(gates).map((g) => `${g.requirement}: ${g.evidence ?? ""}`.trim())[0];
  const suggestedEthicsRecord = ethicsRecordMissing ? (fromGate ?? suggestEthicsRecord(invText, own)) : undefined;
  const suggestionSource = suggestedEthicsRecord ? (fromGate ? "gate" : "fact") : undefined;
  return {
    ethicsRecordMissing,
    approvalFacts: ethicsRecordMissing ? approvalFacts(invText) : [],
    leadsToNoWork: !ACTIONABLE_KINDS.has(d.kind),
    openItems,
    modelStatements,
    ...(suggestedEthicsRecord ? { suggestedEthicsRecord, suggestionSource } : {}),
  };
}

/** An investigator sentence about this work that states an ethics approval or determination and leaves nothing open. */
function suggestEthicsRecord(investigator: string, own: string): string | undefined {
  const ownWords = new Set((normalizeForMatch(own).match(/\p{L}{5,}/gu) ?? []).map((w) => w.slice(0, 5)));
  for (const c of factClauses(investigator)) {
    if (c.notFact || statusOpen(c.sentence) || /\b(?:hope|hopefully|assume|assuming|believe|think|probably|likely|may|might|should|would|could|if)\b/i.test(c.norm)) continue;
    // Another study's approval is not this work's ("the staff survey", "our 2024 audit", "the original trial").
    if (OTHER_WORK.test(c.norm)) continue;
    const words = (c.norm.match(/\p{L}{5,}/gu) ?? []).map((w) => w.slice(0, 5));
    const aboutThis =
      /\b(?:this|our)\s+(?:[\w-]+\s+){0,2}?(?:study|audit|project|evaluation|survey|review|work|programme|program|initiative|pilot|analysis|count|extract|report)\b/i.test(c.norm) ||
      /\bthe\s+(?:study|audit|project|evaluation|work|programme|program|initiative|pilot|analysis)\b(?!\s+(?:of|for|by|at|in|on)\b)/i.test(c.norm) ||
      words.filter((w) => ownWords.has(w)).length >= 2;
    if (!aboutThis) continue;
    if (!/\b(?:reb|irb|rec|hireb|hreb|ethics|ethical|research\s+ethics|quality\s+improvement|service\s+evaluation|program(?:me)?\s+evaluation|not\s+research|clinical\s+audit)\b/i.test(c.norm)) continue;
    if (/\b(?:approv\w*|granted|classified|screened|determined|determination|registered|confirmed|exempt\w*|not\s+(?:required|needed)|no\s+(?:reb|ethics)\s+review|favou?rable)\b/i.test(c.norm)) return c.sentence;
  }
  return undefined;
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
  d = { ...d, claimIds: d.claimIds ?? [], criteria: d.criteria ?? [], gates: d.gates ?? [], alternatives: d.alternatives ?? [] };
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
  const criterionClaims = d.criteria.flatMap((c) => c.claimIds).map((id) => claimsById.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
  const investigatorFacts = (study.problem.localFacts ?? []).filter((f) => f.by === "investigator").map((f) => f.text);
  for (const c of [...supporting, ...criterionClaims]) {
    const proposal =
      c.kind === "local-fact" ||
      ((c.kind === "assumption" || c.kind === "scenario") && assertsLocalResource(c.text)) ||
      ((c.kind === "inference" || c.kind === "unknown") && localAssertions(c.text).length > 0);
    if (proposal && c.origin !== "investigator" && !localFactEstablished(c.text, investigatorFacts)) {
      // D10 / S5, SYN-LOCAL-01: a plan cannot treat the model's proposed local fact as available.
      blockers.push(`claim ${c.id} is a local fact the model proposed ("${c.text.slice(0, 120)}"); only the investigator can establish it`);
    }
  }
  for (const g of d.gates) {
    if (g.status === "unmet") blockers.push(`gate unmet: ${g.requirement}`);
    if (g.status === "unknown") {
      blockers.push(
        g.proposal
          ? `gate unknown: ${g.requirement} (the model proposes "met": ${g.proposal.evidence.slice(0, 160)}; confirm it if it is true)`
          : `gate unknown: ${g.requirement}`,
      );
    }
    if (g.status === "not-required") {
      if (g.setBy === "investigator" && g.evidence?.trim()) warnings.push(`gate "${g.requirement}" marked not required for this decision by the investigator: ${g.evidence}`);
      else blockers.push(`gate "${g.requirement}" is marked not required, but only the investigator can waive a gate, with a reason`);
    }
    if (g.status === "met" && g.setBy !== "investigator") {
      // Stored before D10: a model's "met" is only a proposal now.
      blockers.push(`gate "${g.requirement}" was declared met by the model; only the investigator can confirm a gate`);
    }
  }
  const review = approvalReview(d, study);
  if (review.ethicsRecordMissing) {
    const claim = review.modelStatements.find((m) => m.kind === "authority" && m.bodies.some((b) => b !== "data"));
    const what = review.leadsToNoWork
      ? "record the approval's reference, or why review is not required (for example, that no people, records or practice are involved)"
      : "record the approval's reference, or why review is not required";
    blockers.push(
      claim
        ? `the decision says no approval is needed ("${claim.text.slice(0, 160)}"), but the investigator has not recorded the research ethics status of this work; an exemption is the review board's or the investigator's call, and clinical access to data is not research permission. ${what[0].toUpperCase()}${what.slice(1)}`
        : `the investigator has not recorded the research ethics status of this work: ${what}`,
    );
  }
  for (const it of review.openItems) {
    blockers.push(
      `your own facts leave an approval open ("${it.text.slice(0, 160)}"); mark it given on this decision with the reference, or set it aside with the reason it does not concern this decision`,
    );
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
  const rev = factsRevisionOf(study);
  const decisions = (study.design.decisions ?? []).map((d0) => {
    // A proposal still open is read again when the investigator's facts changed since it was read.
    const stale = (d0.gates ?? []).some((g) => g.proposal && g.setBy !== "investigator" && g.status === "unknown" && g.proposal.factsRevision !== rev);
    const d = stale
      ? {
          ...d0,
          gates: d0.gates.map((g) => {
            if (!(g.proposal && g.setBy !== "investigator" && g.status === "unknown" && g.proposal.factsRevision !== rev)) return g;
            const read = readProposal(g.requirement, g.proposal.evidence, study);
            return { ...g, proposal: read.proposal, grounding: read.grounding };
          }),
        }
      : d0;
    const e = evaluateDecision(d, study);
    const next: DecisionRecord = {
      ...d,
      status: e.status,
      selectionStatus: e.selectionStatus,
      actionStatus: e.actionStatus,
    };
    return !stale && d.status === next.status && d.selectionStatus === next.selectionStatus && d.actionStatus === next.actionStatus ? d0 : next;
  });
  return { ...study, design: { ...study.design, decisions } };
}

/** The investigator's facts and the study's own description, as one revision key. */
function factsRevisionOf(study: Study): string {
  return sha256Hex(`${investigatorFactText(study)}\u0001${studyOwnText(study)}`).slice(0, 16);
}

/** Meridian's reading of the investigator's facts for a model "met" proposal (advisory only). */
function readProposal(requirement: string, evidence: string, study: Study): { proposal: GateProposal; grounding: string } {
  const support = gateSupport(requirement, evidence, investigatorFactText(study), studyOwnText(study));
  const proposal: GateProposal = { status: "met", evidence, supportingFacts: support.supportingFacts, concerns: support.concerns, factsRevision: factsRevisionOf(study) };
  const grounding = support.concerns.length
    ? `proposed by the model; check before confirming: ${support.concerns[0]}`
    : support.supportingFacts.length
      ? `proposed by the model; it points to your fact: "${support.supportingFacts[0].slice(0, 160)}"`
      : "proposed by the model; confirm it only if it is true";
  return { proposal, grounding };
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
  "gates": [{ "id": string, "requirement": string (an authorization, resource or fact that must exist before acting on THIS decision; never a requirement of a rejected alternative), "status": "met"|"unmet"|"unknown", "evidence": string (document/approval that shows it is met; omit if unknown) }],
  "alternatives": string[] (simpler credible options considered),
  "note": string
}`;
