/**
 * Candidate behaviour for the model→stage mapping. Each test inverts a baseline reproduction
 * (Appendix A finding 4) recorded against commit e27921e.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAiResult } from "../src/lib/apply-ai";
import type { EvidenceItem } from "../src/lib/types";

const scan = (raw: Record<string, unknown>) => applyAiResult("scan", raw, "cohort");
const items = (raw: Record<string, unknown>) => (scan(raw).stagePatch.items as EvidenceItem[]) ?? [];

test("unreported year stays unknown (null), not 2020", () => {
  assert.equal(items({ items: [{ title: "T" }] })[0].year, null);
});

test("unreported methodQuality/relevance stay null, not 50; out-of-range 1200 becomes null with an issue", () => {
  const r = scan({ items: [{ title: "T", methodQuality: 1200 }] });
  const it = (r.stagePatch.items as EvidenceItem[])[0];
  assert.equal(it.methodQuality, null);
  assert.equal(it.relevance, null);
  assert.ok(r.issues.some((i) => i.code === "out-of-range" && i.path === "items[0].methodQuality"));
});

test("unknown verification/kind/grade strings are not retained", () => {
  const r = scan({ items: [{ title: "T", verification: "verified-by-nobody", kind: "blog-post", grade: "excellent" }] });
  const it = (r.stagePatch.items as EvidenceItem[])[0];
  assert.equal(it.verification, "ai-lead");
  assert.equal(it.kind, "grey");
  assert.equal(it.grade, "unrated");
  assert.equal(r.issues.filter((i) => i.code === "resolved" || i.code === "invalid-enum").length, 3);
});

test("'landmark' label never yields a verified provenance", () => {
  const it = items({ items: [{ title: "T", verification: "landmark", doi: "10.1000/x" }] })[0];
  assert.equal(it.verification, "landmark");
  assert.equal(it.provenance.origin, "model");
  assert.equal(it.provenance.status, "unverified");
  assert.deepEqual(it.provenance.checks, []);
  assert.equal(it.provenance.identifiers.doi, "10.1000/x");
});

test("model-described sourcesConsulted is dropped with an issue, not stored", () => {
  const r = scan({ items: [], sourcesConsulted: ["PubMed", "Cochrane"] });
  assert.equal("sourcesConsulted" in r.stagePatch, false);
  assert.ok(r.issues.some((i) => i.path === "sourcesConsulted" && i.code === "dropped"));
});

test("objects inside string arrays are dropped, never coerced", () => {
  const it = items({ items: [{ title: "T", contextTags: ["night shift", { tag: "x" }] }] })[0];
  assert.deepEqual(it.contextTags, ["night shift"]);
});

test("omitted fields are absent from the patch, so a merge preserves reviewed content", () => {
  const r = scan({ items: [{ title: "T" }] });
  for (const k of ["query", "synthesis", "gradeRationale"]) assert.equal(k in r.stagePatch, false, k);
  // A3.2: an omitted grade over leads-only / zero retrieved records resolves unassessed.
  assert.equal(r.stagePatch.gradeOverall, "");
  assert.equal(r.ok, true);
});

test("explicit null clears a field; a bad gradeOverall enum is not applied", () => {
  const r = scan({ synthesis: null, gradeOverall: "excellent" });
  assert.equal(r.stagePatch.synthesis, "");
  // D20(c): zero records still resolve certainty to unassessed; the invalid enum is not stored as a GRADE.
  assert.equal(r.stagePatch.gradeOverall, "");
  assert.ok(r.issues.some((i) => i.path === "gradeOverall" && i.code === "invalid-enum"));
});

test("string 'false' for patientCentered becomes null with a malformed-boolean issue", () => {
  const r = applyAiResult("protocol", { outcomes: [{ name: "Pain", role: "primary", patientCentered: "false" }] }, "rct");
  const out = r.stagePatch.outcomes as { patientCentered: boolean | null; role: string }[];
  assert.equal(out[0].patientCentered, null);
  assert.ok(r.issues.some((i) => i.code === "malformed-boolean"));
});

test("an outcome with an unrecognised role is dropped rather than demoted to secondary", () => {
  const r = applyAiResult("protocol", { outcomes: [{ name: "Pain", role: "tertiary" }] }, "rct");
  assert.deepEqual(r.stagePatch.outcomes, []);
});

test("non-object payload → ok:false and nothing applied", () => {
  const r = applyAiResult("scan", "not json", "cohort");
  assert.equal(r.ok, false);
  assert.deepEqual(r.stagePatch, {});
});

test("payload with no recognised keys → ok:false", () => {
  assert.equal(applyAiResult("stats", { banana: 1 }, "cohort").ok, false);
});

test("design: valid recommendation is stored; invalid one leaves family untouched", () => {
  const good = applyAiResult("design", { recommended: "scoping-review", rationale: "r" }, "cohort");
  assert.equal(good.stagePatch.recommended, "scoping-review");
  assert.equal(good.stagePatch.basis, undefined);
  assert.equal(good.studyPatch?.family, undefined);
  const bad = applyAiResult("design", { recommended: "vibes-based", rationale: "r" }, "cohort");
  assert.equal("recommended" in bad.stagePatch, false);
  assert.deepEqual(bad.studyPatch ?? {}, {});
});

test("questions: PCC frame accepted with concept/context; unknown frame dropped", () => {
  const r = applyAiResult("questions", { items: [
    { text: "q", framework: "PCC", population: "adults", concept: "prehabilitation", context: "spine surgery" },
    { text: "q2", framework: "PICOTS-plus" },
  ] }, "scoping-review");
  const qs = r.stagePatch.items as { framework: string; concept?: string }[];
  assert.equal(qs.length, 1);
  assert.equal(qs[0].framework, "PCC");
  assert.equal(qs[0].concept, "prehabilitation");
});

test("hypotheses: scores may be null; selectedId must match an item", () => {
  const r = applyAiResult("hypotheses", { items: [{ id: "h-1", statement: "s", novelty: "high" }], selectedId: "h-9" }, "cohort");
  const hs = r.stagePatch.items as { novelty: number | null }[];
  assert.equal(hs[0].novelty, null);
  assert.equal("selectedId" in r.stagePatch, false);
});

test("voices: generated voices are always ai-lead regardless of label", () => {
  const r = applyAiResult("voices", { items: [{ theme: "t", quote: "q", verification: "landmark" }] }, "cohort");
  assert.equal((r.stagePatch.items as { verification: string }[])[0].verification, "ai-lead");
});
