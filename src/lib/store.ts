import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createStudy, migrateStudy, scanMayComplete, queryHashOf, scanContentRevision, withdrawScanCompletionIfInvalid } from "./defaults";
import { writeImmutableBackup, browserLocalStorage, createGuardedStorage, readBackupFailure, FAIL_KEY, MAIN_KEY } from "./persist-backup";
import { SEED_IDS, SEED_STUDIES } from "./seed";
import { STAGE_IDS, STUDY_SCHEMA_VERSION } from "./types";
import type { AuditEntry, StageId, Study, StudyFamily, EvidenceItem, RetrievalEvent, SourceDocument } from "./types";
import { nowIso, uid } from "./utils";
import { refreshDecisionStatuses, studyRevision } from "./evidence/decision";
import { illuminateDecision } from "./illuminate";
import { mergeIngested } from "./evidence/records";

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
  }) => Study;
  update: (id: string, patch: StudyPatch) => void;
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
  illuminateApply: (
    id: string,
    stage: StageId,
    payload: unknown,
    expectedRevision: string,
  ) => { ok: boolean; complete: boolean; reason?: string; summary: string; issues?: { path: string; code: string; message?: string }[] };
  recordIlluminateFailure: (id: string, stage: StageId, error: string) => void;
  log: (id: string, entry: AuditEntry) => void;
  applyRetrieval: (
    id: string,
    payload: { event: RetrievalEvent; items: EvidenceItem[]; documents: SourceDocument[] },
  ) => void;
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
      update: (id, patch) => {
        set({
          studies: get().studies.map((s) =>
            s.id === id ? { ...s, ...patch, updatedAt: nowIso() } : s,
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
            const needsReview = [...new Set([...(s.needsReview ?? []), ...flagged])];
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
            return consequential && (stage === "scan" || stage === "problem" || stage === "design") ? refreshDecisionStatuses(gated) : gated;
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
            summary: `Stale model response for ${stage} refused: produced against revision ${expectedRevision}, study is now ${current}.`,
          });
          return { applied: false, reason: `study changed since the request (${expectedRevision} → ${current})` };
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
          summary: "Investigator confirmed the search was run and returned no records.",
        });
      },
      acceptDecision: (id, which) => {
        const s = get().studies.find((x) => x.id === id);
        if (!s) return { ok: false, reason: "study not found" };
        const idx = decisionIndex(s, which);
        const list = s.design.decisions ?? [];
        if (idx < 0 || idx >= list.length) return { ok: false, reason: "no decision" };
        const decisions = list.map((d, i) => (i === idx ? { ...d, status: "accepted" as const } : d));
        get().mergeStage(id, "design", { decisions });
        get().log(id, {
          id: uid("audit"),
          at: nowIso(),
          kind: "note",
          stage: "design",
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
        const decisions = list.map((d, i) => (i === idx ? { ...d, status: "withdrawn" as const } : d));
        get().mergeStage(id, "design", { decisions });
        get().log(id, {
          id: uid("audit"),
          at: nowIso(),
          kind: "note",
          stage: "design",
          summary: `Investigator withdrew decision ${list[idx].id}.`,
        });
        return { ok: true };
      },
      illuminateApply: (id, stage, payload, expectedRevision) => {
        const s = get().studies.find((x) => x.id === id);
        if (!s) return { ok: false, complete: false, reason: "study not found", summary: "missing study" };
        const decision = illuminateDecision(s, stage, payload, expectedRevision);
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
            summary: `Illuminate refused (${decision.reason ?? "rejected"}). Model gates stripped: ${decision.droppedGates.join(",") || "none"}.`,
          });
          stamp({
            ok: false,
            summary: decision.applied.summary,
            error: decision.reason ?? decision.applied.summary,
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
          stamp({ ok: false, summary: decision.applied.summary, error: "stale" });
          return { ok: false, complete: false, reason: "stale", summary: decision.applied.summary, issues: decision.applied.issues };
        }
        if (decision.applied.studyPatch) {
          const patch = { ...decision.applied.studyPatch };
          if (!patch.title) delete patch.title;
          if (!patch.subtitle) delete patch.subtitle;
          get().update(id, patch);
        }
        if (decision.complete) get().markComplete(id, stage);
        get().log(id, {
          id: uid("log"),
          at: nowIso(),
          kind: "generate",
          stage,
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
        get().mergeStage(id, "scan", {
          items: merged.items,
          retrievalEvents: [...(s.scan.retrievalEvents ?? []), payload.event],
          sourcesConsulted: [...new Set([...(s.scan.sourcesConsulted ?? []), payload.event.provider])],
        });
        get().update(id, { documents, idAliases: merged.aliases });
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
          studies: Array.isArray(state.studies) ? state.studies.map((s) => migrateStudy(s)) : SEED_STUDIES.map((s) => migrateStudy(s)),
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
          studies: rawStudies.map((s) => migrateStudy(s)),
          backupFailure: readBackupFailure(browserLocalStorage()) ?? current.backupFailure,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.hydrated = true;
          state.backupFailure = readBackupFailure(browserLocalStorage());
          queueMicrotask(() => {
            useStudio.setState((s) => ({ studies: s.studies.map((x) => migrateStudy(x)) }));
          });
        }
      },
    },
  ),
);

export function useStudy(id: string | undefined): Study | undefined {
  return useStudio((s) => s.studies.find((x) => x.id === id));
}
