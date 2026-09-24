import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createStudy, migrateStudy, scanMayComplete, queryHashOf, scanContentRevision, withdrawScanCompletionIfInvalid } from "./defaults";
import { writeImmutableBackup, browserLocalStorage, createGuardedStorage, readBackupFailure, FAIL_KEY, MAIN_KEY } from "./persist-backup";
import { SEED_IDS, SEED_STUDIES } from "./seed";
import { STAGE_IDS, STUDY_SCHEMA_VERSION, STUDY_FAMILIES, orderNeedsReview } from "./types";
import type { AuditEntry, CheckProvider, EvidenceRun, ModelRun, SourceCheck, StageId, Study, StudyFamily, EvidenceItem, RetrievalEvent, SourceDocument } from "./types";
import { applyLookupOutcome, type LookupOutcome } from "./evidence/verify";
import { nowIso, uid } from "./utils";
import { refreshDecisionStatuses, studyRevision, decisionIsSupported } from "./evidence/decision";
import { illuminateDecision } from "./illuminate";
import { mergeIngested } from "./evidence/records";
import { sha256Hex } from "./evidence/hash";

export { studioAvailability } from "./studio-availability";

type StudyPatch = Partial<Omit<Study, "id" | "createdAt">>;

interface StudioState {
  studies: Study[];
  hydrated: boolean;
  backupFailure: { written: boolean; key?: string; reason?: string; at?: string } | null;
  create: (input: {
    family: StudyFamily | null;
    setting: string;
    rawNeed: string;
    title?: string;
    replayKey?: string;
    constraints?: string;
    basis?: "explicit" | "inferred" | "unresolved";
    /** One investigator-documented local fact per entry (approvals, resources, data access). */
    localFacts?: string[];
  }) => Study;
  /** Investigator-only: record a local fact (an approval with its reference, a resource, data access). */
  addLocalFact: (id: string, text: string) => { ok: boolean; reason?: string };
  /** Investigator-only: remove a local fact. Decisions and gates that rested on it are re-evaluated. */
  removeLocalFact: (id: string, factId: string) => void;
  /** Investigator-only: set a decision gate's status with the evidence that shows it. */
  setGate: (
    id: string,
    which: "latest" | number,
    gateId: string,
    status: "met" | "unmet" | "unknown" | "not-required",
    evidence?: string,
  ) => { ok: boolean; reason?: string };
  /**
   * Investigator-only: add a gate they have settled to a decision (for example the review board's
   * determination that no approval is needed for this work), with the reference or reason.
   */
  addGate: (
    id: string,
    which: "latest" | number,
    requirement: string,
    status: "met" | "unmet" | "not-required",
    evidence: string,
  ) => { ok: boolean; reason?: string; gateId?: string };
  /**
   * Investigator-only (D10 / S5): act on one of their own facts that leaves an approval open, for one
   * decision: it has been given (with the reference), or it does not concern this decision (with the reason).
   * Logged in the audit; it settles that fact for that decision and nothing else.
   */
  settleOpenItem: (id: string, which: "latest" | number, text: string, how: "given" | "aside", note: string) => { ok: boolean; reason?: string };
  update: (id: string, patch: StudyPatch) => void;
  /** Investigator family choice: records design.basis explicit, or unresolved when cleared. */
  setFamily: (id: string, family: StudyFamily | null) => void;
  remove: (id: string) => void;
  restoreSeeds: () => void;
  setStage: (id: string, stage: StageId) => void;
  markComplete: (id: string, stage: StageId) => void;
  /** Investigator has re-reviewed a stage flagged by an upstream change. */
  clearReview: (id: string, stage: StageId) => void;
  mergeStage: <K extends StageId>(id: string, stage: K, patch: Partial<Study[K]>) => void;
  /**
   * Apply a model result only if the study is still at the revision the request was made against.
   * A late reply for a study that has since changed is refused and logged, never merged.
   */
  mergeStageIfRevision: <K extends StageId>(id: string, stage: K, patch: Partial<Study[K]>, expectedRevision: string) => { applied: boolean; reason?: string };
  /** Investigator-only: search was run and returned no records. */
  confirmEmptySearch: (id: string) => void;
  acceptDecision: (id: string, which: "latest" | number) => { ok: boolean; reason?: string };
  withdrawDecision: (id: string, which: "latest" | number) => { ok: boolean; reason?: string };
  changeSource: (
    id: string,
    record: { id?: string; title?: string },
    field: "abstract" | "keyFindings" | "year" | "status" | "limitations",
    value: unknown,
    note?: string,
  ) => { ok: boolean; reason?: string };
  illuminateApply: (
    id: string,
    stage: StageId,
    payload: unknown,
    expectedRevision: string,
    options?: { appraisedRecordIds?: string[]; appraisalBatch?: { index: number; of: number } },
  ) => { ok: boolean; complete: boolean; reason?: string; summary: string; issues?: { path: string; code: string; message?: string }[] };
  recordIlluminateFailure: (id: string, stage: StageId, error: string) => void;
  log: (id: string, entry: AuditEntry) => void;
  applyRetrieval: (
    id: string,
    payload: { event: RetrievalEvent; items: EvidenceItem[]; documents: SourceDocument[] },
  ) => void;
  /** Apply registry identity checks (one outcome per requested chunk of DOIs). */
  applyIdentityChecks: (
    id: string,
    provider: CheckProvider,
    chunks: { requested: string[]; outcome: LookupOutcome }[],
  ) => IdentityCheckSummary;
  /** Append-only record of a model call (reproducibility). */
  recordModelRun: (id: string, run: ModelRun) => void;
  /** Append-only record of a live search or identity check. */
  recordEvidenceRun: (id: string, run: EvidenceRun) => void;
}

export interface IdentityCheckSummary {
  checked: number;
  verified: number;
  mismatch: number;
  notFound: number;
  unresolved: number;
  failed: number;
}


/** Stages after `stage` in the pipeline that are already complete — the ones an upstream change puts in question. */
export function downstreamCompleted(study: Study, stage: StageId): StageId[] {
  const idx = STAGE_IDS.indexOf(stage);
  return STAGE_IDS.slice(idx + 1).filter((s) => study.completedStages.includes(s));
}

/** A patch that only touches bookkeeping does not flag downstream stages. */
const BOOKKEEPING_KEYS = new Set(["generatedAt", "lastReview"]);
function isConsequential(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).some((k) => !BOOKKEEPING_KEYS.has(k));
}

/** The most recent `n` audit entries for display. The store keeps the full history. */
export function recentAudit(study: Study, n = 40): AuditEntry[] {
  return study.audit.entries.slice(0, n);
}

function decisionIndex(study: Study, which: "latest" | number): number {
  const list = study.design.decisions ?? [];
  if (which === "latest") return list.length - 1;
  if (which < 0) return list.length + which;
  return which;
}

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => ({
      studies: SEED_STUDIES.map((s) => migrateStudy(s)),
      hydrated: false,
      backupFailure: readBackupFailure(browserLocalStorage()),
      create: (input) => {
        const study = createStudy(input);
        set({ studies: [study, ...get().studies] });
        return study;
      },
      addLocalFact: (id, text) => {
        const s = get().studies.find((x) => x.id === id);
        const t = (text ?? "").trim();
        if (!s) return { ok: false, reason: "study not found" };
        if (!t) return { ok: false, reason: "empty fact" };
        const fact = { id: uid("fact"), text: t, by: "investigator" as const, at: nowIso() };
        get().mergeStage(id, "problem", { localFacts: [...(s.problem.localFacts ?? []), fact] });
        get().log(id, { id: uid("audit"), at: nowIso(), kind: "edit", stage: "problem", actor: "investigator", summary: `Local fact ${fact.id} added.` });
        return { ok: true };
      },
      removeLocalFact: (id, factId) => {
        const s = get().studies.find((x) => x.id === id);
        if (!s) return;
        const facts = s.problem.localFacts ?? [];
        if (!facts.some((f) => f.id === factId)) return;
        get().mergeStage(id, "problem", { localFacts: facts.filter((f) => f.id !== factId) });
        get().log(id, { id: uid("audit"), at: nowIso(), kind: "edit", stage: "problem", actor: "investigator", summary: `Local fact ${factId} removed.` });
      },
      setGate: (id, which, gateId, status, evidence) => {
        const s = get().studies.find((x) => x.id === id);
        if (!s) return { ok: false, reason: "study not found" };
        const idx = decisionIndex(s, which);
        const list = s.design.decisions ?? [];
        if (idx < 0 || idx >= list.length) return { ok: false, reason: "no decision" };
        const ev = (evidence ?? "").trim();
        if (status === "met" && !ev) return { ok: false, reason: "a met gate needs the evidence that shows it (a document, reference or approval number)" };
        if (status === "not-required" && !ev) return { ok: false, reason: "a gate marked not required for this decision needs the reason" };
        const target = list[idx];
        const matching = target.gates.filter((g) => g.id === gateId);
        if (matching.length > 1) return { ok: false, reason: "more than one gate has this id; nothing was changed" };
        const prior = matching[0];
        if (!prior) return { ok: false, reason: "gate not found" };
        const priorModelEvidence = prior.setBy !== "investigator" ? (prior.proposal?.evidence ?? prior.evidence) : undefined;
        const decisions = list.map((d, i) =>
          i === idx
            ? {
                ...d,
                gates: d.gates.map((g) =>
                  g.id === gateId
                    ? (() => {
                        // The investigator's setting replaces the model's evidence; without new evidence none is shown as theirs.
                        const { evidence: _modelEvidence, ...rest } = g;
                        return { ...rest, status, setBy: "investigator" as const, ...(ev ? { evidence: ev } : {}), grounding: "set by the investigator" };
                      })()
                    : g,
                ),
              }
            : d,
        );
        // A gate is about authority and resources, not study content: re-evaluate the decisions without
        // flagging downstream stages for review.
        const refreshed = refreshDecisionStatuses({ ...s, design: { ...s.design, decisions } });
        get().update(id, { design: refreshed.design });
        const shown = prior.setBy !== "investigator" && prior.proposal ? prior.proposal.concerns : [];
        get().log(id, {
          id: uid("audit"),
          at: nowIso(),
          kind: "note",
          stage: "design",
          actor: "investigator",
          summary: `Investigator set gate ${gateId} of decision ${target.id} to ${status}${ev ? ` (${ev})` : ""}${prior.setBy !== "investigator" && prior.proposal ? ", confirming the model's proposal" : ""}${priorModelEvidence ? `; the model's evidence was: ${priorModelEvidence}` : ""}${shown.length ? `; Meridian's concerns shown: ${shown.join(" | ")}` : ""}.`,
        });
        return { ok: true };
      },
      addGate: (id, which, requirement, status, evidence) => {
        const s = get().studies.find((x) => x.id === id);
        if (!s) return { ok: false, reason: "study not found" };
        const idx = decisionIndex(s, which);
        const list = s.design.decisions ?? [];
        if (idx < 0 || idx >= list.length) return { ok: false, reason: "no decision" };
        const req = (requirement ?? "").trim();
        const ev = (evidence ?? "").trim();
        if (!req) return { ok: false, reason: "a gate needs its requirement" };
        if ((status === "met" || status === "not-required") && !ev) return { ok: false, reason: "a settled gate needs the reference or the reason" };
        const gateId = uid("gate");
        const target = list[idx];
        const gate = { id: gateId, requirement: req, status, setBy: "investigator" as const, grounding: "added by the investigator", ...(ev ? { evidence: ev } : {}), record: true as const };
        const decisions = list.map((d, i) => (i === idx ? { ...d, gates: [...(d.gates ?? []), gate] } : d));
        const refreshed = refreshDecisionStatuses({ ...s, design: { ...s.design, decisions } });
        get().update(id, { design: refreshed.design });
        get().log(id, { id: uid("audit"), at: nowIso(), kind: "note", stage: "design", actor: "investigator", summary: `Investigator added gate ${gateId} to decision ${target.id}: ${req} is ${status}${ev ? ` (${ev})` : ""}.` });
        return { ok: true, gateId };
      },
      settleOpenItem: (id, which, text, how, note) => {
        const s = get().studies.find((x) => x.id === id);
        if (!s) return { ok: false, reason: "study not found" };
        const idx = decisionIndex(s, which);
        const list = s.design.decisions ?? [];
        if (idx < 0 || idx >= list.length) return { ok: false, reason: "no decision" };
        const t = (text ?? "").trim();
        const n = (note ?? "").trim();
        if (!t) return { ok: false, reason: "no statement given" };
        if (!n) return { ok: false, reason: how === "given" ? "give the reference that shows it was given" : "say why it does not concern this decision" };
        const target = list[idx];
        const decisions = list.map((d, i) => (i === idx ? { ...d, settledItems: [...(d.settledItems ?? []), { text: t, how, note: n, at: nowIso() }] } : d));
        const refreshed = refreshDecisionStatuses({ ...s, design: { ...s.design, decisions } });
        get().update(id, { design: refreshed.design });
        get().log(id, {
          id: uid("audit"),
          at: nowIso(),
          kind: "note",
          stage: "design",
          actor: "investigator",
          summary: `Investigator ${how === "given" ? "marked as given" : "set aside"}, for decision ${target.id}, a fact that left an approval open: "${t.slice(0, 200)}" (${n.slice(0, 200)}).`,
        });
        return { ok: true };
      },
      update: (id, patch) => {
        set({
          studies: get().studies.map((s) =>
            s.id === id ? { ...s, ...patch, updatedAt: nowIso() } : s,
          ),
        });
      },
      setFamily: (id, family) => {
        const basis = family ? ("explicit" as const) : ("unresolved" as const);
        set({
          studies: get().studies.map((s) =>
            s.id === id ? { ...s, family, familyBy: family ? ("investigator" as const) : undefined, design: { ...s.design, basis }, updatedAt: nowIso() } : s,
          ),
        });
      },
      remove: (id) => {
        set({ studies: get().studies.filter((s) => s.id !== id) });
      },
      restoreSeeds: () => {
        const existing = new Set(get().studies.map((s) => s.id));
        const missing = SEED_STUDIES.filter((s) => !existing.has(s.id)).map((s) => migrateStudy(s));
        if (missing.length) set({ studies: [...missing, ...get().studies] });
        else
          set({
            studies: [
              ...SEED_STUDIES.map((s) => migrateStudy(s)),
              ...get().studies.filter((s) => !SEED_IDS.includes(s.id)),
            ],
          });
      },
      setStage: (id, stage) => {
        set({
          studies: get().studies.map((s) =>
            s.id === id ? { ...s, currentStage: stage, updatedAt: nowIso() } : s,
          ),
        });
      },
      markComplete: (id, stage) => {
        set({
          studies: get().studies.map((s) => {
            if (s.id !== id) return s;
            if (stage === "scan" && !scanMayComplete(s)) return s;
            const completed = s.completedStages.includes(stage)
              ? s.completedStages
              : [...s.completedStages, stage];
            return {
              ...s,
              completedStages: completed,
              needsReview: (s.needsReview ?? []).filter((x) => x !== stage),
              updatedAt: nowIso(),
            };
          }),
        });
      },
      clearReview: (id, stage) => {
        set({
          studies: get().studies.map((s) =>
            s.id === id ? { ...s, needsReview: (s.needsReview ?? []).filter((x) => x !== stage), updatedAt: nowIso() } : s,
          ),
        });
      },
      mergeStage: (id, stage, patch) => {
        set({
          studies: get().studies.map((s) => {
            if (s.id !== id) return s;
            const current = s[stage];
            const consequential = isConsequential(patch as Record<string, unknown>);
            const flagged = consequential ? downstreamCompleted(s, stage) : [];
            const needsReview = orderNeedsReview([...(s.needsReview ?? []), ...flagged]);
            const entries =
              consequential && flagged.length
                ? [
                    {
                      id: uid("audit"),
                      at: nowIso(),
                      kind: "edit" as const,
                      stage,
                      summary: `${stage} changed after ${flagged.join(", ")} ${flagged.length === 1 ? "was" : "were"} completed; flagged for re-review.`,
                    },
                    ...s.audit.entries,
                  ]
                : s.audit.entries;
            // L1.6: write audit entries first, then the stage patch, so an audit-stage
            // model payload (openFixes, improvementNotes, lastReview) is not discarded.
            const auditBase = { ...s.audit, entries };
            const stageValue =
              stage === "audit"
                ? { ...auditBase, ...(patch as Partial<Study["audit"]>), entries: auditBase.entries }
                : { ...(current as object), ...patch };
            const merged = {
              ...s,
              audit: stage === "audit" ? (stageValue as Study["audit"]) : auditBase,
              ...(stage === "audit" ? {} : { [stage]: stageValue }),
              needsReview,
              updatedAt: nowIso(),
              status: consequential && s.status === "complete" ? "active" : s.status === "draft" ? "active" : s.status,
            } as Study;
            const gated = stage === "scan" ? withdrawScanCompletionIfInvalid(merged) : merged;
            // The Ethics stage can state that no review or consent is needed (D10 / S5), so it re-evaluates decisions too.
            return consequential && (stage === "scan" || stage === "problem" || stage === "design" || stage === "ethics") ? refreshDecisionStatuses(gated) : gated;
          }),
        });
      },
      mergeStageIfRevision: (id, stage, patch, expectedRevision) => {
        const s = get().studies.find((x) => x.id === id);
        if (!s) return { applied: false, reason: "study not found" };
        const current = studyRevision(s);
        if (current !== expectedRevision) {
          get().log(id, {
            id: uid("audit"),
            at: nowIso(),
            kind: "note",
            stage,
            actor: "system",
            summary: `Stale model response for ${stage} refused: produced against revision ${expectedRevision}, study is now ${current}.`,
          });
          return { applied: false, reason: `study changed since the request (${expectedRevision} → ${current}); the reply was not applied` };
        }
        get().mergeStage(id, stage, patch);
        return { applied: true };
      },
      confirmEmptySearch: (id) => {
        set({
          studies: get().studies.map((s) => {
            if (s.id !== id) return s;
            const at = nowIso();
            const confirmation = {
              by: "investigator" as const,
              at,
              queryHash: queryHashOf(s.scan.query ?? ""),
              revision: scanContentRevision(s),
            };
            return {
              ...s,
              scan: {
                ...s.scan,
                emptySearchConfirmation: confirmation,
                emptySearchConfirmedBy: "investigator" as const,
                emptySearchConfirmedAt: at,
                emptySearchConfirmed: { at, actor: "investigator" as const },
              },
              updatedAt: at,
            };
          }),
        });
        get().log(id, {
          id: uid("audit"),
          at: nowIso(),
          kind: "note",
          stage: "scan",
          actor: "investigator",
          summary: "Investigator confirmed the search was run and returned no records.",
        });
      },
      acceptDecision: (id, which) => {
        const s = get().studies.find((x) => x.id === id);
        if (!s) return { ok: false, reason: "study not found" };
        const idx = decisionIndex(s, which);
        const list = s.design.decisions ?? [];
        if (idx < 0 || idx >= list.length) return { ok: false, reason: "no decision" };
        const current = list[idx];
        if (current.status === "withdrawn" || current.selectionStatus === "withdrawn") return { ok: false, reason: "a withdrawn decision cannot be accepted" };
        const support = decisionIsSupported(current, s);
        if (!support.ok) {
          get().log(id, {
            id: uid("audit"),
            at: nowIso(),
            kind: "note",
            stage: "design",
            actor: "system",
            summary: `Accept refused: ${support.reason}`,
          });
          return { ok: false, reason: support.reason };
        }
        const decisions = list.map((d, i) =>
          i === idx
            ? { ...d, status: "accepted" as const, selectionStatus: "accepted" as const, actionStatus: d.actionStatus ?? "blocked" }
            : d,
        );
        const fam =
          (current.recommendedFamily && (STUDY_FAMILIES as readonly string[]).includes(current.recommendedFamily)
            ? current.recommendedFamily
            : undefined) ||
          (s.design.recommended && (STUDY_FAMILIES as readonly string[]).includes(s.design.recommended)
            ? s.design.recommended
            : undefined);
        const familyApplied = Boolean(fam);
        get().mergeStage(id, "design", {
          decisions,
          ...(familyApplied || s.family ? { basis: "explicit" as const } : {}),
        });
        if (familyApplied) {
          get().update(id, { family: fam as StudyFamily, familyBy: "investigator" });
        }
        get().log(id, {
          id: uid("audit"),
          at: nowIso(),
          kind: "note",
          stage: "design",
          actor: "investigator",
          summary: `Investigator accepted decision ${list[idx].id}.`,
        });
        return { ok: true };
      },
      withdrawDecision: (id, which) => {
        const s = get().studies.find((x) => x.id === id);
        if (!s) return { ok: false, reason: "study not found" };
        const idx = decisionIndex(s, which);
        const list = s.design.decisions ?? [];
        if (idx < 0 || idx >= list.length) return { ok: false, reason: "no decision" };
        const decisions = list.map((d, i) =>
          i === idx
            ? { ...d, status: "withdrawn" as const, selectionStatus: "withdrawn" as const, actionStatus: "blocked" as const }
            : d,
        );
        get().mergeStage(id, "design", { decisions });
        get().log(id, {
          id: uid("audit"),
          at: nowIso(),
          kind: "note",
          stage: "design",
          actor: "investigator",
          summary: `Investigator withdrew decision ${list[idx].id}.`,
        });
        return { ok: true };
      },
      changeSource: (id, record, field, value, note) => {
        const s = get().studies.find((x) => x.id === id);
        if (!s) return { ok: false, reason: "study not found" };
        const item = s.scan.items.find((it) => (record.id && it.id === record.id) || (record.title && it.title === record.title));
        if (!item) return { ok: false, reason: "record not found" };
        let extraDoc: SourceDocument | undefined;
        let refused: string | undefined;
        const items = s.scan.items.map((it) => {
          if (it.id !== item.id) return it;
          if (field === "status") {
            const result = String(value);
            const allowed = ["match", "mismatch", "not-found", "error", "blocked"] as const;
            if (!(allowed as readonly string[]).includes(result)) {
              refused = "a manual identity check cannot set verified";
              return it;
            }
            const noteText = String(note ?? "").trim();
            if (!noteText) {
              refused = "a manual identity check needs a note";
              return it;
            }
            const status =
              result === "mismatch"
                ? "mismatch"
                : result === "blocked"
                  ? "access-blocked"
                  : result === "not-found" || result === "error"
                    ? "check-failed"
                    : it.provenance.status;
            const check: SourceCheck = {
              id: uid("chk"),
              at: nowIso(),
              provider: "manual",
              identifier: it.doi || it.pmid || it.title,
              result: result as SourceCheck["result"],
              note: noteText,
            };
            return {
              ...it,
              provenance: { ...it.provenance, status, checks: [...(it.provenance.checks ?? []), check] },
            };
          }
          if (field === "year") return { ...it, year: typeof value === "number" ? value : Number(value) };
          if (field === "keyFindings") return { ...it, keyFindings: String(value ?? "") };
          if (field === "limitations") return { ...it, limitations: String(value ?? "") };
          if (field === "abstract") {
            const text = String(value ?? "");
            const sha = sha256Hex(text);
            const documentId = `doc-${sha.slice(0, 12)}`;
            extraDoc = {
              id: documentId,
              recordId: it.id,
              sha256: sha,
              text,
              mediaType: "text/plain",
              sourceScope: "abstract",
              shortenedAtSource: "unknown",
              capturedAt: nowIso(),
            };
            const prev = it.abstract;
            const versions = it.contentVersions ? [...it.contentVersions] : prev ? [prev] : [];
            return { ...it, abstract: { documentId, sha256: sha, text }, contentVersions: versions };
          }
          return it;
        });
        if (refused) return { ok: false, reason: refused };
        const after = items.find((it) => it.id === item.id);
        const beforeSnap = field === "status" ? item.provenance : field === "abstract" ? item.abstract : item[field as keyof typeof item];
        const afterSnap = field === "status" ? after?.provenance : field === "abstract" ? after?.abstract : after?.[field as keyof typeof after];
        const changed = JSON.stringify(beforeSnap) !== JSON.stringify(afterSnap);
        if (!changed) return { ok: false, reason: "source content did not change" };
        get().mergeStage(id, "scan", { items });
        if (extraDoc) {
          const latest = get().studies.find((x) => x.id === id);
          get().update(id, { documents: [...(latest?.documents ?? []), extraDoc] });
        }
        get().log(id, {
          id: uid("audit"),
          at: nowIso(),
          kind: "edit",
          stage: "scan",
          actor: "investigator",
          summary: `Source ${item.id} ${field} changed.`,
        });
        return { ok: true };
      },
      illuminateApply: (id, stage, payload, expectedRevision, options) => {
        const s = get().studies.find((x) => x.id === id);
        if (!s) return { ok: false, complete: false, reason: "study not found", summary: "missing study" };
        const decision = illuminateDecision(s, stage, payload, expectedRevision, options ?? {});
        const stamp = (extra: Partial<Study["lastIlluminate"]> & { ok: boolean; summary: string }) => {
          get().update(id, {
            lastIlluminate: {
              stage,
              issues: decision.applied.issues ?? [],
              at: nowIso(),
              ...extra,
            },
          });
        };
        if (!decision.merge) {
          get().log(id, {
            id: uid("audit"),
            at: nowIso(),
            kind: "note",
            stage,
            actor: "system",
            summary: `Illuminate refused (${decision.reason ?? "rejected"}). Model gates stripped: ${decision.droppedGates.join(",") || "none"}.`,
          });
          stamp({
            ok: false,
            summary: decision.applied.summary,
            error:
              decision.reason === "stale"
                ? "study changed since the request; the reply was not applied"
                : (decision.reason ?? decision.applied.summary),
          });
          return {
            ok: false,
            complete: false,
            reason: decision.reason,
            summary: decision.applied.summary,
            issues: decision.applied.issues,
          };
        }
        const merged = get().mergeStageIfRevision(id, stage, decision.applied.stagePatch as never, expectedRevision);
        if (!merged.applied) {
          stamp({ ok: false, summary: merged.reason ?? "study changed since the request; the reply was not applied", error: merged.reason ?? "study changed since the request; the reply was not applied" });
          return { ok: false, complete: false, reason: "stale", summary: decision.applied.summary, issues: decision.applied.issues };
        }
        if (decision.applied.studyPatch) {
          const patch = { ...decision.applied.studyPatch };
          if (!patch.title) delete patch.title;
          if (!patch.subtitle) delete patch.subtitle;
          if (stage === "design") delete patch.family;
          // A family a model reply sets is the model's, even over the investigator's earlier choice (D10: it then
          // settles nothing, such as the ethics status of a review of published literature).
          const current = get().studies.find((x) => x.id === id);
          const withBy = patch.family && patch.family !== current?.family ? { ...patch, familyBy: "model" as const } : patch;
          if (Object.keys(withBy).length) get().update(id, withBy);
        }
        if (decision.complete) get().markComplete(id, stage);
        get().log(id, {
          id: uid("log"),
          at: nowIso(),
          kind: "generate",
          stage,
          actor: "model",
          summary: decision.applied.summary,
        });
        stamp({ ok: true, summary: decision.applied.summary });
        return {
          ok: true,
          complete: decision.complete,
          reason: decision.reason,
          summary: decision.applied.summary,
          issues: decision.applied.issues,
        };
      },
      recordIlluminateFailure: (id, stage, error) => {
        get().update(id, {
          lastIlluminate: {
            stage,
            ok: false,
            summary: error,
            issues: [],
            error,
            at: nowIso(),
          },
        });
      },
      log: (id, entry) => {
        set({
          studies: get().studies.map((s) =>
            s.id === id
              ? {
                  ...s,
                  // Full history is kept. Panels use recentAudit() for a bounded view.
                  audit: { ...s.audit, entries: [entry, ...s.audit.entries] },
                  updatedAt: nowIso(),
                }
              : s,
          ),
        });
      },
      applyRetrieval: (id, payload) => {
        const s = get().studies.find((x) => x.id === id);
        if (!s) return;
        const merged = mergeIngested(s.scan.items, payload.items, s.idAliases ?? {});
        const documents = [
          ...(s.documents ?? []),
          ...payload.documents.map((d) => ({
            ...d,
            recordId: merged.aliases[d.recordId] ?? d.recordId,
          })),
        ];
        // Documents first: the scan merge re-derives the decisions, and they must see the new documents.
        get().update(id, { documents, idAliases: merged.aliases });
        get().mergeStage(id, "scan", {
          items: merged.items,
          retrievalEvents: [...(s.scan.retrievalEvents ?? []), payload.event],
          sourcesConsulted: [...new Set([...(s.scan.sourcesConsulted ?? []), payload.event.provider])],
        });
      },
      applyIdentityChecks: (id, provider, chunks) => {
        const zero: IdentityCheckSummary = { checked: 0, verified: 0, mismatch: 0, notFound: 0, unresolved: 0, failed: 0 };
        const s = get().studies.find((x) => x.id === id);
        if (!s || !chunks.length) return zero;
        let items = s.scan.items;
        const checks: SourceCheck[] = [];
        for (const c of chunks) {
          const r = applyLookupOutcome(items, c.requested, provider, c.outcome);
          items = r.items;
          checks.push(...r.checks);
        }
        if (!checks.length) return zero;
        const summary: IdentityCheckSummary = {
          checked: checks.length,
          verified: checks.filter((c) => c.result === "match").length,
          mismatch: checks.filter((c) => c.result === "mismatch").length,
          notFound: checks.filter((c) => c.result === "not-found").length,
          unresolved: checks.filter((c) => c.result === "unresolved").length,
          failed: checks.filter((c) => c.result === "error" || c.result === "blocked").length,
        };
        get().mergeStage(id, "scan", { items });
        get().log(id, {
          id: uid("audit"),
          at: nowIso(),
          kind: "note",
          stage: "scan",
          actor: "system",
          summary: `Identity checks (${provider}): ${summary.checked} checked, ${summary.verified} verified, ${summary.mismatch} mismatch, ${summary.notFound} not found, ${summary.unresolved} unresolved, ${summary.failed} failed.`,
        });
        return summary;
      },
      recordModelRun: (id, run) => {
        const s = get().studies.find((x) => x.id === id);
        if (!s) return;
        get().update(id, { modelRuns: [...(s.modelRuns ?? []), run] });
      },
      recordEvidenceRun: (id, run) => {
        const s = get().studies.find((x) => x.id === id);
        if (!s) return;
        get().update(id, { evidenceRuns: [...(s.evidenceRuns ?? []), run] });
      },
    }),
    {
      // The key is unchanged on purpose: studies saved by earlier versions are migrated, not discarded.
      name: MAIN_KEY,
      version: STUDY_SCHEMA_VERSION,
      storage: createJSONStorage(() => {
        const inner = browserLocalStorage();
        if (!inner) {
          const mem = new Map<string, string>();
          return {
            getItem: (k: string) => mem.get(k) ?? null,
            setItem: (k: string, v: string) => {
              mem.set(k, v);
            },
            removeItem: (k: string) => {
              mem.delete(k);
            },
          };
        }
        return createGuardedStorage(inner, STUDY_SCHEMA_VERSION);
      }),
      partialize: (state) => ({ studies: state.studies }),
      migrate: (persisted, fromVersion) => {
        const json = JSON.stringify(persisted ?? {});
        const backup = writeImmutableBackup(
          browserLocalStorage(),
          fromVersion,
          json,
          nowIso().replace(/[:.]/g, "-"),
        );
        if (!backup.written) {
          const storage = browserLocalStorage();
          if (storage) {
            try {
              storage.setItem(FAIL_KEY, JSON.stringify(backup));
            } catch {
              /* keep going; guarded storage will refuse the main write */
            }
          }
        }
        const state = (persisted ?? {}) as { studies?: unknown[] };
        return {
          studies: Array.isArray(state.studies) ? state.studies.map((s) => loadStudy(s)) : SEED_STUDIES.map((s) => loadStudy(s)),
          lastMigrationBackup: backup,
          backupFailure: backup.written ? null : backup,
        } as unknown as StudioState;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<StudioState> & { studies?: unknown[]; lastMigrationBackup?: unknown };
        const rawStudies = Array.isArray(p.studies) ? p.studies : current.studies;
        return {
          ...current,
          ...p,
          studies: rawStudies.map((s) => loadStudy(s)),
          backupFailure: readBackupFailure(browserLocalStorage()) ?? current.backupFailure,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.hydrated = true;
          state.backupFailure = readBackupFailure(browserLocalStorage());
          queueMicrotask(() => {
            useStudio.setState((s) => ({ studies: s.studies.map((x) => loadStudy(x)) }));
          });
        }
      },
    },
  ),
);

/** A stored study as the app reads it: migrated, with every decision's status re-derived (never trusted from storage). */
function loadStudy(raw: unknown): Study {
  return refreshDecisionStatuses(migrateStudy(raw));
}

export function useStudy(id: string | undefined): Study | undefined {
  return useStudio((s) => s.studies.find((x) => x.id === id));
}
