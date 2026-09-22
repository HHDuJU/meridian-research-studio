import { test } from "node:test";
import assert from "node:assert/strict";
import { createStudy, migrateStudy } from "../src/lib/defaults";
import { applyAppraisal } from "../src/lib/evidence/appraise";
import { ingestRecords, retainIdOnCorrection, flagSuspectContentPairing, mergeIngested } from "../src/lib/evidence/records";
import { collapseIdenticalRecords } from "../src/lib/evidence/dedupe";
import { applyLookupOutcome, compareWithRegistry } from "../src/lib/evidence/verify";
import { applyDecision, evaluateDecision, evidenceRevision, studyRevision } from "../src/lib/evidence/decision";
import { lintActiveReferences, markUnknownIds, unresolvedActiveIds } from "../src/lib/evidence/ids";
import { publicationStatusFromLabel, treatAsFullTextRead } from "../src/lib/evidence/access";
import { applyAiResult } from "../src/lib/apply-ai";
import { useStudio } from "../src/lib/store";
import type { EvidenceItem } from "../src/lib/types";

test("do_not_verify_opposite_title", () => {
  const r = compareWithRegistry(
    { title: "Drug X prevents mortality after surgery", year: 2020 },
    { title: "Drug X does not prevent mortality after surgery", year: 2020, authors: "Different", venue: "Other" },
  );
  assert.equal(r.result, "mismatch", `Opposite title verified at similarity=${r.similarity}`);
});

test("year_off_by_one_note_says_differs", () => {
  const r = compareWithRegistry(
    { title: "Same invented title for identity", year: 2020 },
    { title: "Same invented title for identity", year: 2021, authors: "", venue: "" },
  );
  assert.equal(r.yearOffByOne, true);
  assert.equal(r.yearAgrees, false);
  const item: EvidenceItem = {
    id: "ev-y",
    title: "Same invented title for identity",
    authors: "",
    year: 2020,
    source: "",
    kind: "grey",
    grade: "unrated",
    methodQuality: null,
    relevance: null,
    notes: "",
    verification: "verify",
    contextTags: [],
    keyFindings: "",
    limitations: "",
    doi: "10.1234/synth.year",
    provenance: { origin: "retrieval", retrievalEventIds: ["r1"], identifiers: { doi: "10.1234/synth.year" }, access: "abstract", status: "retrieved", checks: [] },
  };
  const applied = applyLookupOutcome([item], ["10.1234/synth.year"], "crossref", {
    status: "ok",
    records: [{ title: item.title, authors: "", year: 2021, venue: "", doi: "10.1234/synth.year" }],
  });
  assert.match(applied.checks[0].note ?? "", /differs/);
});

test("retain_known_mismatch_on_transport_failure", () => {
  const item: EvidenceItem = {
    id: "ev-m",
    title: "T",
    authors: "",
    year: 2020,
    source: "",
    kind: "grey",
    grade: "unrated",
    methodQuality: null,
    relevance: null,
    notes: "",
    verification: "verify",
    contextTags: [],
    keyFindings: "",
    limitations: "",
    doi: "10.1234/synth.m",
    provenance: { origin: "retrieval", retrievalEventIds: ["r1"], identifiers: { doi: "10.1234/synth.m" }, access: "abstract", status: "mismatch", checks: [] },
  };
  const r = applyLookupOutcome([item], ["10.1234/synth.m"], "crossref", { status: "blocked", records: [], note: "403" });
  assert.equal(r.items[0].provenance.status, "mismatch");
  assert.equal(r.checks[0].result, "blocked");
});

test("appraisal_refuses_records_without_identity_attempt", () => {
  const { items } = ingestRecords([{ title: "Invented", authors: "A", year: 2024, venue: "J", abstract: "x".repeat(40) }], { id: "r", provider: "f" });
  const r = applyAppraisal(items, { annotations: [{ id: items[0].id, grade: "high" }] });
  assert.notEqual(r.items[0].grade, "high");
  assert.ok(r.issues.some((i) => /identity attempt/.test(i.message)));
});

test("do_not_discard_later_duplicate_content", () => {
  const { items: a } = ingestRecords([{ title: "T", authors: "A", year: 2021, venue: "J", doi: "10.1234/dup.test", abstract: "Short abstract" }], { id: "r1", provider: "f" });
  const { items: b } = ingestRecords([{ title: "T", authors: "A", year: 2021, venue: "J", doi: "10.1234/dup.test", abstract: "Full corrected abstract with decisive outcome RESULT_END" }], { id: "r2", provider: "f" });
  const r = collapseIdenticalRecords([...a, ...b]);
  assert.ok(JSON.stringify(r).includes("decisive outcome"));
  assert.ok(r.items[0].provenance.retrievalEventIds.length >= 2);
});

test("duplicate_abstract_is_flagged_at_ingestion", () => {
  const body = "SYNTHETIC ".repeat(40) + "trial result shared illegally across dois.";
  const { items } = ingestRecords(
    [
      { title: "Trial A", authors: "A", year: 2020, venue: "J", doi: "10.1234/trial.a", abstract: body },
      { title: "Protocol B", authors: "B", year: 2020, venue: "K", doi: "10.1234/protocol.b", abstract: body },
    ],
    { id: "r", provider: "f" },
  );
  const flagged = flagSuspectContentPairing(items);
  assert.equal(flagged[0].pairingIssue, "suspect-content-pairing");
  assert.equal(flagged[1].pairingIssue, "suspect-content-pairing");
});

test("invalidate_on_passage_or_source_edit", () => {
  const { items } = ingestRecords([{ title: "T", authors: "A", year: 2020, venue: "J", abstract: "Original result." }], { id: "r", provider: "f" });
  const study = migrateStudy({
    ...createStudy({ family: "retrospective", setting: "s", rawNeed: "n" }),
    scan: { items, claims: [{ id: "c1", text: "x", kind: "source-derived", sourceIds: [items[0].id], passage: "Original result.", uncertainty: "high" }], retrievalEvents: [], unresolvedAccess: [], sourcesConsulted: [], query: "", gradeOverall: "", gradeRationale: "", synthesis: "" },
  });
  const before = evidenceRevision(study);
  const next = {
    ...study,
    scan: {
      ...study.scan,
      items: [{ ...study.scan.items[0], notes: "CORRECTION: result reversed" }],
      claims: [{ ...study.scan.claims[0], passage: "CORRECTION: effect reversed" }],
    },
  };
  assert.notEqual(evidenceRevision(next), before);
});

test("record_id_survives_title_and_doi_edit", () => {
  const { items } = ingestRecords([{ title: "Invented paper", authors: "A", year: 2020, venue: "J" }], { id: "r", provider: "f" });
  const kept = retainIdOnCorrection(items[0], { title: "Invented paper (corrected)", authors: "A", year: 2020, venue: "J", doi: "10.0/new.doi" });
  assert.equal(kept.id, items[0].id);
  assert.ok(Object.values(kept.aliases).includes(items[0].id));
});

test("id_lint_finds_unknown_ids_in_any_string_field", () => {
  const study = createStudy({ family: "retrospective", setting: "s", rawNeed: "n" });
  study.gaps.items = [{ id: "g1", title: "Gap", kind: "evidence", severity: "high", whyItMatters: "see ev-old", opportunity: "" }];
  study.scan.claims = [{ id: "c1", text: "uses ev-old", kind: "inference", sourceIds: [], uncertainty: "high", interpretation: "ev-old remains" }];
  const hits = unresolvedActiveIds(study);
  assert.ok(hits.some((h) => h.id === "ev-old"));
  const quoted = lintActiveReferences({
    ...study,
    documents: [{ id: "doc-1", recordId: "ev-1", sha256: "a", text: "the paper mentioned ev-foreign once", mediaType: "text/plain", sourceScope: "abstract", shortenedAtSource: "unknown", capturedAt: "2026-01-01T00:00:00Z" }],
  });
  assert.ok(quoted.some((h) => h.id === "ev-foreign" && h.kind === "quoted-source"));
});

test("apply_marks_unknown_ids_in_free_text", () => {
  const r = markUnknownIds("see ev-orphan in the gap", new Set());
  assert.match(r.text, /unresolved:ev-orphan/);
  assert.deepEqual(r.unknown, ["ev-orphan"]);
  assert.notEqual(r.unknown.length, 0);
  const study = createStudy({ family: "retrospective", setting: "s", rawNeed: "n" });
  const applied = applyAiResult(
    "gaps",
    { items: [{ title: "Gap", kind: "evidence", whyItMatters: "see ev-orphan in the gap", opportunity: "none" }] },
    null,
    study,
  );
  const why = (applied.stagePatch.items as { whyItMatters: string }[])[0].whyItMatters;
  assert.match(why, /unresolved:ev-orphan/);
  assert.ok(applied.issues.some((i) => i.code === "unresolved-reference" && i.value === "ev-orphan"));
  const quoted = applyAiResult(
    "scan",
    {
      annotations: [],
      claims: [{ text: "quoted", kind: "source-derived", passage: "the paper mentioned ev-foreign once", uncertainty: "high" }],
    },
    null,
    study,
  );
  const claim = (quoted.stagePatch.claims as { passage?: string }[])?.[0];
  assert.equal(claim?.passage, "the paper mentioned ev-foreign once");
});

test("record_id_survives_title_and_doi_edit_on_retrieval", () => {
  const S = () => useStudio.getState();
  const created = S().create({ family: "retrospective", setting: "s", rawNeed: "n" });
  const first = ingestRecords([{ title: "Invented paper", authors: "A", year: 2020, venue: "J" }], { id: "r1", provider: "f" });
  S().applyRetrieval(created.id, { event: { id: "r1", at: "2026-09-22T00:00:00Z", provider: "f", query: "q", resultCount: 1, recordIds: [first.items[0].id], status: "ok", performedBy: "app" }, items: first.items, documents: first.documents });
  const second = ingestRecords([{ title: "Invented paper", authors: "A", year: 2020, venue: "J", doi: "10.1234/new.doi" }], { id: "r2", provider: "f" });
  S().applyRetrieval(created.id, { event: { id: "r2", at: "2026-09-22T00:00:01Z", provider: "f", query: "q", resultCount: 1, recordIds: [second.items[0].id], status: "ok", performedBy: "app" }, items: second.items, documents: second.documents });
  const study = S().studies.find((x) => x.id === created.id)!;
  assert.equal(study.scan.items.length, 1);
  assert.equal(study.scan.items[0].id, first.items[0].id);
  assert.ok(Object.values(study.idAliases ?? {}).includes(first.items[0].id));
  assert.equal(study.scan.items[0].doi, "10.1234/new.doi");
});

test("later_duplicate_content_is_kept_on_retrieval", () => {
  const a = ingestRecords([{ title: "T", authors: "A", year: 2021, venue: "J", doi: "10.1234/dup.store", abstract: "Short abstract" }], { id: "r1", provider: "f" });
  const b = ingestRecords([{ title: "T", authors: "A", year: 2021, venue: "J", doi: "10.1234/dup.store", abstract: "Full corrected abstract with decisive outcome RESULT_END" }], { id: "r2", provider: "f" });
  const merged = mergeIngested(a.items, b.items);
  assert.equal(merged.items.length, 1);
  assert.ok(JSON.stringify(merged.items[0].contentVersions ?? merged.items[0]).includes("decisive outcome"));
});

test("usage_write_does_not_change_study_revision", () => {
  const study = createStudy({ family: "qi-pdsa", setting: "s", rawNeed: "n" });
  const before = studyRevision(study);
  const withUsage = { ...study, usage: [{ id: "u1", at: "2026-09-22T00:00:00Z", reasonUnknown: "unmeasured" }] };
  assert.equal(studyRevision(withUsage), before);
  const edited = { ...study, problem: { ...study.problem, constraints: "new constraint" } };
  assert.notEqual(studyRevision(edited), before);
});

test("decision_reports_source_counts", () => {
  const { items } = ingestRecords([{ title: "T", authors: "A", year: 2020, venue: "J", abstract: "a".repeat(20) }], { id: "r", provider: "f" });
  const study = migrateStudy({
    ...createStudy({ family: "retrospective", setting: "s", rawNeed: "n" }),
    scan: { items, claims: [{ id: "c1", text: "x", kind: "local-fact", sourceIds: [], uncertainty: "high" }], retrievalEvents: [], unresolvedAccess: [], sourcesConsulted: [], query: "", gradeOverall: "", gradeRationale: "", synthesis: "" },
  });
  const { decision } = applyDecision({ kind: "defer", statement: "Wait.", claimIds: ["c1"], criteria: [], gates: [], alternatives: ["Stop"] }, study);
  assert.ok(decision);
  const e = evaluateDecision({ ...decision!, status: "accepted" }, study);
  assert.equal(e.sourceCounts.items, 1);
  assert.equal(e.sourceCounts.retrieved, 1);
});

test("publication_status_and_abstract_are_not_full_text", () => {
  assert.equal(publicationStatusFromLabel("retracted"), "retracted");
  const { items } = ingestRecords([{ title: "T", authors: "A", year: 2020, venue: "J", abstract: "abs" }], { id: "r", provider: "f" });
  assert.equal(treatAsFullTextRead(items[0]), false);
});
