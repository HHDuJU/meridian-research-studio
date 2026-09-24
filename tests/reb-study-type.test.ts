import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDecision, approvalReview, evaluateDecision, studyRevision } from "../src/lib/evidence/decision";
import { DETERMINATION_GATE, LITERATURE_FAMILIES, LITERATURE_ONLY_REASON, RECORD_PRESETS, studyTypeEthicsRecord } from "../src/lib/evidence/authority";
import { createStudy } from "../src/lib/defaults";
import { useStudio } from "../src/lib/store";
import type { Study, StudyFamily } from "../src/lib/types";

/*
 * 24 September 2026, the investigator: "REB is not for all types of research", so a review of published
 * literature must go from problem to manuscript without waiting for an ethics record. TCPS 2 (2022), Article
 * 2.2 (read on ethics.gc.ca the same day): research that relies exclusively on information in the public
 * domain needs no REB review. The rule is structural: it follows the study type the INVESTIGATOR chose; a family
 * a model reply set never counts, and D10's other blocks (open approvals in the investigator's own facts, model
 * local-fact claims) stay. All fixtures are invented.
 */

const S = () => useStudio.getState();
const NEED = "Summarize randomized evidence on erector spinae plane block for rib fractures.";

function study(family: StudyFamily, extra: Partial<Study> = {}, localFacts: string[] = []): Study {
  return { ...createStudy({ family, setting: "Academic trauma centre", rawNeed: NEED, constraints: "", localFacts }), ...extra };
}

function evaluate(s: Study) {
  const d = applyDecision({ kind: "pursue", statement: "Run the review.", claimIds: [], criteria: [], gates: [], alternatives: ["do nothing"] }, s).decision!;
  const accepted = { ...d, status: "accepted" as const, selectionStatus: "accepted" as const };
  return { review: approvalReview(accepted, s), e: evaluateDecision(accepted, s) };
}

const ethicsBlocked = (blockers: string[]) => blockers.some((b) => /research ethics status of this work/.test(b));

test("a review of published literature the investigator chose needs no ethics record to proceed", () => {
  for (const family of LITERATURE_FAMILIES) {
    const s = study(family as StudyFamily);
    assert.equal(s.familyBy, "investigator");
    const { review, e } = evaluate(s);
    assert.equal(review.ethicsRecordMissing, false, family);
    assert.equal(review.ethicsByStudyType, LITERATURE_ONLY_REASON);
    assert.equal(ethicsBlocked(e.blockers), false, `${family}: ${e.blockers.join(" | ")}`);
  }
});

test("a family set by a model reply, or a study with people or records, still needs the record", () => {
  const byModel = study("systematic-review", { familyBy: "model" });
  assert.equal(evaluate(byModel).review.ethicsRecordMissing, true);
  assert.equal(ethicsBlocked(evaluate(byModel).e.blockers), true);
  for (const family of ["cohort", "rct", "qi-pdsa", "retrospective", "qualitative", "economic"] as StudyFamily[]) {
    assert.equal(evaluate(study(family)).review.ethicsRecordMissing, true, family);
  }
  assert.equal(studyTypeEthicsRecord({ family: "scoping-review" }), undefined, "no recorded chooser, no study-type record");
});

test("the investigator's explicit record wins, and open approvals in their own facts still block", () => {
  const s = study("systematic-review");
  const d = applyDecision({ kind: "pursue", statement: "Run the review.", claimIds: [], criteria: [], gates: [], alternatives: [] }, s).decision!;
  const withRecord = {
    ...d,
    gates: [{ id: "g-rec", requirement: DETERMINATION_GATE.ethics, status: "met" as const, setBy: "investigator" as const, evidence: "HiREB 26-001 approved 2026-09-01", record: true as const }],
  };
  assert.equal(approvalReview(withRecord, s).ethicsByStudyType, undefined, "an explicit record is shown instead of the study-type one");
  const open = study("systematic-review", {}, ["The data custodian has not yet approved access to the unpublished trial registry extracts."]);
  const r = evaluate(open);
  assert.equal(r.review.ethicsRecordMissing, false);
  assert.ok(r.review.openItems.length >= 1, "the investigator's own open approval is still an open item");
  assert.ok(r.e.blockers.some((b) => /your own facts leave an approval open/.test(b)));
});

test("who set the family is recorded: start page and family picker are the investigator's; a model reply is the model's", () => {
  const created = S().create({ family: "scoping-review", setting: "Ward", rawNeed: NEED });
  assert.equal(S().studies.find((x) => x.id === created.id)!.familyBy, "investigator");
  const open = S().create({ family: null, setting: "Ward", rawNeed: NEED });
  assert.equal(S().studies.find((x) => x.id === open.id)!.familyBy, undefined);
  S().setFamily(open.id, "narrative-review");
  assert.equal(S().studies.find((x) => x.id === open.id)!.familyBy, "investigator");
  const before = S().studies.find((x) => x.id === open.id)!;
  const applied = S().illuminateApply(open.id, "problem", { statement: "A review.", family: "systematic-review", summary: "Problem framed." }, studyRevision(before));
  assert.equal(applied.ok, true);
  const after = S().studies.find((x) => x.id === open.id)!;
  assert.equal(after.family, "systematic-review");
  assert.equal(after.familyBy, "model", "the model changed the family, so it no longer settles the ethics status");
  S().setFamily(open.id, "systematic-review");
  assert.equal(S().studies.find((x) => x.id === open.id)!.familyBy, "investigator", "choosing it again makes it the investigator's");
});

test("one-click reasons cite the TCPS 2 articles and are recorded only when the investigator clicks", () => {
  assert.match(RECORD_PRESETS[0].text, /TCPS 2 \(2022\), Article 2\.2/);
  assert.match(RECORD_PRESETS[1].text, /TCPS 2 \(2022\), Article 2\.5/);
  const s = study("qi-pdsa");
  assert.equal(evaluate(s).review.ethicsRecordMissing, true, "QI is not settled by study type: the institution may require screening");
});
