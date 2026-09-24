import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildSearchReport, searchReportDocument, searchReportText, strategyChecks, strategyLimits, EXTERNAL_PROVIDER } from "../src/lib/evidence/search-report";
import { reportToDocxBuffer, columnWidths, CONTENT_WIDTH } from "../src/lib/report-docx";
import { createStudy } from "../src/lib/defaults";
import { useStudio } from "../src/lib/store";
import { studyRevision } from "../src/lib/evidence/decision";
import { searchLive } from "../src/lib/evidence/live";
import { pubmedFetchRequest, pubmedSearchRequest } from "../src/lib/evidence/providers/pubmed";
import { clinicalTrialsSearchRequest } from "../src/lib/evidence/providers/clinicaltrials";
import { recordedTransport } from "../src/lib/evidence/transport";
import type { EvidenceItem, EvidenceRun, RetrievalEvent, Study } from "../src/lib/types";

/*
 * Search report (PRISMA-S). Every study, record and count below is invented; the PubMed translation is the
 * one ESearch returned for "erector spinae plane block rib fractures" on 24 September 2026 (it maps
 * "plane" to the MeSH heading "aircraft" and splits the unquoted phrase).
 */

const S = () => useStudio.getState();
const noSleep = async () => {};

const TRANSLATION =
  '("erector"[All Fields] OR "erectores"[All Fields] OR "erectors"[All Fields]) AND "spinae"[All Fields] AND ("aircraft"[MeSH Terms] OR "aircraft"[All Fields] OR "plane"[All Fields] OR "planes"[All Fields]) AND ("block"[All Fields] OR "blocked"[All Fields] OR "blocking"[All Fields] OR "blockings"[All Fields] OR "blocks"[All Fields]) AND ("rib fractures"[MeSH Terms] OR ("rib"[All Fields] AND "fractures"[All Fields]) OR "rib fractures"[All Fields])';

function item(id: string, extra: Partial<EvidenceItem> & { origin?: "model" | "retrieval" | "user"; events?: string[]; status?: EvidenceItem["provenance"]["status"]; checks?: EvidenceItem["provenance"]["checks"] } = {}): EvidenceItem {
  const { origin = "retrieval", events = [], status = "retrieved", checks = [], ...rest } = extra;
  return {
    id,
    title: `Invented record ${id}`,
    authors: "Rossi A",
    year: 2024,
    source: "Journal of Invented Anesthesia",
    kind: "rct",
    grade: "unrated",
    methodQuality: null,
    relevance: null,
    notes: "",
    verification: "verify",
    contextTags: [],
    keyFindings: "",
    limitations: "",
    provenance: { origin, retrievalEventIds: events, identifiers: {}, access: "abstract", status, checks },
    ...rest,
  };
}

function reviewStudy(): Study {
  const s = createStudy({ family: "systematic-review", setting: "Academic trauma centre", rawNeed: "Erector spinae plane block for rib fractures.", constraints: "" });
  const A: RetrievalEvent = {
    id: "ret-a",
    at: "2026-09-24T10:21:00.000Z",
    provider: "pubmed",
    query: "erector spinae plane block rib fractures",
    sent: "erector spinae plane block rib fractures",
    translation: TRANSLATION,
    via: "NCBI E-utilities API (ESearch, EFetch)",
    order: "relevance (PubMed Best Match)",
    importCap: 20,
    resultCount: 106,
    recordIds: ["ev-a1", "ev-a2", "ev-a3"],
    status: "partial",
    performedBy: "app",
  };
  const B: RetrievalEvent = {
    id: "ret-b",
    at: "2026-09-24T10:22:00.000Z",
    provider: "clinicaltrials",
    query: "erector spinae plane block AND rib fractures",
    sent: "erector spinae plane block AND rib fractures",
    via: "ClinicalTrials.gov API version 2 (/studies, query.term)",
    order: "relevance (@relevance)",
    importCap: 50,
    resultCount: 39,
    recordIds: ["ev-b1", "ev-b2", "ev-bdup"],
    status: "partial",
    performedBy: "app",
  };
  const failed: RetrievalEvent = {
    id: "ret-c",
    at: "2026-09-24T10:23:00.000Z",
    provider: "openalex",
    query: "erector spinae plane block rib fractures",
    resultCount: null,
    recordIds: [],
    status: "blocked",
    performedBy: "app",
    note: "HTTP 403",
  };
  const runs: EvidenceRun[] = [
    { id: "erun-a", at: "2026-09-24T10:21:02.000Z", kind: "search", provider: "pubmed", query: A.query, requests: ["https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=x&sort=relevance"], status: "partial", records: 3, elapsedMs: 900, eventId: "ret-a" },
  ];
  const items = [
    item("ev-a1", { events: ["ret-a"], doi: "10.9999/a1", checks: [{ id: "c1", at: A.at, provider: "crossref", identifier: "10.9999/a1", result: "match" }], status: "verified" }),
    item("ev-a2", { events: ["ret-a", "ret-b"], doi: "10.9999/a2" }),
    item("ev-a3", { events: ["ret-a"] }),
    item("ev-b1", { events: ["ret-b"] }),
    item("ev-b2", { events: ["ret-b"] }),
    item("ev-m1", { origin: "model", status: "verified", checks: [{ id: "c2", at: A.at, provider: "pubmed", identifier: "10.9999/m1", result: "match" }] }),
    item("ev-m2", { origin: "model", status: "unverified" }),
  ];
  return { ...s, scan: { ...s.scan, retrievalEvents: [A, B, failed], items }, evidenceRuns: runs };
}

const dashes = /[‒–—―]/;

test("the report counts sources, imports and duplicates from the recorded searches", () => {
  const r = buildSearchReport(reviewStudy(), "2026-09-24T12:00:00.000Z");
  assert.deepEqual(r.searches.map((s) => [s.n, s.source]), [
    [1, "PubMed"],
    [2, "ClinicalTrials.gov"],
  ]);
  assert.deepEqual(r.failed.map((s) => [s.n, s.source, s.status]), [[3, "OpenAlex", "blocked"]]);
  const pubmed = r.sources.find((s) => s.provider === "pubmed")!;
  assert.equal(pubmed.found, 106);
  assert.equal(pubmed.imported, 3);
  assert.equal(r.sources.find((s) => s.provider === "clinicaltrials")!.kind, "registry");
  assert.deepEqual(r.totals, { found: 145, imported: 6, fromSearches: 5, merged: 1, inMoreThanOne: 1 });
  assert.equal(r.otherSources.modelOnly, 2);
  assert.equal(r.otherSources.modelOnlyVerified, 1);
  assert.equal(r.identity.checked, 2);
  assert.equal(r.identity.verified, 2);
  assert.deepEqual(r.searches[0].requests, ["https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=x&sort=relevance"]);
  assert.equal(r.searches[0].reproduceUrl, "https://pubmed.ncbi.nlm.nih.gov/?term=erector%20spinae%20plane%20block%20rib%20fractures");
  assert.equal(r.searches[0].asOfStrategy, "(erector spinae plane block rib fractures) AND 1800/01/01:2026/09/24[edat]");
  assert.equal(r.searches[1].reproduceUrl, "https://clinicaltrials.gov/search?term=erector%20spinae%20plane%20block%20AND%20rib%20fractures");
});

test("PRISMA-S: facts Meridian recorded are reported; what only the investigator knows waits for an answer", () => {
  const r = buildSearchReport(reviewStudy(), "2026-09-24T12:00:00.000Z");
  const state = Object.fromEntries(r.prismaS.map((x) => [x.n, x.state]));
  assert.equal(r.prismaS.length, 16);
  for (const n of [1, 3, 8, 9, 13, 15, 16]) assert.equal(state[n], "reported", `item ${n}`);
  assert.equal(state[2], "not-applicable");
  for (const n of [4, 5, 6, 7, 10, 11, 12, 14]) assert.equal(state[n], "needs-answer", `item ${n}`);
  assert.match(r.prismaS[12].text, /All searches were run on 24 September 2026/);
  assert.match(r.prismaS[15].text, /6 imported records became 5 unique records \(1 duplicate merged\)/);
  assert.match(r.prismaS[6].text, /suggested 2 records that no search returned; 1 of them was confirmed/);
  assert.match(r.methods, /^We searched PubMed \(which includes MEDLINE\) and the ClinicalTrials\.gov registry on 24 September 2026\./);
  assert.match(r.methods, /\[State whether the strategies were peer reviewed/);
  assert.match(r.methods, /We applied no language, date or publication-type limits\./);
  assert.match(r.methods, /The searches returned 145 records in all\./);
  assert.ok(r.gaps.some((g) => /must screen every record found/.test(g)), "a systematic review with a partial import is told to export everything");
  assert.ok(r.gaps.some((g) => /conduct standard C24/.test(g)), "one database only");
  assert.ok(!r.gaps.some((g) => /conduct standard C27/.test(g)), "a registry was searched");
  assert.ok(r.gaps.some((g) => /failed or were blocked/.test(g)));
});

test("automated strategy checks name the PubMed mapping problems a librarian would catch", () => {
  const r = buildSearchReport(reviewStudy(), "2026-09-24T12:00:00.000Z");
  const checks = r.searches[0].checks.map((c) => `${c.element}: ${c.text}`).join("\n");
  assert.match(checks, /Subject headings: PubMed also searched the heading "aircraft"/);
  assert.match(checks, /Text word searching: The words "erector", "spinae", "plane" and "block" were searched one by one/);
  assert.match(checks, /"erector spinae plane block"\[tiab\]/);
  assert.doesNotMatch(checks, /"rib fractures".*one by one/, "PubMed kept rib fractures as a phrase");
  const quoted = strategyChecks("pubmed", '"erector spinae plane block"[tiab] AND "rib fractures"[mh]', '"erector spinae plane block"[tiab] AND "rib fractures"[mh]', '"erector spinae plane block"[Title/Abstract] AND "rib fractures"[MeSH Terms]');
  assert.deepEqual(quoted, [], "a quoted, tagged strategy raises nothing");
  const mixed = strategyChecks("pubmed", "ketamine OR esketamine AND depression", "ketamine OR esketamine AND depression");
  assert.ok(mixed.some((c) => c.element === "Boolean and proximity operators" && /\(A OR B\) AND C/.test(c.text)));
  const unbalanced = strategyChecks("clinicaltrials", "(ketamine AND pain", "(ketamine AND pain");
  assert.ok(unbalanced.some((c) => /Parentheses do not pair up/.test(c.text)));
  const truncated = strategyChecks("pubmed", "analges* AND rib fractures[mh]", "analges AND rib fractures[mh]");
  assert.ok(truncated.some((c) => /Truncation \(\*\) was removed/.test(c.text)));
  assert.deepEqual(strategyLimits('(ketamine) AND english[la] AND 2015:2026[dp] NOT review[pt] AND "humans"[MeSH Terms]'), [
    "language",
    "publication date",
    "publication type",
    "humans or animals",
    "exclusion with NOT",
  ]);
});

test("searches recorded before 24 September 2026 are described from their notes, and the old PubMed order is stated plainly", () => {
  const s = createStudy({ family: "narrative-review", setting: "Ward", rawNeed: "Ketamine for neuropathic pain.", constraints: "" });
  const oldServer: RetrievalEvent = {
    id: "ret-old",
    at: "2026-09-22T09:00:00.000Z",
    provider: "pubmed",
    query: "ketamine neuropathic pain",
    resultCount: 800,
    recordIds: ["ev-o1"],
    status: "partial",
    performedBy: "app",
    note: 'PubMed translation: "ketamine"[MeSH Terms] AND "neuralgia"[MeSH Terms]; 1 of 800 hits ingested (most relevant first); 1 of 1 records carry an abstract',
  };
  const oldCowork: RetrievalEvent = {
    id: "ret-old2",
    at: "2026-09-23T09:00:00.000Z",
    provider: "pubmed",
    query: "ketamin* neuropathic",
    resultCount: 10,
    recordIds: [],
    status: "ok",
    performedBy: "app",
    note: "PubMed translation: ketamine[All Fields]; through the PubMed connector",
  };
  const study = { ...s, scan: { ...s.scan, retrievalEvents: [oldServer, oldCowork], items: [item("ev-o1", { events: ["ret-old"] })] } };
  const r = buildSearchReport(study, "2026-09-24T12:00:00.000Z");
  assert.equal(r.searches[0].order, "most recently added first (PubMed ESearch default; no order was requested)");
  assert.equal(r.searches[0].translation, '"ketamine"[MeSH Terms] AND "neuralgia"[MeSH Terms]');
  assert.equal(r.searches[0].sentRecorded, false);
  assert.equal(r.searches[0].via, "NCBI E-utilities API (ESearch, EFetch)");
  assert.equal(r.searches[1].sent, "ketamin neuropathic", "the connector route removed the asterisk");
  assert.equal(r.searches[1].order, "relevance (PubMed Best Match)");
  assert.match(r.searches[1].via, /PubMed connector in Claude/);
  assert.equal(r.exhaustive, false);
  assert.ok(!r.gaps.some((g) => /must screen every record/.test(g)), "a narrative review is not told to screen everything");
});

test("the investigator's answers fill PRISMA-S items and the methods text; a model reply cannot write them", () => {
  const created = S().create({ family: "systematic-review", setting: "Ward", rawNeed: "Erector spinae plane block for rib fractures." });
  const id = created.id;
  useStudio.setState((st) => ({ studies: st.studies.map((x) => (x.id === id ? { ...reviewStudy(), id, title: x.title } : x)) }));
  assert.equal(S().setSearchLog(id, "peerReview", { answer: "yes", detail: "" }).ok, false, "a yes needs the details");
  assert.equal(S().setSearchLog(id, "nonsense" as never, { answer: "no", detail: "" }).ok, false);
  assert.equal(S().setSearchLog(id, "searcher", { detail: "" }).ok, false);
  assert.ok(S().setSearchLog(id, "peerReview", { answer: "yes", detail: "A health sciences librarian peer reviewed the PubMed strategy with the PRESS 2015 checklist on 18 September 2026" }).ok);
  assert.ok(S().setSearchLog(id, "citations", { answer: "no", detail: "" }).ok);
  assert.ok(S().setSearchLog(id, "filters", { answer: "no", detail: "" }).ok);
  assert.ok(S().setSearchLog(id, "searcher", { detail: "Vito (anesthesiologist), with a health sciences librarian" }).ok);
  let study = S().studies.find((x) => x.id === id)!;
  let r = buildSearchReport(study, "2026-09-24T12:00:00.000Z");
  const state = Object.fromEntries(r.prismaS.map((x) => [x.n, x.state]));
  assert.equal(state[14], "reported");
  assert.equal(state[5], "reported");
  assert.equal(state[10], "reported");
  assert.match(r.methods, /A health sciences librarian peer reviewed the PubMed strategy with the PRESS 2015 checklist on 18 September 2026\./);
  assert.doesNotMatch(r.methods, /\[State whether the strategies were peer reviewed/);
  assert.match(r.prismaS[4].text, /Reference lists and citing articles were not examined\./);
  assert.ok(study.audit.entries.some((e) => /Search report: peerReview recorded/.test(e.summary) && e.actor === "investigator"));

  // A model reply for the scan stage that tries to set the answers changes nothing about them.
  const before = S().studies.find((x) => x.id === id)!;
  S().illuminateApply(id, "scan", { query: "ketamine", searchLog: { entries: { peerReview: { answer: "yes", detail: "model says reviewed", at: "x" } } } }, studyRevision(before));
  study = S().studies.find((x) => x.id === id)!;
  assert.equal(study.scan.searchLog?.entries.peerReview?.detail, "A health sciences librarian peer reviewed the PubMed strategy with the PRESS 2015 checklist on 18 September 2026");
  S().setSearchLog(id, "peerReview", null);
  r = buildSearchReport(S().studies.find((x) => x.id === id)!, "2026-09-24T12:00:00.000Z");
  assert.equal(r.prismaS[13].state, "needs-answer");
});

test("limits written into a strategy must be justified before item 9 is reported", () => {
  const s = createStudy({ family: "scoping-review", setting: "Ward", rawNeed: "Ketamine.", constraints: "" });
  const e: RetrievalEvent = {
    id: "ret-l",
    at: "2026-09-24T10:00:00.000Z",
    provider: "pubmed",
    query: "(ketamine) AND english[la] AND 2015:2026[dp]",
    sent: "(ketamine) AND english[la] AND 2015:2026[dp]",
    resultCount: 12,
    recordIds: [],
    status: "ok",
    performedBy: "app",
  };
  const study: Study = { ...s, scan: { ...s.scan, retrievalEvents: [e] } };
  let r = buildSearchReport(study, "2026-09-24T12:00:00.000Z");
  assert.equal(r.prismaS[8].state, "needs-answer");
  assert.match(r.methods, /restricted results by language and publication date\. \[State why each restriction was used\.\]/);
  const answered: Study = { ...study, scan: { ...study.scan, searchLog: { entries: { limitsWhy: { detail: "We limited the search to English because no translator was available, and to 2015 onward because the block was first described in 2016", at: "x" } } } } };
  r = buildSearchReport(answered, "2026-09-24T12:00:00.000Z");
  assert.equal(r.prismaS[8].state, "reported");
  assert.match(r.methods, /first described in 2016\./);
});

test("a search run elsewhere (Embase through Ovid) is recorded by the investigator and reported with its route", () => {
  const created = S().create({ family: "systematic-review", setting: "Ward", rawNeed: "Erector spinae plane block for rib fractures." });
  const id = created.id;
  const base = { source: "Embase", kind: "database" as const, platform: "Ovid", strategy: "1. exp rib fracture/\n2. erector spinae plane block.tw.\n3. 1 and 2", found: 57 };
  assert.equal(S().recordExternalSearch(id, { ...base, date: "2099-01-01" }).ok, false, "no future dates");
  assert.equal(S().recordExternalSearch(id, { ...base, platform: "", date: "2026-09-20" }).ok, false);
  assert.equal(S().recordExternalSearch(id, { ...base, date: "20 Sept" }).ok, false);
  assert.equal(S().recordExternalSearch(id, { ...base, found: -3, date: "2026-09-20" }).ok, false);
  const ok = S().recordExternalSearch(id, { ...base, date: "2026-09-20" });
  assert.ok(ok.ok);
  const study = S().studies.find((x) => x.id === id)!;
  const r = buildSearchReport(study, "2026-09-24T12:00:00.000Z");
  const embase = r.sources.find((s) => s.provider === EXTERNAL_PROVIDER)!;
  assert.equal(embase.source, "Embase");
  assert.equal(embase.via, "Ovid");
  assert.equal(embase.found, 57);
  assert.equal(r.searches[0].performedBy, "manual");
  assert.match(r.methods, /We searched Embase \(Ovid\) on 20 September 2026\./);
  const doc = searchReportDocument(r);
  const table1 = doc.blocks.find((b) => b.kind === "table" && b.caption.startsWith("Table 1"));
  assert.ok(table1 && table1.kind === "table" && table1.rows[0][5] === "none (run elsewhere)");
  assert.ok(r.gaps.some((g) => /run outside Meridian/.test(g)));
});

test("server searches ask for relevance order and record the strategy, reading, route and cap", async () => {
  assert.match(pubmedSearchRequest("x", 20).url, /[?&]sort=relevance(&|$)/);
  assert.match(clinicalTrialsSearchRequest("x", 50).url, /[?&]sort=%40relevance(&|$)/);
  const search = pubmedSearchRequest("ketamine neuropathic", 2, "meridian");
  const fetch = pubmedFetchRequest(["90000001"], "meridian");
  const t = recordedTransport({
    [search.url]: { status: 200, body: JSON.stringify({ esearchresult: { count: "57", idlist: ["90000001"], querytranslation: "ketamine[All Fields]" } }) },
    [fetch.url]: { status: 200, body: "<PubmedArticleSet></PubmedArticleSet>" },
  });
  const r = await searchLive("pubmed", "ketamine neuropathic", t, { max: 2, sleep: noSleep });
  assert.equal(r.event.sent, "ketamine neuropathic");
  assert.equal(r.event.translation, "ketamine[All Fields]");
  assert.equal(r.event.via, "NCBI E-utilities API (ESearch, EFetch)");
  assert.equal(r.event.order, "relevance (PubMed Best Match)");
  assert.equal(r.event.importCap, 2);
});

test("text and Word output: same content, no dashes, strategies kept exactly", async () => {
  const r = buildSearchReport(reviewStudy(), "2026-09-24T12:00:00.000Z");
  const text = searchReportText(r);
  assert.doesNotMatch(text, dashes);
  assert.match(text, /Table 4\. PRISMA-S checklist/);
  assert.match(text, /PubMed's reading of the strategy: \("erector"\[All Fields\]/);
  assert.match(text, /Open items for the authors/);
  const buf = await reportToDocxBuffer(searchReportDocument(r));
  assert.equal(Buffer.from(buf.slice(0, 2)).toString(), "PK");
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /Literature search report/);
  assert.match(xml, /erector spinae plane block rib fractures/);
  assert.match(xml, /Consolas/);
  assert.doesNotMatch(xml, dashes);
  const widths = columnWidths([22, 26, 9, 15, 13, 15]);
  assert.equal(widths.reduce((a, b) => a + b, 0), CONTENT_WIDTH);
});
