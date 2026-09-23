/**
 * Before/after probes for the 2026-09-22 integrity increment. Uses only APIs present in both the a41
 * delivery and this branch, so the same script shows the unsafe behaviour on a41 and the repaired
 * behaviour here. Usage: npx tsx probes/integrity-v2-probes.ts <tree-root>
 * Each probe prints SAFE or UNSAFE with the observed value. Exit code 1 if any probe is UNSAFE.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? ".");
const imp = (p: string) => import(pathToFileURL(path.join(root, p)).href);

const store = await imp("src/lib/store.ts");
const apply = await imp("src/lib/apply-ai.ts");
const records = await imp("src/lib/evidence/records.ts");
const decision = await imp("src/lib/evidence/decision.ts");
const compact = await imp("src/lib/compact.ts");
const S = () => store.useStudio.getState();

const results: { probe: string; safe: boolean; observed: string }[] = [];
const record = (probe: string, safe: boolean, observed: string) => results.push({ probe, safe, observed });

function studyWithRecord(abstract: string) {
  const s = S().create({ family: "rct", setting: "Hamilton", rawNeed: "Ketamine infusions for refractory neuropathic pain." });
  const { items, documents } = records.ingestRecords(
    [{ title: "Synthetic ketamine trial", authors: "Doe", year: 2024, venue: "J", doi: "10.5555/probe.1", abstract }],
    { id: "ret-probe", provider: "fixture" },
  );
  S().mergeStage(s.id, "scan", {
    items,
    retrievalEvents: [{ id: "ret-probe", at: "", provider: "fixture", query: "q", resultCount: 1, recordIds: [items[0].id], status: "ok", performedBy: "app" }],
  });
  S().update(s.id, { documents });
  return { id: s.id, recordId: items[0].id as string };
}

// P1: a hand-set "verified" with no registry check.
{
  const s = S().create({ family: null, setting: "s", rawNeed: "n" });
  const lead = apply.applyAiResult("scan", { items: [{ title: "Invented landmark trial", doi: "10.9999/invented" }] }, null, s).stagePatch.items;
  S().mergeStage(s.id, "scan", { items: lead });
  const r = S().changeSource(s.id, { id: lead[0].id }, "status", "verified");
  const status = S().studies.find((x: { id: string }) => x.id === s.id).scan.items[0].provenance.status;
  record("P1 status 'verified' set by hand on a model lead", !(r.ok && status === "verified"), `ok=${r.ok} status=${status}`);
}

// P2: a model gate "met" citing an approval the investigator never entered.
{
  const s = S().create({ family: "qi-pdsa", setting: "s", rawNeed: "Improve discharge phone calls.", constraints: "No funding." });
  const cur = S().studies.find((x: { id: string }) => x.id === s.id);
  const out = apply.applyAiResult("design", {
    recommended: "qi-pdsa",
    rationale: "PDSA",
    decision: { kind: "narrow", statement: "Start on one ward.", claimIds: [], criteria: [], gates: [{ id: "g1", requirement: "QI determination", status: "met", evidence: "Record CGC-2026-031 dated 2026-09-08, supplied by the investigator" }], alternatives: ["none"] },
  }, "qi-pdsa", cur);
  const gate = out.stagePatch.decisions?.at(-1)?.gates?.[0]?.status;
  record("P2 model-declared gate citing an approval never entered", gate !== "met", `gate=${gate}`);
}

// P3: accept a 'pursue' decision resting on a claim with a number the source does not contain.
{
  const { id, recordId } = studyWithRecord("RESULTS: Pain scores fell by 2.1 points (95% CI 1.2 to 3.0) in 120 participants.");
  S().mergeStage(id, "scan", { claims: [{ id: "c-fab", text: "Ketamine cut pain by 48 percent.", kind: "source-derived", sourceIds: [recordId], passage: "Pain scores fell by 2.1 points", uncertainty: "low", origin: "model" }] });
  const cur = S().studies.find((x: { id: string }) => x.id === id);
  const d = decision.applyDecision({ kind: "pursue", statement: "Run the trial.", claimIds: ["c-fab"], criteria: [], gates: [], alternatives: ["audit"] }, cur).decision;
  S().mergeStage(id, "design", { decisions: [d] });
  const acc = S().acceptDecision(id, "latest");
  record("P3 accept a decision resting on a fabricated number", !acc.ok, `accepted=${acc.ok}${acc.reason ? ` reason=${acc.reason}` : ""}`);
}

// P4: the appraisal context cuts the record's text.
{
  const long = `${"Synthetic methods sentence number 7 of the abstract body. ".repeat(34)}RESULT_SENTENCE_AT_END 41 percent.`;
  const { id } = studyWithRecord(long);
  const ctx = compact.compactStudy(S().studies.find((x: { id: string }) => x.id === id), "scan");
  record("P4 appraisal context shows the whole abstract", ctx.includes("RESULT_SENTENCE_AT_END"), `abstractChars=${long.length} endVisible=${ctx.includes("RESULT_SENTENCE_AT_END")}`);
}

// P5: a new appraisal erases an investigator-authored claim.
{
  const { id, recordId } = studyWithRecord("RESULTS: 41 percent attended.");
  S().mergeStage(id, "scan", { claims: [{ id: "inv-1", text: "Our clinic data show similar attendance.", kind: "local-fact", sourceIds: [], uncertainty: "moderate", origin: "investigator" }] });
  const cur = S().studies.find((x: { id: string }) => x.id === id);
  const out = apply.applyAiResult("scan", { annotations: [{ id: recordId, relevance: 70 }], claims: [{ id: "c1", text: "41 percent attended.", kind: "source-derived", sourceIds: [recordId], passage: "41 percent attended", uncertainty: "moderate" }] }, "rct", cur);
  const kept = (out.stagePatch.claims ?? []).some((c: { id: string }) => c.id === "inv-1");
  record("P5 appraisal keeps investigator-authored claims", kept, `investigatorClaimKept=${kept}`);
}

for (const r of results) console.log(`${r.safe ? "SAFE  " : "UNSAFE"} ${r.probe} :: ${r.observed}`);
process.exit(results.some((r) => !r.safe) ? 1 : 0);
