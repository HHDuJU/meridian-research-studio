import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAppraisal } from "../src/lib/evidence/appraise";
import { ingestRecords } from "../src/lib/evidence/records";
import { applyAiResult } from "../src/lib/apply-ai";
import { createStudy } from "../src/lib/defaults";
import { extractNumbers } from "../src/lib/evidence/numbers";
import { decisionIsSupported } from "../src/lib/evidence/decision";
import type { DecisionRecord } from "../src/lib/types";

const SYN_NUM_01_A =
  "Eighty adults received a postoperative opioid dose of 7.4 versus 14.7 mg. No dosing interval is reported.";
const SYN_NUM_01_B = "Median time to first oral intake was 48 hours.";

function studyWith(records: { title: string; abstract: string; doi: string }[]) {
  const { items, documents } = ingestRecords(
    records.map((r) => ({ title: r.title, authors: "Synth", year: 2024, venue: "Synth J", doi: r.doi, abstract: r.abstract })),
    { id: "ret-num", provider: "fixture" },
  );
  const study = createStudy({ family: "rct", setting: "ward", rawNeed: "postoperative opioid interval" });
  return {
    study: {
      ...study,
      documents: [...(study.documents ?? []), ...documents],
      scan: {
        ...study.scan,
        items,
        retrievalEvents: [
          {
            id: "ret-num",
            at: "2026-09-22T00:00:00Z",
            provider: "fixture",
            query: "opioid dose",
            resultCount: items.length,
            recordIds: items.map((i) => i.id),
            status: "ok" as const,
            performedBy: "app" as const,
          },
        ],
      },
    },
    items,
    documents,
  };
}

test("reject_unsupported_48_hour_claim", () => {
  const { study, items, documents } = studyWith([
    { title: "Dose trial A", abstract: SYN_NUM_01_A, doi: "10.5555/syn-num-01a" },
    { title: "Intake trial B", abstract: SYN_NUM_01_B, doi: "10.5555/syn-num-01b" },
  ]);
  const payload = {
    claims: [
      {
        id: "c-48h",
        text: "The postoperative dose interval was 48 hours.",
        kind: "source-derived",
        sourceIds: [items[0].id],
        uncertainty: "low",
        assertion: { outcome: "postoperative dose", timeWindow: "48 hours", estimate: "48", unit: "hours" },
      },
    ],
  };
  const r = applyAppraisal(items, payload, documents);
  assert.equal(r.claims.some((c) => c.id === "c-48h"), false);
  assert.equal(r.quarantine.claims.some((c) => c.id === "c-48h"), true);
  assert.deepEqual(r.quarantine.claims[0].sourceIds, [items[0].id]);
  assert.ok(r.issues.some((i) => i.path.startsWith("claims[c-48h]") && (i.code === "unsupported" || i.code === "quote-not-in-source")));
  const live = applyAiResult("scan", payload, study.family, study);
  const q = live.stagePatch.quarantine as { claims: { id: string }[] };
  assert.equal(q.claims.some((c) => c.id === "c-48h"), true);
  const blocked = decisionIsSupported(
    {
      id: "d1",
      at: "2026-09-22T00:00:00Z",
      actor: "model",
      kind: "pursue",
      statement: "Use a 48-hour dose interval.",
      question: "interval",
      claimIds: ["c-48h"],
      criteria: [],
      gates: [],
      alternatives: [],
      inputRevision: "ev1-x",
      status: "proposed",
      selectionStatus: "proposed",
      actionStatus: "blocked",
    } as DecisionRecord,
    { ...study, scan: { ...study.scan, claims: r.claims } },
  );
  assert.equal(blocked.ok, false);
});

test("reject_forged_passage", () => {
  const { items, documents } = studyWith([
    { title: "Events paper", abstract: "Seven of fifty patients had events (7/50 events).", doi: "10.5555/syn-num-02" },
  ]);
  const forged = "zero deaths in 900 patients";
  const r = applyAppraisal(
    items,
    {
      claims: [
        {
          id: "c-forge",
          text: "There were zero deaths in 900 patients.",
          kind: "source-derived",
          sourceIds: [items[0].id],
          passage: forged,
          uncertainty: "low",
        },
      ],
    },
    documents,
  );
  assert.equal(r.claims.length, 0);
  assert.equal(r.quarantine.claims.length, 1);
  assert.equal(r.quarantine.claims[0].supportStatus, "quarantined");
  const issue = r.issues.find((i) => i.code === "quote-not-in-source");
  assert.ok(issue);
  assert.equal(issue!.path, "claims[c-forge].passage");
  assert.equal(issue!.value, forged);
});

test("claim_number_absent_from_cited_abstract_is_quarantined", () => {
  const { items, documents } = studyWith([
    { title: "Dose trial A", abstract: SYN_NUM_01_A, doi: "10.5555/syn-num-01a" },
  ]);
  const r = applyAppraisal(
    items,
    {
      annotations: [{ id: items[0].id, limitations: "The dosing interval was 48 hours." }],
      claims: [
        {
          id: "c-48h",
          text: "The postoperative dose interval was 48 hours.",
          kind: "source-derived",
          sourceIds: [items[0].id],
          uncertainty: "moderate",
          assertion: { outcome: "postoperative dose", timeWindow: "48 hours", estimate: "48", unit: "hours" },
        },
      ],
    },
    documents,
  );
  assert.equal(r.quarantine.claims.some((c) => c.id === "c-48h"), true);
  assert.equal(r.claims.some((c) => c.id === "c-48h"), false);
  assert.ok(r.quarantine.annotations.some((a) => (a as { field: string }).field === "limitations"));
  assert.equal(r.items[0].limitations, "");
  assert.ok(r.issues.some((i) => i.path === "annotations[" + items[0].id + "].limitations" && i.code === "unsupported"));
  assert.ok(r.issues.some((i) => i.path.startsWith("claims[c-48h]") && i.code === "unsupported"));
});

test("tokenizer_handles_clinical_notation", () => {
  const s = "95% CI -21.00 to -14.56; forty-eight hours; 70ºC; PROMIS-29; ev-x; p < 0.001";
  const nums = extractNumbers(s);
  const byRole = Object.fromEntries(nums.map((n) => [n.role + ":" + n.value, n]));
  assert.equal(nums.some((n) => n.role === "ci-level" && n.numeric === 95), true);
  const lo = nums.find((n) => n.role === "ci-lo");
  const hi = nums.find((n) => n.role === "ci-hi");
  assert.ok(lo && lo.numeric === -21);
  assert.ok(hi && hi.numeric === -14.56);
  const dur = nums.find((n) => n.role === "duration");
  assert.ok(dur && dur.numeric === 48 && dur.unit === "hours");
  const temp = nums.find((n) => n.role === "temperature");
  assert.ok(temp && temp.numeric === 70);
  const p = nums.find((n) => n.role === "p-value");
  assert.ok(p && p.numeric === 0.001);
  assert.equal(
    nums.some((n) => n.numeric === 29 && n.role !== "ci-level"),
    false,
    "PROMIS-29 digits are not an outcome",
  );
  assert.equal(Object.keys(byRole).join(",").includes("estimate:29"), false);
});
