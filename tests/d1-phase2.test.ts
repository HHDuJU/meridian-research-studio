import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyAppraisal } from "../src/lib/evidence/appraise";
import { ingestRecords } from "../src/lib/evidence/records";
import { applyAiResult } from "../src/lib/apply-ai";
import { createStudy, migrateStudy, scanMayComplete } from "../src/lib/defaults";
import { studyToJson, downloadStudyJson } from "../src/lib/export";
import { sha256Hex } from "../src/lib/evidence/hash";
import type { Study } from "../src/lib/types";

const SYN_TEXT_01 =
  "SYNTHETIC structured abstract. Methods invented. Results: pain fell. RESULT_END";

test("appraisal_preserves_retrieved_abstract_and_access", () => {
  const { items } = ingestRecords(
    [{ title: "Invented trial", authors: "A", year: 2024, venue: "Synth J", abstract: SYN_TEXT_01, doi: "10.0/synth.1" }],
    { id: "ret-1", provider: "fixture" },
  );
  const before = items[0];
  assert.equal(before.abstract?.text, SYN_TEXT_01);
  assert.equal(before.provenance.access, "abstract");
  const r = applyAppraisal(items, {
    annotations: [
      {
        id: before.id,
        notes: "Model commentary only",
        access: "metadata",
        abstract: { documentId: "hack", sha256: "0", text: "HACKED" },
        provenance: { status: "verified" },
      },
    ],
  });
  const after = r.items[0];
  assert.equal(after.abstract?.text, SYN_TEXT_01);
  assert.equal(after.abstract?.sha256, before.abstract?.sha256);
  assert.equal(after.provenance.access, "abstract");
  assert.equal(after.notes, "Model commentary only");
  assert.ok(r.issues.some((i) => i.path.includes("abstract") || i.message.includes("abstract")));
});

test("preserve_original_abstract", () => {
  const { items, documents } = ingestRecords(
    [{ title: "Invented trial", authors: "A", year: 2024, venue: "Synth J", abstract: SYN_TEXT_01 }],
    { id: "ret-1", provider: "fixture" },
  );
  const r = applyAppraisal(items, { annotations: [{ id: items[0].id, notes: "Model appraisal" }] });
  const doc = documents[0];
  assert.equal(doc.text, SYN_TEXT_01);
  assert.equal(doc.sha256, sha256Hex(SYN_TEXT_01));
  assert.equal(r.items[0].abstract?.text, SYN_TEXT_01);
  assert.equal(r.items[0].abstract?.sha256, doc.sha256);
});

test("migration_moves_abstract_prefix_out_of_notes", () => {
  const invented = "Invented source sentence RESULT_END";
  const raw = {
    schemaVersion: 3,
    id: "st-mig",
    title: "t",
    subtitle: "",
    family: "retrospective",
    setting: "s",
    status: "draft",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    currentStage: "scan",
    completedStages: [],
    scan: {
      items: [
        {
          id: "ev-1",
          title: "T",
          authors: "",
          year: 2020,
          source: "J",
          kind: "grey",
          grade: "unrated",
          methodQuality: null,
          relevance: null,
          notes: `Abstract (from fixture): ${invented}`,
          verification: "ai-lead",
          contextTags: [],
          keyFindings: "",
          limitations: "",
        },
      ],
      gradeOverall: "",
      gradeRationale: "",
      synthesis: "",
      query: "",
      sourcesConsulted: [],
    },
  };
  const once = migrateStudy(raw);
  assert.equal(once.schemaVersion, 4);
  assert.equal(once.scan.items[0].abstract?.text, invented);
  assert.equal(once.scan.items[0].notes, "");
  assert.equal(once.documents?.[0]?.text, invented);
  assert.ok(once.migrationBackupHash);
  const twice = migrateStudy(once);
  assert.equal(twice.migrationEvents?.filter((e) => e.to === 4).length, 1);
});

test("empty_scan_assigns_no_certainty_and_no_completion", () => {
  const study = createStudy({ family: "retrospective", setting: "Ontario", rawNeed: "Need." });
  const r = applyAiResult(
    "scan",
    { items: [], gradeOverall: "very-low", gradeRationale: "Nothing found", synthesis: "Empty.", summary: "empty" },
    study.family,
    study,
  );
  const merged = { ...study, scan: { ...study.scan, ...r.stagePatch } };
  assert.equal(merged.scan.gradeOverall, "");
  assert.equal(scanMayComplete(merged), false);
});

test("export_json_bytes_equal_store", () => {
  const study = createStudy({ family: "qi-pdsa", setting: "Ward", rawNeed: "Need." });
  const json = studyToJson(study);
  const parsed = JSON.parse(json) as Study & { meta?: unknown };
  const { meta, ...rest } = parsed;
  assert.ok(meta);
  assert.deepEqual(rest, study);
});

function withFakeDownload(run: (events: { via: string; download: string }[]) => void) {
  const events: { via: string; download: string }[] = [];
  const original = {
    document: globalThis.document,
    URL: globalThis.URL,
    Blob: globalThis.Blob,
    window: globalThis.window,
    MouseEvent: globalThis.MouseEvent,
  };
  class FakeAnchor {
    href = "";
    download = "";
    rel = "";
    click() {
      events.push({ via: "click", download: this.download });
    }
    setAttribute() {}
    dispatchEvent() {
      events.push({ via: "dispatchEvent", download: this.download });
      return true;
    }
    remove() {}
  }
  Object.assign(globalThis, {
    document: {
      createElement: (tag: string) => {
        assert.equal(tag, "a");
        return new FakeAnchor();
      },
      body: { appendChild(el: FakeAnchor) { return el; }, removeChild() {} },
    },
    window: {},
    MouseEvent: class {
      constructor() {}
    },
    URL: { createObjectURL: () => "blob:meridian-test", revokeObjectURL() {} },
    Blob: class {
      constructor(parts: string[]) {
        this.size = new TextEncoder().encode(parts.join("")).length;
      }
      size = 0;
    },
  });
  try {
    run(events);
  } finally {
    Object.assign(globalThis, original);
  }
}

test("downloadStudyJson_clicks_anchor_with_store_bytes", () => {
  const study = createStudy({ family: "qi-pdsa", setting: "Ward", rawNeed: "Need." });
  withFakeDownload((events) => {
    const result = downloadStudyJson(study);
    assert.equal(result.json, studyToJson(study));
    assert.equal(events.length, 1, `expected one download event, got ${events.map((e) => e.via).join(",")}`);
    assert.equal(events[0].via, "dispatchEvent");
    assert.equal(events[0].download, `meridian-study-${study.id}.json`);
  });
});

test("one_export_click_dispatches_one_download", () => {
  const exportSrc = fs.readFileSync(new URL("../src/lib/export.ts", import.meta.url), "utf8");
  assert.match(exportSrc, /dispatchEvent\(new MouseEvent\("click"/);
  assert.doesNotMatch(exportSrc, /\ba\.click\(\)/);
  const study = createStudy({ family: "qi-pdsa", setting: "Ward", rawNeed: "Need." });
  withFakeDownload((events) => {
    downloadStudyJson(study);
    assert.equal(events.length, 1);
    assert.equal(events[0].via, "dispatchEvent");
  });
});

test("public_fixture_contains_only_declared_synthetic_abstracts", () => {
  const text = fs.readFileSync(new URL("./fixtures/consensus-export-2026-09-20.txt", import.meta.url), "utf8");
  assert.match(text, /SYNTHETIC/);
  assert.doesNotMatch(text, /utm_source=/);
  assert.doesNotMatch(text, /Eight RCTs \(n = 627\)/);
  assert.doesNotMatch(text, /MD -1\.65/);
});

test("applyAiResult scan annotations route uses applyAppraisal", () => {
  const { items } = ingestRecords(
    [{ title: "Invented trial", authors: "A", year: 2024, venue: "Synth J", abstract: SYN_TEXT_01 }],
    { id: "ret-1", provider: "fixture" },
  );
  const study = createStudy({ family: "retrospective", setting: "s", rawNeed: "n" });
  const withItems = { ...study, scan: { ...study.scan, items } };
  const r = applyAiResult(
    "scan",
    { annotations: [{ id: items[0].id, keyFindings: "Provided finding" }], claims: [{ id: "scan-c5", text: "A claim", kind: "inference", sourceIds: [items[0].id], uncertainty: "high" }] },
    withItems.family,
    withItems,
  );
  assert.equal(r.ok, true);
  assert.ok(JSON.stringify(r.stagePatch).includes("scan-c5"));
});
