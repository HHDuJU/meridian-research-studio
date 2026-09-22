import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  canonicalJson,
  collectArtifactHashes,
  deepEqualJson,
  evalError,
  evalIssues,
  exitCodeForStatuses,
  normalizeJson,
  parsePersistedStudio,
  sourceContentChanged,
  statusOfCheckpoints,
  studyWithoutEnvelope,
  screenHas,
} from "../scripts/run-scenarios.mjs";
import { treeSha256, sourceManifest } from "../scripts/tree-digest.mjs";
import { useStudio } from "../src/lib/store";

test("deepEqualJson_normalises_and_compares", () => {
  assert.equal(deepEqualJson({ a: 1 }, { a: 1 }), true);
  assert.equal(deepEqualJson({ a: 1 }, { a: 2 }), false);
  assert.deepEqual(normalizeJson({ x: undefined }), {});
});

test("deepEqualJson_ignores_object_key_order_only", () => {
  assert.equal(deepEqualJson({ b: 1, a: { d: 4, c: 3 } }, { a: { c: 3, d: 4 }, b: 1 }), true);
  assert.equal(deepEqualJson({ a: [1, 2] }, { a: [2, 1] }), false);
  assert.equal(JSON.stringify(canonicalJson({ b: 1, a: 2 })), JSON.stringify({ a: 2, b: 1 }));
});

test("parsePersistedStudio_reads_zustand_shape", () => {
  const raw = JSON.stringify({ state: { studies: [{ id: "s1", title: "T" }] }, version: 4 });
  assert.equal(parsePersistedStudio(raw)[0].id, "s1");
  assert.equal(parsePersistedStudio(JSON.stringify({ studies: [{ id: "s2" }] }))[0].id, "s2");
  assert.deepEqual(parsePersistedStudio(null), []);
});

test("studyWithoutEnvelope_drops_meta", () => {
  const s = studyWithoutEnvelope({ id: "x", title: "t", meta: { modelMode: "replay" } });
  assert.equal(s.id, "x");
  assert.equal("meta" in s, false);
});

test("evalIssues_min_99999_fails", () => {
  const checkpoints = [];
  evalIssues({ count: { min: 99999 } }, [], {}, 1, { do: "illuminate" }, checkpoints);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].check, "issues.count");
  assert.equal(checkpoints[0].ok, false);
  assert.equal(checkpoints[0].observed, 0);
});

test("evalIssues_includes_path_and_code", () => {
  const checkpoints = [];
  evalIssues(
    { includes: [{ path: "gradeOverall", code: "dropped" }] },
    [{ path: "gradeOverall", code: "dropped" }],
    {},
    2,
    { do: "illuminate" },
    checkpoints,
  );
  assert.equal(checkpoints[0].ok, true);
  const miss = [];
  evalIssues({ includes: [{ path: "family", code: "cleared" }] }, [], {}, 2, { do: "illuminate" }, miss);
  assert.equal(miss[0].ok, false);
});

test("evalError_missing_required_refusal_text_fails", () => {
  const checkpoints = [];
  evalError({ shown: true, includes: "did not return JSON" }, "Generation failed.", "nothing useful", {}, 4, { do: "illuminate" }, checkpoints);
  assert.equal(checkpoints.length, 2);
  assert.equal(checkpoints[0].check, "error.shown");
  assert.equal(checkpoints[0].ok, true);
  assert.equal(checkpoints[1].check, "error.includes");
  assert.equal(checkpoints[1].ok, false);
  assert.match(checkpoints[1].reason, /required refusal text omitted/);
});

test("sourceContentChanged_detects_abstract_and_keyFindings", () => {
  assert.equal(sourceContentChanged("a", "a"), false);
  assert.equal(sourceContentChanged("Observed benefit", "Correction: no observed benefit"), true);
  assert.equal(
    sourceContentChanged({ documentId: "d1", sha256: "aa", text: "old" }, { documentId: "d2", sha256: "bb", text: "new" }),
    true,
  );
});

test("store_change_source_of_abstract_is_not_a_noop", () => {
  const S = () => useStudio.getState();
  const created = S().create({ family: "qi-pdsa", setting: "Ward", rawNeed: "Need." });
  const item = {
    id: "ev-abs1",
    title: "Tenure and alarm functioning in rented rural housing: a cross-sectional study in two districts",
    authors: "A",
    year: 2020,
    source: "J",
    kind: "observational",
    grade: "unrated",
    methodQuality: null,
    relevance: null,
    notes: "",
    verification: "ai-lead",
    contextTags: [],
    keyFindings: "28 percent of rented homes",
    limitations: "",
    abstract: { documentId: "doc-old", sha256: "abc", text: "old abstract" },
    provenance: {
      origin: "retrieval",
      retrievalEventIds: ["r1"],
      identifiers: {},
      access: "abstract",
      status: "retrieved",
      checks: [],
    },
  };
  S().mergeStage(created.id, "scan", { items: [item] });
  const before = S().studies.find((x) => x.id === created.id)!.scan.items[0].abstract;
  const text = "new abstract text after source change";
  S().mergeStage(created.id, "scan", {
    items: [{ ...item, abstract: { documentId: "doc-new", sha256: "def", text } }],
  });
  const after = S().studies.find((x) => x.id === created.id)!.scan.items[0].abstract;
  assert.equal(sourceContentChanged(before, after), true);
  assert.equal(after?.text, text);
});

test("collectArtifactHashes_only_files_on_disk_and_status_exit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-art-"));
  fs.writeFileSync(path.join(dir, "export.json"), "{}\n");
  fs.writeFileSync(path.join(dir, "store-final.json"), "{}\n");
  const { artifacts, artifactSha256 } = collectArtifactHashes(dir, ["export.json", "store-final.json", "missing.png"]);
  assert.deepEqual(artifacts, ["export.json", "store-final.json"]);
  assert.equal(typeof artifactSha256["export.json"], "string");
  assert.equal(artifactSha256["export.json"].length, 64);
  assert.equal("missing.png" in artifactSha256, false);
  assert.equal(statusOfCheckpoints([]), "INCOMPLETE");
  assert.equal(statusOfCheckpoints([{ ok: false, reason: "x" }]), "FAIL");
  assert.equal(statusOfCheckpoints([{ ok: true, reason: "" }]), "PASS");
  assert.equal(exitCodeForStatuses(["PASS", "FAIL"]), 1);
  assert.equal(exitCodeForStatuses(["PASS"]), 0);
});

test("treeSha256_is_pinned_source_digest", () => {
  const root = path.resolve(".");
  const a = treeSha256(root);
  const b = treeSha256(root);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  const files = sourceManifest(root);
  assert.ok(files.length > 10);
  assert.equal(files.some((f) => f.path.startsWith("node_modules/")), false);
  assert.equal(files.some((f) => f.path.endsWith(".tar.gz")), false);
  assert.equal(files.some((f) => f.path.startsWith(".vercel/") || f.path.split("/")[0] === ".vercel"), false);
});

test("screenHas_is_case_insensitive_and_honours_anyOf", () => {
  assert.equal(screenHas("selection Proposed · action blocked", "proposed"), true);
  assert.equal(screenHas("Grade Unrated", "unrated"), true);
  assert.equal(screenHas("Applied with notes. constraints: replacement was refused", { anyOf: ["kept", "refused", "not applied"] }), true);
  assert.equal(screenHas("nothing relevant", { anyOf: ["kept", "refused", "not applied"] }), false);
  assert.equal(screenHas("Certainty not assessed (no GRADE label).", "not assessed"), true);
});

test("source_digest_ignores_generated_vercel_output", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-digest-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
  const d1 = treeSha256(dir);
  fs.mkdirSync(path.join(dir, ".vercel", "output"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".vercel", "output", "index.js"), "generated-bundle\n");
  const d2 = treeSha256(dir);
  assert.equal(d1, d2, "generated .vercel output must not change the source digest");
  fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 2;\n");
  const d3 = treeSha256(dir);
  assert.notEqual(d1, d3, "a source change must change the digest");
});

