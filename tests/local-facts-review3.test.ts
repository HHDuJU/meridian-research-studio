import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDecision, approvalReview, evaluateDecision, refreshDecisionStatuses } from "../src/lib/evidence/decision";
import { DETERMINATION_GATE, NO_WORK_REASON, authorityClaims, openApprovalItems } from "../src/lib/evidence/authority";
import { gateSupport, localFactEstablished } from "../src/lib/evidence/grounding";
import { applyAiResult } from "../src/lib/apply-ai";
import { createStudy, migrateStudy } from "../src/lib/defaults";
import { useStudio } from "../src/lib/store";
import type { DecisionRecord, Study } from "../src/lib/types";

/*
 * D10 / S5: cases from the third and fourth independent reviews (23 September). A model never sets a gate,
 * and what blocks action is structural: the investigator's record of the work's ethics status, and approvals
 * their own facts leave open. What the model writes about approvals is listed for the investigator to check
 * and never settles anything, whatever its wording. All fixtures are invented; no patient data.
 */

const NEED = "Audit night-time opioid prescribing on the surgical wards.";
const S = () => useStudio.getState();

function study(localFacts: string[], rawNeed = NEED, constraints = ""): Study {
  return createStudy({ family: "qi-pdsa", setting: "Surgical wards", rawNeed, constraints, localFacts });
}

function decide(s: Study, extra: Record<string, unknown>) {
  const d = applyDecision({ kind: "narrow", statement: "Start with a feasibility check.", claimIds: [], criteria: [], gates: [], alternatives: ["do nothing"], ...extra }, s).decision!;
  return { d, e: evaluateDecision({ ...d, status: "accepted", selectionStatus: "accepted" }, s) };
}

const saysNoApproval = (e: { blockers: string[] }) => e.blockers.some((b) => b.startsWith("the decision says no approval is needed"));
// As the store's addGate writes it from the record form.
const ethicsRecord = (reason: string, status: "met" | "not-required" = "not-required") => ({ id: "rec", requirement: DETERMINATION_GATE.ethics, status, setBy: "investigator" as const, evidence: reason, record: true as const });
const accepted = (d: DecisionRecord): DecisionRecord => ({ ...d, status: "accepted", selectionStatus: "accepted" });

test("gate identity belongs to Meridian: duplicate or missing model ids become unique, and an ambiguous confirmation changes nothing", () => {
  const s = study(["REB-2026-188 approved the night-time opioid prescribing audit on 2026-08-01."]);
  const { d } = decide(s, {
    gates: [
      { id: "g1", requirement: "REB approval for the audit", status: "met", evidence: "REB-2026-188" },
      { id: "g1", requirement: "Signed data-sharing agreement with the pharmacy vendor", status: "unknown" },
      { requirement: "Unit manager approval of nurse time", status: "unknown" },
      { id: "gate-3", requirement: "Pharmacy sign-off", status: "unknown" },
    ],
  });
  const ids = d.gates.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, ids.join(","));
  // A stored decision from before this fix with two gates of one id: the store refuses to guess.
  const cur = S().create({ family: "qi-pdsa", setting: "Surgical wards", rawNeed: NEED, localFacts: ["REB-2026-188 approved the night-time opioid prescribing audit on 2026-08-01."] });
  const legacy: DecisionRecord = { ...d, gates: [{ ...d.gates[0], id: "dup" }, { ...d.gates[1], id: "dup" }] };
  S().mergeStage(cur.id, "design", { decisions: [legacy] });
  const r = S().setGate(cur.id, "latest", "dup", "met", "REB-2026-188");
  assert.equal(r.ok, false);
  assert.ok(S().studies.find((x) => x.id === cur.id)!.design.decisions[0].gates.every((g) => g.status !== "met"));
});

test("authorization claims are read in any common wording, and obligations are not", () => {
  const claims = [
    "This is quality improvement, not research, so no REB submission.",
    "No REB approval or patient consent is needed.",
    "No ethics or privacy review is required.",
    "The REB does not need to review this audit.",
    "There is no need to submit to the REB.",
    "The audit need not go to the REB.",
    "Consent need not be obtained.",
    "Patients do not need to consent.",
    "Ethics review is not applicable to this QI project.",
    "REB approval does not apply because this is QI.",
    "The project is considered exempt under TCPS 2 Article 2.5.",
    "It falls under the TCPS 2 quality improvement exemption.",
    "An IRB determination is not needed.",
    "Formal ethics review was deemed unnecessary.",
    "Consent waived because the data are de-identified.",
    "REB approval is not a prerequisite for this audit.",
    "The audit can go ahead without further approval.",
    "We can skip ethics review because this is QI.",
    "No DSA is needed with the vendor.",
    "The vendor does not need a DUA.",
    "Informed consent will not be sought.",
    "We need not wait for REB approval before starting.",
    "Run the count; it falls outside REB review because staff already see the data.",
  ];
  for (const t of claims) assert.ok(authorityClaims(t).length > 0, t);
  const plain = [
    "The REB must review this before data collection.",
    "Consent is required from every participant.",
    "No identifiable data leave the unit.",
    "No patient will be contacted without consent.",
    "Nothing will start without REB approval.",
    "Without consent from the custodian, no data can be extracted.",
    "This audit is not exempt from REB review.",
    "The project does not qualify for exemption from ethics review.",
    "A waiver of consent is not needed because written consent will be obtained.",
    "Consent is not required to be written; verbal consent is recorded by the nurse.",
    "We will not begin without ethics approval.",
    "The audit will not start until the REB approves it.",
    "Confirm whether the count needs no approval before starting.",
    "No REB approval has been obtained yet.",
    "Verbal consent for the phone follow-up; a waiver of documented consent is requested for chart abstraction.",
    "No full-board review is needed; delegated review applies.",
    "If the REB confirms that no review is needed, start in October.",
  ];
  for (const t of plain) assert.deepEqual(authorityClaims(t), [], t);
  // Each claim names its kinds of body.
  assert.deepEqual(authorityClaims("No REB approval or patient consent is needed.")[0].bodies.sort(), ["consent", "ethics"]);
  assert.deepEqual(authorityClaims("No data-sharing agreement is required with the vendor.")[0].bodies, ["data"]);
});

test("only the investigator's explicit ethics record makes a decision ready: no confirmed gate, crafted requirement, waived gate or decision kind stands in for it", () => {
  const s = study(["The unit manager approved 8 hours per week of nurse time for this audit (memo MM-2026-14)."]);
  const statement = "Run the chart audit now; it needs no REB approval and patient consent is not required because this is quality improvement.";
  const { d } = decide(s, { statement, gates: [{ id: "g1", requirement: "Unit manager approval of nurse time", status: "met", evidence: "memo MM-2026-14" }] });
  const confirmed = accepted({ ...d, gates: d.gates.map((g) => ({ ...g, status: "met" as const, setBy: "investigator" as const })) });
  assert.ok(saysNoApproval(evaluateDecision(confirmed, s)), "a confirmed nurse-time gate is not an ethics record");
  for (const requirement of [
    "REB approval for the chart audit",
    "Research ethics office determination that the project is quality improvement not requiring REB review",
    "Clinical ethics committee review of the DNACPR policy",
    "IRB approval at the coordinating site",
    "REB determination requested",
    "Nurse rota agreed for the audit weeks (REB not involved)",
  ]) {
    const g = { id: "gx", requirement, status: "met" as const, setBy: "investigator" as const, evidence: "seen" };
    assert.equal(evaluateDecision(accepted({ ...d, gates: [g] }), s).canAct, false, requirement);
  }
  // A confirmed ethics gate is offered as the reference for the record, never taken as it.
  const approvedGate = accepted({ ...d, gates: [{ id: "g3", requirement: "REB approval for the chart audit", status: "met", setBy: "investigator", evidence: "REB-2026-188" }] });
  assert.match(approvalReview(approvedGate, s).suggestedEthicsRecord ?? "", /REB-2026-188/);
  const waived = accepted({ ...d, gates: [{ id: "g2", requirement: "REB approval of the comparative trial protocol", status: "not-required", setBy: "investigator", evidence: "the trial was the rejected alternative" }] });
  assert.equal(evaluateDecision(waived, s).canAct, false);
  // Every kind needs the record; a decision that leads to no work records that in one step.
  for (const kind of ["defer", "refer", "no-new-study", "implementation"]) assert.equal(decide(s, { kind, statement: "Wait for the national audit." }).e.canAct, false, kind);
  const noWork = accepted({ ...decide(s, { kind: "defer", statement: "Wait for the national audit." }).d, gates: [ethicsRecord(NO_WORK_REASON)] });
  assert.equal(evaluateDecision(noWork, s).canAct, true);
  assert.equal(approvalReview(accepted(decide(s, { kind: "defer" }).d), s).leadsToNoWork, true);
  // The record: approved with its reference, or not required with the reason; the model's text stays listed.
  const recorded = accepted({ ...d, gates: [ethicsRecord("Registered with the QI office as quality improvement (QIS-2026-4)")] });
  const e = evaluateDecision(recorded, s);
  assert.equal(e.canAct, true, e.blockers.join(" | "));
  assert.ok(approvalReview(recorded, s).modelStatements.some((m) => m.kind === "authority" && m.bodies.includes("consent")));
});

test("no wording and no field lets the model make a plan ready without the ethics record", () => {
  const s0 = study(["The research nurse has 8 hours per week protected for this audit (letter NT-2026-3)."]);
  const texts = [
    "No REB review.", "There will be no REB review.", "REB approval (not required).", "It is an audit, not a research study.", "This falls under QI.",
    "Per TCPS 2 Art. 2.5, the audit proceeds as quality improvement.", "REB review is optional for QI.", "We will not involve the REB.", "IRB determination: NHSR.",
    "Classified as non-research by the QI office.", "Not needed (QI).", "None; unit-level QI.", "Ethics: none.", "IRB-exempt.", "Self-certified as service evaluation.",
    "Non è necessaria l'approvazione del comitato etico.", "Aucune approbation éthique n'est nécessaire.", "Ethics approval received.", "REB approval obtained on 2 September.",
  ];
  const fields: ((t: string) => Record<string, unknown>)[] = [
    (t) => ({ statement: `Run the chart audit. ${t}` }),
    (t) => ({ note: t }),
    (t) => ({ alternatives: [t] }),
    (t) => ({ criteria: [{ id: "k1", text: t, role: "justifies", status: "met" }] }),
    (t) => ({ gates: [{ id: "g1", requirement: "Research nurse time", status: "met", evidence: `Letter NT-2026-3. ${t}` }] }),
    (t) => ({ kind: "no-new-study", statement: t }),
  ];
  for (const t of texts) {
    for (const f of fields) assert.equal(decide(s0, f(t)).e.canAct, false, `${t} | ${JSON.stringify(f(t)).slice(0, 60)}`);
    for (const k of ["rebPath", "consent", "data", "risks", "limitations"] as const) {
      const withEthics: Study = { ...s0, ethics: { ...s0.ethics, [k]: t } };
      assert.equal(decide(withEthics, {}).e.canAct, false, `${k}: ${t}`);
    }
  }
});

test("approvals the investigator's own facts leave open block until acted on for that decision, and nothing else settles them", () => {
  const facts = [
    "REB approval REB-2026-311 is expected in October.",
    "Whether research use of the clinic dashboard data needs a data-use approval is unknown.",
    "The data custodian has not yet decided on linkage to the death register.",
    "The school board has not approved the combined consent form yet.",
    "Waiting on the pharmacy committee.",
    "Data-sharing agreement: draft.",
    "REB approval is outstanding.",
    "We need the pharmacy committee's sign-off before the rollout.",
    "The custodian has yet to sign.",
    "Application to the REB submitted 2026-09-01.",
  ];
  for (const f of facts) assert.equal(openApprovalItems(f).length, 1, f);
  for (const f of [
    "REB-2026-188 approved the audit on 2026-08-01.",
    "The REB approved the audit; its annual renewal is due in 2027.",
    "Consent forms are stored in the ward office.",
    "Consent was declined by 3 of 40 families in last year's pilot.",
    "The ward has 28 beds.",
  ]) assert.deepEqual(openApprovalItems(f), [], f);
  const s = study(["The data custodian has not yet decided on release of the pharmacy extract."]);
  const { d } = decide(s, { gates: [{ id: "g1", requirement: "Meeting with the data custodian booked", status: "met", evidence: "calendar" }] });
  const withRecords = accepted({
    ...d,
    gates: [
      { ...d.gates[0], status: "met", setBy: "investigator" },
      ethicsRecord("REB-2026-188 approved the audit", "met"),
      { id: "rec-d", requirement: DETERMINATION_GATE.data, status: "met", setBy: "investigator", evidence: "DC-2026-9" },
    ],
  });
  const e = evaluateDecision(withRecords, s);
  assert.equal(e.canAct, false, "records and gates do not settle the open fact");
  assert.ok(e.blockers.some((b) => /your own facts leave an approval open/.test(b)));
  // The investigator acts on the fact itself, for this decision, through the store (audited).
  const st = S().create({ family: "qi-pdsa", setting: "Surgical wards", rawNeed: NEED, localFacts: ["The pharmacy's approval of the new order set is expected in November."] });
  const cur = S().studies.find((x) => x.id === st.id)!;
  S().mergeStage(st.id, "design", { decisions: [applyDecision({ kind: "narrow", statement: "Audit one ward first.", claimIds: [], criteria: [], gates: [], alternatives: ["none"] }, cur).decision!] });
  assert.equal(S().acceptDecision(st.id, "latest").ok, true);
  assert.equal(S().addGate(st.id, "latest", DETERMINATION_GATE.ethics, "not-required", "QI registration QI-2026-054").ok, true);
  assert.equal(S().studies.find((x) => x.id === st.id)!.design.decisions[0].actionStatus, "blocked");
  const open = approvalReview(S().studies.find((x) => x.id === st.id)!.design.decisions[0], S().studies.find((x) => x.id === st.id)!).openItems;
  assert.equal(open.length, 1);
  assert.equal(S().settleOpenItem(st.id, "latest", open[0].text, "aside", "").ok, false, "a reason is required");
  assert.equal(S().settleOpenItem(st.id, "latest", open[0].text, "aside", "The audit does not use the new order set").ok, true);
  const after = S().studies.find((x) => x.id === st.id)!;
  assert.equal(after.design.decisions[0].actionStatus, "ready");
  assert.ok(after.audit.entries.some((x) => /set aside/.test(x.summary ?? "")));
});

test("the investigator's facts are offered for the record, never taken as it", () => {
  const offer = (facts: string[]) => approvalReview(accepted(decide(study(facts), {}).d), study(facts)).suggestedEthicsRecord;
  assert.match(offer(["The hospital quality committee registered the project as quality improvement on 2026-09-02 (registration QI-2026-054); no REB review is required."]) ?? "", /QI-2026-054/);
  assert.match(offer(["REB-2026-188 approved the night-time opioid prescribing audit on 2026-08-01."]) ?? "", /REB-2026-188/);
  assert.equal(offer(["We hope this audit needs no REB approval."]), undefined);
  assert.equal(offer(["The REB approved the staff wellbeing survey in 2025 (REB-2025-044)."]), undefined);
  assert.equal(offer(["REB-2024-310 approved our 2024 audit of discharge letters."]), undefined);
  assert.equal(offer(["The original trial was approved by the REB (REB-2023-9)."]), undefined);
  assert.equal(offer(["REB approval REB-2026-311 is expected in October."]), undefined);
  // Offered or not, the decision stays blocked until the investigator records it.
  const s = study(["REB-2026-188 approved the night-time opioid prescribing audit on 2026-08-01."]);
  assert.equal(evaluateDecision(accepted(decide(s, {}).d), s).canAct, false);
});

test("a local fact holds only when the investigator states it, and prose that states one is read", () => {
  const cases: [string, string][] = [
    ["Two funded research nurses are available for data collection", "It is unknown whether two funded research nurses are available for data collection."],
    ["Two funded research nurses are available for data collection", "If the grant is funded, two funded research nurses are available for data collection."],
    ["The custodian has approved the pharmacy extract", "We are waiting to hear whether the custodian has approved the pharmacy extract."],
    ["REB approval REB-2026-188 is in place", "Is REB approval REB-2026-188 is in place yet?"],
    ["The research nurse has protected time", "The research nurse has protected time only after the ward reopens in 2027."],
  ];
  for (const [claim, fact] of cases) assert.equal(localFactEstablished(claim, [fact]), false, fact);
  assert.equal(localFactEstablished("The research nurse has protected time", ["The research nurse has protected time for this audit."]), true);
  // An inference claim that states a permission is a local-fact proposal too.
  const s0 = study(["Whether the data custodian will release the pharmacy extract is unknown."]);
  const s: Study = { ...s0, scan: { ...s0.scan, claims: [{ id: "c-inf", text: "The data custodian has approved release of the pharmacy extract.", kind: "inference", sourceIds: [], uncertainty: "low", origin: "model" }] } };
  assert.equal(decide(s, { claimIds: ["c-inf"] }).e.canAct, false);
  // The decision statement itself: listed for the investigator, and the open fact keeps the plan blocked.
  const st = decide(s0, { statement: "Start next week with the pharmacy extract, which the data custodian has approved.", gates: [ethicsRecord("QI registration QI-2026-054")] });
  assert.equal(st.e.canAct, false);
  assert.ok(st.e.blockers.some((b) => /your own facts leave an approval open/.test(b)));
  assert.ok(approvalReview(accepted(st.d), s0).modelStatements.some((m) => m.kind === "local"));
  // The same statement is not listed when the investigator's facts say so.
  const ok = study(["The data custodian approved release of the pharmacy extract on 2026-08-01 (DC-2026-9)."]);
  const fine = decide(ok, { statement: "Start next week with the pharmacy extract, which the data custodian approved (DC-2026-9)." });
  assert.equal(approvalReview(accepted(fine.d), ok).modelStatements.some((m) => m.kind === "local"), false);
});

test("proposals are read again when the facts change, confirmations log the concerns shown, and withdrawn decisions cannot be accepted", () => {
  const s = S().create({ family: "qi-pdsa", setting: "Surgical wards", rawNeed: NEED, localFacts: ["REB-2026-188 approved the night-time opioid prescribing audit on 2026-08-01."] });
  const cur = S().studies.find((x) => x.id === s.id)!;
  const d = applyDecision({ kind: "narrow", statement: "Audit one ward first.", claimIds: [], criteria: [], gates: [{ id: "g1", requirement: "REB approval for the audit", status: "met", evidence: "REB-2026-188" }], alternatives: ["none"] }, cur).decision!;
  assert.deepEqual(d.gates[0].proposal?.concerns, []);
  S().mergeStage(s.id, "design", { decisions: [d] });
  S().addLocalFact(s.id, "The REB suspended approval REB-2026-188 on 2026-09-15.");
  const g = S().studies.find((x) => x.id === s.id)!.design.decisions[0].gates[0];
  assert.ok((g.proposal?.concerns ?? []).length > 0, "the suspension is shown before anyone confirms");
  assert.equal(S().setGate(s.id, "latest", "g1", "met", "REB-2026-188").ok, true);
  const audit = S().studies.find((x) => x.id === s.id)!.audit.entries;
  assert.ok(audit.some((e) => /confirming the model's proposal/.test(e.summary ?? "") && /concerns shown/.test(e.summary ?? "")));
  assert.equal(S().withdrawDecision(s.id, "latest").ok, true);
  assert.equal(S().acceptDecision(s.id, "latest").ok, false);
});

test("stored decisions are re-derived on load, never trusted as ready", () => {
  const s = study([]);
  const { d } = decide(s, { statement: "Run the chart audit now; it needs no REB approval." });
  const raw = { ...s, design: { ...s.design, decisions: [{ ...d, status: "accepted", selectionStatus: undefined, actionStatus: undefined }] } };
  const migrated = migrateStudy(raw);
  assert.equal(migrated.design.decisions[0].actionStatus, "blocked");
  assert.equal(refreshDecisionStatuses(migrated).design.decisions[0].actionStatus, "blocked");
});

test("Meridian's reading of the facts: refusals in any voice are concerns, approvals by a board are not", () => {
  const req = "REB approval for the night-time opioid prescribing audit";
  const concern = (fact: string) => gateSupport(req, "REB-2026-188", fact, NEED).concerns.length > 0;
  for (const f of [
    "REB approval REB-2026-188 was never granted.",
    "The REB did not approve REB-2026-188.",
    "REB-2026-188: not approved.",
    "The REB suspended approval REB-2026-188 on 2026-09-15.",
    "The REB revoked REB-2026-188 in September.",
    "REB-2026-188 is on hold.",
    "REB-2026-188 is the approval for Dr. Rossi's diabetes foot-care project.",
  ]) assert.ok(concern(f), f);
  for (const f of [
    "The audit was approved by the research ethics board on 2026-08-01 (REB-2026-188).",
    "Approval REB-2026-188 was granted by the Hamilton Integrated REB on 2026-08-01.",
    "The REB granted full approval to our team on 2026-08-01 (REB-2026-188).",
    "HiREB gave ethics approval to the night-time opioid prescribing audit (REB-2026-188).",
  ]) assert.equal(concern(f), false, f);
  assert.ok(gateSupport("Signed data-sharing agreement with the pharmacy", "DSA-2026-04", "Data-sharing agreement DSA-2026-04 was signed by the pharmacy but not by the hospital.", NEED).concerns.length > 0);
});

test("investigator sentences in a proposal are copied as written, and the reading stays fast on long texts", () => {
  const s = study(["REB-2026-188 approved the night-time opioid prescribing audit on 2026-08-01; the extract follows specification doc-2026-14."]);
  const out = applyAiResult("design", { recommended: "qi-pdsa", rationale: "x", alternatives: [], guidelines: [], whyNotMoreComplex: "x", decision: { kind: "narrow", statement: "Audit one ward.", claimIds: [], criteria: [], gates: [{ id: "g1", requirement: "REB approval for the audit", status: "met", evidence: "REB-2026-188" }], alternatives: ["none"] } }, "qi-pdsa", s);
  const decisions = (out.stagePatch as { decisions?: DecisionRecord[] }).decisions ?? [];
  const facts = decisions.at(-1)?.gates[0].proposal?.supportingFacts ?? [];
  assert.ok(facts.length > 0);
  assert.ok(facts.every((f) => !f.includes("⟦")), facts.join(" | "));
  const many = Array.from({ length: 2000 }, (_, i) => `REB-2026-188 approved this audit for ward ${i + 1}.`).concat("Approval REB-2026-188 was suspended on 2026-09-15.").join("\n");
  const t0 = Date.now();
  gateSupport("REB approval for the audit", "REB-2026-188", many, NEED);
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
});

test("final review: the record is the investigator's form only, open facts in more wordings, suggestions only for this work", () => {
  // A model gate that copies the record's wording is renamed, and confirming it is not a record.
  const s = study(["REB-2026-188 approved the night-time opioid prescribing audit on 2026-08-01."]);
  const r = applyDecision({ kind: "narrow", statement: "Audit one ward.", claimIds: [], criteria: [], gates: [{ id: "g1", requirement: DETERMINATION_GATE.ethics, status: "met", evidence: "REB-2026-188" }], alternatives: ["none"] }, s);
  assert.notEqual(r.decision!.gates[0].requirement, DETERMINATION_GATE.ethics);
  const confirmed = accepted({ ...r.decision!, gates: [{ ...r.decision!.gates[0], requirement: DETERMINATION_GATE.ethics, status: "met", setBy: "investigator" }] });
  assert.equal(evaluateDecision(confirmed, s).canAct, false, "without the record form's mark it is not a record");
  // Open facts in the wordings the last review found missing.
  for (const f of [
    "Research governance approval: requested 2026-08-20.",
    "An REB determination was requested on 2026-09-01.",
    "The nurse manager has not agreed to release staff time.",
    "No reply yet from the custodian.",
    "The network board meets in November 2026 to approve the design.",
    "Use of the activity data needs the data governance lead's approval, which has not been requested.",
  ]) assert.equal(openApprovalItems(f).length, 1, f);
  // A confirmed gate about other work, or a step still to come, is never offered as the reference.
  const gate = (requirement: string, evidence: string) => ({ id: "gx", requirement, status: "met" as const, setBy: "investigator" as const, evidence });
  const offered = (requirement: string, evidence: string) => approvalReview(accepted({ ...r.decision!, gates: [gate(requirement, evidence)] }), s).suggestedEthicsRecord;
  // (The investigator's own fact about this audit is offered instead.)
  assert.doesNotMatch(offered("REB approval of the original trial", "REB-2019-12") ?? "", /REB-2019-12/);
  assert.doesNotMatch(offered("IRB approval at the coordinating site", "IRB-44") ?? "", /IRB-44/);
  assert.doesNotMatch(offered("REB determination requested", "email 2026-09-01") ?? "", /requested/);
  assert.doesNotMatch(offered("REB approval of the staff survey", "REB-2025-044") ?? "", /REB-2025-044/);
  const ok = approvalReview(accepted({ ...r.decision!, gates: [gate("REB approval for the audit", "REB-2026-188")] }), s);
  assert.match(ok.suggestedEthicsRecord ?? "", /REB-2026-188/);
  assert.equal(ok.suggestionSource, "gate");
});

test("open facts in the investigator's everyday wording are read; plain facts about approvals given are not", () => {
  for (const f of [
    "The DUA is with legal for review.",
    "The consent form is still being revised at the REB's request.",
    "Awaiting the privacy impact assessment.",
    "The REB asked for changes; resubmission is planned.",
    "Conditional approval from the REB, subject to changes to the consent form.",
    "The research office is still reviewing the contract.",
    "The DSA was sent to the vendor for signature.",
    "The data custodian is reviewing our request.",
    "The data access request is in the queue at the data office.",
    "Our REB application is due to be heard at the November meeting.",
    "The school principals' consent to approach classes has not come back.",
    "The union has been asked to agree to the observation sessions.",
    "The REB application goes in next month.",
    "We still have to ask the custodian.",
    "The privacy office is looking at the request.",
    "The DSA is being negotiated.",
    "The consent materials are with the REB.",
    "We have applied to the REB; no decision yet.",
  ]) assert.equal(openApprovalItems(f).length, 1, f);
  for (const f of [
    "The custodian approved access to the surgical waiting list extract.",
    "Unknown-primary cases are excluded; the custodian approved the extract.",
    "The custodian approved the extract; the data have not yet arrived.",
    "The REB approved the audit; whether we publish is still to be decided.",
    "Our previous REB approval expired in 2024; this audit has its own approval REB-2026-188.",
  ]) assert.deepEqual(openApprovalItems(f), [], f);
  // At the record step the investigator sees every one of their statements about approvals.
  const s = study(["REB-2026-188 approved the night-time opioid prescribing audit on 2026-08-01.", "The ward has 28 beds."]);
  assert.deepEqual(approvalReview(accepted(decide(s, {}).d), s).approvalFacts, ["REB-2026-188 approved the night-time opioid prescribing audit on 2026-08-01."]);
});
