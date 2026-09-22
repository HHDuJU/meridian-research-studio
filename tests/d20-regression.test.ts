import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAiResult } from "../src/lib/apply-ai";
import { createStudy, migrateStudy, scanMayComplete } from "../src/lib/defaults";
import { illuminateDecision } from "../src/lib/illuminate";
import { studyRevision } from "../src/lib/evidence/decision";
import { useStudio } from "../src/lib/store";
import type { Study } from "../src/lib/types";

test("forged_model_boolean_does_not_complete_empty_scan", () => {
  const study = createStudy({ family: "retrospective", setting: "Ontario", rawNeed: "Need." });
  const rev = studyRevision(study);
  const d = illuminateDecision(
    study,
    "scan",
    {
      items: [],
      gradeOverall: "very-low",
      investigatorConfirmsEmptySearch: true,
      emptySearchConfirmed: { at: "x", actor: "investigator" },
      summary: "empty",
    },
    rev,
  );
  assert.ok(d.droppedGates.includes("investigatorConfirmsEmptySearch"));
  assert.equal(d.complete, false);
  assert.equal((d.applied.stagePatch as { gradeOverall?: string }).gradeOverall, "");
  const merged = { ...study, scan: { ...study.scan, ...(d.applied.stagePatch as object) } } as Study;
  assert.equal(scanMayComplete(merged), false);
});

test("rejected_or_stale_output_does_not_merge_or_complete", () => {
  const study = createStudy({ family: "retrospective", setting: "s", rawNeed: "n" });
  const rejected = illuminateDecision(study, "scan", "not-json", studyRevision(study));
  assert.equal(rejected.merge, false);
  assert.equal(rejected.complete, false);
  assert.equal(rejected.reason, "rejected");
  const stale = illuminateDecision(study, "problem", { statement: "x" }, "st1-not-current");
  assert.equal(stale.merge, false);
  assert.equal(stale.complete, false);
  assert.equal(stale.reason, "stale");
});

test("investigator_confirmEmptySearch_is_the_positive_control", () => {
  const created = useStudio.getState().create({ family: "qi-pdsa", setting: "Ward", rawNeed: "Need." });
  const before = useStudio.getState().studies.find((s) => s.id === created.id)!;
  const d = illuminateDecision(
    before,
    "scan",
    { items: [], gradeOverall: "very-low", investigatorConfirmsEmptySearch: true, summary: "empty" },
    studyRevision(before),
  );
  const applied = useStudio.getState().illuminateApply(created.id, "scan", { items: [], investigatorConfirmsEmptySearch: true }, studyRevision(before));
  assert.equal(applied.complete, false);
  assert.equal(useStudio.getState().studies.find((s) => s.id === created.id)!.completedStages.includes("scan"), false);
  useStudio.getState().confirmEmptySearch(created.id);
  const after = useStudio.getState().studies.find((s) => s.id === created.id)!;
  assert.equal(after.scan.emptySearchConfirmed?.actor, "investigator");
  assert.equal(scanMayComplete(after), true);
  useStudio.getState().markComplete(created.id, "scan");
  assert.equal(useStudio.getState().studies.find((s) => s.id === created.id)!.completedStages.includes("scan"), true);
  assert.equal(d.complete, false);
});

test("migration_marks_unsupported_empty_scan_grade_stale_without_verifying", () => {
  const raw = {
    schemaVersion: 3,
    id: "study-airhhf7i",
    title: "ketamine example",
    subtitle: "",
    family: "retrospective",
    setting: "Ontario",
    status: "active",
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
    currentStage: "scan",
    completedStages: ["scan"],
    scan: { items: [], gradeOverall: "very-low", gradeRationale: "Nothing found", synthesis: "", query: "retrieve only" },
  };
  const original = JSON.parse(JSON.stringify(raw));
  const migrated = migrateStudy(raw);
  assert.equal(migrated.scan.gradeOverall, "");
  assert.equal(migrated.scan.unsupportedGradeOverall?.value, "very-low");
  assert.equal(migrated.scan.unsupportedGradeOverall?.status, "stale");
  assert.equal(migrated.completedStages.includes("scan"), false);
  assert.equal(migrated.scan.completionWithdrawn?.wasComplete, true);
  assert.equal(original.scan.gradeOverall, "very-low");
  assert.deepEqual(original.completedStages, ["scan"]);
  assert.notEqual(migrated.scan.unsupportedGradeOverall?.status, "verified");
});

test("omitted_grade_over_zero_records_resolves_unassessed", () => {
  const study = createStudy({ family: "retrospective", setting: "Ontario", rawNeed: "Need." });
  const withStale = {
    ...study,
    scan: { ...study.scan, gradeOverall: "high" as const, items: [] },
  };
  const r = applyAiResult("scan", { items: [], synthesis: "later response omits the grade" }, study.family, withStale);
  assert.equal((r.stagePatch as { gradeOverall?: string }).gradeOverall, "");
  const merged = { ...withStale, scan: { ...withStale.scan, ...r.stagePatch } };
  assert.equal(merged.scan.gradeOverall, "");
  assert.equal(scanMayComplete(merged), false);
});

test("model_only_leads_cannot_receive_overall_certainty", () => {
  const study = createStudy({ family: "retrospective", setting: "Ontario", rawNeed: "Need." });
  const r = applyAiResult(
    "scan",
    {
      items: [{ title: "Uninspected model lead", kind: "grey", verification: "landmark" }],
      gradeOverall: "high",
      summary: "leads only",
    },
    study.family,
    study,
  );
  assert.equal((r.stagePatch as { gradeOverall?: string }).gradeOverall, "");
  assert.ok(r.issues.some((i) => i.path === "gradeOverall" && i.code === "dropped"));
  const added = r.stagePatch.items as { provenance?: { status?: string }; verification?: string }[] | undefined;
  assert.ok(added && added.length >= 1);
  assert.equal(added[0].provenance?.status, "unverified");
});
