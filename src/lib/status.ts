import type { StageId, Study } from "./types";
import { STAGE_IDS } from "./types";
import { checkClaim } from "./evidence/grounding";
import { evaluateDecision } from "./evidence/decision";
import { emptySearchConfirmationValid, scanHasRetrievedRecord } from "./defaults";

/*
 * One deterministic summary of where a study stands, for the top of the studio: what is known,
 * what is checked, what went stale, which decision is the investigator's, and the next useful step.
 * Derived from the stored study only; nothing here calls a model or changes the study.
 */

export interface StudyStatus {
  evidence: {
    records: number;
    retrieved: number;
    verified: number;
    mismatch: number;
    leads: number;
    withText: number;
    withdrawn: number;
    uncheckedDois: number;
  };
  claims: { total: number; supported: number; notSupported: number; unchecked: number };
  decisions: { total: number; accepted: number; proposed: number; stale: number; ready: number; firstBlocker: string | null };
  review: StageId[];
  localFacts: number;
  next: { stage: StageId; text: string };
}

export function studyStatus(study: Study): StudyStatus {
  const items = study.scan.items;
  const status = (s: string) => items.filter((i) => i.provenance?.status === s).length;
  const uncheckedDois = items.filter(
    (i) =>
      (i.doi || i.provenance?.identifiers?.doi) &&
      (i.provenance?.status === "retrieved" || i.provenance?.status === "unverified" || i.provenance?.status === "check-failed") &&
      !(i.provenance?.checks ?? []).some((c) => c.provider !== "manual" && (c.result === "match" || c.result === "mismatch" || c.result === "not-found" || c.result === "unresolved")),
  ).length;
  const evidence = {
    records: items.length,
    retrieved: status("retrieved"),
    verified: status("verified"),
    mismatch: status("mismatch"),
    leads: items.filter((i) => i.provenance?.origin === "model" && i.provenance?.status === "unverified").length,
    withText: items.filter((i) => !!i.abstract?.text).length,
    withdrawn: items.filter((i) => i.publicationStatus === "retracted" || i.publicationStatus === "withdrawn").length,
    uncheckedDois,
  };
  const checks = (study.scan.claims ?? []).map((c) => checkClaim(c, study));
  const claims = {
    total: checks.length,
    supported: checks.filter((c) => c.status === "supported").length,
    notSupported: checks.filter((c) => c.blocking).length,
    unchecked: checks.filter((c) => c.status === "no-source-text").length,
  };
  const decisions = study.design.decisions ?? [];
  const evals = decisions.map((d) => ({ d, e: evaluateDecision(d, study) }));
  const live = evals.filter(({ d }) => (d.selectionStatus ?? d.status) !== "withdrawn");
  const acceptedBlocked = live.find(({ e }) => e.status === "accepted" && !e.canAct);
  const dec = {
    total: decisions.length,
    accepted: live.filter(({ e }) => e.status === "accepted").length,
    proposed: live.filter(({ e }) => e.status === "proposed").length,
    stale: live.filter(({ e }) => e.status === "stale").length,
    ready: live.filter(({ e }) => e.canAct).length,
    firstBlocker: acceptedBlocked?.e.blockers[0] ?? null,
  };
  const review = [...(study.needsReview ?? [])];
  return { evidence, claims, decisions: dec, review, localFacts: (study.problem.localFacts ?? []).length, next: nextStep(study, evidence, claims, dec, review) };
}

function nextStep(
  study: Study,
  evidence: StudyStatus["evidence"],
  claims: StudyStatus["claims"],
  dec: StudyStatus["decisions"],
  review: StageId[],
): StudyStatus["next"] {
  if (!study.problem.statement.trim()) return { stage: "problem", text: "Structure the problem (Illuminate on Problem), then check it reads as you meant." };
  const retrieved = scanHasRetrievedRecord(study);
  if (!retrieved && !emptySearchConfirmationValid(study)) {
    if (!(study.scan.query ?? "").trim()) return { stage: "scan", text: "Write a search query, or Illuminate on Scan to draft one." };
    return { stage: "scan", text: "Search the literature with the stored query." };
  }
  if (evidence.uncheckedDois > 0) return { stage: "scan", text: `Check the identity of ${evidence.uncheckedDois} records against Crossref.` };
  if (retrieved && claims.total === 0) return { stage: "scan", text: "Appraise the retrieved records (Illuminate on Scan)." };
  if (claims.notSupported > 0) return { stage: "scan", text: `Fix or remove ${claims.notSupported} claims that their cited text does not support.` };
  if (review.length) return { stage: review[0], text: `Re-review ${review.join(", ")}: an upstream change may have made them out of date.` };
  if (dec.stale > 0) return { stage: "design", text: "A decision is stale: the evidence changed after it was made. Review it on Design." };
  if (dec.proposed > 0 && dec.accepted === 0) return { stage: "design", text: "A design decision is waiting for you: accept or withdraw it on Design." };
  if (dec.firstBlocker) return { stage: "design", text: `Before acting: ${dec.firstBlocker}` };
  const firstIncomplete = STAGE_IDS.find((s) => !study.completedStages.includes(s));
  if (firstIncomplete) return { stage: firstIncomplete, text: `Next stage: ${firstIncomplete}.` };
  return { stage: "audit", text: "Every stage is complete. Run the audit again after any change." };
}
