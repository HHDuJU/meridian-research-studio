import { test } from "node:test";
import assert from "node:assert/strict";
import { createStudy, migrateStudy } from "../src/lib/defaults";
import { ingestRecords } from "../src/lib/evidence/records";
import { applyLookupOutcome } from "../src/lib/evidence/verify";
import { applyDecision, evaluateDecision } from "../src/lib/evidence/decision";
import { applyPublicationStatus, isWithdrawnResult, supportsActiveRecommendation } from "../src/lib/evidence/publication-status";

test("retracted_record_cannot_support_active_recommendation", () => {
  const { items } = ingestRecords(
    [{ title: "Invented trial of drug X after surgery", authors: "A", year: 2020, venue: "J", doi: "10.1234/synth.ret", abstract: "SYNTHETIC abstract of the trial." }],
    { id: "r1", provider: "f" },
  );
  let item = items[0];
  const verified = applyLookupOutcome([item], ["10.1234/synth.ret"], "crossref", {
    status: "ok",
    records: [{ title: item.title, authors: "A", year: 2020, venue: "J", doi: "10.1234/synth.ret" }],
  });
  item = verified.items[0];
  assert.equal(item.provenance.status, "verified");
  item = applyPublicationStatus(item, "Retracted: the authors withdraw the result");
  assert.equal(item.publicationStatus, "retracted");
  assert.equal(isWithdrawnResult(item), true);
  assert.equal(supportsActiveRecommendation(item), false);
  const afterError = applyLookupOutcome([item], ["10.1234/synth.ret"], "crossref", { status: "blocked", records: [], note: "timeout" });
  assert.equal(afterError.items[0].publicationStatus, "retracted");
  assert.ok(afterError.items[0].provenance.checks.some((c) => c.result === "match"));
  assert.ok(afterError.items[0].provenance.checks.some((c) => c.result === "blocked" || c.result === "error"));
  assert.equal(supportsActiveRecommendation(afterError.items[0]), false);
  const cleared = applyPublicationStatus(afterError.items[0], "journal-article");
  assert.equal(cleared.publicationStatus, "retracted");

  const study = migrateStudy({
    ...createStudy({ family: "retrospective", setting: "s", rawNeed: "n" }),
    scan: {
      items: [cleared],
      claims: [{ id: "c1", text: "Adopt drug X.", kind: "source-derived", sourceIds: [cleared.id], uncertainty: "high" }],
      retrievalEvents: [],
      unresolvedAccess: [],
      sourcesConsulted: [],
      query: "",
      gradeOverall: "",
      gradeRationale: "",
      synthesis: "",
    },
  });
  const { decision } = applyDecision({ kind: "pursue", statement: "Adopt the withdrawn result.", claimIds: ["c1"], criteria: [], gates: [], alternatives: ["Stop"] }, study);
  assert.ok(decision);
  const e = evaluateDecision({ ...decision!, status: "accepted" }, { ...study, scan: { ...study.scan, items: [cleared] } });
  assert.equal(e.canAct, false);
  assert.ok(e.blockers.some((b) => /withdrawn or retracted/.test(b)));
});
