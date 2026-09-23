import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDecision, evaluateDecision } from "../src/lib/evidence/decision";
import { DETERMINATION_GATE } from "../src/lib/evidence/authority";
import { createStudy } from "../src/lib/defaults";
import { useStudio } from "../src/lib/store";
import type { Study } from "../src/lib/types";

/*
 * D10 / S5: cases from the independent review of the first D10 version (23 September). The first group
 * got a model "met" or an exemption through that version; the second group was refused by it although
 * the investigator's facts support the gate. All fixtures are invented; no patient data.
 */

function study(localFacts: string[], rawNeed = "Audit night-time opioid prescribing on the surgical wards.", constraints = ""): Study {
  return createStudy({ family: "qi-pdsa", setting: "Surgical wards", rawNeed, constraints, localFacts });
}

function gate(s: Study, requirement: string, evidence: string) {
  const d = applyDecision(
    { kind: "narrow", statement: "Start with a feasibility check.", claimIds: [], criteria: [], gates: [{ id: "g1", requirement, status: "met", evidence }], alternatives: ["do nothing"] },
    s,
  ).decision!;
  const e = evaluateDecision({ ...d, status: "accepted", selectionStatus: "accepted" }, s);
  return {
    status: d.gates[0].status,
    grounding: d.gates[0].grounding ?? "",
    concerns: d.gates[0].proposal?.concerns ?? [],
    supporting: d.gates[0].proposal?.supportingFacts ?? [],
    canAct: e.canAct,
    blockers: e.blockers,
  };
}

function decide(s: Study, extra: Record<string, unknown>) {
  const d = applyDecision({ kind: "narrow", statement: "Start with a feasibility check.", claimIds: [], criteria: [], gates: [], alternatives: ["do nothing"], ...extra }, s).decision!;
  return evaluateDecision({ ...d, status: "accepted", selectionStatus: "accepted" }, s);
}

// Since the confirmation design no model "met" sets a gate; these cases also check that Meridian's
// reading of the facts flags a concern for the investigator.
const refused = (label: string, r: { status: string; canAct: boolean; concerns: string[] }) => {
  assert.equal(r.status, "unknown", label);
  assert.equal(r.canAct, false, label);
  assert.ok(r.concerns.length > 0, `${label}: a concern is shown`);
};

test("negated, pending, uncertain, questioning and needed facts never ground a model 'met'", () => {
  const need02 = "Describe opioid tapering outcomes in the clinic registry.";
  const perm = "Permission for secondary research use of the clinic registry data";
  refused("01a", gate(study(["One nurse is employed on the ward; no research time is allocated to this project."], "Reduce missed post-discharge phone calls on the surgical ward."), "Research nurse time allocated to this project", "Research time is allocated to this project (investigator local facts)"));
  refused("02a", gate(study(["We do not have permission for secondary research use of the clinic registry data."], need02), perm, `${perm} (investigator local facts)`));
  refused("02b", gate(study(["There is no data-use agreement for the clinic registry."], need02), "Data-use agreement for the clinic registry", "Data-use agreement for the clinic registry"));
  refused("02c", gate(study([`${perm} has not been sought.`], need02), perm, perm));
  refused("02d", gate(study([`${perm}: not known.`], need02), perm, perm));
  refused("02e", gate(study([`Do we have ${perm.toLowerCase()}?`], need02), perm, perm));
  refused("02f", gate(study(["I don't know if the data custodian has approved secondary research use of the registry."], need02), "Data custodian approval for secondary research use of the registry", "The data custodian has approved secondary research use of the registry"));
  refused("02g", gate(study(["REB approval REB-2026-311 is expected in October."], need02), "REB approval for the tapering study", "REB-2026-311"));
  refused("02h", gate(study(["We applied for REB approval (REB-2026-311) and expect it to be approved in October."], need02), "REB approval for the tapering study", "REB-2026-311"));
  refused("02i", gate(study(["REB approval REB-2026-311 is under consideration."], need02), "REB approval for the tapering study", "REB-2026-311"));
  refused("02j", gate(study([], need02, "Any data extraction must be approved by the data custodian."), "Data custodian approval for the data extraction", "Any data extraction must be approved by the data custodian"));
  refused("02k", gate(study(["We need REB approval before starting the audit."], need02), "REB approval before starting the audit", "REB approval before starting the audit: confirmed"));
  refused("02l", gate(study(["The research nurse no longer has funded research time."], need02), "Funded research nurse time", "The research nurse ... has funded research time"));
});

test("the need text never grounds a gate, and anchors that cannot be tied to one statement refuse it", () => {
  const s03 = study(["The block registry holds treated patients only: it records patients who received a nerve block."], "Estimate attrition between referral and treatment for the regional block service.");
  refused("03a", gate(s03, "Block registry records all referred candidates, treated and non-treated", "The block registry records referred candidates and treated patients, both of which are needed to estimate attrition between referral and treatment."));
  refused("03b", gate(s03, "Registry records non-treated candidates", "The registry records non-treated candidates; it records patients who received a nerve block"));
  const s02 = study(["Permission for secondary research use of the clinic registry data is unknown."], "Describe opioid tapering outcomes in the clinic registry.");
  refused("02 need", gate(s02, "Clinic registry data available for secondary research use", "Describe opioid tapering outcomes in the clinic registry; the registry data are available for secondary research use."));
  refused("05e", gate(study(["The ketamine registry has REB approval.", "40 night-time audits were done last year."]), "REB approval for the night-time opioid prescribing audit", "REB approval 40"));
});

test("approvals for another study, protocol or scope do not meet this study's gate", () => {
  refused("05a", gate(study(["REB approval REB-2025-077 covers protocol CARE-KET-01 (the ketamine registry) only; any other use needs a new application."]), "REB approval for this study", "REB-2025-077 (investigator local facts)"));
  refused("05b", gate(study(["Protocol CARE-KET-01 (the ketamine registry) was approved under REB-2025-077."]), "REB approval for the night-time opioid prescribing audit", "REB-2025-077"));
  refused("05c", gate(study(["REB-2025-077 approved the ketamine registry study."]), "REB approval for the night-time opioid prescribing audit", "REB-2025-077"));
  refused("05d", gate(study(["REB approval REB-2025-077 covers the ketamine registry only."]), "REB approval for this study", "REB-2025-077"));
  for (const fact of [
    "Our previous opioid audit was approved by the REB (REB-2024-310).",
    "Last year’s audit was approved by the REB (REB-2024-310).",
    "The REB approved our previous study (REB-2024-310), and this project builds on it.",
    "Our previous study was approved by the REB (REB-2024-310); this review took six weeks.",
    "REB-2025-077 approved study CARE-KET-01.",
  ]) {
    const evidence = fact.includes("REB-2024-310") ? "REB-2024-310" : "REB-2025-077";
    refused(fact, gate(study([fact]), "REB approval for this audit", evidence));
  }
  // A title set by a model reply is not the study's own description.
  const s = study(["REB approval REB-2025-077 covers protocol CARE-KET-01 (the ketamine registry) only; any other use needs a new application."]);
  refused("title", gate({ ...s, title: "Night-time opioid prescribing audit (protocol CARE-KET-01)" }, "REB approval for the night-time opioid prescribing audit", "REB-2025-077 (investigator local facts)"));
});

test("conflicting facts keep a capacity gate open whatever the wording", () => {
  const need06 = "Follow up patients 6 months after radiofrequency ablation.";
  const letter = "Allocation letter (2026-06-01): the research nurse has 8 hours per week protected for this project.";
  const ev06 = "Allocation letter: 8 hours per week protected for this project";
  const req06 = "Protected research nurse time for follow-up calls";
  const roster = (t: string) => study([letter, t], need06);
  const zero = "Staffing roster (2026-09-01): the research nurse has zero protected research time this term.";
  refused("06a", gate(roster(zero), "Nurse hours for follow-up calls", ev06));
  refused("06b", gate(roster(zero), "Protected research nurse time for follow-up calls to ablation patients at six months", ev06));
  refused("06c", gate(roster("Staffing roster (2026-09-01): the research nurse has zero protected research time this term, which may change in January."), req06, ev06));
  refused("06d", gate(roster("Staffing roster (2026-09-01): the research nurse has zero protected research time this term, as she is needed on the wards."), req06, ev06));
  refused("06e", gate(roster("Staffing roster (2026-09-01): the research nurse no longer has protected research time."), req06, ev06));
  refused("06f", gate(roster("Staffing roster (2026-09-01): the research nurse has 4 hrs per week protected for research this term."), req06, ev06));
  refused("06g", gate(roster("Staffing roster (2026-09-01): the research nurse's protected research time was cancelled."), req06, ev06));
  refused("06h", gate(study(["The allocation letter gave the research nurse 8 hours per week protected for this project, but the September roster shows zero protected research time."], need06), req06, "8 hours per week protected for this project"));
  refused("06i", gate(roster("Staffing roster (2026-09-01): protected research time for the research nurse = 0 h/week."), req06, ev06));
  refused("06j", gate(roster("Staffing roster (2026-09-01): the research nurse does not have protected research time this term."), req06, ev06));
});

test("'no approval needed' is blocked in every wording unless the investigator stated that exemption for this work", () => {
  const need04 = "Count patients on high-dose opioids to plan a tapering pathway.";
  const fact04 = "Whether research use of the clinic dashboard data needs a data-use approval is unknown. Clinic staff can view the dashboard for patient care.";
  const s04 = study([fact04], need04);
  const blockedBy = (e: { blockers: string[] }) => e.blockers.some((b) => /no approval is needed/.test(b));
  for (const statement of [
    "Run a preliminary research count of high-dose opioid patients from the clinic dashboard; this doesn’t need approval because staff already see the data for care.",
    "Run a preliminary research count from the clinic dashboard; approval isn't needed because staff already see the data for care.",
    "Run a preliminary research count from the clinic dashboard; no REB submission is needed because staff already see the data for care.",
    "Run a preliminary research count from the clinic dashboard without ethics approval, since staff already see the data for care.",
    "Run a preliminary research count from the clinic dashboard; it falls outside REB review because staff already see the data for care.",
    "Run a preliminary research count from the clinic dashboard; it qualifies for exemption from ethics review.",
    "Run a preliminary research count from the clinic dashboard; there is no requirement for ethics review.",
    "Run a preliminary research count from the clinic dashboard; approval: not required.",
    "Run a preliminary research count from the clinic dashboard; this needs no approval because staff already see the data for care, and if the count is high we escalate.",
    "Run a preliminary research count from the clinic dashboard now; it needs no approval (check that the export works first).",
    "Run a preliminary research count from the clinic dashboard; REB review won't be required.",
  ]) {
    const e = decide(s04, { statement });
    assert.equal(e.canAct, false, statement);
    assert.ok(blockedBy(e), statement);
  }
  // The investigator's exemption must be for the same work.
  const other = study([fact04, "Staff interviews need no consent form because they are part of routine service evaluation."], need04);
  assert.ok(blockedBy(decide(other, { statement: "Run a preliminary research count of high-dose opioid patients from the clinic dashboard; this needs no approval because staff already see the data for care." })));
  const split = study(["The REB said the staff survey does not need approval, but the dashboard count does."], need04);
  assert.ok(blockedBy(decide(split, { statement: "Run a preliminary research count of high-dose opioid patients from the clinic dashboard; this needs no approval." })));
  // A model claim the decision rests on carries the same assertion.
  const withClaim = {
    ...s04,
    scan: { ...s04.scan, claims: [{ id: "c-ex", text: "A preliminary research count from the clinic dashboard needs no approval because staff already see the data for care.", kind: "assumption" as const, sourceIds: [], uncertainty: "low" as const, origin: "model" as const }] },
  };
  assert.ok(blockedBy(decide(withClaim, { statement: "Run the preliminary research count from the clinic dashboard now.", claimIds: ["c-ex"] })));
  // Clinical access is not research permission, however it is worded.
  const d = study(["Whether research use of the clinic dashboard data needs a data-use approval is unknown.", "Clinic staff are authorised to access the dashboard for direct patient care."], need04);
  refused("04d", gate(d, "Authorisation for research use of the dashboard data", "Clinic staff are authorised to access the dashboard for direct patient care"));
  refused("04e", gate(d, "Authorised access to the dashboard data for the count", "Clinic staff are authorised to access the dashboard for direct patient care"));
  const f = study(["Clinic staff are authorised to view the dashboard for patient care; research use has not been discussed with the custodian."], need04);
  refused("04f", gate(f, "Authorisation for research use of the dashboard data", "Clinic staff are authorised to view the dashboard"));
  refused("04 requirement", gate(study(["Clinic staff are allowed to view the dashboard for patient care."], need04), "Confirmation that the dashboard count needs no approval", "Clinic staff are allowed to view the dashboard for patient care"));
});

test("a model assumption that asserts local capacity is a proposal, not a fact", () => {
  const s = study(["One nurse is employed on the ward; no research time is allocated to this project."], "Reduce missed post-discharge phone calls on the surgical ward.");
  const withClaim = { ...s, scan: { ...s.scan, claims: [{ id: "c-n", text: "Two funded research nurses are available for data collection.", kind: "assumption" as const, sourceIds: [], uncertainty: "low" as const, origin: "model" as const }] } };
  const e = decide(withClaim, { statement: "Use the nurses.", claimIds: ["c-n"] });
  assert.equal(e.canAct, false);
  assert.ok(e.blockers.some((b) => /local fact the model proposed/.test(b)));
  // A model claim that repeats the investigator's own fact word for word is established.
  const fact = "The surgical ward has 48 beds and admits about 20 patients per week.";
  const s2 = study([fact], "Reduce missed post-discharge phone calls on the surgical ward.");
  const c2 = { ...s2, scan: { ...s2.scan, claims: [{ id: "c-beds", text: fact, kind: "local-fact" as const, sourceIds: [], uncertainty: "low" as const, origin: "model" as const }] } };
  assert.equal(decide(c2, { statement: "Pilot the call script on the surgical ward.", claimIds: ["c-beds"] }).blockers.some((b) => /model proposed/.test(b)), false);
});

test("facts that support the gate are not refused (false refusals of the first version)", () => {
  // Supported: a proposal with no concerns and the supporting fact shown; the investigator confirms it.
  const met = (label: string, facts: string[], req: string, ev: string, rawNeed?: string) => {
    const r = gate(study(facts, rawNeed), req, ev);
    assert.equal(r.status, "unknown", label);
    assert.deepEqual(r.concerns, [], label);
    assert.ok(r.supporting.length > 0, label);
  };
  met("F1", ["The REB approved the night-time opioid prescribing audit on 2026-08-01 (REB-2026-188)."], "Ethics approval granted for the night-time opioid prescribing audit", "REB-2026-188");
  met("F2", ["The research nurse has 8 hours per week protected for this audit (letter from the unit manager, 2026-06-01)."], "Research nurse time allocated to the audit", "The research nurse has 8 hours per week protected for this audit");
  met("F4", ["REB approval REB-2026-188 was granted on 2026-08-01 for the audit of opioid prescribing in patients with cancer of unknown primary."], "REB approval for the audit", "REB-2026-188", "Audit night-time opioid prescribing in patients with cancer of unknown primary.");
  met("F5", ["REB approval REB-2026-188 was granted on 2026-08-01; whether the pharmacy signs the data-sharing form is unknown."], "REB approval for the night-time opioid prescribing audit", "REB-2026-188");
  met("F6", ["The block registry records whether each referred patient received a nerve block, for all referrals since 2024."], "Block registry records all referred patients, treated and not treated", "The block registry records whether each referred patient received a nerve block", "Estimate attrition between referral and treatment for the regional block service.");
  met("F7", ["REB approval REB-2026-188 was granted on 2026-08-01; data may be accessed only by the study team."], "REB approval for the night-time opioid prescribing audit", "REB-2026-188");
  met("F8", ["REB-2026-188 approved this audit as a retrospective chart review only."], "REB approval for the night-time opioid prescribing audit", "REB-2026-188");
  met("F9", ["The parent registry's steering committee approved data access for this sub-study (DA-2026-07)."], "Data access approval for the night-time opioid prescribing audit", "DA-2026-07");
  met("F10", ["The data-use agreement DUA-2026-12 with pharmacy was signed on 2026-07-01; ethics review is a separate application."], "Signed data-use agreement with pharmacy", "DUA-2026-12");
  met("F11", ["The research ethics committee gave a favourable opinion (REC 26/NW/0142) on 2026-08-01."], "Research ethics committee approval for the audit", "REC 26/NW/0142");
  met("F12", ["Data-use agreement DUA-2026-12 is signed, excluding free-text notes."], "Signed data-use agreement for the prescribing extract", "DUA-2026-12");
  met("F13", ["Ethics approval REB-2026-188 was granted for the TBC screening audit on 2026-08-01."], "Ethics approval for the TBC screening audit", "REB-2026-188", "Audit TBC screening uptake in the respiratory clinic.");
  const need06 = "Follow up patients 6 months after radiofrequency ablation.";
  const letter = "Allocation letter (2026-06-01): the research nurse has 8 hours per week protected for this project.";
  const ev06 = "Allocation letter: 8 hours per week protected for this project";
  met("F14", [letter, "The research nurse works 37.5 hours per week in total, of which the protected research time is part."], "Protected research nurse time for follow-up calls", ev06, need06);
  met("F15", [letter, "The ward's second research nurse has 16 hours per week protected for the diabetes trial."], "Protected research nurse time for follow-up calls", ev06, need06);
  met("own protocol in the description", ["REB-2026-188 approved protocol NOP-2026-02 on 2026-08-01."], "REB approval for the night-time opioid prescribing audit", "REB-2026-188", "Audit night-time opioid prescribing on the surgical wards (protocol NOP-2026-02).");
  // Kept refused on purpose: a protocol number the study's own description never gives. The message says how to resolve it.
  const f3 = gate(study(["REB-2026-188 approved protocol NOP-2026-02 on 2026-08-01."]), "REB approval for the night-time opioid prescribing audit", "REB-2026-188");
  assert.equal(f3.status, "unknown");
  assert.match(f3.concerns.join(" "), /add the number to the study's description or confirm the gate yourself/);
});

test("Meridian's further readings flag an approval of something else and the wrong kind of body, and stay quiet on allocations", () => {
  const opioid = "Audit night-time opioid prescribing on the surgical wards.";
  // An approval whose object is another thing.
  const other = gate(study(["REB-2026-188 approved the dashboard redesign on 2026-08-01."], opioid), "REB approval for the night-time opioid prescribing audit", "REB-2026-188");
  assert.equal(other.status, "unknown");
  assert.match(other.concerns.join(" "), /the approval in your fact is for "dashboard redesign"/);
  // The wrong kind of body.
  const body = gate(study(["Data-sharing agreement DSA-2026-04 with the pharmacy was signed on 2026-07-01."], opioid), "Research ethics board approval for the audit", "DSA-2026-04");
  assert.match(body.concerns.join(" "), /asks for an ethics approval, and your fact is about a data-sharing agreement/);
  // No concern: facts from the scenario bank that meet their gates (sc-026, sc-033, sc-057, sc-093, sc-097).
  const quiet = (label: string, facts: string[], req: string, ev: string, rawNeed?: string, constraints?: string) => {
    const r = gate(study(facts, rawNeed, constraints), req, ev);
    assert.equal(r.status, "unknown", label);
    assert.deepEqual(r.concerns, [], label);
    assert.ok(r.supporting.length > 0, label);
  };
  quiet("vets", [], "Vet time for planning visits and observation", "Investigator constraint: two practice vets can each give one half-day a week from January to June 2027", "Improve lameness scoring on dairy farms.", "Two practice vets can each give one half-day a week from January to June 2027.");
  quiet("forum", ["The quality committee has scheduled the one-hour pathway proposal for its meeting on 2 December 2026 (item QC-2026-51)."], "A decision forum and date for the report", "Quality committee item QC-2026-51 for 2 December 2026", "Decide whether to adopt a one-hour chest pain pathway.");
  quiet("union", ["The nurses' union local agreed in writing on 2026-09-08 to 20 minutes of paid time for survey completion (letter UL-114)."], "Union agreement to paid time for survey completion", "Union letter UL-114 dated 2026-09-08 granting 20 minutes of paid time", "Survey inpatient nurses about staffing and missed care.");
  quiet("reviewers", ["The department of anaesthesia approved 60 hours for each of two residents between November 2026 and April 2027 (memo ANES-EDU-2026-19)."], "Reviewer time for dual screening and charting", "Department memo ANES-EDU-2026-19 approving 60 hours for each of two residents", "Map evidence on preoperative anaemia before joint replacement.");
  quiet("approved allocation", ["The department of anaesthesia approved 60 hours for each of two residents between November 2026 and April 2027 (memo ANES-EDU-2026-19)."], "Approved reviewer time for dual screening", "ANES-EDU-2026-19", "Map evidence on preoperative anaemia before joint replacement.");
});

test("the investigator resolves a refused gate directly, and the audit log says so", () => {
  const S = () => useStudio.getState();
  const s = S().create({ family: "qi-pdsa", setting: "Surgical wards", rawNeed: "Audit night-time opioid prescribing on the surgical wards.", localFacts: ["REB-2026-188 approved protocol NOP-2026-02 on 2026-08-01."] });
  const cur = S().studies.find((x) => x.id === s.id)!;
  const d = applyDecision({ kind: "narrow", statement: "Audit one ward first.", claimIds: [], criteria: [], gates: [{ id: "g1", requirement: "REB approval for the audit", status: "met", evidence: "REB-2026-188" }], alternatives: ["none"] }, cur).decision!;
  assert.equal(d.gates[0].status, "unknown");
  S().mergeStage(s.id, "design", { decisions: [d] });
  assert.equal(S().acceptDecision(s.id, "latest").ok, true);
  assert.equal(S().setGate(s.id, "latest", "g1", "met", "Protocol NOP-2026-02 is this audit (REB-2026-188)").ok, true);
  assert.ok((S().studies.find((x) => x.id === s.id)!.audit.entries ?? []).some((e) => /the model's evidence was: REB-2026-188/.test(e.summary ?? "")));
  // D10 / S5: the work's ethics status is the investigator's explicit record.
  assert.equal(S().addGate(s.id, "latest", DETERMINATION_GATE.ethics, "met", "REB-2026-188 approved protocol NOP-2026-02 (this audit)").ok, true);
  const after = S().studies.find((x) => x.id === s.id)!;
  assert.equal(after.design.decisions.at(-1)!.actionStatus, "ready");
});
