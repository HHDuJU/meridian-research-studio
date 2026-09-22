import { test } from "node:test";
import assert from "node:assert/strict";
import { compactStudy, EVIDENCE_IN_CONTEXT, rankEvidence } from "../src/lib/compact";
import { createStudy } from "../src/lib/defaults";
import type { EvidenceItem, Study } from "../src/lib/types";

function item(n: number, over: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: `ev-${n}`,
    title: `Synthetic record ${n}`,
    authors: "Synthetic, Author",
    year: 2026,
    source: "J",
    kind: "observational",
    grade: "low",
    methodQuality: 10,
    relevance: 5,
    notes: "",
    verification: "ai-lead",
    doi: `10.9999/synthetic.${n}`,
    contextTags: [],
    keyFindings: `FINDING_${n}`,
    limitations: `LIMIT_${n}`,
    provenance: { origin: "model", retrievalEventIds: [], identifiers: { doi: `10.9999/synthetic.${n}` }, access: "unknown", status: "unverified", checks: [] },
    ...over,
  };
}

function study(items: EvidenceItem[]): Study {
  const s = createStudy({ family: "cohort", setting: "Hamilton, Ontario", rawNeed: "need" });
  s.scan.items = items;
  s.scan.gradeOverall = "low";
  return s;
}

test("the most relevant record is shown even when it is the 13th in the array; hidden records are counted and named", () => {
  const items = Array.from({ length: 13 }, (_, i) => item(i + 1));
  items[12] = item(13, { relevance: 99, provenance: { ...items[12].provenance, status: "verified" } });
  const out = compactStudy(study(items), "gaps");
  assert.ok(out.includes("Synthetic record 13"));
  assert.ok(out.includes(`+${13 - EVIDENCE_IN_CONTEXT} more records not shown`));
  assert.match(out, /ids: ev-\d+/);
});

test("findings, limitations and identifiers travel with each record; status counts are summarised", () => {
  const out = compactStudy(study([item(1), item(2, { provenance: { ...item(2).provenance, status: "verified" } })]), "gaps");
  assert.ok(out.includes("FINDING_1") && out.includes("LIMIT_2") && out.includes("doi:10.9999/synthetic.1"));
  assert.match(out, /1 unverified, 1 verified|1 verified, 1 unverified/);
  assert.ok(out.includes("SEARCHES ACTUALLY RUN: none — all evidence below is unretrieved leads."));
});

test("clipping is announced with the number of characters removed", () => {
  const s = study([item(1)]);
  s.scan.synthesis = "x".repeat(900) + " DECISIVE_CAVEAT";
  const out = compactStudy(s, "gaps");
  assert.match(out, /\[clipped \d+ chars\]/);
});

test("selected hypothesis, outcome measure/timing, retrieval events, claims and unresolved access are carried", () => {
  const s = study([item(1)]);
  s.hypotheses.items = [
    { id: "h-1", statement: "H1", novelty: null, need: null, practiceChange: null, feasibility: null, parsimony: null, rationale: "", risks: "" },
    { id: "h-2", statement: "H2", novelty: null, need: null, practiceChange: null, feasibility: null, parsimony: null, rationale: "", risks: "" },
  ];
  s.hypotheses.selectedId = "h-2";
  s.protocol.overview = "overview";
  s.protocol.outcomes = [{ id: "o-1", role: "primary", name: "Pain", measure: "NRS", timing: "6 months", why: "", patientCentered: null }];
  s.scan.retrievalEvents = [{ id: "ret-1", at: "2026-09-20T00:00:00Z", provider: "openalex", query: "q", resultCount: 42, recordIds: ["ev-1"], status: "ok", performedBy: "app" }];
  s.scan.claims = [{ id: "c-1", text: "RFA reduces pain at 6 months", kind: "source-derived", sourceIds: ["ev-1"], location: "Table 2", uncertainty: "moderate" }];
  s.scan.unresolvedAccess = ["clinicaltrials.gov blocked"];
  const out = compactStudy(s, "stats");
  assert.ok(out.includes("h-2 [SELECTED]"));
  assert.ok(out.includes("primary: Pain [NRS @ 6 months; patient-centred?]"));
  assert.ok(out.includes('openalex: "q" → ok, 42 hits'));
  assert.ok(out.includes("c-1 [source-derived; moderate uncertainty]") && out.includes("@ Table 2"));
  assert.ok(out.includes("UNRESOLVED ACCESS: clinicaltrials.gov blocked"));
});

test("rankEvidence: verified > retrieved > unverified; then relevance with unknown last", () => {
  const ranked = rankEvidence([
    item(1, { relevance: null }),
    item(2, { relevance: 90 }),
    item(3, { relevance: 10, provenance: { ...item(3).provenance, status: "retrieved" } }),
    item(4, { relevance: 1, provenance: { ...item(4).provenance, status: "verified" } }),
  ]).map((i) => i.id);
  assert.deepEqual(ranked, ["ev-4", "ev-3", "ev-2", "ev-1"]);
});

test("at the scan (appraisal) stage every record is shown with its abstract; downstream stages keep the ranked cut", () => {
  const items = Array.from({ length: 15 }, (_, i) => item(i + 1, { notes: `ABSTRACT_${i + 1} lorem ipsum` }));
  const scanCtx = compactStudy(study(items), "scan");
  assert.ok(scanCtx.includes("Synthetic record 15") && scanCtx.includes("ABSTRACT_15"));
  assert.equal(scanCtx.includes("more records not shown"), false);
  const gapsCtx = compactStudy(study(items), "gaps");
  assert.ok(gapsCtx.includes("+3 more records not shown"));
  assert.equal(gapsCtx.includes("ABSTRACT_1 "), false);
});
