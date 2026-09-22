import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAiResult } from "../src/lib/apply-ai";
import {
  createStudy,
  migrateStudy,
  scanMayComplete,
  queryHashOf,
  scanContentRevision,
  emptySearchConfirmationValid,
  REPAIR_EMPTY_SCAN_GRADE,
} from "../src/lib/defaults";
import { illuminateDecision } from "../src/lib/illuminate";
import { applyDecision, evaluateDecision, evidenceRevision, studyRevision } from "../src/lib/evidence/decision";
import { compareWithRegistry } from "../src/lib/evidence/verify";
import { writeImmutableBackup } from "../src/lib/persist-backup";
import { useStudio } from "../src/lib/store";
import { parseExportedStudy, studyToJson } from "../src/lib/export";
import type { Study } from "../src/lib/types";

const S = () => useStudio.getState();

test("empty_scan_assigns_no_certainty_and_no_completion", () => {
  const study = createStudy({ family: "retrospective", setting: "Ontario", rawNeed: "Need." });
  const r = applyAiResult("scan", { items: [], gradeOverall: "very-low", summary: "empty" }, study.family, study);
  assert.equal((r.stagePatch as { gradeOverall?: string }).gradeOverall, "");
  const d = illuminateDecision(study, "scan", { items: [], gradeOverall: "low" }, studyRevision(study));
  assert.equal(d.complete, false);
  assert.equal(scanMayComplete(study), false);
});

test("leads_only_scan_stays_incomplete", () => {
  const study = createStudy({ family: "retrospective", setting: "Ontario", rawNeed: "Need." });
  const r = applyAiResult(
    "scan",
    { items: [{ title: "Uninspected model lead", kind: "grey" }], gradeOverall: "high", summary: "leads" },
    study.family,
    study,
  );
  assert.equal((r.stagePatch as { gradeOverall?: string }).gradeOverall, "");
  const merged = { ...study, scan: { ...study.scan, ...r.stagePatch, items: r.stagePatch.items as Study["scan"]["items"] } };
  assert.equal(scanMayComplete(merged), false);
  const d = illuminateDecision(study, "scan", { items: [{ title: "Lead" }], gradeOverall: "moderate" }, studyRevision(study));
  assert.equal(d.complete, false);
});

test("omitted_grade_over_empty_scan_resolves_unassessed", () => {
  const study = createStudy({ family: "retrospective", setting: "Ontario", rawNeed: "Need." });
  const withStale = { ...study, scan: { ...study.scan, gradeOverall: "high" as const, items: [] } };
  const r = applyAiResult("scan", { items: [], synthesis: "omits the grade" }, study.family, withStale);
  assert.equal((r.stagePatch as { gradeOverall?: string }).gradeOverall, "");
});

test("empty_search_confirmation_is_investigator_action", () => {
  const created = S().create({ family: "qi-pdsa", setting: "Ward", rawNeed: "Need." });
  const before = S().studies.find((s) => s.id === created.id)!;
  const applied = S().illuminateApply(
    created.id,
    "scan",
    { items: [], investigatorConfirmsEmptySearch: true, emptySearchConfirmation: { by: "investigator" } },
    studyRevision(before),
  );
  assert.equal(applied.complete, false);
  let s = S().studies.find((x) => x.id === created.id)!;
  assert.equal(s.scan.emptySearchConfirmation, undefined);
  S().confirmEmptySearch(created.id);
  s = S().studies.find((x) => x.id === created.id)!;
  assert.equal(s.scan.emptySearchConfirmation?.by, "investigator");
  assert.equal(s.scan.emptySearchConfirmation?.queryHash, queryHashOf(s.scan.query ?? ""));
  assert.equal(s.scan.emptySearchConfirmation?.revision, scanContentRevision(s));
  assert.equal(emptySearchConfirmationValid(s), true);
  assert.equal(scanMayComplete(s), true);
});

test("empty_search_confirmation_invalidated_by_query_change", () => {
  const created = S().create({ family: "qi-pdsa", setting: "Ward", rawNeed: "Need." });
  S().mergeStage(created.id, "scan", { query: "query A ketamine infusion protocol" });
  S().confirmEmptySearch(created.id);
  const confirmed = S().studies.find((x) => x.id === created.id)!;
  assert.equal(scanMayComplete(confirmed), true);
  S().mergeStage(created.id, "scan", { query: "query B unrelated nerve ablation" });
  const after = S().studies.find((x) => x.id === created.id)!;
  assert.equal(emptySearchConfirmationValid(after), false);
  assert.equal(scanMayComplete(after), false);
  assert.equal(S().studies.find((x) => x.id === created.id)!.completedStages.includes("scan"), false);
  S().markComplete(created.id, "scan");
  assert.equal(S().studies.find((x) => x.id === created.id)!.completedStages.includes("scan"), false);
});

test("empty_search_confirmation_survives_no_change", () => {
  const created = S().create({ family: "qi-pdsa", setting: "Ward", rawNeed: "Need." });
  S().mergeStage(created.id, "scan", { query: "stable query" });
  S().confirmEmptySearch(created.id);
  const before = S().studies.find((x) => x.id === created.id)!;
  S().mergeStage(created.id, "scan", { generatedAt: "2026-09-22T00:00:00.000Z" });
  const after = S().studies.find((x) => x.id === created.id)!;
  assert.equal(emptySearchConfirmationValid(after), true);
  assert.equal(scanMayComplete(after), true);
  assert.equal(after.scan.emptySearchConfirmation?.queryHash, before.scan.emptySearchConfirmation?.queryHash);
});

test("same_version_hydrate_applies_repairs_once", () => {
  const raw = {
    schemaVersion: 4,
    id: "study-airhhf7i",
    title: "ketamine example",
    family: "retrospective",
    setting: "Ontario",
    status: "active",
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
    currentStage: "scan",
    completedStages: ["scan", "protocol"],
    needsReview: [],
    scan: { items: [], gradeOverall: "very-low", gradeRationale: "", synthesis: "", query: "retrieve only", retrievalEvents: [] },
  };
  const first = migrateStudy(raw);
  assert.equal(first.scan.gradeOverall, "");
  assert.equal(first.completedStages.includes("scan"), false);
  assert.ok(first.repairsApplied?.includes(REPAIR_EMPTY_SCAN_GRADE));
  const second = migrateStudy(first);
  assert.equal(second.scan.gradeOverall, "");
  assert.deepEqual(second.repairsApplied, first.repairsApplied);
  const exported = parseExportedStudy(JSON.stringify({ ...raw, meta: {} }));
  assert.equal(exported.study.scan.gradeOverall, "");
});

test("accepted_decision_goes_stale_on_key_findings_change", () => {
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
  let s = S().studies.find((x) => x.id === created.id)!;
  const applied = applyDecision(
    { kind: "pursue", statement: "Run a trial", question: "Does it work?", claimIds: ["cl-1"] },
    s,
  );
  assert.ok(applied.decision);
  S().mergeStage(created.id, "design", { decisions: [applied.decision!] });
  S().acceptDecision(created.id, "latest");
  s = S().studies.find((x) => x.id === created.id)!;
  assert.equal(s.design.decisions[0].status, "accepted");
  const beforeRev = evidenceRevision(s);
  const items = s.scan.items.map((i) => (i.id === "ev-1" ? { ...i, keyFindings: "Correction: no observed benefit" } : i));
  S().mergeStage(created.id, "scan", { items });
  s = S().studies.find((x) => x.id === created.id)!;
  assert.notEqual(evidenceRevision(s), beforeRev);
  assert.equal(s.design.decisions[0].status, "stale");
  const evaled = evaluateDecision(s.design.decisions[0], s);
  assert.equal(evaled.status, "stale");
  const json = studyToJson(s);
  assert.match(json, /"status": "stale"/);
});

test("migration_writes_one_immutable_backup_or_reports_none", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  const first = writeImmutableBackup(storage, 3, '{"studies":[]}', "2026-09-22T00-00-00Z");
  assert.equal(first.written, true);
  const same = writeImmutableBackup(storage, 3, '{"studies":[]}', "2026-09-22T01-00-00Z");
  assert.equal(same.key, first.key);
  assert.equal(storage.getItem(first.key!), '{"studies":[]}');
  const mutated = writeImmutableBackup(storage, 3, '{"studies":["mutated"]}', "2026-09-22T02-00-00Z");
  assert.equal(mutated.written, true);
  assert.notEqual(mutated.key, first.key);
  assert.equal(storage.getItem(mutated.key!), '{"studies":["mutated"]}');
  assert.equal(storage.getItem(first.key!), '{"studies":[]}');
  const quota = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    key: () => null,
    length: 0,
  };
  const none = writeImmutableBackup(quota, 3, "{}", "t");
  assert.equal(none.written, false);
  assert.equal(none.reason, "no backup written: quota");
});

test("date_variant_without_typed_dates_is_unresolved", () => {
  const r = compareWithRegistry(
    { title: "Same article electronic then print", year: 2019, doi: "10.5555/date.var" },
    { title: "Same article electronic then print", authors: "", year: 2022, venue: "J", doi: "10.5555/date.var" },
  );
  assert.equal(r.result, "unresolved");
  assert.equal(r.dateVariant?.corroborated, false);
});

test("date_variant_with_typed_online_and_print_is_match", () => {
  const r = compareWithRegistry(
    { title: "Same article electronic then print", year: 2021, doi: "10.5555/date.var" },
    {
      title: "Same article electronic then print",
      authors: "",
      year: 2024,
      venue: "J",
      doi: "10.5555/date.var",
      dates: { online: 2021, print: 2024 },
      pmid: "34624374",
    },
  );
  assert.equal(r.result, "match");
  assert.equal(r.dateVariant?.corroborated, true);
});

test("audit_substance_changes_study_revision_log_does_not", () => {
  const created = S().create({ family: "qi-pdsa", setting: "s", rawNeed: "n" });
  const before = S().studies.find((x) => x.id === created.id)!;
  const rev0 = studyRevision(before);
  S().log(created.id, { id: "e-1", at: "2026-09-22T00:00:00.000Z", kind: "note", stage: "audit", summary: "log only" });
  const logged = S().studies.find((x) => x.id === created.id)!;
  assert.equal(studyRevision(logged), rev0);
  S().update(created.id, { audit: { ...logged.audit, openFixes: ["fix-1"], improvementNotes: "note" } });
  const after = S().studies.find((x) => x.id === created.id)!;
  assert.notEqual(studyRevision(after), rev0);
});
