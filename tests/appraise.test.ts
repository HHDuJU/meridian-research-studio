import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyAppraisal } from "../src/lib/evidence/appraise";
import { parseConsensusConnectorExport } from "../src/lib/evidence/providers/consensus";
import { ingestExternalSearch } from "../src/lib/evidence/retrieve";
import { ledgerIssues } from "../src/lib/evidence/ledger";

const exportText = fs.readFileSync(new URL("./fixtures/consensus-export-2026-09-20.txt", import.meta.url), "utf8");
const base = () => ingestExternalSearch("consensus-connector", "q", parseConsensusConnectorExport(exportText), "connector").items;

test("annotations update appraisal fields only; identity and provenance are untouchable", () => {
  const items = base().map((i) => ({
    ...i,
    provenance: {
      ...i.provenance,
      checks: [{ id: "chk-1", at: "2026-09-20T00:00:00Z", provider: "manual" as const, identifier: i.doi ?? "n/a", result: "match" as const }],
    },
  }));
  const r = applyAppraisal(items, {
    annotations: [{ id: items[0].id, relevance: 90, kind: "systematic-review", grade: "moderate", keyFindings: "pain ↓ at 12 wk", limitations: "I² 83%", title: "HACKED", doi: "10.0/hack", provenance: { status: "verified" } }],
  });
  const it = r.items[0];
  assert.equal(it.relevance, 90);
  assert.equal(it.kind, "systematic-review");
  assert.equal(it.grade, "moderate");
  assert.equal(it.title, items[0].title);
  assert.equal(it.doi, items[0].doi);
  assert.equal(it.provenance.status, "retrieved");
  assert.equal(r.issues.filter((i) => /cannot be changed by appraisal/.test(i.message)).length, 3);
});

test("annotations for ids that do not exist are dropped and reported — the model cannot invent records", () => {
  const items = base();
  const r = applyAppraisal(items, { annotations: [{ id: "ev-made-up", relevance: 99 }] });
  assert.deepEqual(r.unknownIds, ["ev-made-up"]);
  assert.equal(r.items.length, items.length);
});

test("claims are validated; unknown source ids are stripped and the ledger then flags the claim", () => {
  const items = base();
  const r = applyAppraisal(items, {
    claims: [
      { id: "c1", text: "Ablation reduced pain vs sham at 12 weeks (MD −1.20)", kind: "source-derived", sourceIds: [items[0].id], location: "Results", passage: "MD -1.20; 95% CI, -2.10 to -0.30", uncertainty: "moderate" },
      { id: "c2", text: "Bipolar RFA works", kind: "source-derived", sourceIds: ["ev-ghost"], uncertainty: "low" },
      { id: "c3", text: "We only have monopolar RF", kind: "local-fact", sourceIds: [], uncertainty: "low" },
      { text: "", kind: "inference", sourceIds: [] },
    ],
    gradeOverall: "excellent",
  });
  assert.equal(r.claims.length, 3);
  assert.deepEqual(r.claims[1].sourceIds, []);
  assert.equal(r.gradeOverall, undefined);
  const issues = ledgerIssues(r.claims, r.items);
  assert.ok(issues.some((i) => i.claimId === "c2" && i.severity === "block"));
  assert.equal(issues.filter((i) => i.claimId === "c1" && i.severity === "block").length, 0);
});
