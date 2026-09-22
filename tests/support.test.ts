import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAppraisal } from "../src/lib/evidence/appraise";
import { ingestRecords } from "../src/lib/evidence/records";
import { evaluateDerivation } from "../src/lib/evidence/support";
import { ledgerIssues } from "../src/lib/evidence/ledger";
import type { ClaimAssertion } from "../src/lib/types";

const SYN_NUM_03 =
  "Nausea incidence at 12 hours was 18%. Satisfaction at 48 hours was 7.4.";
const SYN_NUM_04 = "There were 26 events among 195 procedures.";

function pack(abstract: string, doi: string) {
  return ingestRecords(
    [{ title: "Synth", authors: "A", year: 2024, venue: "J", doi, abstract }],
    { id: "ret-sup", provider: "fixture" },
  );
}

test("same_number_wrong_endpoint_is_rejected", () => {
  const { items, documents } = pack(SYN_NUM_03, "10.5555/syn-num-03");
  const r = applyAppraisal(
    items,
    {
      claims: [
        {
          id: "c-wrong",
          text: "Nausea at 48 hours was 18%.",
          kind: "source-derived",
          sourceIds: [items[0].id],
          uncertainty: "low",
          assertion: { outcome: "nausea", timeWindow: "48 hours", estimate: "18", unit: "%" },
        },
      ],
    },
    documents,
  );
  assert.equal(r.claims.length, 0);
  assert.equal(r.quarantine.claims.length, 1);
  assert.ok(r.issues.some((i) => /endpoint\/time/.test(i.message) || i.code === "unsupported"));
  const positive = applyAppraisal(
    items,
    {
      claims: [
        {
          id: "c-ok",
          text: "Nausea at 12 hours was 18%.",
          kind: "source-derived",
          sourceIds: [items[0].id],
          passage: "Nausea incidence at 12 hours was 18%.",
          uncertainty: "moderate",
          assertion: { outcome: "nausea", timeWindow: "12 hours", estimate: "18", unit: "%" },
        },
      ],
    },
    documents,
  );
  assert.equal(positive.claims.length, 1);
  assert.equal(positive.claims[0].supportStatus, "supported");
});

test("derived_number_requires_operands_and_method", () => {
  const { items, documents } = pack(SYN_NUM_04, "10.5555/syn-num-04");
  const r = applyAppraisal(
    items,
    {
      claims: [
        {
          id: "a-events",
          text: "26 events were observed.",
          kind: "source-derived",
          sourceIds: [items[0].id],
          passage: "26 events",
          uncertainty: "moderate",
          assertion: { outcome: "events", estimate: "26" },
        },
        {
          id: "a-proc",
          text: "195 procedures were performed.",
          kind: "source-derived",
          sourceIds: [items[0].id],
          passage: "195 procedures",
          uncertainty: "moderate",
          assertion: { outcome: "procedures", estimate: "195" },
        },
        {
          id: "c-pct",
          text: "The event rate was 13.3%.",
          kind: "source-derived",
          sourceIds: [items[0].id],
          uncertainty: "moderate",
          assertion: {
            outcome: "event rate",
            estimate: "13.3",
            unit: "%",
            derivation: { method: "percent", operandIds: ["a-events", "a-proc"], rounding: { mode: "half-up", decimals: 1 } },
          },
        },
        {
          id: "c-ci",
          text: "The 95% CI was 10.1 to 16.8.",
          kind: "source-derived",
          sourceIds: [items[0].id],
          uncertainty: "low",
          assertion: { outcome: "event rate", estimate: "13.3" },
        },
      ],
    },
    documents,
  );
  assert.equal(r.claims.some((c) => c.id === "c-pct"), true);
  assert.equal(r.claims.find((c) => c.id === "c-pct")?.supportStatus, "supported");
  const derived = r.claims.find((c) => c.id === "c-pct")?.assertion?.derivation;
  assert.deepEqual(derived?.operandIds, ["a-events", "a-proc"]);
  assert.equal(derived?.method, "percent");
  assert.equal(r.quarantine.claims.some((c) => c.id === "c-ci"), true);
  assert.equal(r.claims.some((c) => c.id === "c-ci"), false);

  const byId = new Map<string, ClaimAssertion>([
    ["a-events", r.claims.find((c) => c.id === "a-events")!.assertion!],
    ["a-proc", r.claims.find((c) => c.id === "a-proc")!.assertion!],
  ]);
  const ev = evaluateDerivation(
    { method: "percent", operandIds: ["a-events", "a-proc"], rounding: { mode: "half-up", decimals: 1 } },
    byId,
  );
  assert.equal(ev.ok, true);
  assert.equal(ev.value, 13.3);

  const ledger = ledgerIssues(r.claims, items, documents);
  assert.equal(ledger.filter((i) => i.claimId === "c-pct" && i.severity === "block").length, 0);
});
