import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDecision, approvalReview, evaluateDecision } from "../src/lib/evidence/decision";
import { DETERMINATION_GATE } from "../src/lib/evidence/authority";
import { applyAiResult } from "../src/lib/apply-ai";
import { ledgerIssues } from "../src/lib/evidence/ledger";
import { createStudy } from "../src/lib/defaults";
import { useStudio } from "../src/lib/store";
import type { DecisionRecord, Study } from "../src/lib/types";

/*
 * Work order 2, D10 / solution contract S5: unknown resources and permissions must not become facts.
 * One test per synthetic acceptance case SYN-LOCAL-01 to 06, named as in the work order. All fixtures
 * are invented; no patient data.
 */

const S = () => useStudio.getState();

function modelDecision(study: Study, extra: Record<string, unknown>) {
  return applyDecision(
    { kind: "narrow", statement: "Start with a feasibility check.", claimIds: [], criteria: [], gates: [], alternatives: ["do nothing"], ...extra },
    study,
  );
}

function evaluateAccepted(d: DecisionRecord, study: Study) {
  return evaluateDecision({ ...d, status: "accepted", selectionStatus: "accepted" }, study);
}

test("reject_model_created_local_capacity (SYN-LOCAL-01): the model cannot create capacity or pass as the investigator", () => {
  const s = S().create({
    family: "qi-pdsa",
    setting: "Surgical ward",
    rawNeed: "Reduce missed post-discharge phone calls on the surgical ward.",
    localFacts: ["One nurse is employed on the ward; no research time is allocated to this project."],
  });
  // A model patch that writes local facts, even labelled as the investigator's, is dropped.
  const out = applyAiResult("problem", { statement: "x", localFacts: [{ text: "Two funded research nurses are available (0.5 FTE each).", by: "investigator" }] }, null, s);
  assert.ok(out.issues.some((i) => i.path === "localFacts" && i.code === "dropped"));
  assert.equal("localFacts" in out.stagePatch, false);

  // A model claim of kind local-fact that says it came from the investigator is stored as a model proposal.
  const cur = S().studies.find((x) => x.id === s.id)!;
  const scan = applyAiResult(
    "scan",
    { claims: [{ id: "c-nurses", text: "Two funded research nurses are available for data collection.", kind: "local-fact", sourceIds: [], uncertainty: "low", origin: "investigator" }] },
    null,
    cur,
  );
  const claims = ((scan.stagePatch as { claims?: { id: string; origin?: string }[] }).claims ?? []).filter((c) => c.id === "c-nurses");
  assert.equal(claims.length, 1);
  assert.equal(claims[0].origin, "model");
  assert.ok(scan.issues.some((i) => i.code === "proposed-local-fact"), "the proposal is flagged as not established");

  // A capacity gate the model declares met on the invented nurses stays unknown and blocks action.
  const r = modelDecision(cur, {
    gates: [{ id: "g-staff", requirement: "Research nurse time for data collection", status: "met", evidence: "Two funded research nurses (0.5 FTE each), supplied by the investigator" }],
  });
  assert.equal(r.decision!.gates[0].status, "unknown");
  const e = evaluateAccepted(r.decision!, cur);
  assert.equal(e.canAct, false);
  assert.equal(S().studies.find((x) => x.id === s.id)!.problem.localFacts?.length, 1, "no local fact was added");

  // A plan that rests on the proposed local fact is blocked, and the ledger flags it.
  const withClaim = { ...cur, scan: { ...cur.scan, claims: [...(cur.scan.claims ?? []), ...claims.map((c) => ({ ...(c as object) }))] } } as Study;
  const plan = applyDecision({ kind: "narrow", statement: "Use the nurses.", claimIds: ["c-nurses"], criteria: [], gates: [], alternatives: ["none"] }, withClaim);
  const ep = evaluateAccepted(plan.decision!, withClaim);
  assert.ok(ep.blockers.some((b) => /local fact the model proposed/.test(b)), ep.blockers.join(" | "));
  assert.ok(ledgerIssues(withClaim.scan.claims, withClaim.scan.items).some((i) => i.claimId === "c-nurses" && i.severity === "block"));
});

test("reject_unresolved_approval_evidence (SYN-LOCAL-02): an unknown permission cannot be met by prose", () => {
  const study = createStudy({
    family: "cohort",
    setting: "Pain clinic",
    rawNeed: "Describe opioid tapering outcomes in the clinic registry.",
    localFacts: ["Permission for secondary research use of the clinic registry data is unknown."],
  });
  const tbc = createStudy({ family: "cohort", setting: "Pain clinic", rawNeed: "Describe opioid tapering outcomes.", localFacts: ["Secondary research permission for the clinic registry: to be confirmed by the data custodian."] });
  const rt = modelDecision(tbc, { gates: [{ id: "g-perm", requirement: "Secondary research permission for the clinic registry", status: "met", evidence: "Secondary research permission for the clinic registry" }] });
  assert.equal(rt.decision!.gates[0].status, "unknown");
  for (const evidence of ["approval confirmed", "Stated by the investigator", "Permission for secondary research use of the clinic registry data"]) {
    const r = modelDecision(study, {
      gates: [{ id: "g-perm", requirement: "Permission for secondary research use of the clinic registry data", status: "met", evidence }],
    });
    assert.equal(r.decision!.gates[0].status, "unknown", evidence);
    const e = evaluateAccepted(r.decision!, study);
    assert.equal(e.canAct, false, evidence);
    assert.ok(e.blockers.some((b) => /gate unknown/.test(b)), evidence);
  }
});

test("f7_registry_field_not_in_cited_fact_is_flagged (SYN-LOCAL-03): a restricted data source cannot cover a wider population", () => {
  const study = createStudy({
    family: "cohort",
    setting: "Regional block service",
    rawNeed: "Estimate attrition between referral and treatment for the regional block service.",
    localFacts: ["The block registry holds treated patients only: it records patients who received a nerve block."],
  });
  const r = modelDecision(study, {
    gates: [
      {
        id: "g-pop",
        requirement: "Block registry records all referred candidates, treated and non-treated",
        status: "met",
        evidence: "The block registry holds treated patients and referred candidates, both of which are recorded.",
      },
    ],
  });
  const gate = r.decision!.gates[0];
  assert.equal(gate.status, "unknown");
  assert.match(gate.grounding ?? "", /only|limited/i, "the reason names the restriction");
  assert.equal(evaluateAccepted(r.decision!, study).canAct, false);

  // The restricted fact still grounds a gate inside its scope.
  const inside = modelDecision(study, {
    gates: [{ id: "g-in", requirement: "Registry records treated patients", status: "met", evidence: "The block registry holds treated patients only" }],
  });
  // D10 / S5: a supported model "met" is a proposal with no concerns; the investigator confirms it.
  assert.equal(inside.decision!.gates[0].status, "unknown");
  assert.deepEqual(inside.decision!.gates[0].proposal?.concerns, []);
});

test("f8_needs_no_approval_contradicts_unknown_status (SYN-LOCAL-04): 'needs no approval' is blocked; clinical access is not research permission", () => {
  const study = createStudy({
    family: "qi-pdsa",
    setting: "Pain clinic",
    rawNeed: "Count patients on high-dose opioids to plan a tapering pathway.",
    localFacts: ["Whether research use of the clinic dashboard data needs a data-use approval is unknown. Clinic staff can view the dashboard for patient care."],
  });
  const r = modelDecision(study, {
    statement: "Run a preliminary research count of high-dose opioid patients from the clinic dashboard; this needs no approval because staff already see the data for care.",
  });
  const e = evaluateAccepted(r.decision!, study);
  assert.equal(e.canAct, false);
  assert.ok(e.blockers.some((b) => /no approval/i.test(b) && /investigator/i.test(b)), e.blockers.join(" | "));

  for (const note of ["This is quality improvement, so REB approval is not required.", "The count is exempt from ethics review.", "No consent needed for a count."]) {
    const rn = modelDecision(study, { note });
    assert.equal(evaluateAccepted(rn.decision!, study).canAct, false, note);
  }
  // A question about the exemption is not an assertion of it.
  const asked = modelDecision(study, { note: "Confirm whether the count needs no approval before starting." });
  assert.equal(evaluateAccepted(asked.decision!, study).blockers.some((b) => /no approval is needed/.test(b)), false);

  // Access for patient care does not meet a gate for research access, even without the word approval.
  const acc = modelDecision(study, {
    gates: [{ id: "g-acc", requirement: "Access to the dashboard data for the research count", status: "met", evidence: "Clinic staff can view the dashboard for patient care" }],
  });
  assert.equal(acc.decision!.gates[0].status, "unknown");

  // Operational access stated by the investigator does not meet a research data-use approval gate.
  const g = modelDecision(study, {
    gates: [{ id: "g-dua", requirement: "Data-use approval for research use of the dashboard data", status: "met", evidence: "Clinic staff can view the dashboard for patient care" }],
  });
  assert.equal(g.decision!.gates[0].status, "unknown");

  // The investigator's own statement of the exemption lets the same decision stand.
  const exempt = createStudy({
    family: "qi-pdsa",
    setting: "Pain clinic",
    rawNeed: "Count patients on high-dose opioids to plan a tapering pathway.",
    localFacts: ["The research ethics board confirmed in writing that this internal count needs no approval (letter QI-2026-14)."],
  });
  const ok = modelDecision(exempt, {
    statement: "Run a preliminary count of high-dose opioid patients from the clinic dashboard; this needs no approval (letter QI-2026-14).",
  });
  // The model's words settle nothing: the investigator records the determination on the decision, and
  // Meridian offers their own fact as the reference.
  const review = approvalReview({ ...ok.decision!, status: "accepted", selectionStatus: "accepted" }, exempt);
  assert.equal(review.ethicsRecordMissing, true);
  assert.match(review.suggestedEthicsRecord ?? "", /QI-2026-14/);
  const recorded = { ...ok.decision!, status: "accepted" as const, selectionStatus: "accepted" as const, gates: [{ id: "rec", requirement: DETERMINATION_GATE.ethics, status: "not-required" as const, setBy: "investigator" as const, evidence: review.suggestedEthicsRecord!, record: true as const }] };
  const e2 = evaluateDecision(recorded, exempt);
  assert.equal(e2.blockers.some((b) => /no approval|ethics status/i.test(b)), false, e2.blockers.join(" | "));
  assert.equal(e2.canAct, true);
  // With the investigator's own fact saying the data-use approval is unknown, recording the ethics status is
  // not enough: the open fact blocks until the investigator records the data determination or sets it aside.
  const open = { ...r.decision!, status: "accepted" as const, selectionStatus: "accepted" as const, gates: [{ id: "rec", requirement: DETERMINATION_GATE.ethics, status: "not-required" as const, setBy: "investigator" as const, evidence: "Clinic QI office: service evaluation, no REB review (QIO-2026-3)", record: true as const }] };
  const e3 = evaluateDecision(open, study);
  assert.equal(e3.canAct, false);
  assert.ok(e3.blockers.some((b) => /your own facts leave an approval open/.test(b)), e3.blockers.join(" | "));
  // Only an action on that fact, for this decision, settles it.
  const item = approvalReview(open, study).openItems[0].text;
  const given = { ...open, settledItems: [{ text: item, how: "given" as const, note: "Custodian confirmed no data-use approval is needed for the count (DC-2026-5)", at: "2026-09-23T00:00:00Z" }] };
  assert.equal(evaluateDecision(given, study).canAct, true);
});

test("permission_for_other_study_is_not_permission_here (SYN-LOCAL-05): an approval scoped to another protocol does not meet this study's gate", () => {
  const study = createStudy({
    family: "qi-pdsa",
    setting: "Surgical wards",
    rawNeed: "Audit night-time opioid prescribing on the surgical wards.",
    localFacts: ["REB approval REB-2025-077 covers protocol CARE-KET-01 (the ketamine registry) only; any other use needs a new application."],
  });
  const r = modelDecision(study, {
    gates: [{ id: "g-reb", requirement: "REB approval for the night-time opioid prescribing audit", status: "met", evidence: "REB-2025-077 (investigator local facts)" }],
  });
  const gate = r.decision!.gates[0];
  assert.equal(gate.status, "unknown");
  assert.match(gate.grounding ?? "", /CARE-KET-01|only|scope/i);
  assert.equal(evaluateAccepted(r.decision!, study).canAct, false);
  assert.equal(study.problem.localFacts?.length, 1, "no extrapolated authority is stored");

  // An approval described as belonging to another study does not count either.
  const other = createStudy({
    family: "qi-pdsa",
    setting: "Surgical wards",
    rawNeed: "Audit night-time opioid prescribing on the surgical wards.",
    localFacts: ["Our previous study was approved by the REB (REB-2024-310)."],
  });
  const r2 = modelDecision(other, {
    gates: [{ id: "g-reb", requirement: "REB approval for this audit", status: "met", evidence: "REB-2024-310 approved" }],
  });
  assert.equal(r2.decision!.gates[0].status, "unknown");

  // Naming another protocol is enough, with or without "only".
  const named = createStudy({
    family: "qi-pdsa",
    setting: "Surgical wards",
    rawNeed: "Audit night-time opioid prescribing on the surgical wards.",
    localFacts: ["REB-2025-077 approved the ketamine registry (protocol CARE-KET-01)."],
  });
  for (const evidence of ["REB-2025-077", "REB-2025-077 for protocol CARE-KET-01"]) {
    const rn = modelDecision(named, { gates: [{ id: "g-reb", requirement: "REB approval for the opioid prescribing audit", status: "met", evidence }] });
    assert.equal(rn.decision!.gates[0].status, "unknown", evidence);
  }

  // The same approval counts when it names this study's own protocol.
  const same = createStudy({
    family: "qi-pdsa",
    setting: "Surgical wards",
    rawNeed: "Audit night-time opioid prescribing on the surgical wards (protocol NOP-2026-02).",
    localFacts: ["REB approval REB-2026-188 covers protocol NOP-2026-02 only."],
  });
  const r3 = modelDecision(same, {
    gates: [{ id: "g-reb", requirement: "REB approval for the audit", status: "met", evidence: "REB-2026-188" }],
  });
  assert.equal(r3.decision!.gates[0].status, "unknown");
  assert.deepEqual(r3.decision!.gates[0].proposal?.concerns, []);
});

test("conflicting_staff_allocations_block_capacity_gate (SYN-LOCAL-06): conflicting facts keep the capacity gate open until the investigator resolves it", () => {
  const s = S().create({
    family: "cohort",
    setting: "Pain clinic",
    rawNeed: "Follow up patients 6 months after radiofrequency ablation.",
    localFacts: [
      "Allocation letter (2026-06-01): the research nurse has 8 hours per week protected for this project.",
      "Staffing roster (2026-09-01): the research nurse has zero protected research time this term.",
    ],
  });
  const cur = S().studies.find((x) => x.id === s.id)!;
  const r = modelDecision(cur, {
    gates: [
      { id: "g-cap", requirement: "Protected research nurse time for follow-up calls", status: "met", evidence: "Allocation letter: 8 hours per week protected for this project" },
    ],
  });
  const gate = r.decision!.gates[0];
  assert.equal(gate.status, "unknown");
  assert.match(gate.grounding ?? "", /conflict/i);
  assert.equal(cur.problem.localFacts?.length, 2, "both facts survive");

  // A different amount in the same unit is a conflict too.
  const figures = createStudy({
    family: "cohort",
    setting: "Pain clinic",
    rawNeed: "Follow up patients 6 months after radiofrequency ablation.",
    localFacts: [
      "Allocation letter (2026-06-01): the research nurse has 8 hours per week protected for this project.",
      "Staffing roster (2026-09-01): the research nurse has 4 hours per week protected for research this term.",
    ],
  });
  const rf = modelDecision(figures, {
    gates: [{ id: "g-cap", requirement: "Protected research nurse time for follow-up calls", status: "met", evidence: "Allocation letter: 8 hours per week protected for this project" }],
  });
  assert.equal(rf.decision!.gates[0].status, "unknown");

  // Only the investigator resolves the conflict.
  S().mergeStage(s.id, "design", { decisions: [r.decision!] });
  assert.equal(S().acceptDecision(s.id, "latest").ok, true);
  assert.equal(S().studies.find((x) => x.id === s.id)!.design.decisions.at(-1)!.actionStatus, "blocked");
  assert.equal(S().setGate(s.id, "latest", "g-cap", "met", "Confirmed with the unit manager on 2026-09-20: 8 hours per week restored (email UM-0920)").ok, true);
  // The capacity gate is settled; the work also needs the investigator's record of its ethics status.
  assert.equal(S().studies.find((x) => x.id === s.id)!.design.decisions.at(-1)!.actionStatus, "blocked");
  assert.equal(S().addGate(s.id, "latest", DETERMINATION_GATE.ethics, "met", "REB-2026-240 approved the follow-up study on 2026-08-12").ok, true);
  const after = S().studies.find((x) => x.id === s.id)!;
  assert.equal(after.design.decisions.at(-1)!.actionStatus, "ready");
  assert.equal(after.problem.localFacts?.length, 2);
});
