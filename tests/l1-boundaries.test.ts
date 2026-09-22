import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyAiResult } from "../src/lib/apply-ai";
import { createStudy, migrateStudy } from "../src/lib/defaults";
import { studyRevision } from "../src/lib/evidence/decision";
import { FAMILY_BY_ID, familyOf, guessFamily } from "../src/lib/stages";
import { studioAvailability, useStudio } from "../src/lib/store";
import { SEED_STUDIES } from "../src/lib/seed";
import { illuminateDecision } from "../src/lib/illuminate";
import type { Study } from "../src/lib/types";

const S = () => useStudio.getState();
const bitsSrc = fs.readFileSync(new URL("../src/components/studio/bits.tsx", import.meta.url), "utf8");
const studioSrc = fs.readFileSync(new URL("../src/components/studio/studio-view.tsx", import.meta.url), "utf8");
const frameSrc = fs.readFileSync(new URL("../src/components/studio/stage-frame.tsx", import.meta.url), "utf8");
const routeSrc = fs.readFileSync(new URL("../src/routes/studio.$studyId.tsx", import.meta.url), "utf8");

test("handler_passes_study_and_refuses_not_ok", () => {
  assert.match(frameSrc, /illuminateApply/);
  assert.match(frameSrc, /studyRevision\(study\)/);
  const study = createStudy({ family: "cohort", setting: "s", rawNeed: "n" });
  study.scan.claims = [{ id: "c1", text: "local", kind: "local-fact", sourceIds: [], uncertainty: "low" }];
  const payload = {
    recommended: "cohort",
    rationale: "Follow exposure over time.",
    decision: { kind: "defer", statement: "Wait for more data.", claimIds: ["c1"], criteria: [], gates: [], alternatives: ["Start now"] },
  };
  const withStudy = applyAiResult("design", payload, study.family, study);
  assert.equal(withStudy.ok, true);
  assert.equal((withStudy.stagePatch.decisions as unknown[]).length, 1);
  const without = applyAiResult("design", payload, study.family);
  assert.ok(without.issues.some((i) => i.path === "decision" && i.code === "dropped"));
  assert.equal("decisions" in without.stagePatch, false);

  const created = S().create({ family: "cohort", setting: "s", rawNeed: "n" });
  const refused = S().illuminateApply(created.id, "design", "not-an-object", studyRevision(created));
  assert.equal(refused.ok, false);
  const after = S().studies.find((x) => x.id === created.id)!;
  assert.equal(after.completedStages.includes("design"), false);
  assert.equal(after.design.rationale, "");
});

test("unchanged_study_accepts_reply", () => {
  assert.match(frameSrc, /studyRevision\(study\)/);
  assert.doesNotMatch(frameSrc, /evidenceRevision\(study\)/);
  const created = S().create({ family: "cohort", setting: "s", rawNeed: "n" });
  const before = S().studies.find((x) => x.id === created.id)!;
  const rev = studyRevision(before);
  const applied = S().illuminateApply(
    created.id,
    "problem",
    { statement: "applied statement", title: "New title", summary: "ok" },
    rev,
  );
  assert.equal(applied.ok, true);
  const after = S().studies.find((x) => x.id === created.id)!;
  assert.equal(after.problem.statement, "applied statement");
  assert.equal(after.title, "New title");
  assert.ok(after.completedStages.includes("problem"));
  assert.ok(after.audit.entries.some((e) => e.kind === "generate"));
});

test("intervening_edit_refuses_reply", () => {
  const created = S().create({ family: "rct", setting: "s", rawNeed: "n" });
  const before = S().studies.find((x) => x.id === created.id)!;
  const rev = studyRevision(before);
  S().mergeStage(created.id, "problem", { statement: "investigator edit between request and reply" });
  const applied = S().illuminateApply(
    created.id,
    "problem",
    { statement: "stale model text", title: "Hijack" },
    rev,
  );
  assert.equal(applied.ok, false);
  assert.equal(applied.reason, "stale");
  const after = S().studies.find((x) => x.id === created.id)!;
  assert.equal(after.problem.statement, "investigator edit between request and reply");
  assert.notEqual(after.title, "Hijack");
  assert.equal(after.completedStages.includes("problem"), false);
  assert.ok(after.audit.entries.some((e) => /stale|refused/i.test(e.summary)));
  assert.equal(
    after.audit.entries.some((e) => e.kind === "generate" && /stale model/i.test(e.summary)),
    false,
  );
});

test("late_response_refused_after_edit", () => {
  const created = S().create({ family: "rct", setting: "s", rawNeed: "n" });
  const rev = studyRevision(S().studies.find((x) => x.id === created.id)!);
  S().mergeStage(created.id, "problem", { statement: "investigator edit while the model was working" });
  const late = S().mergeStageIfRevision(created.id, "problem", { statement: "stale model text" }, rev);
  assert.equal(late.applied, false);
  const s = S().studies.find((x) => x.id === created.id)!;
  assert.equal(s.problem.statement, "investigator edit while the model was working");
  const applied = S().illuminateApply(created.id, "problem", { statement: "too late" }, rev);
  assert.equal(applied.ok, false);
  assert.equal(applied.reason, "stale");
});

test("needs_review_not_counted_complete", () => {
  assert.match(studioSrc, /needsReview/);
  assert.match(studioSrc, /review required/);
  const created = S().create({ family: "rct", setting: "s", rawNeed: "n" });
  S().confirmEmptySearch(created.id);
  for (const st of ["problem", "scan", "map"] as const) S().markComplete(created.id, st);
  S().mergeStage(created.id, "problem", { statement: "changed after map was done" });
  const s = S().studies.find((x) => x.id === created.id)!;
  assert.ok(s.needsReview.includes("scan"));
  assert.ok(s.needsReview.includes("map"));
  const done = s.completedStages.filter((st) => !(s.needsReview ?? []).includes(st)).length;
  assert.equal(done, 1);
  assert.ok(s.completedStages.includes("map"));
});

test("seeds_pass_through_migration_on_fresh_and_restore", () => {
  const raw = {
    id: "seed-like",
    title: "Raw seed",
    subtitle: "no schema",
    family: "cohort",
    setting: "Ontario",
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    currentStage: "scan",
    completedStages: ["problem"],
    problem: { rawNeed: "n", statement: "keep", whoAffected: "", whatHurts: "", currentPractice: "", whyNow: "", constraints: "", patientCenteredGoal: "" },
    scan: {
      query: "q",
      sourcesConsulted: [],
      items: [{ id: "ev-1", title: "Paper", authors: "A", year: 2019, source: "J", kind: "rct", grade: "moderate", methodQuality: 70, relevance: 80, notes: "", verification: "landmark", doi: "10.5555/x", contextTags: [], keyFindings: "f", limitations: "l" }],
      gradeOverall: "low",
      gradeRationale: "",
      synthesis: "",
    },
    audit: { entries: [], openFixes: [], improvementNotes: "" },
  };
  const migrated = migrateStudy(raw);
  assert.equal(migrated.schemaVersion, 4);
  assert.deepEqual(migrated.needsReview, []);
  assert.equal(migrated.scan.items[0].provenance.status, "unverified");
  assert.notEqual(migrated.scan.items[0].provenance.status, "verified");
  for (const seed of SEED_STUDIES) {
    assert.equal(seed.schemaVersion, 4);
    assert.ok(Array.isArray(seed.needsReview));
    for (const item of seed.scan.items) {
      assert.ok(item.provenance);
      assert.notEqual(item.provenance.status, "verified");
    }
  }
  const before = S().studies.length;
  S().restoreSeeds();
  assert.ok(S().studies.length >= before);
  const restored = S().studies.find((x) => x.id === SEED_STUDIES[0].id);
  assert.ok(restored);
  assert.equal(restored!.schemaVersion, 4);
});

test("unresolved_family_renders_undetermined_state", () => {
  assert.equal(guessFamily("Something hurts and I am not sure what kind of study this is."), null);
  const created = S().create({ family: null, setting: "s", rawNeed: "Something hurts and I am not sure." });
  assert.equal(created.family, null);
  assert.equal(FAMILY_BY_ID[null].label, "Undetermined");
  assert.doesNotThrow(() => FAMILY_BY_ID[null].label);
  assert.equal(familyOf(null).label, "Undetermined");
  assert.notEqual(familyOf(null).label, "Mixed methods");
  assert.match(studioSrc, /Design undetermined/);
});

test("null_scores_render_not_assessed", () => {
  assert.match(bitsSrc, /not assessed/);
  assert.match(bitsSrc, /value === null/);
});

test("verification_badge_from_provenance_only", () => {
  assert.match(bitsSrc, /status === "verified"/);
  assert.match(bitsSrc, /model: \{v\}/);
  assert.match(bitsSrc, /grade === "unrated"/);
  assert.match(bitsSrc, />unrated</);
  assert.doesNotMatch(bitsSrc.slice(bitsSrc.indexOf("function GradeBadge"), bitsSrc.indexOf("function VerifyBadge")), /destructive/);
});

test("audit_stage_patch_is_kept", () => {
  const created = S().create({ family: "qi-pdsa", setting: "s", rawNeed: "n" });
  S().mergeStage(created.id, "audit", {
    openFixes: ["name the operational definition", "protect huddle time", "agree the balancing measures"],
    improvementNotes: "Next cycle: both handoffs.",
    lastReview: "2026-09-22",
  });
  const s = S().studies.find((x) => x.id === created.id)!;
  assert.equal(s.audit.openFixes.length, 3);
  assert.match(s.audit.improvementNotes, /Next cycle/);
  assert.equal(s.audit.lastReview, "2026-09-22");
  const applied = applyAiResult(
    "audit",
    { openFixes: ["a", "b"], improvementNotes: "notes", lastReview: "today", summary: "audit" },
    "qi-pdsa",
    s,
  );
  assert.equal(applied.ok, true);
  S().mergeStage(created.id, "audit", applied.stagePatch as Partial<Study["audit"]>);
  const after = S().studies.find((x) => x.id === created.id)!;
  assert.deepEqual(after.audit.openFixes, ["a", "b"]);
  assert.equal(after.audit.improvementNotes, "notes");
  assert.equal(after.audit.lastReview, "today");
});

test("empty_search_confirmation_is_investigator_action", () => {
  const created = S().create({ family: "retrospective", setting: "Ontario", rawNeed: "Need." });
  const before = S().studies.find((x) => x.id === created.id)!;
  const d = illuminateDecision(
    before,
    "scan",
    { items: [], gradeOverall: "very-low", investigatorConfirmsEmptySearch: true, summary: "empty" },
    studyRevision(before),
  );
  assert.ok(d.droppedGates.includes("investigatorConfirmsEmptySearch"));
  assert.equal(d.complete, false);
  const applied = S().illuminateApply(created.id, "scan", { items: [], investigatorConfirmsEmptySearch: true }, studyRevision(before));
  assert.equal(applied.complete, false);
  let s = S().studies.find((x) => x.id === created.id)!;
  assert.equal(s.scan.emptySearchConfirmedBy, undefined);
  S().confirmEmptySearch(created.id);
  s = S().studies.find((x) => x.id === created.id)!;
  assert.equal(s.scan.emptySearchConfirmedBy, "investigator");
  assert.ok(s.scan.emptySearchConfirmedAt);
  S().markComplete(created.id, "scan");
  assert.ok(S().studies.find((x) => x.id === created.id)!.completedStages.includes("scan"));
});

test("reload_shows_loading_not_missing_before_hydration", () => {
  assert.match(routeSrc, /Loading this study/);
  assert.match(routeSrc, /studioAvailability/);
  assert.match(routeSrc, /This study is not on the desk/);
  assert.ok(
    routeSrc.indexOf("Loading this study") < routeSrc.indexOf("This study is not on the desk"),
    "loading copy must appear before missing copy",
  );
  const study = createStudy({ family: "cohort", setting: "s", rawNeed: "n" });
  assert.equal(studioAvailability(false, undefined), "loading");
  assert.equal(studioAvailability(false, study), "loading");
  assert.equal(studioAvailability(true, undefined), "missing");
  assert.equal(studioAvailability(true, study), "ready");
  assert.notEqual(studioAvailability(false, undefined), "missing");
});
