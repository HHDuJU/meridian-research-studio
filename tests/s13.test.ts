import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAiResult } from "../src/lib/apply-ai";
import { applyAppraisal } from "../src/lib/evidence/appraise";
import { ingestRecords } from "../src/lib/evidence/records";
import { createStudy } from "../src/lib/defaults";
import { schemaFor } from "../src/lib/ai";
import { useStudio } from "../src/lib/store";
import { studyRevision } from "../src/lib/evidence/decision";

const S = () => useStudio.getState();

function retrievedStudy() {
  const { items, documents } = ingestRecords(
    [{ title: "Synth retrieved", authors: "A", year: 2021, venue: "J", doi: "10.5555/s13.retrieved", abstract: "Observed benefit of 12 percent." }],
    { id: "ret-s13", provider: "fixture" },
  );
  const study = createStudy({ family: "qi-pdsa", setting: "ward", rawNeed: "handoff checklist" });
  return {
    ...study,
    documents: [...(study.documents ?? []), ...documents],
    scan: {
      ...study.scan,
      items,
      retrievalEvents: [
        {
          id: "ret-s13",
          at: "2026-09-22T00:00:00Z",
          provider: "fixture",
          query: "handoff",
          resultCount: 1,
          recordIds: [items[0].id],
          status: "ok" as const,
          performedBy: "app" as const,
        },
      ],
    },
  };
}

test("appraisal_contract_supported_by_live_scan_mapper", () => {
  const study = retrievedStudy();
  const payload = {
    annotations: [{ id: study.scan.items[0].id, relevance: 88, methodQuality: 48, kind: "qi-report", grade: "low", keyFindings: "Observed benefit of 12 percent." }],
    claims: [
      {
        id: "c1",
        text: "A structured prompt was followed by fewer missed items.",
        kind: "source-derived",
        sourceIds: [study.scan.items[0].id],
        passage: "Observed benefit of 12 percent.",
        uncertainty: "moderate",
      },
    ],
    gradeOverall: "low",
    synthesis: "One retrieved record appraised.",
    summary: "appraisal",
  };
  const canonical = applyAppraisal(study.scan.items, payload);
  const live = applyAiResult("scan", payload, study.family, study);
  assert.equal(live.ok, true);
  const items = live.stagePatch.items as typeof study.scan.items;
  assert.equal(items[0].grade, "low");
  assert.equal(items[0].grade, canonical.items[0].grade);
  assert.equal(items[0].methodQuality, 48);
  assert.equal((live.stagePatch.claims as { id: string }[])[0].id, "c1");
  assert.equal(live.stagePatch.gradeOverall, "low");
  assert.equal(canonical.gradeOverall, "low");
});

test("retrieved_record_grade_applies_without_identity_checks", () => {
  const study = retrievedStudy();
  assert.equal(study.scan.items[0].provenance.checks.length, 0);
  const r = applyAppraisal(study.scan.items, {
    annotations: [{ id: study.scan.items[0].id, grade: "moderate", relevance: 70 }],
  });
  assert.equal(r.items[0].grade, "moderate");
  assert.equal(r.items[0].relevance, 70);
  assert.equal(r.items[0].provenance.status, "retrieved");
  assert.equal(r.issues.some((i) => /identity attempt/.test(i.message)), false);
});

test("appraisal_does_not_grade_unverified_leads", () => {
  const study = retrievedStudy();
  const lead = {
    ...study.scan.items[0],
    id: "ev-lead",
    provenance: { ...study.scan.items[0].provenance, origin: "model" as const, status: "unverified" as const, retrievalEventIds: [], checks: [] },
  };
  const r = applyAppraisal([lead], { annotations: [{ id: "ev-lead", grade: "high" }] });
  assert.equal(r.items[0].grade, "unrated");
  assert.ok(r.issues.some((i) => /unverified lead/.test(i.message)));
});

test("id_collision_quarantines_at_item_path", () => {
  const study = retrievedStudy();
  const id = study.scan.items[0].id;
  const live = applyAiResult(
    "scan",
    {
      items: [
        { id, title: "Colliding lead", authors: "X", year: 2019, source: "Invented", kind: "grey", grade: "high", verification: "landmark", doi: "10.5555/invented.1" },
        { title: "Fresh lead", authors: "Y", year: 2020, source: "J", kind: "grey", grade: "low", verification: "ai-lead" },
      ],
      summary: "discovery",
    },
    study.family,
    study,
  );
  assert.equal(live.ok, true);
  const collision = live.issues.find((i) => i.code === "id-collision");
  assert.equal(collision?.path, "items[0]");
  const q = live.stagePatch.quarantine as { items: { id: string; doi?: string }[] };
  assert.equal(q.items.length, 1);
  assert.equal(q.items[0].id, id);
  assert.equal(q.items[0].doi, "10.5555/invented.1");
  const items = live.stagePatch.items as { id: string; provenance: { origin: string } }[];
  assert.equal(items[0].id, id);
  assert.equal(items[0].provenance.origin, "retrieval");
  assert.equal(items.some((i) => i.provenance.origin === "model"), true);
});

test("schemaFor_scan_distinguishes_appraisal_from_discovery", () => {
  const discovery = schemaFor("scan", "discovery");
  const appraisal = schemaFor("scan", "appraisal");
  assert.equal(discovery.includes('"items"'), true);
  assert.equal(discovery.includes("annotations"), false);
  assert.equal(appraisal.includes("annotations"), true);
  assert.equal(appraisal.includes("existing retrieved records"), true);
});

test("illuminateApply_scan_mapper_writes_grades_and_claims", async () => {
  const created = S().create({ family: "qi-pdsa", setting: "ward", rawNeed: "handoff" });
  const study0 = retrievedStudy();
  S().mergeStage(created.id, "scan", { items: study0.scan.items, retrievalEvents: study0.scan.retrievalEvents });
  S().update(created.id, { documents: study0.documents });
  await new Promise((r) => setTimeout(r, 0));
  const before = S().studies.find((s) => s.id === created.id)!;
  const payload = {
    annotations: [{ id: before.scan.items[0].id, grade: "low", relevance: 88, methodQuality: 48, kind: "qi-report", keyFindings: "Observed benefit of 12 percent." }],
    claims: [{ id: "c1", text: "Fewer missed items.", kind: "source-derived", sourceIds: [before.scan.items[0].id], passage: "Observed benefit of 12 percent.", uncertainty: "low" }],
    gradeOverall: "low",
    synthesis: "One retrieved record appraised.",
  };
  const result = S().illuminateApply(created.id, "scan", payload, studyRevision(before));
  assert.equal(result.ok, true, result.reason || result.summary);
  const after = S().studies.find((s) => s.id === created.id)!;
  assert.equal(after.scan.items[0].grade, "low");
  assert.equal(after.scan.claims[0].id, "c1");
  assert.equal(after.scan.gradeOverall, "low");
});
