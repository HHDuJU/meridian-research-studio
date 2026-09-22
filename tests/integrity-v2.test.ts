import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePubmedArticles, pubmedFetchRequest, pubmedSearchRequest } from "../src/lib/evidence/providers/pubmed";
import { abstractFromInvertedIndex, openalexDiscoveryRequest, parseOpenAlexWorks } from "../src/lib/evidence/providers/openalex";
import { clinicalTrialsSearchRequest, parseClinicalTrials } from "../src/lib/evidence/providers/clinicaltrials";
import { crossrefLookupRequest } from "../src/lib/evidence/providers/crossref";
import { lookupDoisLive, providerQuery, queryProblem, searchLive } from "../src/lib/evidence/live";
import { recordedTransport, blockedTransport } from "../src/lib/evidence/transport";
import { ingestRecords, stableRecordId } from "../src/lib/evidence/records";
import { approximateFigures, claimSupport, extractNumbers, groundedInInvestigatorText, investigatorSentences, numberWordsToDigits } from "../src/lib/evidence/support";
import { applyDecision, decisionIsSupported, evaluateDecision, evidenceRevision, evidenceRevisionFor, studyRevision } from "../src/lib/evidence/decision";
import { mergeAppraisedClaims } from "../src/lib/evidence/appraise";
import { applyAiResult } from "../src/lib/apply-ai";
import { applyLookupOutcome } from "../src/lib/evidence/verify";
import { schemaFor } from "../src/lib/ai";
import { compactStudy, scanAppraisalBatches } from "../src/lib/compact";
import { createStudy } from "../src/lib/defaults";
import { validateSearchInput, validateDoiInput } from "../src/lib/evidence-server";
import { studyStatus } from "../src/lib/status";
import { useStudio } from "../src/lib/store";
import type { Claim, EvidenceItem, Study } from "../src/lib/types";

const S = () => useStudio.getState();
const noSleep = async () => undefined;

// Synthetic records in the documented PubMed efetch shape (no publisher text).
const EFETCH_XML = `<?xml version="1.0" ?>
<!DOCTYPE PubmedArticleSet PUBLIC "-//NLM//DTD PubMedArticle, 1st January 2025//EN" "https://dtd.nlm.nih.gov/ncbi/pubmed/out/pubmed_250101.dtd">
<PubmedArticleSet>
 <PubmedArticle>
  <MedlineCitation Status="MEDLINE" Owner="NLM">
   <PMID Version="1">90000001</PMID>
   <Article PubModel="Print-Electronic">
    <Journal><JournalIssue CitedMedium="Internet"><PubDate><Year>2024</Year><Month>Mar</Month></PubDate></JournalIssue><Title>Synthetic Journal of Anaesthesia &amp; Pain</Title><ISOAbbreviation>Synth J Anaesth</ISOAbbreviation></Journal>
    <ArticleTitle>Intravenous ketamine for <i>refractory</i> neuropathic pain: a synthetic randomized trial.</ArticleTitle>
    <ELocationID EIdType="doi" ValidYN="Y">10.5555/synth.2024.001</ELocationID>
    <Abstract>
     <AbstractText Label="BACKGROUND" NlmCategory="BACKGROUND">Synthetic background sentence one.</AbstractText>
     <AbstractText Label="RESULTS" NlmCategory="RESULTS">Pain scores fell by 2.1 points (95% CI 1.2&#8211;3.0) in 120 participants; thirty-eight percent reached a 30% reduction.</AbstractText>
     <AbstractText Label="CONCLUSIONS" NlmCategory="CONCLUSIONS">Synthetic conclusion &lt;short&gt;.</AbstractText>
    </Abstract>
    <AuthorList CompleteYN="Y"><Author ValidYN="Y"><LastName>Doe</LastName><ForeName>Jane</ForeName><Initials>J</Initials></Author><Author ValidYN="Y"><CollectiveName>Synthetic Pain Group</CollectiveName></Author></AuthorList>
    <PublicationTypeList><PublicationType UI="D016428">Journal Article</PublicationType><PublicationType UI="D016449">Randomized Controlled Trial</PublicationType></PublicationTypeList>
    <ArticleDate DateType="Electronic"><Year>2023</Year><Month>12</Month><Day>01</Day></ArticleDate>
   </Article>
  </MedlineCitation>
  <PubmedData><PublicationStatus>ppublish</PublicationStatus><ArticleIdList><ArticleId IdType="pubmed">90000001</ArticleId><ArticleId IdType="doi">10.5555/synth.2024.001</ArticleId></ArticleIdList></PubmedData>
 </PubmedArticle>
 <PubmedArticle>
  <MedlineCitation Status="MEDLINE" Owner="NLM">
   <PMID Version="1">90000002</PMID>
   <Article PubModel="Print">
    <Journal><JournalIssue><PubDate><MedlineDate>2019 Nov-Dec</MedlineDate></PubDate></JournalIssue><Title>Synthetic Reviews</Title></Journal>
    <ArticleTitle>A synthetic review later retracted.</ArticleTitle>
    <Abstract><AbstractText>Single paragraph synthetic abstract with 14 studies.</AbstractText></Abstract>
    <PublicationTypeList><PublicationType UI="D016428">Journal Article</PublicationType><PublicationType UI="D016441">Retracted Publication</PublicationType></PublicationTypeList>
   </Article>
   <CommentsCorrectionsList><CommentsCorrections RefType="RetractionIn"><RefSource>Synthetic Reviews. 2021</RefSource><PMID Version="1">90000099</PMID></CommentsCorrections></CommentsCorrectionsList>
  </MedlineCitation>
  <PubmedData><PublicationStatus>ppublish</PublicationStatus><ArticleIdList><ArticleId IdType="pubmed">90000002</ArticleId></ArticleIdList></PubmedData>
 </PubmedArticle>
</PubmedArticleSet>`;

test("pubmed efetch: whole structured abstract, decoded text, DOI, typed dates, retraction", () => {
  const recs = parsePubmedArticles(EFETCH_XML);
  assert.equal(recs.length, 2);
  const a = recs[0];
  assert.equal(a.pmid, "90000001");
  assert.equal(a.doi, "10.5555/synth.2024.001");
  assert.equal(a.title, "Intravenous ketamine for refractory neuropathic pain: a synthetic randomized trial");
  assert.equal(a.venue, "Synthetic Journal of Anaesthesia & Pain");
  assert.equal(a.year, 2024);
  assert.deepEqual(a.dates, { print: 2024, online: 2023 });
  assert.match(a.abstract ?? "", /^BACKGROUND: Synthetic background sentence one\.\nRESULTS: Pain scores fell by 2\.1 points \(95% CI 1\.2–3\.0\)/);
  assert.match(a.abstract ?? "", /CONCLUSIONS: Synthetic conclusion <short>\./);
  assert.equal(a.authors, "Doe J, Synthetic Pain Group");
  assert.equal(a.publicationStatus, "published");
  const b = recs[1];
  assert.equal(b.year, 2019);
  assert.equal(b.publicationStatus, "retracted");
  assert.deepEqual(b.notices, [{ type: "RetractionIn", pmid: "90000099" }]);
  const { items, documents } = ingestRecords(recs, { id: "ret-1", provider: "pubmed" });
  assert.equal(items[0].kind, "rct");
  assert.equal(items[1].publicationStatus, "retracted");
  assert.equal(documents.length, 2);
  assert.equal(items[0].abstract?.text, a.abstract);
});

test("pubmed live search: esearch then efetch; partial when more hits exist; failures are visible", async () => {
  const search = pubmedSearchRequest("ketamine neuropathic", 2, "meridian", "x@example.org");
  const fetch = pubmedFetchRequest(["90000001", "90000002"], "meridian", "x@example.org");
  const t = recordedTransport({
    [search.url]: { status: 200, body: JSON.stringify({ esearchresult: { count: "57", idlist: ["90000001", "90000002"], querytranslation: "ketamine[All Fields]" } }) },
    [fetch.url]: { status: 200, body: EFETCH_XML },
  });
  const r = await searchLive("pubmed", "ketamine neuropathic", t, { max: 2, contact: "x@example.org", sleep: noSleep });
  assert.equal(r.event.status, "partial");
  assert.equal(r.event.resultCount, 57);
  assert.equal(r.items.length, 2);
  assert.equal(r.documents.length, 2);
  assert.deepEqual(r.requests, [search.url, fetch.url]);
  assert.match(r.event.note ?? "", /2 of 57 hits ingested/);
  assert.match(r.event.note ?? "", /2 of 2 records carry an abstract/);

  const blocked = await searchLive("pubmed", "ketamine", blockedTransport("policy 403"), { sleep: noSleep });
  assert.equal(blocked.event.status, "blocked");
  assert.equal(blocked.items.length, 0);
  assert.equal(blocked.event.resultCount, null);

  const s2 = pubmedSearchRequest("q2", 20);
  const f2 = pubmedFetchRequest(["1"]);
  const half = recordedTransport({ [s2.url]: { status: 200, body: JSON.stringify({ esearchresult: { count: "1", idlist: ["1"] } }) }, [f2.url]: { status: 502, body: "" } });
  const failedFetch = await searchLive("pubmed", "q2", half, { sleep: noSleep });
  assert.equal(failedFetch.event.status, "error");
  assert.match(failedFetch.event.note ?? "", /efetch failed/);
  assert.equal(failedFetch.items.length, 0);
});

test("openalex: abstract rebuilt from the inverted index; retraction flag kept", () => {
  assert.equal(abstractFromInvertedIndex({ Pain: [0], fell: [1], by: [2], "30%": [3] }), "Pain fell by 30%");
  assert.equal(abstractFromInvertedIndex(null), undefined);
  const body = JSON.stringify({
    meta: { count: 3 },
    results: [
      { id: "https://openalex.org/W1", doi: "https://doi.org/10.5555/oa.1", title: "Synthetic OA work", publication_year: 2022, type: "article", authorships: [{ author: { display_name: "A B" } }], abstract_inverted_index: { Synthetic: [0], text: [1] }, is_retracted: false },
      { id: "https://openalex.org/W2", doi: null, title: "Retracted synthetic work", publication_year: 2020, type: "article", is_retracted: true },
    ],
  });
  const parsed = parseOpenAlexWorks(body);
  assert.equal(parsed.records[0].abstract, "Synthetic text");
  assert.equal(parsed.records[1].publicationStatus, "retracted");
  assert.match(openalexDiscoveryRequest("q").url, /abstract_inverted_index/);
});

test("clinicaltrials.gov: registry records carry NCT identity, status and design in their stored text", () => {
  const body = JSON.stringify({
    totalCount: 1,
    studies: [
      {
        protocolSection: {
          identificationModule: { nctId: "NCT09999991", briefTitle: "Synthetic ketamine infusion trial" },
          statusModule: { overallStatus: "RECRUITING", startDateStruct: { date: "2025-02" }, studyFirstPostDateStruct: { date: "2025-01-15" } },
          descriptionModule: { briefSummary: "Synthetic summary." },
          designModule: { studyType: "INTERVENTIONAL", phases: ["PHASE2"], enrollmentInfo: { count: 80 } },
          sponsorCollaboratorsModule: { leadSponsor: { name: "Synthetic University" } },
        },
        hasResults: false,
      },
    ],
  });
  const parsed = parseClinicalTrials(body);
  assert.equal(parsed.total, 1);
  const r = parsed.records[0];
  assert.equal(r.nct, "NCT09999991");
  assert.equal(r.kind, "trial-registry");
  assert.match(r.abstract ?? "", /Status: RECRUITING/);
  assert.match(r.abstract ?? "", /Enrollment: 80/);
  assert.equal(stableRecordId(r), stableRecordId({ title: "different title", year: 1999, nct: "NCT09999991" }));
  assert.match(clinicalTrialsSearchRequest("ketamine").url, /query\.term=ketamine/);
});

test("crossref identity checks run per chunk; a blocked chunk never becomes 'not found'", async () => {
  const dois = Array.from({ length: 21 }, (_, i) => `10.5555/chk.${i}`);
  const first = crossrefLookupRequest(dois.slice(0, 20));
  const found = dois.slice(0, 20).map((d, i) => ({ DOI: d, title: [`Synthetic title ${i}`], issued: { "date-parts": [[2020]] }, "container-title": ["J"] }));
  const t = recordedTransport({ [first.url]: { status: 200, body: JSON.stringify({ status: "ok", message: { "total-results": 20, items: found } }) } });
  const r = await lookupDoisLive(dois, t, { sleep: noSleep });
  assert.equal(r.chunks.length, 2);
  assert.equal(r.chunks[0].outcome.status, "ok");
  assert.equal(r.chunks[1].outcome.status, "blocked");

  const s = S().create({ family: null, setting: "s", rawNeed: "n" });
  const items: EvidenceItem[] = dois.map((doi, i) => ({
    ...ingestRecords([{ title: `Synthetic title ${i}`, authors: "", year: 2020, venue: "J", doi }], { id: "ret-c", provider: "fixture" }).items[0],
  }));
  items[1] = { ...items[1], title: "A completely different paper about something else" };
  S().mergeStage(s.id, "scan", { items, retrievalEvents: [{ id: "ret-c", at: "", provider: "fixture", query: "q", resultCount: 21, recordIds: items.map((i) => i.id), status: "ok", performedBy: "app" }] });
  const summary = S().applyIdentityChecks(s.id, r.provider, r.chunks);
  assert.equal(summary.checked, 21);
  assert.equal(summary.verified, 19);
  assert.equal(summary.mismatch, 1);
  assert.equal(summary.failed, 1);
  const after = S().studies.find((x) => x.id === s.id)!;
  const last = after.scan.items.find((i) => i.doi === "10.5555/chk.20")!;
  assert.equal(last.provenance.status, "check-failed");
  assert.equal(last.provenance.checks.at(-1)?.result, "blocked");
  assert.ok(after.audit.entries.some((e) => e.actor === "system" && /Identity checks \(crossref\)/.test(e.summary)));
});

test("server-function input is validated before any network call", () => {
  assert.throws(() => validateSearchInput({ provider: "scholar", query: "q" }), /Unknown literature source/);
  assert.throws(() => validateSearchInput({ provider: "pubmed", query: "" }), /empty/);
  assert.throws(() => validateSearchInput({ provider: "pubmed", query: "x".repeat(501) }), /exceeds/);
  assert.throws(() => validateSearchInput({ provider: "pubmed", query: "q", max: 500 }), /max must be/);
  assert.deepEqual(validateSearchInput({ provider: "openalex", query: " ketamine " }), { provider: "openalex", query: "ketamine", max: undefined });
  assert.throws(() => validateDoiInput({ dois: [] }), /No DOIs/);
});

test("hand-set status cannot claim a registry check; manual changes are recorded as manual checks", () => {
  const s = S().create({ family: null, setting: "s", rawNeed: "n" });
  const lead = applyAiResult("scan", { items: [{ title: "Invented landmark trial", doi: "10.9999/invented" }] }, null, s).stagePatch.items as EvidenceItem[];
  S().mergeStage(s.id, "scan", { items: lead });
  const id = lead[0].id;
  const refused = S().changeSource(s.id, { id }, "status", "verified");
  assert.equal(refused.ok, false);
  assert.match(refused.reason ?? "", /cannot be set by hand/);
  assert.equal(S().studies.find((x) => x.id === s.id)!.scan.items[0].provenance.status, "unverified");
  assert.equal(S().changeSource(s.id, { id }, "status", "retrieved").ok, false);
  const ok = S().changeSource(s.id, { id }, "status", "mismatch");
  assert.equal(ok.ok, true);
  const item = S().studies.find((x) => x.id === s.id)!.scan.items[0];
  assert.equal(item.provenance.status, "mismatch");
  assert.equal(item.provenance.checks.at(-1)?.provider, "manual");
});

function studyWithRecord(abstract: string): { study: Study; id: string } {
  const study = createStudy({ family: "rct", setting: "s", rawNeed: "n" });
  const { items, documents } = ingestRecords([{ title: "Synthetic trial", authors: "Doe", year: 2024, venue: "J", doi: "10.5555/s.1", abstract }], { id: "ret-s", provider: "fixture" });
  study.scan.items = items;
  study.documents = documents;
  study.scan.retrievalEvents = [{ id: "ret-s", at: "", provider: "fixture", query: "q", resultCount: 1, recordIds: [items[0].id], status: "ok", performedBy: "app" }];
  return { study, id: items[0].id };
}

const ABSTRACT = "RESULTS: Pain scores fell by 2.1 points (95% CI 1.2 to 3.0) in 120 participants; thirty-eight percent reached a 30% reduction.";

test("claim support: quoted passage and every number must occur in the cited record's stored text", () => {
  const { study, id } = studyWithRecord(ABSTRACT);
  const claim = (over: Partial<Claim>): Claim => ({ id: "c1", text: "Pain fell by 2.1 points in 120 participants.", kind: "source-derived", sourceIds: [id], passage: "Pain scores fell by 2.1 points (95% CI 1.2 to 3.0)", uncertainty: "moderate", origin: "model", ...over });
  assert.equal(claimSupport(claim({}), study).status, "supported");
  assert.equal(claimSupport(claim({ text: "38% reached a 30% reduction." , passage: "thirty-eight percent reached a 30% reduction" }), study).status, "supported");
  const fabricatedNumber = claimSupport(claim({ text: "Pain fell by 4.5 points in 120 participants." }), study);
  assert.equal(fabricatedNumber.status, "numbers-not-in-source");
  assert.deepEqual(fabricatedNumber.missingNumbers, ["4.5"]);
  assert.equal(fabricatedNumber.blocking, true);
  const invented = claimSupport(claim({ passage: "ketamine abolished pain in every patient" }), study);
  assert.equal(invented.status, "passage-not-found");
  assert.equal(invented.blocking, true);
  assert.equal(claimSupport(claim({ kind: "inference", text: "Pooled 9.9" }), study).status, "not-source-derived");
  assert.deepEqual(extractNumbers(numberWordsToDigits("Forty-one percent of 1,204 women; 0.50 and .5")).sort(), ["0.5", "1204", "41"].sort());
});

test("a decision cannot rest on a claim its source text does not support", () => {
  const { study, id } = studyWithRecord(ABSTRACT);
  study.scan.claims = [{ id: "c-fab", text: "Pain fell by 4.5 points.", kind: "source-derived", sourceIds: [id], passage: "Pain scores fell by 2.1 points", uncertainty: "low", origin: "model" }];
  const r = applyDecision({ kind: "pursue", statement: "Run a trial.", claimIds: ["c-fab"], criteria: [], gates: [], alternatives: ["audit"] }, study);
  assert.ok(r.decision);
  const support = decisionIsSupported(r.decision!, study);
  assert.equal(support.ok, false);
  assert.match(support.reason, /claim c-fab: number\(s\) 4\.5 do not occur/);
  const ev = evaluateDecision({ ...r.decision!, status: "accepted", selectionStatus: "accepted" }, study);
  assert.ok(ev.blockers.some((b) => /claim c-fab/.test(b)));
  assert.equal(ev.canAct, false);
});

test("appraisal flags unsupported claims as issues and keeps them visible", () => {
  const { study, id } = studyWithRecord(ABSTRACT);
  const out = applyAiResult("scan", {
    annotations: [{ id, relevance: 80 }],
    claims: [
      { id: "c1", text: "Pain fell by 2.1 points.", kind: "source-derived", sourceIds: [id], passage: "Pain scores fell by 2.1 points", uncertainty: "moderate" },
      { id: "c2", text: "Pain fell by 48 points.", kind: "source-derived", sourceIds: [id], passage: "Pain scores fell", uncertainty: "moderate" },
    ],
  }, "rct", study);
  assert.equal(out.ok, true);
  assert.equal((out.stagePatch.claims as Claim[]).length, 2);
  assert.ok(out.issues.some((i) => i.code === "claim-unsupported" && i.path === "claims[c2]"));
  assert.equal(out.issues.some((i) => i.path === "claims[c1]"), false);
});

test("gates: a model 'met' needs anchors the investigator entered; local facts supply them", () => {
  const study = createStudy({ family: "qi-pdsa", setting: "s", rawNeed: "Improve discharge calls.", constraints: "No funding." });
  const payload = (evidence: string) => ({
    kind: "narrow",
    statement: "Start with one ward.",
    claimIds: [],
    criteria: [],
    gates: [{ id: "g1", requirement: "QI determination", status: "met", evidence }],
    alternatives: [],
  });
  const fabricated = applyDecision(payload("Record CGC-2026-031 dated 2026-09-08, supplied by the investigator"), study);
  assert.equal(fabricated.decision!.gates[0].status, "unknown");
  assert.ok(fabricated.issues.some((i) => i.code === "ungrounded-gate" && /CGC-2026-031/.test(i.message)));
  assert.equal(applyDecision(payload("Approved, trust me."), study).decision!.gates[0].status, "unknown");

  study.problem.localFacts = [{ id: "fact-1", text: "The governance committee classified the project as QI on 2026-09-08 (record CGC-2026-031).", by: "investigator", at: "" }];
  const grounded = applyDecision(payload("Record CGC-2026-031 dated 2026-09-08, supplied by the investigator"), study);
  assert.equal(grounded.decision!.gates[0].status, "met");
  assert.equal(grounded.decision!.gates[0].setBy, "model");
  assert.match(grounded.decision!.gates[0].grounding ?? "", /CGC-2026-031/);

  // Removing the fact reopens the gate at evaluation time.
  const accepted = { ...grounded.decision!, status: "accepted" as const, selectionStatus: "accepted" as const };
  study.problem.localFacts = [];
  const ev = evaluateDecision({ ...accepted, inputRevision: evidenceRevision(study) }, study);
  assert.ok(ev.blockers.some((b) => /declared met by the model/.test(b)));
});

test("investigator sets gates with evidence; the model cannot write local facts", () => {
  const s = S().create({ family: "qi-pdsa", setting: "s", rawNeed: "n", localFacts: ["Nurse manager approved 10 minutes of huddle time (WM-6B-2026-09)."] });
  assert.equal(S().studies.find((x) => x.id === s.id)!.problem.localFacts?.length, 1);
  const out = applyAiResult("problem", { statement: "x", localFacts: ["invented approval"] }, null, s);
  assert.ok(out.issues.some((i) => i.path === "localFacts" && i.code === "dropped"));
  assert.equal("localFacts" in out.stagePatch, false);

  const cur = S().studies.find((x) => x.id === s.id)!;
  const r = applyDecision({ kind: "narrow", statement: "One ward first.", claimIds: [], criteria: [], gates: [{ id: "g1", requirement: "Ethics determination", status: "unknown" }], alternatives: ["none"] }, cur);
  S().mergeStage(s.id, "design", { decisions: [r.decision!] });
  assert.equal(S().acceptDecision(s.id, "latest").ok, true);
  assert.equal(S().setGate(s.id, "latest", "g1", "met").ok, false);
  assert.equal(S().setGate(s.id, "latest", "g1", "met", "QI screening record QIS-118").ok, true);
  const after = S().studies.find((x) => x.id === s.id)!;
  const d = after.design.decisions.at(-1)!;
  assert.equal(d.gates[0].setBy, "investigator");
  assert.equal(d.actionStatus, "ready");
  assert.ok(after.audit.entries.some((e) => e.actor === "investigator" && /set gate g1/.test(e.summary)));
});

test("local facts enter the evidence revision; an accepted decision goes stale when they change", () => {
  const s = S().create({ family: "cohort", setting: "s", rawNeed: "n" });
  const cur = S().studies.find((x) => x.id === s.id)!;
  const r = applyDecision({ kind: "defer", statement: "Wait.", claimIds: [], criteria: [], gates: [], alternatives: [] }, cur);
  S().mergeStage(s.id, "design", { decisions: [r.decision!] });
  S().acceptDecision(s.id, "latest");
  assert.equal(S().studies.find((x) => x.id === s.id)!.design.decisions.at(-1)!.status, "accepted");
  S().addLocalFact(s.id, "Data access agreement DA-2026-17 signed.");
  assert.equal(S().studies.find((x) => x.id === s.id)!.design.decisions.at(-1)!.status, "stale");
});

test("evidence revision v2 covers grade and kind; v1-stamped decisions are compared with v1", () => {
  const { study, id } = studyWithRecord(ABSTRACT);
  const v1 = evidenceRevisionFor(study, 1);
  const v2 = evidenceRevision(study);
  assert.match(v1, /^ev1-/);
  assert.match(v2, /^ev2-/);
  const legacy = { ...applyDecision({ kind: "defer", statement: "Wait.", claimIds: [], criteria: [], gates: [], alternatives: [] }, study).decision!, inputRevision: v1, status: "accepted" as const, selectionStatus: "accepted" as const };
  assert.equal(evaluateDecision(legacy, study).status, "accepted");
  const regraded = { ...study, scan: { ...study.scan, items: study.scan.items.map((i) => (i.id === id ? { ...i, grade: "low" as const } : i)) } };
  assert.notEqual(evidenceRevision(regraded), v2);
});

test("appraisal claims merge by record scope; superseded claims are kept; colliding ids are renamed", () => {
  const existing: Claim[] = [
    { id: "c1", text: "about A", kind: "source-derived", sourceIds: ["ev-a"], uncertainty: "moderate", origin: "model" },
    { id: "c2", text: "about B", kind: "source-derived", sourceIds: ["ev-b"], uncertainty: "moderate", origin: "model" },
    { id: "inv", text: "investigator note on A", kind: "assumption", sourceIds: ["ev-a"], uncertainty: "high", origin: "investigator" },
  ];
  const incoming: Claim[] = [{ id: "c2", text: "new about A", kind: "source-derived", sourceIds: ["ev-a"], uncertainty: "moderate", origin: "model" }];
  const m = mergeAppraisedClaims(existing, incoming, new Set(["ev-a"]));
  assert.deepEqual(m.superseded.map((c) => c.id), ["c1"]);
  assert.deepEqual(m.claims.map((c) => c.id), ["c2", "inv", "c2-2"]);
  assert.deepEqual(m.renamed, { c2: "c2-2" });
});

test("appraisal context shows each record whole and batches sets too large for one call", () => {
  const long = `${"Synthetic sentence with numbers 12 and 34. ".repeat(48)}END_OF_ABSTRACT`;
  assert.ok(long.length > 2000);
  const { study } = studyWithRecord(long);
  const ctx = compactStudy(study, "scan");
  assert.ok(ctx.includes("END_OF_ABSTRACT"));
  assert.equal(/clipped \d+ chars\]/.test(ctx.split("EVIDENCE")[1] ?? ""), false);
  assert.match(ctx, /LOCAL FACTS entered by the investigator: none/);

  const many = createStudy({ family: "rct", setting: "s", rawNeed: "n" });
  const recs = Array.from({ length: 30 }, (_, i) => ({ title: `Synthetic record ${i}`, authors: "", year: 2020, venue: "J", doi: `10.5555/b.${i}`, abstract: long }));
  const { items, documents } = ingestRecords(recs, { id: "ret-b", provider: "fixture" });
  many.scan.items = items;
  many.documents = documents;
  many.scan.retrievalEvents = [{ id: "ret-b", at: "", provider: "fixture", query: "q", resultCount: 30, recordIds: items.map((i) => i.id), status: "ok", performedBy: "app" }];
  const batches = scanAppraisalBatches(many);
  assert.ok(batches.length > 1);
  assert.equal(batches.flat().length, 30);
  for (const [i, b] of batches.entries()) {
    const c = compactStudy(many, "scan", { recordIds: b, batch: { index: i + 1, of: batches.length } });
    assert.ok(c.length <= 32_000, `batch ${i + 1} is ${c.length} chars`);
    assert.match(c, new RegExp(`APPRAISAL BATCH ${i + 1} of ${batches.length}`));
  }
});

test("model runs are recorded append-only and do not change the study revision", () => {
  const s = S().create({ family: null, setting: "s", rawNeed: "n" });
  const before = studyRevision(S().studies.find((x) => x.id === s.id)!);
  S().recordModelRun(s.id, { id: "run-1", at: "t", stage: "problem", provider: "xai", model: "grok-4.5", mode: "live", promptSha256: "p", contextSha256: "c", contextChars: 10, outputSha256: "o", elapsedMs: 5, outcome: "applied", issues: 0, requestRevision: before });
  S().recordEvidenceRun(s.id, { id: "erun-1", at: "t", kind: "search", provider: "pubmed", query: "q", requests: ["u"], status: "ok", records: 3, elapsedMs: 9 });
  const after = S().studies.find((x) => x.id === s.id)!;
  assert.equal(after.modelRuns?.length, 1);
  assert.equal(after.evidenceRuns?.length, 1);
  assert.equal(studyRevision(after), before);
});

test("study status names the next useful step from the stored study", () => {
  const study = createStudy({ family: null, setting: "s", rawNeed: "n" });
  assert.equal(studyStatus(study).next.stage, "problem");
  study.problem.statement = "structured";
  assert.match(studyStatus(study).next.text, /Write a search query/);
  study.scan.query = "ketamine";
  assert.match(studyStatus(study).next.text, /Search the literature/);
  const { study: withRecord } = studyWithRecord(ABSTRACT);
  withRecord.problem.statement = "structured";
  assert.match(studyStatus(withRecord).next.text, /Check the identity of 1 records/);
  assert.equal(studyStatus(withRecord).evidence.uncheckedDois, 1);
});

test("investigator anchors: identifiers must appear, a verbatim phrase or figure can anchor", () => {
  const inv = "Constraints: the regional sepsis network can release one research nurse two days a week from February to May 2027.";
  assert.equal(groundedInInvestigatorText("Investigator's constraints: one research nurse two days a week to May 2027", inv).grounded, true);
  assert.equal(groundedInInvestigatorText("REB-2026-188 approved", inv).grounded, false);
  assert.equal(groundedInInvestigatorText("Approved.", inv).grounded, false);
});

test("fractions in words are approximate figures, not numbers the source must contain", () => {
  // Found in the bank run (sc-030): "about three quarters" for a reported 76 percent was blocked as a
  // fabricated number "3". A word fraction is listed for the reader instead; digits still must occur.
  const { study, id } = studyWithRecord("RESULTS: The database captured 76 percent of events meeting its own definition.");
  const base: Claim = { id: "c4", text: "The database captured about three quarters of qualifying events.", kind: "source-derived", sourceIds: [id], passage: "The database captured 76 percent of events meeting its own definition", uncertainty: "moderate", origin: "model" };
  const r = claimSupport(base, study);
  assert.equal(r.blocking, false);
  assert.equal(r.status, "supported");
  assert.deepEqual(r.approximateFigures, ["three quarters"]);
  assert.match(r.message, /approximate figure/);
  assert.deepEqual(approximateFigures("One in five patients, half the wards, 1 in 3 nurses, two-thirds of sites"), ["one in five", "half", "1 in 3", "two-thirds"]);
  // A digit the source lacks is still refused, with or without a word fraction beside it.
  const wrong = claimSupport({ ...base, text: "The database captured about three quarters (81 percent) of events." }, study);
  assert.equal(wrong.status, "numbers-not-in-source");
  assert.deepEqual(wrong.missingNumbers, ["81"]);
});

test("investigator text that says something is not in place cannot ground a gate as met", () => {
  const inv = [
    "The research ethics board application 26-311 was submitted on 2026-09-01; the decision is pending.",
    "Use of the out-of-hours activity data requires the data governance lead's approval, which has not been requested.",
    "The hospital privacy office approved secondary use of the ERAS database on 2026-06-30 (approval PO-2026-117).",
  ].join("\n");
  assert.deepEqual(investigatorSentences(inv).map((x) => x.notInPlace), [true, true, false]);
  const reb = groundedInInvestigatorText("REB approval 26-311, supplied by the investigator", inv);
  assert.equal(reb.grounded, false);
  assert.match(reb.reason, /not in place/);
  const phrase = groundedInInvestigatorText("Data governance: requires the data governance lead's approval (investigator)", inv);
  assert.equal(phrase.grounded, false);
  assert.equal(groundedInInvestigatorText("Privacy office approval PO-2026-117 dated 2026-06-30", inv).grounded, true);
});

test("live search refuses sentence queries and shapes Boolean queries per source (first live run)", async () => {
  // The three sentence queries of the first live run (2026-09-22) gave 0, 0 and 358,453 PubMed hits.
  const sentence = "PCA pump programming-error timing vs detection timing around nursing shift handover; handover/handoff safety bundles; QI measurement design under no added funding or staff.";
  assert.match(queryProblem(sentence) ?? "", /reads like a sentence/);
  assert.match(queryProblem("IV ketamine infusion for adult refractory neuropathic pain with analgesic and functional efficacy in one pain clinic") ?? "", /sentence/);
  assert.equal(queryProblem('(ketamine OR esketamine) AND ("neuropathic pain" OR neuralgia) AND (infusion)'), null);
  assert.equal(queryProblem("ketamine neuropathic pain infusion"), null);
  const r = await searchLive("pubmed", sentence, blockedTransport("must not be called"), { sleep: noSleep });
  assert.equal(r.event.status, "error");
  assert.match(r.event.note ?? "", /^not searched: /);
  assert.deepEqual(r.requests, []);
  assert.equal(providerQuery("openalex", "(ketamine[tiab] OR esketamine*) AND neuralgia[mh]"), "(ketamine OR esketamine) AND neuralgia");
  assert.equal(providerQuery("pubmed", "ketamine[tiab]"), "ketamine[tiab]");
  assert.match(schemaFor("scan", "discovery"), /database search string, not a sentence/);
  assert.equal(schemaFor("scan", "discovery").includes("sourcesConsulted"), false);
});

test("a rate-limited registry call is retried once; a second failure stays visible", async () => {
  let calls = 0;
  const flaky = async () => (++calls === 1 ? { status: 429, body: "" } : { status: 200, body: JSON.stringify({ status: "ok", message: { "total-results": 0, items: [] } }) });
  const ok = await lookupDoisLive(["10.5555/r.1"], flaky, { sleep: noSleep });
  assert.equal(calls, 2);
  assert.equal(ok.chunks[0].outcome.status, "ok");
  let calls2 = 0;
  const down = async () => { calls2++; return { status: 503, body: "" }; };
  const bad = await lookupDoisLive(["10.5555/r.1"], down, { sleep: noSleep });
  assert.equal(calls2, 2);
  assert.equal(bad.chunks[0].outcome.status, "error");
  assert.match(bad.chunks[0].outcome.note ?? "", /503.*retry/);
});

test("a failed cross-check does not demote a record a registry already identified", () => {
  // First live run: one failed Crossref chunk turned 20 PubMed records into "check-failed", which then
  // fell out of appraisal batching and pushed the appraisal context past its limit.
  const { items } = ingestRecords(
    [
      { title: "PubMed record", authors: "A", year: 2021, venue: "J", doi: "10.5555/pm.1", pmid: "90000001", abstract: "Text." },
      { title: "Connector record", authors: "B", year: 2021, venue: "J", doi: "10.5555/cx.1" },
    ],
    { id: "ret-x", provider: "pubmed" },
  );
  const r = applyLookupOutcome(items, ["10.5555/pm.1", "10.5555/cx.1"], "crossref", { status: "error", records: [], note: "HTTP 500" });
  const pm = r.items.find((i) => i.doi === "10.5555/pm.1")!;
  const cx = r.items.find((i) => i.doi === "10.5555/cx.1")!;
  assert.equal(pm.provenance.identifiers.pmid, "90000001");
  assert.equal(pm.provenance.status, "retrieved");
  assert.equal(pm.provenance.checks.at(-1)?.result, "error");
  assert.equal(cx.provenance.status, "check-failed");
});

test("records with stored text are appraised in batches whatever their check status", () => {
  const study = createStudy({ family: "qi-pdsa", setting: "s", rawNeed: "n" });
  const recs = Array.from({ length: 20 }, (_, i) => ({ title: `Record ${i}`, authors: "A", year: 2020, venue: "J", doi: `10.5555/b.${i}`, abstract: `Abstract ${i}. ${"Long methods and results text. ".repeat(90)}` }));
  const { items, documents } = ingestRecords(recs, { id: "ret-b", provider: "fixture" });
  study.scan.items = items.map((i) => ({ ...i, provenance: { ...i.provenance, status: "check-failed" as const } }));
  study.documents = documents;
  const batches = scanAppraisalBatches(study);
  assert.ok(batches.length > 1);
  assert.equal(batches.flat().length, 20);
  for (const b of batches) assert.ok(compactStudy(study, "scan", { recordIds: b, batch: { index: 1, of: batches.length } }).length <= 32000);
});
