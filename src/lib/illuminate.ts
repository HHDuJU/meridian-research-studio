import { applyAiResult, type AppliedAi, type ApplyOptions } from "./apply-ai";
import { scanMayComplete } from "./defaults";
import { isStaleRequest } from "./evidence/decision";
import type { StageId, Study } from "./types";
import { isRecord } from "./contracts";

const MODEL_GATES = [
  "investigatorConfirmsEmptySearch",
  "emptySearchConfirmed",
  "confirmEmptySearch",
  "emptySearchConfirmation",
] as const;

/** Model JSON cannot authorize human gates. */
export function stripModelAuthority(raw: unknown): { payload: unknown; dropped: string[] } {
  if (!isRecord(raw)) return { payload: raw, dropped: [] };
  const dropped: string[] = [];
  const next: Record<string, unknown> = { ...raw };
  for (const k of MODEL_GATES) {
    if (k in next) {
      dropped.push(k);
      delete next[k];
    }
  }
  return { payload: next, dropped };
}

export interface IlluminateDecision {
  applied: AppliedAi;
  merge: boolean;
  complete: boolean;
  reason?: "rejected" | "stale" | "empty-scan" | "model-gate-stripped";
  droppedGates: string[];
}

/**
 * Single commit rule for Illuminate. Callers must not mark complete unless `complete` is true.
 */
export function illuminateDecision(
  study: Study,
  stage: StageId,
  raw: unknown,
  expectedRevision: string,
  options: ApplyOptions = {},
): IlluminateDecision {
  const { payload, dropped } = stripModelAuthority(raw);
  const applied = applyAiResult(stage, payload, study.family, study, options);
  if (!applied.ok) {
    return { applied, merge: false, complete: false, reason: "rejected", droppedGates: dropped };
  }
  if (isStaleRequest(study, expectedRevision)) {
    return { applied, merge: false, complete: false, reason: "stale", droppedGates: dropped };
  }
  const afterScan =
    stage === "scan"
      ? { ...study, scan: { ...study.scan, ...(applied.stagePatch as Partial<Study["scan"]>) } }
      : study;
  const complete = stage !== "scan" || scanMayComplete(afterScan);
  return {
    applied,
    merge: true,
    complete,
    reason: complete ? undefined : "empty-scan",
    droppedGates: dropped,
  };
}
