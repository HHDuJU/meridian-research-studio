import { test } from "node:test";
import assert from "node:assert/strict";
import { createStudy } from "../src/lib/defaults";
import { classifyFamily } from "../src/lib/stages";
import { applyAiResult } from "../src/lib/apply-ai";
import { applyDecision } from "../src/lib/evidence/decision";
import { useStudio } from "../src/lib/store";

test("create_stores_inferred_basis_when_need_cues_a_design", () => {
  const need =
    "Sepsis bundle uptake is patchy across our five hospitals. I want to understand why. Not sure what kind of study this is.";
  const c = classifyFamily(need);
  assert.equal(c.family, "implementation");
  assert.equal(c.basis, "inferred");
  const s = createStudy({ family: c.family, setting: "s", rawNeed: need });
  assert.equal(s.family, "implementation");
  assert.equal(s.design.basis, "inferred");
});

test("create_stores_explicit_basis_when_need_names_a_design", () => {
  const need = "A pragmatic trial of a structured decision template for tumour boards across six hospitals.";
  const c = classifyFamily(need);
  assert.equal(c.family, "pragmatic-trial");
  assert.equal(c.basis, "explicit");
  const s = createStudy({ family: c.family, setting: "s", rawNeed: need });
  assert.equal(s.design.basis, "explicit");
});

test("create_unresolved_need_keeps_undetermined_family", () => {
  const s = createStudy({ family: null, setting: "s", rawNeed: "n" });
  assert.equal(s.family, null);
  assert.equal(s.design.basis, "unresolved");
});

test("recommendedFamily_comes_from_payload_not_study_family", () => {
  const study = createStudy({ family: "implementation", setting: "s", rawNeed: "uptake of the bundle" });
  const r = applyDecision(
    { kind: "pursue", statement: "Interview staff", claimIds: [], recommendedFamily: "qualitative" },
    study,
  );
  assert.equal(r.decision?.recommendedFamily, "qualitative");
  const applied = applyAiResult(
    "design",
    { recommended: "qualitative", rationale: "r", decision: { kind: "pursue", statement: "Interview staff", claimIds: [] } },
    study.family,
    study,
  );
  assert.equal((applied.stagePatch.decisions as { recommendedFamily?: string }[])?.at(-1)?.recommendedFamily, "qualitative");
  assert.equal(applied.studyPatch?.family, undefined);
});

test("screenHas_anyOf_is_exported", async () => {
  const { screenHas } = await import("../scripts/run-scenarios.mjs");
  assert.equal(screenHas("applied with notes; refused", { anyOf: ["kept", "refused", "not applied"] }), true);
});

test("investigator_family_select_sets_explicit_basis", () => {
  const S = () => useStudio.getState();
  const s = S().create({ family: null, setting: "s", rawNeed: "two designs: a cross-sectional study or a cohort" });
  assert.equal(s.design.basis, "unresolved");
  S().setFamily(s.id, "cross-sectional");
  const after = S().studies.find((x) => x.id === s.id)!;
  assert.equal(after.family, "cross-sectional");
  assert.equal(after.design.basis, "explicit");
  S().setFamily(s.id, null);
  const cleared = S().studies.find((x) => x.id === s.id)!;
  assert.equal(cleared.family, null);
  assert.equal(cleared.design.basis, "unresolved");
});

test("design_proposal_does_not_overwrite_investigator_basis", () => {
  const S = () => useStudio.getState();
  const s = S().create({ family: null, setting: "s", rawNeed: "n" });
  S().setFamily(s.id, "cross-sectional");
  const current = S().studies.find((x) => x.id === s.id)!;
  const applied = applyAiResult(
    "design",
    { recommended: null, rationale: "choice remains the investigator's", decision: { kind: "narrow", statement: "Stay with records", claimIds: [] } },
    current.family,
    current,
  );
  assert.equal(applied.stagePatch.basis, undefined);
  assert.equal(applied.studyPatch?.family, undefined);
});

test("omitted_recommendedFamily_is_absent_not_empty_string", () => {
  const study = createStudy({ family: null, setting: "s", rawNeed: "n" });
  const r = applyDecision({ kind: "defer", statement: "Wait for data", claimIds: [] }, study);
  assert.equal(r.decision?.recommendedFamily, null);
  const applied = applyAiResult(
    "design",
    { recommended: null, rationale: "r", decision: { kind: "defer", statement: "Wait for data", claimIds: [] } },
    study.family,
    study,
  );
  const last = (applied.stagePatch.decisions as { recommendedFamily?: string | null }[])?.at(-1);
  assert.equal(last?.recommendedFamily, null);
});

test("accept_without_recommended_family_keeps_unresolved_basis", () => {
  const S = () => useStudio.getState();
  const s = S().create({ family: null, setting: "s", rawNeed: "n" });
  const applied = applyDecision({ kind: "defer", statement: "Audit the pathway", claimIds: [] }, s);
  S().mergeStage(s.id, "design", { decisions: [applied.decision!] });
  const r = S().acceptDecision(s.id, "latest");
  assert.equal(r.ok, true);
  const after = S().studies.find((x) => x.id === s.id)!;
  assert.equal(after.family, null);
  assert.equal(after.design.basis, "unresolved");
  assert.equal(after.design.decisions[0].selectionStatus, "accepted");
});
