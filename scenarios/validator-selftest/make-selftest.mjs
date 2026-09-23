#!/usr/bin/env node
// make-selftest.mjs: builds the files of the scenario validator self-test from the version-2 bank samples.
//
// Usage: node make-selftest.mjs      (paths are relative to this file; bank-samples/ is read, never written)
//
// Writes, next to this file:
//   sc-000-level1.json, sc-000-level3.json, sc-000-level4.json   the good set: the three version-2 samples from
//       bank-samples/ with the corrections in GOOD_FIXES. The samples predate two checks of validator 1.2 (G11 and
//       screen-status); their author fixes the samples themselves, and until then these copies carry the fixes so
//       that the good set passes. validator-selftest.sh prints every path where a copy differs from its sample.
//   broken/broken-*.json   one good copy with one deliberate defect each (plus the unmodified level 3 sample,
//       which fails G11). The expected failing rules of each are listed in ../validator-selftest.sh.
//   accept/accept-*.json   one good copy with one legitimate variation each that the validator must accept.
// Broken and accept files carry ids sc-9NN (never used by the bank) and are validated in staging folders under
// their id, so the validator's id and file-name rule holds.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// The generator starts from the version 2 samples (kept at bank-samples/original-v2/) and applies the listed
// corrections itself, so the good set stays stable when the bank samples move to a later version.
const samplesDir = path.join(here, "..", "bank-samples", "original-v2");
const brokenDir = path.join(here, "broken");
const acceptDir = path.join(here, "accept");

const clone = (x) => JSON.parse(JSON.stringify(x));
const readSample = (id) => JSON.parse(fs.readFileSync(path.join(samplesDir, `${id}.json`), "utf8"));
// Files stay plain ASCII bytes: a non-ASCII character that a broken file needs is written as a \u escape.
const write = (file, sc) => fs.writeFileSync(file, `${JSON.stringify(sc, null, 2).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}\n`);
const wordCount = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const skeleton = (sc) => sc.steps.map((s) => [s.do, s.stage ?? "", s.shape ?? "", s.provider ?? ""].join("/")).join(" ");
function must(cond, msg) {
  if (!cond) throw new Error(`make-selftest: ${msg} (the bank samples changed; update make-selftest.mjs)`);
}
function find(sc, pred, label) {
  const i = sc.steps.findIndex(pred);
  must(i >= 0, `no ${label} step`);
  return i;
}
function findLast(sc, pred, label) {
  const i = sc.steps.map(pred).lastIndexOf(true);
  must(i >= 0, `no ${label} step`);
  return i;
}
const isProblem = (s) => s.do === "illuminate" && s.stage === "problem";
const isScan = (shape, call) => (s) => s.do === "illuminate" && s.stage === "scan" && s.shape === shape && (call === undefined || s.call === call);
// Replaces every string value equal to `from` with `to`, in the whole subtree.
function replaceStrings(node, from, to) {
  if (Array.isArray(node)) return node.map((x) => replaceStrings(x, from, to));
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, replaceStrings(v, from, to)]));
  return node === from ? to : node;
}
// A copy with a new id and notes that say what the file is for.
function variant(base, id, notes) {
  const sc = clone(base);
  sc.id = id;
  sc.notes = notes;
  return sc;
}

// ---- the good set ----
const GOOD_FIXES = {
  "sc-000-level1": (sc) => {
    const p = find(sc, isProblem, "problem");
    // G11: the model's constraints paraphrase the typed text (a different value), so the correct build keeps the
    // typed text and records dropped at constraints; issues.count 0 contradicted that.
    must(sc.steps[p].expect.issues.count === 0, "level1 problem step issues");
    sc.steps[p].expect.issues = { includes: [{ path: "constraints", code: "dropped" }], count: 1 };
  },
  "sc-000-level3": (sc) => {
    const typed = sc.inputs.constraints;
    const p = find(sc, isProblem, "problem");
    must(sc.steps[p].response.constraints === null, "level3 problem response constraints null");
    // G11: a model null leaves the typed constraints unchanged and records dropped, never "cleared".
    sc.steps[p].expect.store["problem.constraints"] = typed;
    sc.steps[p].expect.issues.includes = sc.steps[p].expect.issues.includes.map((it) => (it.path === "constraints" ? { path: "constraints", code: "dropped" } : it));
    // Later reload, reopen and export checks of the same field keep the typed text too.
    sc.steps.forEach((s, i) => {
      if (i === p || !s.expect) return;
      if (s.expect.store && "problem.constraints" in s.expect.store) s.expect.store["problem.constraints"] = typed;
      if (s.expect.export && s.expect.export.path && "problem.constraints" in s.expect.export.path) s.expect.export.path["problem.constraints"] = typed;
    });
  },
  "sc-000-level4": (sc) => {
    const p = find(sc, isProblem, "problem");
    must(sc.steps[p].expect.issues.count === 0, "level4 problem step issues");
    // G11, as in level 1: the model's constraints differ from the typed text.
    sc.steps[p].expect.issues = { includes: [{ path: "constraints", code: "dropped" }], count: 1 };
    // screen-status: the audit step checks a non-empty needsReview, so its screen check names the status.
    const a = find(sc, (s) => s.do === "illuminate" && s.stage === "audit", "audit");
    must(!sc.steps[a].expect.screen, "level4 audit step has no screen check");
    sc.steps[a].expect.screen = { includes: ["review required"] };
  },
};
const good = {};
for (const [id, fix] of Object.entries(GOOD_FIXES)) {
  const sc = readSample(id);
  fix(sc);
  good[id] = sc;
  write(path.join(here, `${id}.json`), sc);
}
const L1 = good["sc-000-level1"];
const L3 = good["sc-000-level3"];
const L4 = good["sc-000-level4"];

// ---- broken copies ----
fs.mkdirSync(brokenDir, { recursive: true });
const broken = {};

// Counterexample 1, exactly as the reviewer ran it: every expect removed, and the only export (with equalsStore)
// placed immediately after create.
{
  const sc = variant(L1, "sc-901", "SELFTEST broken copy (counterexample 1): every outcome check removed; the only export, with equalsStore, comes immediately after create, before every consequential step.");
  sc.steps = sc.steps.filter((s) => s.do !== "export").map(({ expect, ...rest }) => rest);
  sc.steps.splice(1, 0, { do: "export", expect: { export: { equalsStore: true } } });
  broken["broken-c1-no-outcome-checks.json"] = sc;
}
// Counterexample 1, partial: the acceptance carries a screen check only, and an added set-field carries no expect.
{
  const sc = variant(L1, "sc-902", "SELFTEST broken copy (counterexample 1): the accept-decision step expects screen text only, and a set-field step has no expect; neither states its outcome in the store.");
  const acc = find(sc, (s) => s.do === "accept-decision", "accept-decision");
  sc.steps[acc].expect = { screen: { includes: ["accepted", "ready"] } };
  const rl = find(sc, (s) => s.do === "reload", "reload");
  sc.steps.splice(rl, 0, { do: "set-field", path: "problem.statement", value: "A structured bedside handoff checklist with a short medicines section, tested in PDSA cycles on one side of the ward." });
  broken["broken-c1-screen-only-expect.json"] = sc;
}
// Counterexample 1, ordering: the export with equalsStore moved before the last consequential step (Audit).
{
  const sc = variant(L1, "sc-903", "SELFTEST broken copy (counterexample 1): the export with equalsStore runs before the Audit stage, so the final state is never compared with the export.");
  const ex = findLast(sc, (s) => s.do === "export", "export");
  const [exportStep] = sc.steps.splice(ex, 1);
  sc.steps.splice(find(sc, (s) => s.do === "illuminate" && s.stage === "audit", "audit"), 0, exportStep);
  broken["broken-c1-export-before-last-step.json"] = sc;
}
// Counterexample 2: the same workflow under two renamed ids (and renamed titles).
{
  const a = variant(L1, "sc-911", "SELFTEST broken copy (counterexample 2): the level 1 sample under a new id and title; the other copy of the pair is broken-c2-renamed-copy-b.json.");
  a.title = "Nursing shift handoff: bedside checklist and missed medication reconciliation (renamed copy A)";
  const b = variant(L1, "sc-912", "SELFTEST broken copy (counterexample 2): the level 1 sample under a new id and title; the other copy of the pair is broken-c2-renamed-copy-a.json.");
  b.title = "Medication handoff at shift change on a medical ward: a checklist project (renamed copy B)";
  broken["broken-c2-renamed-copy-a.json"] = a;
  broken["broken-c2-renamed-copy-b.json"] = b;
}
// Counterexample 2, need only: the level 4 workflow and records with the level 1 need, four words changed
// (word-set Jaccard above 0.8, not equal). Compared with the level 1 good copy.
{
  const sc = variant(L4, "sc-913", "SELFTEST broken copy (counterexample 2, need only): the level 4 workflow and records under a lightly edited copy of the level 1 need.");
  let need = L1.inputs.need;
  for (const [from, to] of [["Ward 6B", "Ward 7C"], ["32-bed", "30-bed"], ["23 of them", "21 of them"], ["two near misses in August", "two near misses in September"]]) {
    must(need.includes(from), `level1 need contains "${from}"`);
    need = need.replace(from, to);
  }
  broken["broken-c2-need-only.json"] = replaceStrings(sc, L4.inputs.need, need);
}
// Counterexample 2, records only: two level 4 fixture records renamed to level 1 record titles (their DOIs, and so
// their record ids, unchanged). Compared with the level 1 good copy.
{
  const sc = variant(L4, "sc-914", "SELFTEST broken copy (counterexample 2, records only): the level 4 scenario with two fixture records retitled as level 1 records.");
  const l1recs = L1.steps[find(L1, (s) => s.do === "retrieve", "retrieve")].response.records;
  const recs = sc.steps[find(sc, (s) => s.do === "retrieve", "retrieve")].response.records;
  must(recs[0].doi && recs[5].doi, "level4 records 0 and 5 have DOIs");
  recs[0].title = l1recs[2].title;
  recs[5].title = l1recs[3].title;
  broken["broken-c2-records-only.json"] = sc;
}
// Counterexample 2, trajectory only: the level 1 steps and model responses unchanged under a new need and new
// record titles. Compared with the level 1 good copy.
{
  const sc = variant(L1, "sc-915", "SELFTEST broken copy (counterexample 2, trajectory only): the level 1 steps and model responses under a different need and retitled records.");
  const need = "I coordinate the outpatient physiotherapy service at a district hospital. Our waiting list for knee and hip rehabilitation has grown to fourteen weeks, and referrers tell us that patients lose function before their first appointment. We are considering a telephone triage clinic run by senior physiotherapists that would sort new referrals into urgent, routine and self-management streams, with a printed exercise booklet for the self-management group.\n\nI want to test the triage clinic with PDSA cycles over one quarter before the service manager decides whether to keep it. I need help writing an aim statement, choosing a measure for time from referral to first treatment, picking balancing measures such as urgent cases missed at triage and complaints, and presenting weekly data on a run chart. There is no research budget, the clinic has to fit into existing rotas, and the booking system cannot be changed this year.";
  const titles = [
    "Telephone triage of musculoskeletal referrals and time to first physiotherapy contact: a before-after study",
    "Self-management booklets while waiting for knee rehabilitation: a pragmatic service evaluation",
    "Senior physiotherapist triage and missed urgent referrals: an audit of three outpatient clinics",
    "Waiting time and functional decline before hip rehabilitation: a prospective cohort",
    "Patient views of telephone assessment in outpatient physiotherapy: an interview study",
    "Run charts for waiting list work in therapy services: a methods note",
    "Referral streaming in outpatient rehabilitation: a scoping review of service models",
  ];
  const recs = sc.steps[find(sc, (s) => s.do === "retrieve", "retrieve")].response.records;
  must(recs.length === titles.length, "level1 retrieves seven records");
  recs.forEach((r, i) => {
    r.title = titles[i];
  });
  broken["broken-c2-trajectory-only.json"] = replaceStrings(sc, L1.inputs.need, need);
}
// Counterexample 3: an unknown top-level key.
{
  const sc = variant(L1, "sc-921", "SELFTEST broken copy (counterexample 3): an unknown top-level key, retrieval, holding a string.");
  const { steps, ...top } = sc;
  broken["broken-c3-retrieval-key.json"] = { ...top, retrieval: "invalid string", steps };
}
// Counterexample 3: malformed fixture records.
{
  const sc = variant(L1, "sc-922", "SELFTEST broken copy (counterexample 3): fixture records with a string year, an array of authors, a DOI without the reserved prefix at its start, a numeric abstract, an unknown key and a blank title.");
  const recs = sc.steps[find(sc, (s) => s.do === "retrieve", "retrieve")].response.records;
  recs[0].year = String(recs[0].year);
  recs[1].authors = recs[1].authors.split(", ");
  recs[2].doi = `doi:${recs[2].doi}`;
  recs[3].abstract = 2023;
  recs[4].journal = recs[4].venue;
  recs[6].title = "   ";
  broken["broken-c3-fixture-records.json"] = sc;
}
// Counterexample 3: a fixture response with total null, and a second retrieve whose status is a string.
{
  const sc = variant(L1, "sc-923", "SELFTEST broken copy (counterexample 3): the fixture response has total null, and a second retrieve sends its status as the string 200.");
  const r = find(sc, (s) => s.do === "retrieve", "retrieve");
  sc.steps[r].response.total = null;
  sc.steps.splice(r + 1, 0, { do: "retrieve", provider: "fixture", query: "structured handoff checklist medication omissions", response: { status: "200", total: 0, records: [] }, expect: { store: { "scan.retrievalEvents": { length: 2 } } } });
  broken["broken-c3-fixture-total-status.json"] = sc;
}
// Counterexample 3: provider-format responses that are malformed, and a provider outside the list.
{
  const sc = variant(L1, "sc-924", "SELFTEST broken copy (counterexample 3): an openalex retrieve with a fixture-shaped response and no body, and a retrieve from an unlisted provider with an empty query.");
  const r = find(sc, (s) => s.do === "retrieve", "retrieve");
  sc.steps.splice(
    r + 1,
    0,
    { do: "retrieve", provider: "openalex", query: "bedside handoff checklist medication", response: { status: 200, total: 1, records: [{ title: "Handoff checklist audit", authors: "Rao P", year: 2020, venue: "Ward Practice" }] }, expect: { store: { "scan.retrievalEvents": { length: 2 } } } },
    { do: "retrieve", provider: "scholar", query: "", response: { status: 200, body: "{}" }, expect: { store: { "scan.retrievalEvents": { length: 3 } } } },
  );
  broken["broken-c3-provider-format.json"] = sc;
}
// Rule 7 (G11): the unmodified level 3 sample; steps[1] expects constraints "" and an issue "cleared" after a
// model null, and later reload, reopen and export checks expect "" too.
broken["broken-g11-level3-sample-v2.json"] = readSample("sc-000-level3");
// Rule 7 (G11): the problem step, and the export, expect the model's paraphrase instead of the typed constraints;
// the create step expects a need other than the one typed.
{
  const sc = variant(L4, "sc-931", "SELFTEST broken copy (rule 7, G11): the problem step and the export expect problem.constraints to be the model's paraphrase instead of the typed constraints, and the create step expects an altered need.");
  const p = find(sc, isProblem, "problem");
  const modelValue = sc.steps[p].response.constraints;
  sc.steps[p].expect.store["problem.constraints"] = modelValue;
  sc.steps[findLast(sc, (s) => s.do === "export", "export")].expect.export.path["problem.constraints"] = modelValue;
  must(sc.steps[0].expect.store["problem.rawNeed"] === sc.inputs.need, "level4 create step checks the need");
  sc.steps[0].expect.store["problem.rawNeed"] = `${sc.inputs.need} Please also add a cost-effectiveness model.`;
  broken["broken-g11-model-value.json"] = sc;
}
// Rule 7 (G11): after a model null, the check hedges between the typed text and "", and the issue count leaves
// no room for dropped.
{
  const sc = variant(L3, "sc-932", "SELFTEST broken copy (rule 7, G11): after a model null for constraints, the problem step accepts either the typed text or an empty string, and its issue count leaves no room for dropped.");
  const p = find(sc, isProblem, "problem");
  sc.steps[p].expect.store["problem.constraints"] = { oneOf: [sc.inputs.constraints, ""] };
  sc.steps[p].expect.issues = { includes: [{ path: "family", code: "cleared" }], count: 1 };
  broken["broken-g11-hedge-and-count.json"] = sc;
}
// Rule 8 (G1): a discovery step after an empty search expects a certainty, in the store and on screen.
{
  const sc = variant(L3, "sc-941", "SELFTEST broken copy (rule 8, G1): the first discovery reply follows a search with no record, yet the step expects certainty low in the store and on screen.");
  const d = find(sc, isScan("discovery", 1), "scan discovery call 1");
  sc.steps[d].expect.store["scan.gradeOverall"] = "low";
  sc.steps[d].expect.screen = { includes: ["low certainty"] };
  broken["broken-g1-discovery-certainty.json"] = sc;
}
// Rule 8 (G1): records were retrieved but not yet appraised when a discovery step expects a certainty.
{
  const sc = variant(L4, "sc-942", "SELFTEST broken copy (rule 8, G1): records were retrieved but no appraisal has run when the second discovery reply is expected to set certainty moderate.");
  const d = find(sc, isScan("discovery", 2), "scan discovery call 2");
  sc.steps[d].expect.store["scan.gradeOverall"] = "moderate";
  sc.steps[d].expect.screen = { includes: ["unrated", "moderate certainty"] };
  broken["broken-g1-grade-before-appraisal.json"] = sc;
}
// Rule 8 (G2): leads only, no retrieved record and no confirmation, yet the Scan stage is expected complete.
{
  const sc = variant(L3, "sc-943", "SELFTEST broken copy (rule 8, G2): the second discovery reply (model leads only, after a search with no record and before the investigator's confirmation) is expected to complete the Scan stage.");
  const d = find(sc, isScan("discovery", 2), "scan discovery call 2");
  sc.steps[d].expect.stage = { scan: "complete" };
  broken["broken-g2-discovery-complete.json"] = sc;
}
// Rule 8 (G7): the acceptance before the source change is not expected to succeed.
{
  const sc = variant(L4, "sc-944", "SELFTEST broken copy (rule 8, G7): the accept-decision before the source change expects the decision to stay proposed, so the change has no accepted predecessor.");
  const cs = find(sc, (s) => s.do === "change-source", "change-source");
  const acc = sc.steps.slice(0, cs).map((s) => s.do === "accept-decision").lastIndexOf(true);
  must(acc >= 0, "an accept-decision before the change-source");
  Object.assign(sc.steps[acc].expect.store, { "design.decisions[-1].status": "proposed", "design.decisions[-1].selectionStatus": "proposed" });
  sc.steps[acc].expect.screen = { includes: ["proposed"] };
  broken["broken-g7-no-accepted-predecessor.json"] = sc;
}
// Rule 8 (G7): the acceptance is stated only through a positive decision index, not design.decisions[-1] (or
// another negative index) as the rule asks.
{
  const sc = variant(L4, "sc-947", "SELFTEST broken copy (rule 8, G7): the accept-decision before the source change states acceptance only at design.decisions[1], a positive index.");
  const cs = find(sc, (s) => s.do === "change-source", "change-source");
  const acc = sc.steps.slice(0, cs).map((s) => s.do === "accept-decision").lastIndexOf(true);
  const store = sc.steps[acc].expect.store;
  must(store["design.decisions[-1].selectionStatus"] === "accepted", "level4 acceptance states selectionStatus accepted");
  delete store["design.decisions[-1].selectionStatus"];
  store["design.decisions[1].selectionStatus"] = "accepted";
  broken["broken-g7-accepted-positive-index.json"] = sc;
}
// Rule 8 (G7): the changed record was retrieved but is not cited by any claim of the accepted decision.
{
  const sc = variant(L4, "sc-945", "SELFTEST broken copy (rule 8, G7): the source change targets a retrieved record that no claim of the accepted decision cites, yet stale is expected.");
  const cs = find(sc, (s) => s.do === "change-source", "change-source");
  const recs = sc.steps[find(sc, (s) => s.do === "retrieve", "retrieve")].response.records;
  must(recs[4].title.startsWith("Fire service home safety visits"), "level4 record 4");
  sc.steps[cs].record = recs[4].title;
  broken["broken-g7-uncited-record.json"] = sc;
}
// Rule 8 (G7): after the source change, stale is checked only in the export.
{
  const sc = variant(L4, "sc-946", "SELFTEST broken copy (rule 8, G7): after the source change the store, the screen and the reload no longer check stale; only the export does.");
  const cs = find(sc, (s) => s.do === "change-source", "change-source");
  sc.steps.forEach((s, i) => {
    if (i < cs || !s.expect || s.do === "export") return;
    if (s.expect.store) for (const k of Object.keys(s.expect.store)) if (s.expect.store[k] === "stale") s.expect.store[k] = "accepted";
    if (s.expect.screen && s.expect.screen.includes) s.expect.screen.includes = s.expect.screen.includes.filter((t) => t !== "stale");
  });
  broken["broken-g7-no-stale-after.json"] = sc;
}
// Rule 9 (screen-status): status checks in the store with a title, or "already", as the only screen text.
{
  const sc = variant(L4, "sc-951", "SELFTEST broken copy (rule 9, screen-status): three steps check a status in the store but their screen text is a title, or the word already, which is not the status word ready.");
  const acc = findLast(sc, (s) => s.do === "accept-decision", "accept-decision");
  sc.steps[acc].expect.screen = { includes: [sc.title] };
  const ro = findLast(sc, (s) => s.do === "reopen", "reopen");
  sc.steps[ro].expect.screen = { includes: [sc.title] };
  const d1 = find(sc, (s) => s.do === "illuminate" && s.stage === "design", "design");
  sc.steps[d1].expect.screen = { includes: ["already reviewed by the design panel"] };
  broken["broken-screen-status.json"] = sc;
}
// Rule 5: a need under 20 words.
{
  const sc = variant(L1, "sc-972", "SELFTEST broken copy (rule 5): the level 1 sample with a need of 15 words, under the 20 word minimum.");
  const need = "We want to test a bedside handoff checklist with PDSA cycles. What should we measure?";
  must(wordCount(need) === 15, "short need is 15 words");
  broken["broken-need-words.json"] = replaceStrings(sc, L1.inputs.need, need);
}
// Rule 10: the earlier checks kept from validator 1.1 (text rules, call numbering, stage schema keys, earlyStop).
{
  const sc = variant(L1, "sc-971", "SELFTEST broken copy (rule 10): a note with a PMID, a PubMed URL, a trial number, a DOI outside the reserved prefix, a forbidden term and a non-ASCII letter; a pmid key; a wrong call number; a stage response missing a schema key; an earlyStop too short to document anything.");
  const m = find(sc, (s) => s.do === "illuminate" && s.stage === "map", "map");
  sc.steps[m].note = `Selftest text rules: PMID: 0000, https://pubmed.ncbi.nlm.nih.gov/0000/, NCT00000000, 10.1000/selftest-not-a-real-doi, selftest forbidden marker, caf${String.fromCharCode(0xe9)}.`;
  sc.steps[m].response.nodes[0].pmid = "0";
  delete sc.steps[m].response.reading;
  sc.steps[find(sc, isScan("appraisal"), "scan appraisal")].call = 2;
  const { steps, ...top } = sc;
  broken["broken-earlier-checks.json"] = { ...top, earlyStop: "short", steps };
}
for (const [name, sc] of Object.entries(broken)) write(path.join(brokenDir, name), sc);

// ---- accept copies: legitimate variations the validator must accept ----
fs.mkdirSync(acceptDir, { recursive: true });
const accept = {};
// Rule 5: a brief, vague need (33 words) is a realistic input.
{
  const sc = variant(L1, "sc-961", "SELFTEST accept copy (rule 5): the level 1 sample with a brief, vague need of 33 words, inside the 20 to 700 word bounds.");
  const need = "Our ward keeps missing medicine changes at the nurse handoff. I want to try a bedside checklist and test it with PDSA cycles, but I do not know what to measure or how.";
  accept["accept-brief-need.json"] = replaceStrings(sc, L1.inputs.need, need);
}
// G11: the investigator edits the constraints on screen; later checks expect the edited text.
{
  const sc = variant(L3, "sc-962", "SELFTEST accept copy (G11): after the model's null is rejected, the investigator edits the constraints on screen, and later checks expect the edited text.");
  const p = find(sc, isProblem, "problem");
  const edited = "Secondary use of existing hospital records only; no new data collection from patients. Analyst time is capped at about 60 hours after the manager's approval. Community pharmacy refill data are not available.";
  const typed = sc.inputs.constraints;
  sc.steps = [
    ...sc.steps.slice(0, p + 1),
    { do: "set-field", path: "problem.constraints", value: edited, note: "The investigator edits the constraints through the screen; G11 lets the investigator change typed text.", expect: { store: { "problem.constraints": edited } } },
    ...sc.steps.slice(p + 1).map((s) => replaceStrings(s, typed, edited)),
  ];
  accept["accept-investigator-edits-constraints.json"] = sc;
}
// G2: the investigator confirms the empty search before the discovery replies; the Scan stage is complete from the
// confirmation on, and certainty stays unassessed (G1).
{
  const sc = variant(L3, "sc-963", "SELFTEST accept copy (G2): the investigator confirms the empty search before the discovery replies, so the Scan stage is complete from then on while certainty stays unassessed.");
  const c = find(sc, (s) => s.do === "confirm-empty-search", "confirm-empty-search");
  const d1 = find(sc, isScan("discovery", 1), "scan discovery call 1");
  const [confirm] = sc.steps.splice(c, 1);
  confirm.expect.store["scan.items"] = { length: 0 };
  sc.steps.splice(d1, 0, confirm);
  for (const call of [1, 2]) {
    const d = find(sc, isScan("discovery", call), `scan discovery call ${call}`);
    sc.steps[d].expect.stage = { scan: "complete" };
    sc.steps[d].expect.store.completedStages = ["problem", "scan"];
  }
  accept["accept-confirm-before-discovery.json"] = sc;
}
// Rule 3: a real-provider format (OpenAlex works body) with the same seven records as the fixture search.
{
  const sc = variant(L1, "sc-964", "SELFTEST accept copy (rule 3): the level 1 sample with its search recorded in the OpenAlex works format; the adapter parses the same seven records, so the appraisal and its certainty stand.");
  const r = find(sc, (s) => s.do === "retrieve", "retrieve");
  const recs = sc.steps[r].response.records;
  const results = recs.map((x) => ({
    title: x.title,
    publication_year: x.year,
    ...(x.doi ? { doi: `https://doi.org/${x.doi}` } : {}),
    authorships: x.authors.split(", ").map((name) => ({ author: { display_name: name } })),
    primary_location: { source: { display_name: x.venue } },
    type: "article",
  }));
  sc.steps[r].provider = "openalex";
  sc.steps[r].response = { status: 200, body: JSON.stringify({ meta: { count: recs.length }, results }) };
  sc.steps[r].expect.store["scan.retrievalEvents[0].provider"] = "openalex";
  accept["accept-openalex-body.json"] = sc;
}
// Rule 5: a long need near the 700 word maximum (the level 1, level 3 and part of the level 4 needs).
{
  const sc = variant(L1, "sc-966", "SELFTEST accept copy (rule 5): the level 1 sample with a need of 680 words, inside the 20 to 700 word bounds.");
  const tail = L4.inputs.need.split(/\s+/).slice(0, 680 - wordCount(L1.inputs.need) - wordCount(L3.inputs.need)).join(" ");
  const need = `${L1.inputs.need}\n\n${L3.inputs.need}\n\n${tail}`;
  must(wordCount(need) === 680, "long need is 680 words");
  accept["accept-long-need.json"] = replaceStrings(sc, L1.inputs.need, need);
}
// Duplicates: the level 4 content cut to exactly the level 1 step skeleton (the same sequence of do, stage, shape
// and provider). Need, records and model responses all differ, so it is no duplicate of the level 1 copy; the
// validator must not flag a shared skeleton, which most full scenarios have. Staged with the level 1 good copy.
{
  const sc = variant(L4, "sc-965", "SELFTEST accept copy (duplicates): the level 4 content cut to the level 1 step skeleton, to show that a shared skeleton with different need, records and model responses is no duplicate. Its later expectations are not a runnable answer key.");
  sc.steps = sc.steps.filter((s) => !isScan("discovery")(s));
  sc.steps.find(isScan("appraisal")).call = 1;
  const d1 = find(sc, (s) => s.do === "illuminate" && s.stage === "design" && s.call === 1, "design call 1");
  must(sc.steps[d1 + 1].do === "accept-decision", "an acceptance follows the first design call");
  sc.steps.splice(d1, 2);
  sc.steps.find((s) => s.do === "illuminate" && s.stage === "design").call = 1;
  const cs = find(sc, (s) => s.do === "change-source", "change-source");
  must(sc.steps[cs + 1].do === "reload", "a reload follows the change-source");
  sc.steps.splice(cs, 2);
  sc.steps.splice(findLast(sc, (s) => s.do === "reopen", "reopen"), 0, { do: "reload", expect: { store: { "design.decisions[-1].selectionStatus": "accepted" }, screen: { includes: ["accepted"] } } });
  must(skeleton(sc) === skeleton(L1), "the cut level 4 copy has the level 1 skeleton");
  accept["accept-shared-skeleton.json"] = sc;
}
// Format 1.2, late replies (validator 1.3): the level 1 audit call held while the investigator edits the audit
// notes; the refusal is expected on the illuminate step, the edit's own outcome inside the during action.
function lateAuditStep(base) {
  const a = find(base, (s) => s.do === "illuminate" && s.stage === "audit", "audit");
  const step = clone(base.steps[a]);
  step.late = true;
  step.during = [{
    do: "set-field",
    path: "audit.improvementNotes",
    value: "Investigator note: the pharmacy lead asks that the reconciliation count be reported per shift, not per day.",
    note: "SELFTEST: the investigator edits the audit notes while the audit request is pending; substantive audit content is part of the revision (D27).",
    expect: { store: { "audit.improvementNotes": "Investigator note: the pharmacy lead asks that the reconciliation count be reported per shift, not per day." } },
  }];
  step.expect = {
    error: { shown: true, includes: "changed since the request" },
    store: { "audit.improvementNotes": "Investigator note: the pharmacy lead asks that the reconciliation count be reported per shift, not per day.", "audit.entries[0].summary": { includes: "refused" } },
    stage: { audit: "incomplete" },
  };
  step.note = "SELFTEST: late reply (format 1.2, G6): the held audit reply arrives after the edit and is refused.";
  return { a, step };
}
{
  const sc = variant(L1, "sc-967", "SELFTEST accept copy (format 1.2): the audit call is a late reply held across an investigator edit of the audit notes (late: true, one during action); the refusal is expected on the illuminate step.");
  const { a, step } = lateAuditStep(sc);
  sc.steps[a] = step;
  accept["accept-late-reply.json"] = sc;
}
{
  const sc = variant(L1, "sc-931", "SELFTEST broken copy (format 1.2): late: true without a during array.");
  const { a, step } = lateAuditStep(sc);
  delete step.during;
  sc.steps[a] = step;
  broken["broken-late-no-during.json"] = sc;
}
{
  const sc = variant(L1, "sc-932", "SELFTEST broken copy (format 1.2): a during array on an illuminate step that is not late.");
  const { a, step } = lateAuditStep(sc);
  delete step.late;
  sc.steps[a] = step;
  broken["broken-during-no-late.json"] = sc;
}
{
  const sc = variant(L1, "sc-933", "SELFTEST broken copy (format 1.2): a during action that is a model call (illuminate) and another without an outcome expect.");
  const { a, step } = lateAuditStep(sc);
  step.during = [
    { do: "illuminate", stage: "problem", call: 2, response: {} },
    { do: "set-field", path: "audit.improvementNotes", value: "edited" },
  ];
  sc.steps[a] = step;
  broken["broken-during-illuminate.json"] = sc;
}
for (const [name, sc] of Object.entries(broken)) write(path.join(brokenDir, name), sc);
for (const [name, sc] of Object.entries(accept)) write(path.join(acceptDir, name), sc);

console.log(`good set: ${Object.keys(good).length} files; broken: ${Object.keys(broken).length} files; accept: ${Object.keys(accept).length} files`);
