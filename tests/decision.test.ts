import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createStudy, migrateStudy } from "../src/lib/defaults";
import { applyAiResult } from "../src/lib/apply-ai";
import { compactStudy } from "../src/lib/compact";
import { applyDecision, evaluateDecision, evidenceRevision, isStaleRequest, refreshDecisionStatuses, studyRevision } from "../src/lib/evidence/decision";
import { parseConsensusConnectorExport } from "../src/lib/evidence/providers/consensus";
import { ingestExternalSearch } from "../src/lib/evidence/retrieve";
import { newClaim } from "../src/lib/evidence/ledger";
import { useStudio } from "../src/lib/store";
import type { Study } from "../src/lib/types";

const exportText = fs.readFileSync(new URL("./fixtures/consensus-export-2026-09-20.txt", import.meta.url), "utf8");

function studyWithEvidence(): Study {
  const s = createStudy({ family: "cohort", setting: "Hamilton", rawNeed: "Does the block threshold matter?" });
  const { event, items } = ingestExternalSearch("consensus-connector", "q", parseConsensusConnectorExport(exportText), "connector");
  s.scan.retrievalEvents = [event];
  s.scan.items = items;
  s.scan.claims = [
    newClaim({ id: "c1", text: "Sham-controlled RCTs show pain reduction at 12 weeks", kind: "source-derived", sourceIds: [items[0].id], location: "Results", uncertainty: "moderate" }),
    newClaim({ id: "local-1", text: "Only conventional monopolar RF is available", kind: "local-fact", sourceIds: [], uncertainty: "low" }),
  ];
  return s;
}

const rawDecision = {
  kind: "narrow",
  statement: "Run a registry-based outcome evaluation rather than a new efficacy trial.",
  question: "Should the clinic adopt the procedure and study it?",
  claimIds: ["c1", "local-1", "ghost-claim"],
  criteria: [
    { id: "k1", text: "≥50% responder rate at 6 months is documented in comparable cohorts", role: "justifies", status: "met", claimIds: ["c1"] },
    { id: "k2", text: "An ongoing multicentre trial already answers the question", role: "defeats", status: "unknown", claimIds: [] },
  ],
  gates: [
    { id: "g1", requirement: "REB determination for secondary use of registry data", status: "met" },
    { id: "g2", requirement: "Registry has percentage relief documented for enough patients", status: "unknown" },
  ],
  alternatives: ["Do nothing and refer to SKOAP results when published"],
};

test("applyDecision validates against the ledger: unknown claim ids dropped, 'met' gate without evidence demoted, revision stamped", () => {
  const s = studyWithEvidence();
  const r = applyDecision(rawDecision, s);
  assert.ok(r.decision);
  assert.deepEqual(r.decision!.claimIds, ["c1", "local-1"]);
  assert.ok(r.issues.some((i) => /unknown claim id "ghost-claim"/.test(i.message)));
  assert.equal(r.decision!.gates[0].status, "unknown", "a model cannot declare a gate met without evidence");
  assert.equal(r.decision!.gates[1].status, "unknown");
  assert.equal(r.decision!.inputRevision, evidenceRevision(s));
  assert.equal(r.decision!.status, "proposed");
  assert.equal(r.decision!.actor, "model");
});

test("evaluateDecision derives blockers from data: unknown gates block action; unverified sources warn; status is not the model's to set", () => {
  const s = studyWithEvidence();
  const d = applyDecision(rawDecision, s).decision!;
  const e = evaluateDecision(d, s);
  assert.equal(e.status, "proposed");
  assert.equal(e.canAct, false);
  assert.ok(e.blockers.some((b) => /gate unknown: REB determination/.test(b)));
  assert.ok(e.warnings.some((w) => /no supporting source-derived claim rests on an identity-verified source/.test(w)));
  assert.ok(e.warnings.some((w) => /abstract\/metadata level/.test(w)));
});

test("a decision goes stale when the evidence or ledger changes; history is kept", () => {
  const s = studyWithEvidence();
  const d = applyDecision(rawDecision, s).decision!;
  s.design.decisions = [d];
  assert.equal(evaluateDecision(d, s).status, "proposed");
  // The evidence moves: one source turns out to be a mismatch.
  s.scan.items[0] = { ...s.scan.items[0], provenance: { ...s.scan.items[0].provenance, status: "mismatch" } };
  const refreshed = refreshDecisionStatuses(s);
  assert.equal(refreshed.design.decisions[0].status, "stale");
  const e = evaluateDecision(refreshed.design.decisions[0], refreshed);
  assert.ok(e.blockers.some((b) => /resolved to a different work/.test(b)));
  assert.ok(e.blockers.some((b) => /re-review before acting/.test(b)));
});

test("apply-ai design stage accepts a decision only with the study; earlier proposed decisions are withdrawn, not erased", () => {
  const s = studyWithEvidence();
  const first = applyAiResult("design", { recommended: "retrospective", rationale: "r", decision: rawDecision }, s.family, s);
  assert.equal(first.ok, true);
  const decisions = first.stagePatch.decisions as Study["design"]["decisions"];
  assert.equal(decisions.length, 1);
  s.design = { ...s.design, ...(first.stagePatch as Partial<Study["design"]>) };
  const second = applyAiResult("design", { recommended: "retrospective", rationale: "r2", decision: { ...rawDecision, kind: "defer", statement: "Wait for SKOAP." } }, s.family, s);
  const after = second.stagePatch.decisions as Study["design"]["decisions"];
  assert.equal(after.length, 2);
  assert.equal(after[0].status, "withdrawn");
  assert.match(after[0].note ?? "", /superseded by/);
  assert.equal(after[1].kind, "defer");
  const noStudy = applyAiResult("design", { recommended: "retrospective", decision: rawDecision }, s.family);
  assert.equal("decisions" in noStudy.stagePatch, false);
  assert.ok(noStudy.issues.some((i) => /cannot be validated without the current study/.test(i.message)));
});

test("compact context carries decisions with kind, status, revision and gates", () => {
  const s = studyWithEvidence();
  s.design.decisions = [applyDecision(rawDecision, s).decision!];
  const ctx = compactStudy(s, "protocol");
  assert.match(ctx, /DECISIONS:\n\S+ \[narrow; proposed; rev ev[12]-[0-9a-f]{8}\]/);
  assert.match(ctx, /gates: REB determination for secondary use of registry data \[unknown\]/);
});

test("store: a stale model response is refused and logged; a current one is merged; scan changes refresh decision status", () => {
  const S = () => useStudio.getState();
  const created = S().create({ family: "cohort", setting: "x", rawNeed: "y" });
  const rev = studyRevision(S().studies.find((x) => x.id === created.id)!);
  // Something changes while the model is thinking.
  S().mergeStage(created.id, "problem", { statement: "the investigator edited the problem" });
  const late = S().mergeStageIfRevision(created.id, "gaps", { reevaluation: "late reply" }, rev);
  assert.equal(late.applied, false);
  let s = S().studies.find((x) => x.id === created.id)!;
  assert.equal(s.gaps.reevaluation, "");
  assert.match(s.audit.entries[0].summary, /Stale model response for gaps refused/);
  const fresh = S().mergeStageIfRevision(created.id, "gaps", { reevaluation: "current reply" }, studyRevision(s));
  assert.equal(fresh.applied, true);
  s = S().studies.find((x) => x.id === created.id)!;
  assert.equal(s.gaps.reevaluation, "current reply");
  assert.equal(isStaleRequest(s, rev), true);
  // A decision, then the evidence changes through the store → stale.
  const withEv = studyWithEvidence();
  S().mergeStage(created.id, "scan", { items: withEv.scan.items, claims: withEv.scan.claims, retrievalEvents: withEv.scan.retrievalEvents });
  s = S().studies.find((x) => x.id === created.id)!;
  const d = applyDecision(rawDecision, s).decision!;
  S().mergeStage(created.id, "design", { decisions: [d] });
  s = S().studies.find((x) => x.id === created.id)!;
  assert.equal(s.design.decisions[0].status, "proposed");
  S().mergeStage(created.id, "scan", { claims: [...s.scan.claims, newClaim({ id: "c9", text: "new evidence", kind: "source-derived", sourceIds: [s.scan.items[1].id], uncertainty: "moderate" })] });
  s = S().studies.find((x) => x.id === created.id)!;
  assert.equal(s.design.decisions[0].status, "stale");
});

test("migration adds an empty decisions array to old studies", () => {
  const m = migrateStudy({ id: "old", title: "t", design: { recommended: "cohort", rationale: "r", alternatives: [], guidelines: [], whyNotMoreComplex: "" } });
  assert.deepEqual(m.design.decisions, []);
  assert.equal(m.design.recommended, "cohort");
});
