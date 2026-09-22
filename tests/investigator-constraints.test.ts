import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyAiResult } from "../src/lib/apply-ai";
import { formatPartialApplyNotice } from "../src/lib/contracts";
import { createStudy } from "../src/lib/defaults";
import { useStudio } from "../src/lib/store";
import { studyRevision } from "../src/lib/evidence/decision";

const TEXT =
  "No new data collection from patients; secondary use of existing hospital records only. Analyst time is capped at about 40 hours. Community pharmacy refill data are not available.";
const REPLACEMENT = "Plenty of funding; unlimited analyst time; community refill data available.";

const S = () => useStudio.getState();

function studyWithConstraints(text = TEXT) {
  return createStudy({
    family: null,
    setting: "450-bed teaching hospital",
    rawNeed: "Anticholinergic burden at discharge and injurious falls.",
    constraints: text,
  });
}

const problemPayload = {
  title: "Anticholinergic burden at hospital discharge and injurious falls in adults aged 70 and over",
  statement: "Older adults are discharged on anticholinergic medicines; injurious falls within 90 days are unknown locally.",
  whoAffected: "Adults aged 70 and over.",
  whatHurts: "Injurious falls after discharge.",
  currentPractice: "Burden scored inconsistently.",
  whyNow: "Consultants asking for routine review.",
  patientCenteredGoal: "Fewer fall-risk medicines without losing needed treatment.",
  summary: "Problem framed.",
};

test("model_null_does_not_erase_investigator_constraints", () => {
  const study = studyWithConstraints();
  const r = applyAiResult("problem", { ...problemPayload, constraints: null, family: null }, null, study);
  assert.equal(r.ok, true);
  assert.equal("constraints" in r.stagePatch, false);
  assert.equal(study.problem.constraints, TEXT);
  assert.ok(r.issues.some((i) => i.path === "constraints" && i.code === "dropped"));
  assert.equal(r.issues.some((i) => i.path === "constraints" && i.code === "cleared"), false);
});

test("model_empty_string_does_not_erase_investigator_constraints", () => {
  const study = studyWithConstraints();
  const r = applyAiResult("problem", { ...problemPayload, constraints: "" }, null, study);
  assert.equal(r.ok, true);
  assert.equal("constraints" in r.stagePatch, false);
  assert.ok(r.issues.some((i) => i.path === "constraints" && i.code === "dropped"));
});

test("model_invented_replacement_does_not_replace_investigator_constraints", () => {
  const study = studyWithConstraints();
  const r = applyAiResult("problem", { ...problemPayload, constraints: REPLACEMENT }, null, study);
  assert.equal(r.ok, true);
  assert.equal("constraints" in r.stagePatch, false);
  assert.ok(r.issues.some((i) => i.path === "constraints" && i.code === "dropped"));
});

test("model_omission_preserves_investigator_constraints_with_no_issue", () => {
  const study = studyWithConstraints();
  const r = applyAiResult("problem", problemPayload, null, study);
  assert.equal(r.ok, true);
  assert.equal("constraints" in r.stagePatch, false);
  assert.equal(r.issues.some((i) => i.path === "constraints"), false);
});

test("model_exact_echo_is_a_no_op_with_no_issue", () => {
  const study = studyWithConstraints();
  const r = applyAiResult("problem", { ...problemPayload, constraints: TEXT }, null, study);
  assert.equal(r.ok, true);
  assert.equal("constraints" in r.stagePatch, false);
  assert.equal(r.issues.some((i) => i.path === "constraints"), false);
});

test("illuminateApply_keeps_constraints_after_model_null_and_stays_ok", () => {
  const created = S().create({
    family: null,
    setting: "Ward",
    rawNeed: "Need.",
    constraints: TEXT,
  });
  const rev = studyRevision(S().studies.find((x) => x.id === created.id)!);
  const out = S().illuminateApply(created.id, "problem", { ...problemPayload, constraints: null, family: null }, rev);
  assert.equal(out.ok, true);
  const after = S().studies.find((x) => x.id === created.id)!;
  assert.equal(after.problem.constraints, TEXT);
  assert.ok((out.issues ?? []).some((i) => i.path === "constraints" && i.code === "dropped"));
});

test("human_mergeStage_clears_and_edits_constraints", () => {
  const created = S().create({
    family: "qi-pdsa",
    setting: "Ward",
    rawNeed: "Need.",
    constraints: TEXT,
  });
  S().mergeStage(created.id, "problem", { constraints: "" });
  assert.equal(S().studies.find((x) => x.id === created.id)!.problem.constraints, "");
  S().mergeStage(created.id, "problem", { constraints: "Fieldwork budget of 18,000." });
  assert.equal(S().studies.find((x) => x.id === created.id)!.problem.constraints, "Fieldwork budget of 18,000.");
});

test("model_owned_null_still_clears_scan_synthesis", () => {
  const r = applyAiResult("scan", { synthesis: null, items: [] }, "cohort", studyWithConstraints());
  assert.equal(r.stagePatch.synthesis, "");
  assert.ok(r.issues.some((i) => i.path === "synthesis" && i.code === "cleared"));
});

test("successful_partial_apply_notice_includes_dropped_path_and_message", () => {
  const study = studyWithConstraints();
  const r = applyAiResult("problem", { ...problemPayload, constraints: null, family: null }, null, study);
  assert.equal(r.ok, true);
  const notice = formatPartialApplyNotice(r.issues);
  assert.match(notice, /Applied with notes/);
  assert.match(notice, /constraints/);
  assert.match(notice, /not model-editable/);
  const created = S().create({ family: null, setting: "Ward", rawNeed: "Need.", constraints: TEXT });
  const rev = studyRevision(S().studies.find((x) => x.id === created.id)!);
  const out = S().illuminateApply(created.id, "problem", { ...problemPayload, constraints: "", family: null }, rev);
  assert.equal(out.ok, true);
  const last = S().studies.find((x) => x.id === created.id)!.lastIlluminate;
  assert.equal(last?.ok, true);
  assert.ok((last?.issues ?? []).some((i) => i.path === "constraints" && i.code === "dropped"));
  assert.match(formatPartialApplyNotice(last?.issues ?? []), /constraints: .*not model-editable/);
  const frameSrc = fs.readFileSync(new URL("../src/components/studio/stage-frame.tsx", import.meta.url), "utf8");
  assert.match(frameSrc, /toast\.warning/);
  assert.match(frameSrc, /data-meridian-partial-apply/);
  assert.match(frameSrc, /formatPartialApplyNotice/);
});
