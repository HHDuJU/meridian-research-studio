import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDecision, decisionIsSupported, evaluateDecision, evidenceRevision, studyRevision } from "../src/lib/evidence/decision";
import { createStudy } from "../src/lib/defaults";
import { useStudio } from "../src/lib/store";
import { studyToJson } from "../src/lib/export";

const S = () => useStudio.getState();

function studyWithRetrievedClaim() {
  const created = S().create({ family: "rct", setting: "s", rawNeed: "n" });
  S().mergeStage(created.id, "scan", {
    items: [
      {
        id: "ev-1",
        title: "Synth paper",
        authors: "A",
        year: 2021,
        source: "J",
        kind: "rct",
        grade: "unrated",
        methodQuality: null,
        relevance: null,
        notes: "",
        keyFindings: "Observed benefit",
        limitations: "",
        verification: "ai-lead",
        contextTags: [],
        provenance: {
          origin: "retrieval",
          retrievalEventIds: ["ret-1"],
          identifiers: { doi: "10.5555/synth" },
          access: "abstract",
          status: "retrieved",
          checks: [],
        },
        doi: "10.5555/synth",
      },
    ],
    retrievalEvents: [
      {
        id: "ret-1",
        at: "2026-09-22T00:00:00.000Z",
        provider: "fixture",
        query: "q",
        resultCount: 1,
        recordIds: ["ev-1"],
        status: "ok",
        performedBy: "app",
      },
    ],
    claims: [
      {
        id: "cl-1",
        text: "benefit exists",
        kind: "source-derived",
        sourceIds: ["ev-1"],
        uncertainty: "moderate",
        origin: "investigator",
      },
    ],
  });
  return S().studies.find((x) => x.id === created.id)!;
}

test("accept_supported_decision_sets_selection_accepted_and_action_ready", () => {
  const s0 = studyWithRetrievedClaim();
  const applied = applyDecision(
    { kind: "pursue", statement: "Run a trial", question: "Does it work?", claimIds: ["cl-1"], alternatives: ["Stop"] },
    s0,
  );
  assert.ok(applied.decision);
  assert.equal(applied.decision!.selectionStatus, "proposed");
  assert.equal(applied.decision!.actionStatus, "blocked");
  S().mergeStage(s0.id, "design", { decisions: [applied.decision!] });
  const r = S().acceptDecision(s0.id, "latest");
  assert.equal(r.ok, true);
  const s = S().studies.find((x) => x.id === s0.id)!;
  const d = s.design.decisions[0];
  assert.equal(d.selectionStatus, "accepted");
  assert.equal(d.status, "accepted");
  assert.equal(d.actionStatus, "ready");
  const e = evaluateDecision(d, s);
  assert.equal(e.selectionStatus, "accepted");
  assert.equal(e.actionStatus, "ready");
});

test("accept_without_retrieved_ledger_claims_is_refused", () => {
  const created = S().create({ family: "rct", setting: "s", rawNeed: "n" });
  const s0 = S().studies.find((x) => x.id === created.id)!;
  const applied = applyDecision({ kind: "pursue", statement: "Run a trial", question: "q", claimIds: [] }, s0);
  assert.ok(applied.decision);
  S().mergeStage(created.id, "design", { decisions: [applied.decision!] });
  const r = S().acceptDecision(created.id, "latest");
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /unsupported selection/);
  const s = S().studies.find((x) => x.id === created.id)!;
  assert.equal(s.design.decisions[0].selectionStatus, "proposed");
  assert.equal(s.design.decisions[0].status, "proposed");
});

test("changeSource_keyFindings_makes_accepted_decision_stale", () => {
  const s0 = studyWithRetrievedClaim();
  const applied = applyDecision(
    { kind: "pursue", statement: "Run a trial", question: "Does it work?", claimIds: ["cl-1"], alternatives: ["Stop"] },
    s0,
  );
  S().mergeStage(s0.id, "design", { decisions: [applied.decision!] });
  assert.equal(S().acceptDecision(s0.id, "latest").ok, true);
  const before = evidenceRevision(S().studies.find((x) => x.id === s0.id)!);
  const ch = S().changeSource(s0.id, { id: "ev-1" }, "keyFindings", "Correction: no observed benefit");
  assert.equal(ch.ok, true);
  const s = S().studies.find((x) => x.id === s0.id)!;
  assert.notEqual(evidenceRevision(s), before);
  assert.equal(s.design.decisions[0].selectionStatus, "stale");
  assert.equal(s.design.decisions[0].status, "stale");
  assert.equal(s.design.decisions[0].actionStatus, "blocked");
  assert.match(studyToJson(s), /"selectionStatus": "stale"/);
});

test("decisionIsSupported_false_for_unretrieved_model_lead", () => {
  const s0 = studyWithRetrievedClaim();
  s0.scan.items[0].provenance.status = "unverified";
  s0.scan.items[0].provenance.origin = "model";
  const applied = applyDecision({ kind: "defer", statement: "Wait", claimIds: ["cl-1"] }, s0);
  const r = decisionIsSupported(applied.decision!, s0);
  assert.equal(r.ok, false);
  assert.match(r.reason, /retrieved record/);
});

test("accept_narrow_without_claims_sets_selection_accepted_action_blocked", () => {
  const created = S().create({ family: null, setting: "s", rawNeed: "n" });
  const s0 = S().studies.find((x) => x.id === created.id)!;
  assert.equal(s0.design.basis, "unresolved");
  const applied = applyDecision(
    { kind: "narrow", statement: "Narrow to a cohort question", question: "q", claimIds: [], gates: [{ id: "g1", requirement: "IG decision", status: "unknown" }] },
    s0,
  );
  assert.ok(applied.decision);
  assert.equal(decisionIsSupported(applied.decision!, s0).ok, true);
  S().mergeStage(created.id, "design", { decisions: [applied.decision!], recommended: "cohort" });
  const r = S().acceptDecision(created.id, "latest");
  assert.equal(r.ok, true);
  const s = S().studies.find((x) => x.id === created.id)!;
  assert.equal(s.design.decisions[0].selectionStatus, "accepted");
  assert.equal(s.design.decisions[0].status, "accepted");
  assert.equal(s.design.decisions[0].actionStatus, "blocked");
  assert.equal(s.design.basis, "explicit");
});

test("accept_implementation_without_claims_sets_selection_accepted_action_blocked", () => {
  const created = S().create({ family: "economic", setting: "s", rawNeed: "n" });
  const s0 = S().studies.find((x) => x.id === created.id)!;
  const applied = applyDecision(
    {
      kind: "implementation",
      statement: "Run a hybrid implementation study",
      question: "q",
      claimIds: [],
      recommendedFamily: "implementation",
      gates: [{ id: "g1", requirement: "data office approval", status: "unknown" }],
      alternatives: ["Model now"],
    },
    s0,
  );
  assert.ok(applied.decision);
  assert.equal(applied.decision!.recommendedFamily, "implementation");
  assert.equal(decisionIsSupported(applied.decision!, s0).ok, true);
  S().mergeStage(created.id, "design", { decisions: [applied.decision!] });
  const r = S().acceptDecision(created.id, "latest");
  assert.equal(r.ok, true);
  const s = S().studies.find((x) => x.id === created.id)!;
  assert.equal(s.design.decisions[0].selectionStatus, "accepted");
  assert.equal(s.design.decisions[0].actionStatus, "blocked");
  assert.equal(s.family, "implementation");
  assert.equal(s.design.basis, "explicit");
});

test("proposed_recommendation_does_not_write_study_family", () => {
  const created = S().create({ family: null, setting: "s", rawNeed: "n" });
  const before = S().studies.find((x) => x.id === created.id)!;
  const result = S().illuminateApply(
    created.id,
    "design",
    { recommended: "pragmatic-trial", rationale: "proposal only", decision: { kind: "narrow", statement: "Wait", claimIds: [] } },
    studyRevision(before),
  );
  assert.equal(result.ok, true);
  const s = S().studies.find((x) => x.id === created.id)!;
  assert.equal(s.family, null);
  assert.equal(s.design.recommended, "pragmatic-trial");
  assert.equal(s.design.decisions.at(-1)?.recommendedFamily, "pragmatic-trial");
});
