/**
 * Store behaviour. Requires the `./seed` import to resolve; the export at e27921e lacks seed.ts, so
 * the harness redirects it to an empty, labelled test double (see tests/README.md).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { downstreamCompleted, recentAudit, useStudio } from "../src/lib/store";
import { migrateStudy } from "../src/lib/defaults";

const S = () => useStudio.getState();

test("audit history is kept in full; recentAudit gives the bounded view", () => {
  const study = S().create({ family: "cohort", setting: "x", rawNeed: "y" });
  for (let i = 1; i <= 41; i++) {
    S().log(study.id, { id: `e-${i}`, at: new Date().toISOString(), kind: "note", stage: "problem", summary: `event ${i}` });
  }
  const s = S().studies.find((x) => x.id === study.id)!;
  assert.equal(s.audit.entries.length, 41);
  assert.ok(s.audit.entries.some((e) => e.id === "e-1"), "oldest entry retained");
  assert.equal(recentAudit(s, 40).length, 40);
  assert.equal(recentAudit(s, 40)[0].id, "e-41");
});

test("an upstream change flags completed downstream stages, logs it, and reopens a 'complete' study", () => {
  const study = S().create({ family: "rct", setting: "x", rawNeed: "y" });
  S().confirmEmptySearch(study.id);
  for (const st of ["problem", "scan", "map", "gaps", "hypotheses", "questions", "design", "protocol"] as const) S().markComplete(study.id, st);
  S().update(study.id, { status: "complete" });
  S().mergeStage(study.id, "questions", { finer: "primary outcome changed after review" });
  const s = S().studies.find((x) => x.id === study.id)!;
  assert.equal(s.status, "active");
  assert.deepEqual(s.needsReview, ["design", "protocol"]);
  assert.ok(s.completedStages.includes("protocol"), "history of completion is not erased");
  assert.match(s.audit.entries[0].summary, /questions changed after design, protocol were completed/);
});

test("bookkeeping-only patches (generatedAt) do not flag anything", () => {
  const study = S().create({ family: "rct", setting: "x", rawNeed: "y" });
  S().confirmEmptySearch(study.id);
  S().markComplete(study.id, "problem");
  S().markComplete(study.id, "scan");
  S().mergeStage(study.id, "problem", { generatedAt: new Date().toISOString() });
  const s = S().studies.find((x) => x.id === study.id)!;
  assert.deepEqual(s.needsReview, []);
});

test("markComplete and clearReview remove the flag; downstreamCompleted is ordered by pipeline position", () => {
  const study = S().create({ family: "rct", setting: "x", rawNeed: "y" });
  S().confirmEmptySearch(study.id);
  for (const st of ["problem", "scan", "map"] as const) S().markComplete(study.id, st);
  S().mergeStage(study.id, "problem", { statement: "new" });
  let s = S().studies.find((x) => x.id === study.id)!;
  assert.deepEqual(s.needsReview, ["scan", "map"]);
  assert.deepEqual(downstreamCompleted(s, "problem"), ["scan", "map"]);
  S().clearReview(study.id, "scan");
  S().markComplete(study.id, "map");
  s = S().studies.find((x) => x.id === study.id)!;
  assert.deepEqual(s.needsReview, []);
});

test("migrateStudy adds provenance/retrieval fields to an old study without touching its content", () => {
  const old = {
    id: "study-old",
    title: "Old",
    subtitle: "s",
    family: "cohort",
    setting: "Hamilton",
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    currentStage: "scan",
    completedStages: ["problem"],
    problem: { rawNeed: "n", statement: "keep me", whoAffected: "", whatHurts: "", currentPractice: "", whyNow: "", constraints: "", patientCenteredGoal: "" },
    scan: { query: "q", sourcesConsulted: ["PubMed"], items: [{ id: "ev-1", title: "Paper", authors: "A", year: 2019, source: "J", kind: "rct", grade: "moderate", methodQuality: 70, relevance: 80, notes: "", verification: "landmark", doi: "10.1/x", contextTags: [], keyFindings: "f", limitations: "l" }], gradeOverall: "low", gradeRationale: "", synthesis: "" },
    audit: { entries: [], openFixes: [], improvementNotes: "" },
  };
  const m = migrateStudy(old);
  assert.equal(m.problem.statement, "keep me");
  assert.equal(m.scan.items[0].provenance.status, "unverified");
  assert.equal(m.scan.items[0].provenance.identifiers.doi, "10.1/x");
  assert.equal(m.scan.items[0].year, 2019);
  assert.deepEqual(m.scan.retrievalEvents, []);
  assert.deepEqual(m.needsReview, []);
  assert.equal(m.schemaVersion, 4);
  assert.deepEqual(m.scan.sourcesConsulted, ["PubMed"], "existing text is kept; only new fields are added");
});
