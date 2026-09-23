import { test } from "node:test";
import assert from "node:assert/strict";
import { createStudy, queryHashOf, scanContentRevision } from "../src/lib/defaults";
import { applyAiResult } from "../src/lib/apply-ai";
import { applyAppraisal } from "../src/lib/evidence/appraise";
import { applyDecision, decisionIsSupported } from "../src/lib/evidence/decision";
import { fixtureAdapter, fixtureRecordingUrl } from "../src/lib/evidence/fixture-adapter";
import { markUnknownIds } from "../src/lib/evidence/ids";
import { illuminateDecision } from "../src/lib/illuminate";
import { extractNumbers, nullValueReferences } from "../src/lib/evidence/numbers";
import { supportClaim } from "../src/lib/evidence/support";
import { runSearch } from "../src/lib/evidence/retrieve";
import { recordedTransport } from "../src/lib/evidence/transport";
import { ingestRecords } from "../src/lib/evidence/records";
import { useStudio } from "../src/lib/store";
import { orderNeedsReview, STAGE_IDS } from "../src/lib/types";
import type { Claim, EvidenceItem, SourceDocument, Study } from "../src/lib/types";

function leadStudy(): Study {
  const s = createStudy({ family: "cohort", setting: "ward", rawNeed: "Does the pathway change pain at 48 hours?" });
  const applied = applyAiResult(
    "scan",
    { query: "pain pathway", items: [{ title: "Model lead only", year: 2024, authors: "A", source: "model" }] },
    s.family,
    s,
  );
  s.scan = { ...s.scan, ...(applied.stagePatch as Study["scan"]) };
  return s;
}

test("model_lead_access_is_unknown", () => {
  const s = leadStudy();
  assert.equal(s.scan.items[0].provenance.access, "unknown");
  assert.equal(s.scan.items[0].provenance.origin, "model");
  assert.equal(s.scan.items[0].provenance.status, "unverified");
});

test("hyphenated_words_are_not_ids", () => {
  const known = new Set(["local-1", "ev-2"]);
  const r = markUnknownIds("This is a local-type gate-keeping claim-based note about local-1.", known);
  assert.deepEqual(r.unknown, []);
  assert.equal(r.text.includes("⟦unresolved:"), false);
  const ghost = markUnknownIds("See ev-9 next.", known);
  assert.deepEqual(ghost.unknown, ["ev-9"]);
});

test("stripped_model_gate_is_a_visible_issue", () => {
  const s = createStudy({ family: "cohort", setting: "ward", rawNeed: "Need" });
  const d = illuminateDecision(s, "problem", { statement: "Pain after surgery", investigatorConfirmsEmptySearch: true }, "stale-not-used");
  const hit = d.applied.issues.find((i) => i.path === "investigatorConfirmsEmptySearch" && i.code === "dropped");
  assert.ok(hit, JSON.stringify(d.applied.issues));
});

test("failed_provider_call_is_recorded", async () => {
  const adapter = fixtureAdapter();
  const url = fixtureRecordingUrl("no hits");
  const transport = recordedTransport({ [url]: { status: 429, body: "", note: "rate limit" } });
  const result = await runSearch(adapter, "no hits", transport);
  assert.equal(result.event.status, "error");
  assert.equal(result.event.resultCount, null);
  assert.deepEqual(result.event.recordIds, []);
  assert.equal(result.items.length, 0);
});

test("needs_review_in_stage_order", () => {
  const ordered = orderNeedsReview(["protocol", "stats", "map", "scan", "map"]);
  const indexes = ordered.map((id) => STAGE_IDS.indexOf(id));
  assert.deepEqual(ordered, ["scan", "map", "protocol", "stats"]);
  assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b));
});

test("explicit_null_clears_grade_on_reappraisal", () => {
  const { items } = ingestRecords([{ title: "Retrieved", year: 2024, authors: "A", abstract: "Pain at 48 hours was 10 percent." }], { id: "ret-1", provider: "fixture" });
  items[0].provenance.status = "retrieved";
  items[0].grade = "moderate";
  const study = createStudy({ family: "cohort", setting: "ward", rawNeed: "Need" });
  study.scan.items = items;
  study.scan.gradeOverall = "low";
  const out = applyAppraisal(items, { annotations: [{ id: items[0].id, grade: null }], gradeOverall: null }, study.documents ?? []);
  assert.equal(out.items[0].grade, "unrated");
  assert.equal(out.gradeOverall, "");
  assert.ok(out.issues.some((i) => i.code === "cleared" && String(i.message).includes("unrated")));
  assert.ok(out.issues.some((i) => i.path === "gradeOverall" && i.code === "cleared"));
});

test("manual_check_cannot_verify", () => {
  const S = () => useStudio.getState();
  const s = S().create({ family: "cohort", setting: "ward", rawNeed: "Need" });
  const { items } = ingestRecords([{ title: "Ward study", year: 2020, authors: "B", abstract: "Twelve patients." }], { id: "ret-2", provider: "fixture" });
  items[0].provenance.status = "retrieved";
  S().mergeStage(s.id, "scan", { items });
  const refused = S().changeSource(s.id, { id: items[0].id }, "status", "verified", "looks right");
  assert.equal(refused.ok, false);
  const match = S().changeSource(s.id, { id: items[0].id }, "status", "match", "title and year agree on the printout");
  assert.equal(match.ok, true);
  const after = S().studies.find((x) => x.id === s.id)!;
  const item = after.scan.items[0];
  assert.notEqual(item.provenance.status, "verified");
  assert.equal(item.provenance.checks.at(-1)?.provider, "manual");
  assert.equal(item.provenance.checks.at(-1)?.result, "match");
  const mismatch = S().changeSource(s.id, { id: items[0].id }, "status", "mismatch", "year is 2019 in the registry");
  assert.equal(mismatch.ok, true);
  const later = S().studies.find((x) => x.id === s.id)!.scan.items[0];
  assert.equal(later.provenance.status, "mismatch");
});

function claimOn(item: EvidenceItem, text: string): Claim {
  return {
    id: "c-num",
    kind: "source-derived",
    text,
    sourceIds: [item.id],
    uncertainty: "moderate",
    supportStatus: "unassessed",
    assertion: { supportStatus: "unassessed", spans: [] },
  } as Claim;
}

test("null_value_reference_supported_by_ci_bounds", () => {
  const { items, documents } = ingestRecords(
    [{ title: "CI study", year: 2021, authors: "C", abstract: "Odds ratio 1.09, 95% CI 0.88 to 1.35." }],
    { id: "ret-3", provider: "fixture" },
  );
  items[0].provenance.status = "retrieved";
  const claim = claimOn(items[0], "The interval including 1 is compatible with no difference.");
  const v = supportClaim(claim, items, documents, "claims[0]");
  assert.equal(v.status, "supported");
  assert.equal(v.assertion.derivation?.method, "contains");
  assert.ok(nullValueReferences("an interval that included 1").some((r) => r.value === 1));
});

test("null_value_reference_refused_when_ci_excludes_it", () => {
  const { items, documents } = ingestRecords(
    [{ title: "CI study", year: 2021, authors: "C", abstract: "Difference 4.2, 95% CI 1.2 to 6.4." }],
    { id: "ret-4", provider: "fixture" },
  );
  items[0].provenance.status = "retrieved";
  const claim = claimOn(items[0], "The interval including 0 supports no difference.");
  const v = supportClaim(claim, items, documents, "claims[0]");
  assert.equal(v.status, "quarantined");
});

test("number_words_below_eleven_match_digits", () => {
  const words = extractNumbers("seven days and six months");
  const digits = extractNumbers("7-day follow-up at month 6");
  const seven = words.find((n) => n.numeric === 7);
  const six = words.find((n) => n.numeric === 6);
  assert.equal(seven?.role, "duration");
  assert.equal(six?.role, "duration");
  assert.ok(digits.some((n) => n.numeric === 7 && n.role === "duration"));
  assert.ok(digits.some((n) => n.numeric === 6 && n.role === "duration"));
});

test("hyphenated_duration_matches_spelled_duration", () => {
  const a = extractNumbers("four-hour workshop and a 12-week course");
  const b = extractNumbers("four hours and 12 weeks");
  assert.ok(a.some((n) => n.numeric === 4 && n.role === "duration"));
  assert.ok(a.some((n) => n.numeric === 12 && n.role === "duration"));
  assert.ok(b.some((n) => n.numeric === 4 && n.role === "duration"));
  assert.ok(b.some((n) => n.numeric === 12 && n.role === "duration"));
});

test("one_day_unit_is_not_a_measured_duration", () => {
  const nums = extractNumbers("In one day unit the median was 3.1 hours");
  assert.equal(nums.some((n) => n.numeric === 1 && n.role === "duration"), false);
  assert.ok(nums.some((n) => n.numeric === 3.1 && n.role === "duration"));
});

test("day_hyphen_word_is_not_a_duration", () => {
  const nums = extractNumbers("214 day-surgery cases and 14 day-case models");
  assert.equal(nums.some((n) => n.role === "duration"), false);
  assert.ok(nums.some((n) => n.numeric === 214 && n.role === "estimate"));
  assert.ok(nums.some((n) => n.numeric === 14 && n.role === "estimate"));
});

test("unit_then_percent_is_not_a_duration", () => {
  const nums = extractNumbers("Complete-entry days 91 percent; at 24 months 21 against 27 percent");
  assert.equal(nums.some((n) => n.numeric === 91 && n.role === "duration"), false);
  assert.equal(nums.some((n) => n.numeric === 21 && n.role === "duration"), false);
  assert.ok(nums.some((n) => n.numeric === 24 && n.role === "duration"));
  assert.ok(nums.some((n) => n.numeric === 91));
});

test("letter_hyphen_digit_is_not_negative", () => {
  const nums = extractNumbers("under-18s were excluded; the CI was -0.9 to 3.7");
  assert.equal(nums.some((n) => n.numeric === -18), false);
  assert.ok(nums.some((n) => n.numeric === 18));
  assert.ok(nums.some((n) => n.numeric === -0.9));
});

test("alphanumeric_identifier_is_not_a_number", () => {
  const nums = extractNumbers("SGLT2 inhibitors and PROMIS29 scores in T2DM");
  assert.equal(nums.some((n) => n.numeric === 2 || n.numeric === 29), false);
});

test("undeclared_rounding_is_unsupported", () => {
  const { items, documents } = ingestRecords(
    [{ title: "Events", year: 2022, authors: "D", abstract: "There were 3.1 events a month." }],
    { id: "ret-5", provider: "fixture" },
  );
  items[0].provenance.status = "retrieved";
  const claim = claimOn(items[0], "about 3 events a month");
  const v = supportClaim(claim, items, documents, "claims[0]");
  assert.equal(v.status, "quarantined");
});

test("undeclared_sum_is_unsupported", () => {
  const { items, documents } = ingestRecords(
    [{ title: "Sample", year: 2022, authors: "E", abstract: "20 patients and 12 carers attended." }],
    { id: "ret-6", provider: "fixture" },
  );
  items[0].provenance.status = "retrieved";
  const claim = claimOn(items[0], "32 participants attended");
  const v = supportClaim(claim, items, documents, "claims[0]");
  assert.equal(v.status, "quarantined");
});

function decided(study: Study, kind: string, claimIds: string[], extra: Record<string, unknown> = {}) {
  return applyDecision({ kind, statement: "Next step", claimIds, ...extra }, study).decision!;
}

test("dropped_claim_blocks_acceptance_until_reissue", () => {
  const s = leadStudy();
  const ghost = decided(s, "narrow", ["missing-claim-9"]);
  assert.ok(ghost.droppedClaimIds?.includes("missing-claim-9"));
  const blocked = decisionIsSupported(ghost, s);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /missing-claim-9/);
  const reissued = decided(s, "narrow", []);
  assert.equal(decisionIsSupported(reissued, s).ok, true);
});

test("implementation_with_no_claims_needs_confirmed_empty_search", () => {
  const s = createStudy({ family: "implementation", setting: "ward", rawNeed: "Need" });
  const bare = decided(s, "implementation", []);
  assert.equal(decisionIsSupported(bare, s).ok, false);
  s.scan.query = "empty query";
  s.scan.emptySearchConfirmation = {
    by: "investigator",
    at: "2026-09-22T00:00:00.000Z",
    queryHash: queryHashOf(s.scan.query),
    revision: scanContentRevision(s),
  };
  assert.equal(decisionIsSupported(bare, s).ok, true);
  s.scan.items = [
    {
      id: "ev-lead1",
      title: "Model lead",
      authors: "A",
      year: 2020,
      source: "model",
      kind: "grey",
      grade: "unrated",
      methodQuality: 0,
      relevance: 0,
      notes: "",
      verification: "ai-lead",
      contextTags: [],
      keyFindings: "",
      limitations: "",
      provenance: {
        origin: "model",
        retrievalEventIds: [],
        identifiers: {},
        access: "unknown",
        status: "unverified",
        checks: [],
      },
    },
  ];
  s.scan.emptySearchConfirmation = {
    ...s.scan.emptySearchConfirmation!,
    revision: scanContentRevision(s),
  };
  assert.equal(decisionIsSupported(bare, s).ok, true, "model leads are not retrieved records");
});

test("all_claims_dropped_refuses_acceptance", () => {
  const { items } = ingestRecords([{ title: "Retrieved", year: 2020, authors: "F", abstract: "Ten patients." }], { id: "ret-7", provider: "fixture" });
  items[0].provenance.status = "retrieved";
  const s = createStudy({ family: "cohort", setting: "ward", rawNeed: "Need" });
  s.scan.items = items;
  const d = decided(s, "pursue", ["no-such-claim"]);
  assert.equal(decisionIsSupported(d, s).ok, false);
  assert.match(decisionIsSupported(d, s).reason, /no-such-claim/);
});

test("narrow_without_claims_accepted_action_blocked", () => {
  const s = createStudy({ family: "cohort", setting: "ward", rawNeed: "Need" });
  const d = decided(s, "narrow", [], { gates: [{ requirement: "Ethics approval", status: "unmet" }] });
  assert.equal(decisionIsSupported(d, s).ok, true);
  Sstore: {
    const S = () => useStudio.getState();
    const created = S().create({ family: "cohort", setting: "ward", rawNeed: "Need" });
    S().mergeStage(created.id, "design", { decisions: [d] });
    const r = S().acceptDecision(created.id, "latest");
    assert.equal(r.ok, true);
    const after = S().studies.find((x) => x.id === created.id)!;
    assert.equal(after.design.decisions.at(-1)?.selectionStatus, "accepted");
    assert.equal(after.design.decisions.at(-1)?.actionStatus, "blocked");
  }
});
