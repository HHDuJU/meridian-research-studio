import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { crossrefLookupRequest, parseCrossrefWorks } from "../src/lib/evidence/providers/crossref";
import { parseOpenAlexWorks, openalexSearchRequest } from "../src/lib/evidence/providers/openalex";
import { parsePubmedSearch, parsePubmedSummary, pubmedSearchRequest } from "../src/lib/evidence/providers/pubmed";
import { parseConsensusConnectorExport } from "../src/lib/evidence/providers/consensus";
import { ingestRecords } from "../src/lib/evidence/records";
import { consultedSources, ingestExternalSearch, runSearch } from "../src/lib/evidence/retrieve";
import { applyLookupOutcome, compareWithRegistry, summarizeVerification, verifyByDoi } from "../src/lib/evidence/verify";
import { ledgerIssues, newClaim } from "../src/lib/evidence/ledger";
import { linkReports } from "../src/lib/evidence/dedupe";
import { normalizeDoi, titleSimilarity } from "../src/lib/evidence/identifiers";
import { blockedTransport, recordedTransport } from "../src/lib/evidence/transport";
import type { EvidenceItem } from "../src/lib/types";

const fixtureDir = new URL("./fixtures/", import.meta.url);
const crossrefFixture = JSON.parse(fs.readFileSync(new URL("crossref-lookup-2026-09-20.json", fixtureDir), "utf8")) as {
  url: string; status: number; body: string; requestedDois: string[];
};
const consensusExport = fs.readFileSync(new URL("consensus-export-2026-09-20.txt", fixtureDir), "utf8");

test("normalizeDoi strips resolver prefixes and trailing punctuation", () => {
  assert.equal(normalizeDoi("https://doi.org/10.1093/PM/pnaf140."), "10.1093/pm/pnaf140");
  assert.equal(normalizeDoi("DOI: 10.1136/rapm-2022-103976,"), "10.1136/rapm-2022-103976");
  assert.equal(normalizeDoi("no doi here"), undefined);
});

test("Crossref: request URL is what was recorded; real response parses to 3 records, fabricated DOI absent", () => {
  assert.equal(crossrefLookupRequest(crossrefFixture.requestedDois).url, crossrefFixture.url);
  const parsed = parseCrossrefWorks(crossrefFixture.body);
  assert.equal(parsed.total, 3);
  assert.deepEqual(parsed.records.map((r) => r.doi).sort(), ["10.1093/pm/pnaf140", "10.1093/pm/pnx286", "10.1136/rapm-2022-103976"]);
  const barreto = parsed.records.find((r) => r.doi === "10.1093/pm/pnaf140")!;
  assert.equal(barreto.year, 2025);
  assert.equal(barreto.venue, "Pain Medicine");
  assert.equal(barreto.authors, "", "lookup select omits authors by design");
});

test("Consensus connector export parses titles, years, venues, DOIs and abstracts; missing DOI stays undefined", () => {
  const parsed = parseConsensusConnectorExport(consensusExport);
  assert.equal(parsed.total, 20);
  assert.equal(parsed.records.length, 4);
  const [barreto, malaithong, mccormick, mohamed] = parsed.records;
  assert.equal(barreto.doi, "10.1093/pm/pnaf140");
  assert.equal(barreto.year, 2025);
  assert.equal(barreto.venue, "Pain medicine");
  assert.match(barreto.abstract ?? "", /Nine RCTs \(n = 412\)/);
  assert.match(barreto.abstract ?? "", /RESULT_END/);
  assert.equal(malaithong.year, 2022);
  assert.equal(mccormick.doi, "10.1093/pm/pnx286");
  assert.equal(mohamed.doi, undefined);
  assert.equal(mohamed.venue, "Pain physician");
});

test("ingested connector results carry retrieval provenance with performedBy: connector, never 'verified'", () => {
  const parsed = parseConsensusConnectorExport(consensusExport);
  const { event, items } = ingestExternalSearch("consensus-connector", "genicular RFA knee OA randomized", parsed, "connector", "2026-09-20T20:30:00Z");
  assert.equal(event.performedBy, "connector");
  assert.equal(event.status, "partial");
  assert.equal(event.resultCount, 20);
  assert.equal(items.length, 4);
  assert.ok(items.every((i) => i.provenance.origin === "retrieval" && i.provenance.status === "retrieved"));
  assert.ok(items.every((i) => i.provenance.retrievalEventIds[0] === event.id));
  assert.deepEqual(consultedSources([event]), ["consensus-connector (partial, 20 hits)"]);
});

test("verification against the real Crossref response: 3 verified, fabricated DOI not-found, wrong-title DOI mismatch", () => {
  const parsed = parseConsensusConnectorExport(consensusExport);
  const { items } = ingestExternalSearch("consensus-connector", "q", parsed, "connector");
  // A model lead that borrowed a real DOI for a different paper — the classic misattribution.
  const lead: EvidenceItem = {
    ...items[0],
    id: "ev-lead",
    title: "Intravenous ketamine for refractory neuropathic pain: a randomized trial",
    year: 2019,
    doi: "10.1093/pm/pnx286",
    provenance: { origin: "model", retrievalEventIds: [], identifiers: { doi: "10.1093/pm/pnx286" }, access: "unknown", status: "unverified", checks: [] },
  };
  const fake: EvidenceItem = {
    ...lead,
    id: "ev-fake",
    title: "A landmark trial that does not exist",
    doi: "10.1093/pm/pnz999fake",
    provenance: { ...lead.provenance, identifiers: { doi: "10.1093/pm/pnz999fake" } },
  };
  const all = [...items, lead, fake];
  const outcome = { status: "ok" as const, records: parseCrossrefWorks(crossrefFixture.body).records };
  const { items: checked, checks } = applyLookupOutcome(all, crossrefFixture.requestedDois, "crossref", outcome, "2026-09-20T20:41:00Z");
  const byId = Object.fromEntries(checked.map((i) => [i.id, i]));
  assert.equal(byId[items[0].id].provenance.status, "verified");
  assert.equal(byId[items[1].id].provenance.status, "verified");
  assert.equal(byId[items[2].id].provenance.status, "retrieved", "2018 vs issued 2017 without typed dates stays unresolved");
  assert.equal(byId[items[2].id].provenance.checks[0].result, "unresolved");
  assert.equal(byId[items[3].id].provenance.status, "retrieved", "no DOI → untouched");
  assert.equal(byId["ev-lead"].provenance.status, "mismatch");
  assert.equal(byId["ev-lead"].provenance.checks[0].observed?.title?.slice(0, 22), "A Prospective Randomiz");
  assert.equal(byId["ev-fake"].provenance.status, "unverified");
  assert.equal(byId["ev-fake"].provenance.checks[0].result, "not-found");
  assert.ok(checks.length >= 5);
  assert.equal(checks.filter((c) => c.result === "not-found").length, 1);
  const s = summarizeVerification(checked);
  assert.equal(s.verified, 2);
  assert.equal(s.mismatch, 1);
  assert.equal(s.notFound, 1);
});

test("a blocked registry yields check-failed, never verified, and a blocked search yields a visible blocked event", async () => {
  const parsed = parseConsensusConnectorExport(consensusExport);
  const { items } = ingestExternalSearch("consensus-connector", "q", parsed, "connector");
  const adapter = { provider: "crossref" as const, buildLookup: (d: string[]) => crossrefLookupRequest(d), parseLookup: parseCrossrefWorks };
  const res = await verifyByDoi(items, adapter, blockedTransport("egress policy 403"));
  assert.ok(res.items.filter((i) => i.doi).every((i) => i.provenance.status === "check-failed"));
  assert.ok(res.checks.every((c) => c.result === "blocked"));
  const search = await runSearch(
    { provider: "openalex", buildSearch: (q) => openalexSearchRequest(q, 5), parseSearch: parseOpenAlexWorks },
    "medial branch block threshold",
    blockedTransport("egress policy 403"),
  );
  assert.equal(search.event.status, "blocked");
  assert.deepEqual(search.items, []);
  assert.equal(search.event.performedBy, "app");
});

test("verifyByDoi over a recorded transport reproduces the live code path end to end", async () => {
  const parsed = parseConsensusConnectorExport(consensusExport);
  const { items } = ingestExternalSearch("consensus-connector", "q", parsed, "connector");
  // Same DOIs as the recording, same batching → same URL → recorded body replays.
  const withFake: EvidenceItem[] = [...items, { ...items[0], id: "ev-fake", title: "Nope", doi: "10.1093/pm/pnz999fake", provenance: { ...items[0].provenance, identifiers: { doi: "10.1093/pm/pnz999fake" } } }];
  const adapter = { provider: "crossref" as const, buildLookup: (d: string[]) => crossrefLookupRequest(d), parseLookup: parseCrossrefWorks };
  const res = await verifyByDoi(withFake, adapter, recordedTransport({ [crossrefFixture.url]: { status: 200, body: crossrefFixture.body } }));
  assert.equal(res.requests[0].url, crossrefFixture.url);
  assert.equal(summarizeVerification(res.items).verified, 2);
  assert.equal(res.items.find((i) => i.id === "ev-fake")!.provenance.checks[0].result, "not-found");
});

test("compareWithRegistry: near-identical titles match; different works do not; year disagreement blocks a match", () => {
  const a = compareWithRegistry({ title: "Efficacy and safety of genicular nerve ablation techniques for knee osteoarthritis: A systematic review and meta-analysis of Sham-Controlled randomized trials.", year: 2025 }, { title: "Efficacy and safety of genicular nerve ablation techniques for knee osteoarthritis: a systematic review and meta-analysis of sham-controlled randomized trials", authors: "", year: 2025, venue: "" });
  assert.equal(a.result, "match");
  const b = compareWithRegistry({ title: "Ketamine for neuropathic pain", year: 2019 }, { title: "Bipolar radiofrequency ablation of the genicular nerves", authors: "", year: 2022, venue: "" });
  assert.equal(b.result, "mismatch");
  const c = compareWithRegistry({ title: "Same title here", year: 2010 }, { title: "Same title here", authors: "", year: 2020, venue: "" });
  assert.equal(c.result, "unresolved");
  assert.equal(c.dateVariant?.corroborated, false);
  assert.ok(titleSimilarity("Cooled radiofrequency ablation of genicular nerves", "Cooled radiofrequency ablation of the genicular nerves") > 0.8);
});

test("ledger: source-derived claims need real, non-mismatched sources; assumptions cannot be 'low' uncertainty", () => {
  const parsed = parseConsensusConnectorExport(consensusExport);
  const { items } = ingestExternalSearch("consensus-connector", "q", parsed, "connector");
  const verified = { ...items[0], provenance: { ...items[0].provenance, status: "verified" as const } };
  const mismatched = { ...items[1], provenance: { ...items[1].provenance, status: "mismatch" as const } };
  const claims = [
    newClaim({ id: "c1", text: "Sham-controlled RCTs show pain reduction at 12 weeks", kind: "source-derived", sourceIds: [verified.id], location: "Results", uncertainty: "moderate" }),
    newClaim({ id: "c2", text: "Bipolar RFA beats sham at 12 months", kind: "source-derived", sourceIds: [mismatched.id], uncertainty: "low" }),
    newClaim({ id: "c3", text: "Our clinic has a cooled RF generator", kind: "assumption", sourceIds: [], uncertainty: "low" }),
    newClaim({ id: "c4", text: "Ghost claim", kind: "source-derived", sourceIds: ["ev-nonexistent"], uncertainty: "moderate" }),
    newClaim({ id: "c5", text: "Unsupported", kind: "source-derived", sourceIds: [], uncertainty: "high" }),
  ];
  const issues = ledgerIssues(claims, [verified, mismatched]);
  const forClaim = (id: string) => issues.filter((i) => i.claimId === id);
  assert.equal(forClaim("c1").filter((i) => i.severity === "block").length, 0);
  assert.ok(forClaim("c2").some((i) => i.severity === "block" && /different work/.test(i.message)));
  assert.ok(forClaim("c3").some((i) => /assumptions and scenarios are not facts/.test(i.message)));
  assert.ok(forClaim("c4").some((i) => /unknown source id/.test(i.message)));
  assert.ok(forClaim("c5").some((i) => /has no source/.test(i.message)));
});

test("linkReports groups the same work reported twice (DOI, or title+year) without deleting either report", () => {
  const parsed = parseConsensusConnectorExport(consensusExport);
  const { items } = ingestRecords(parsed.records, { id: "ret-x", provider: "consensus-connector" });
  const dup = { ...items[0], id: "ev-dup", doi: undefined, provenance: { ...items[0].provenance, identifiers: {} } };
  const { items: linked, groups } = linkReports([...items, dup]);
  assert.equal(linked.length, 5);
  assert.equal(groups.size, 4);
  assert.equal(linked[0].provenance.groupId, linked[4].provenance.groupId);
});

test("PubMed and OpenAlex parsers handle the documented JSON shapes and reject unexpected ones", () => {
  const es = parsePubmedSearch(JSON.stringify({ esearchresult: { count: "12", idlist: ["1", "2"], querytranslation: "x[tiab]" } }));
  assert.equal(es.total, 12);
  assert.deepEqual(es.pmids, ["1", "2"]);
  const sum = parsePubmedSummary(JSON.stringify({ result: { uids: ["41063397"], "41063397": { uid: "41063397", title: "A title.", pubdate: "2025 Oct 8", fulljournalname: "Pain Medicine", authors: [{ name: "Barreto RB" }], articleids: [{ idtype: "doi", value: "10.1093/pm/pnaf140" }], pubtype: ["Systematic Review"] } } }));
  assert.equal(sum[0].pmid, "41063397");
  assert.equal(sum[0].doi, "10.1093/pm/pnaf140");
  assert.equal(sum[0].year, 2025);
  assert.throws(() => parsePubmedSearch("{}"));
  const oa = parseOpenAlexWorks(JSON.stringify({ meta: { count: 1 }, results: [{ id: "https://openalex.org/W1", doi: "https://doi.org/10.1093/pm/pnaf140", title: "T", publication_year: 2025, type: "review", ids: { pmid: "https://pubmed.ncbi.nlm.nih.gov/41063397" }, primary_location: { source: { display_name: "Pain Medicine" } }, authorships: [{ author: { display_name: "R Barreto" } }] }] }));
  assert.equal(oa.records[0].pmid, "41063397");
  assert.equal(oa.records[0].doi, "10.1093/pm/pnaf140");
  assert.throws(() => parseOpenAlexWorks("{\"nope\":1}"));
  assert.match(pubmedSearchRequest("x", 5).url, /tool=meridian/);
});

test("collapseIdenticalRecords merges same-DOI records from two searches and keeps both event ids", async () => {
  const { collapseIdenticalRecords } = await import("../src/lib/evidence/dedupe");
  const parsed = parseConsensusConnectorExport(consensusExport);
  const a = ingestExternalSearch("consensus-connector", "q1", parsed, "connector");
  const b = ingestExternalSearch("consensus-connector", "q2", parsed, "connector");
  const { items, collapsed } = collapseIdenticalRecords([...a.items, ...b.items]);
  // 4 records each; 3 have DOIs and collapse, the DOI-less one is kept twice (not provably identical)
  assert.equal(collapsed, 3);
  assert.equal(items.length, 5);
  const barreto = items.find((i) => i.doi === "10.1093/pm/pnaf140")!;
  assert.deepEqual(barreto.provenance.retrievalEventIds.sort(), [a.event.id, b.event.id].sort());
});

test("record ids are stable across re-ingestion (content-derived), so annotations keep pointing at the same work", async () => {
  const { stableRecordId } = await import("../src/lib/evidence/records");
  const parsed = parseConsensusConnectorExport(consensusExport);
  const a = ingestExternalSearch("consensus-connector", "q", parsed, "connector").items.map((i) => i.id);
  const b = ingestExternalSearch("consensus-connector", "q again", parsed, "connector").items.map((i) => i.id);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length, "no collisions in the fixture");
  assert.equal(stableRecordId({ doi: "https://doi.org/10.1093/PM/pnaf140", title: "x", year: 1 }), stableRecordId({ doi: "10.1093/pm/pnaf140", title: "y", year: 2 }));
});
