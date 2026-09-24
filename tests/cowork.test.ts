import { test } from "node:test";
import assert from "node:assert/strict";
import { pubmedArticlesToRecords, trialToRecord, connectorFailure, pubmedConnectorQuery } from "../src/cowork/records";
import { lookupDoisConnector, searchConnector, LIVE_SOURCES, IDENTITY_PROVIDER } from "../src/cowork/evidence-server";
import { coworkPrompt, runMeridian, sampleFailure, MAX_PROMPT_BYTES, COWORK_PROVIDER } from "../src/cowork/ai";
import { resetCapabilities, payloadOf, type Mcp } from "../src/cowork/runtime";
import { doisToCheck } from "../src/lib/evidence/requests";
import { applyLookupOutcome } from "../src/lib/evidence/verify";
import { buildUserMessage, promptFingerprintText, SYSTEM, MAX_COMPACT_CHARS } from "../src/lib/prompt";
import * as serverAi from "../src/lib/ai";
import { sha256Hex } from "../src/lib/evidence/hash";
import type { EvidenceItem } from "../src/lib/types";

/*
 * Meridian on Cowork: the model call through the artifact's sample capability and literature search
 * through the viewer's PubMed and Clinical Trials connectors. Connector payloads below have the shape
 * of real replies observed on 24 September 2026; every value is invented (no publisher text).
 */

type Call = { server: string; tool: string; input: unknown };

function fakeMcp(handlers: Record<string, (input: Record<string, unknown>) => unknown>, calls: Call[] = []): Mcp {
  return {
    async callTool(server, tool, input) {
      calls.push({ server, tool, input });
      const h = handlers[`${server}/${tool}`];
      if (!h) throw { code: "not_in_manifest", message: `${server}/${tool} not declared` };
      const out = h((input ?? {}) as Record<string, unknown>);
      if (out instanceof Error) throw out;
      if (out && typeof out === "object" && "code" in (out as object) && "message" in (out as object)) throw out;
      return { content: [{ type: "text", text: JSON.stringify(out) }], payload: out };
    },
  };
}

const ARTICLE = (pmid: string, doi: string, title: string, extra: Record<string, unknown> = {}) => ({
  identifiers: { pmid, doi },
  title: `${title}.`,
  abstract: `Background: invented abstract for ${pmid}. Results: 12 of 40 patients improved.`,
  doi,
  journal: { title: "Journal of Invented Anesthesia", iso_abbreviation: "J Invent Anesth" },
  authors: [
    { last_name: "Rossi", fore_name: "Anna", initials: "A" },
    { last_name: "Chen", fore_name: "Li Wei", initials: "LW" },
  ],
  publication_date: { year: "2024", month: "03", day: "01" },
  article_types: ["Journal Article", "Randomized Controlled Trial"],
  ...extra,
});

test("PubMed connector articles become the same RawRecords the server parser makes", () => {
  const [r] = pubmedArticlesToRecords([ARTICLE("90000001", "10.9999/ABC.001", "Ketamine for invented pain")]);
  assert.equal(r.title, "Ketamine for invented pain");
  assert.equal(r.authors, "Rossi A, Chen LW");
  assert.equal(r.year, 2024);
  assert.equal(r.venue, "Journal of Invented Anesthesia");
  assert.equal(r.doi, "10.9999/abc.001");
  assert.equal(r.pmid, "90000001");
  assert.equal(r.providerType, "Journal Article; Randomized Controlled Trial");
  assert.match(r.abstract ?? "", /12 of 40 patients/);
  assert.equal(r.publicationStatus, "unknown");
  const [x] = pubmedArticlesToRecords([ARTICLE("90000002", "10.9999/x", "Withdrawn work", { article_types: ["Retracted Publication"] })]);
  assert.equal(x.publicationStatus, "retracted");
  assert.deepEqual(pubmedArticlesToRecords([{ identifiers: { pmid: "1" }, title: "  " }]), [], "a record without a title is dropped");
});

test("a Clinical Trials registration keeps the server build's stored-text layout", () => {
  const r = trialToRecord({
    nct_id: "nct09999999",
    title: "An Invented Trial of Ketamine",
    status: "RECRUITING",
    phase: ["PHASE4"],
    study_type: "INTERVENTIONAL",
    enrollment: 30,
    start_date: "2024-10-02",
    primary_completion_date: "2025-04",
    brief_summary: "Invented registry summary.",
    has_results: false,
    sponsor: "Invented Hospital",
  })!;
  assert.equal(r.nct, "NCT09999999");
  assert.equal(r.kind, "trial-registry");
  assert.equal(r.year, 2024);
  assert.equal(
    r.abstract,
    "Registry: ClinicalTrials.gov NCT09999999. Status: RECRUITING. Type: INTERVENTIONAL (PHASE4). Enrollment: 30. Start: 2024-10-02. Primary completion: 2025-04. Results posted: no\nInvented registry summary.",
  );
  assert.equal(trialToRecord({ nct_id: "NCT1", title: "" }), null);
  assert.equal(trialToRecord({ title: "x" }), null);
});

test("PubMed search through the connector: records, event and the calls made", async () => {
  const calls: Call[] = [];
  const mcp = fakeMcp(
    {
      "PubMed/search_articles": () => ({ pmids: ["90000001", "90000002"], total_count: 49, query_translation: "ketamine[All Fields]" }),
      "PubMed/get_article_metadata": (i) => ({ articles: (i.pmids as string[]).map((p) => ARTICLE(p, `10.9999/${p}`, `Invented study ${p}`)) }),
    },
    calls,
  );
  const r = await searchConnector("pubmed", "(ketamine) AND (\"neuropathic pain\")", 20, mcp);
  assert.equal(r.items.length, 2);
  assert.equal(r.event.status, "partial", "49 hits, 2 ingested");
  assert.equal(r.event.resultCount, 49);
  assert.equal(r.event.performedBy, "app");
  assert.match(r.event.note ?? "", /through the PubMed connector/);
  assert.equal(r.items[0].provenance.origin, "retrieval");
  assert.equal(r.items[0].provenance.identifiers.pmid, "90000001");
  assert.ok(r.documents.length >= 2, "abstracts are stored as documents");
  assert.deepEqual(calls.map((c) => c.tool), ["search_articles", "get_article_metadata"]);
  assert.equal((calls[0].input as { query: string }).query, "(ketamine) AND (\"neuropathic pain\")");
  assert.equal(r.requests.length, 2);
});

test("a refused or missing connector is a visible blocked event with the fix, never an empty success", async () => {
  const mcp = fakeMcp({ "PubMed/search_articles": () => ({ code: "server_not_connected", message: "no PubMed" }) });
  const r = await searchConnector("pubmed", "(ketamine) AND (pain)", 20, mcp);
  assert.equal(r.event.status, "blocked");
  assert.match(r.event.note ?? "", /add the PubMed connector/);
  const none = await searchConnector("pubmed", "(ketamine) AND (pain)", 20, null);
  assert.equal(none.event.status, "blocked");
  const oa = await searchConnector("openalex", "(ketamine) AND (pain)", 20, mcp);
  assert.equal(oa.event.status, "blocked");
  assert.match(oa.event.note ?? "", /OpenAlex has no connector/);
  const sentence = await searchConnector("pubmed", "Does ketamine help people with nerve pain after surgery in adults?", 20, mcp);
  assert.equal(sentence.event.status, "error");
  assert.match(sentence.event.note ?? "", /not searched/);
  assert.deepEqual([...LIVE_SOURCES], ["pubmed", "clinicaltrials"]);
  assert.equal(connectorFailure("PubMed", { code: "tool_error", message: "boom" }).status, "error");
  assert.equal(pubmedConnectorQuery("ketamin* AND  pain"), "ketamin AND pain");
});

test("Clinical Trials search reads each registration in full; a failed detail read is partial and says so", async () => {
  const mcp = fakeMcp({
    "Clinical Trials/search_trials": () => ({
      total: 51,
      items: [
        { nct_id: "NCT09000001", title: "Invented trial one", status: "COMPLETED", study_type: "INTERVENTIONAL", start_date: "2020-01" },
        { nct_id: "NCT09000002", title: "Invented trial two", status: "RECRUITING", study_type: "OBSERVATIONAL", start_date: "2023-05" },
      ],
    }),
    "Clinical Trials/get_trial_details": (i) =>
      i.nct_id === "NCT09000001"
        ? { found: true, trial: { nct_id: "NCT09000001", title: "Invented trial one (official title)", brief_summary: "Invented summary one.", has_results: true } }
        : { code: "server_unavailable", message: "timeout" },
  });
  const r = await searchConnector("clinicaltrials", "(ketamine) AND (\"neuropathic pain\")", 20, mcp);
  assert.equal(r.items.length, 2);
  assert.equal(r.event.status, "partial");
  assert.match(r.event.note ?? "", /1 of 2 records carry a registry summary/);
  assert.match(r.event.note ?? "", /1 registrations could not be read in full/);
  const one = r.items.find((i) => i.provenance.identifiers.nct === "NCT09000001")!;
  assert.equal(one.title, "Invented trial one (official title)");
  assert.match(one.abstract?.text ?? "", /Results posted: yes\nInvented summary one\./);
});

test("identity checks go to PubMed; a DOI PubMed does not index is not found, which changes no status", async () => {
  const mcp = fakeMcp({
    "PubMed/convert_article_ids": (i) => ({
      records: (i.ids as string[]).map((d) => (d === "10.9999/known" ? { pmid: "90000003", doi: d, "requested-id": d } : { "requested-id": d, errmsg: "invalid article id" })),
    }),
    "PubMed/get_article_metadata": () => ({ articles: [ARTICLE("90000003", "10.9999/known", "A known invented paper")] }),
  });
  const out = await lookupDoisConnector(["10.9999/KNOWN", "10.9999/unknown", "10.9999/known"], mcp);
  assert.equal(out.provider, "pubmed");
  assert.equal(out.chunks.length, 1);
  assert.deepEqual(out.chunks[0].requested, ["10.9999/known", "10.9999/unknown"]);
  assert.equal(out.chunks[0].outcome.status, "ok");
  const lead = (doi: string, title: string): EvidenceItem =>
    ({
      id: `ev-${doi}`,
      title,
      authors: "Rossi A",
      year: 2024,
      source: "Journal of Invented Anesthesia",
      kind: "rct",
      doi,
      provenance: { origin: "model", retrievalEventIds: [], identifiers: { doi }, access: "none", status: "unverified", checks: [] },
    }) as unknown as EvidenceItem;
  const applied = applyLookupOutcome([lead("10.9999/known", "A known invented paper"), lead("10.9999/unknown", "Not in PubMed")], out.chunks[0].requested, out.provider, out.chunks[0].outcome);
  assert.equal(applied.items[0].provenance.status, "verified");
  assert.equal(applied.items[1].provenance.status, "unverified", "not found in PubMed is not proof the work does not exist");
  const failed = await lookupDoisConnector(["10.9999/a"], fakeMcp({ "PubMed/convert_article_ids": () => ({ code: "needs_reauth", message: "expired" }) }));
  assert.equal(failed.chunks[0].outcome.status, "blocked");
  assert.match(failed.chunks[0].outcome.note ?? "", /reconnect PubMed/);
  assert.equal(IDENTITY_PROVIDER, "pubmed");
});

test("a registry does not confirm its own records: PubMed-retrieved DOIs are not sent to a PubMed check", () => {
  const items = [
    { doi: "10.1/a", provenance: { origin: "retrieval", status: "retrieved", identifiers: { doi: "10.1/a", pmid: "1" } } },
    { doi: "10.1/b", provenance: { origin: "model", status: "unverified", identifiers: { doi: "10.1/b" } } },
    { doi: "10.1/c", provenance: { origin: "retrieval", status: "retrieved", identifiers: { doi: "10.1/c", openalex: "W1" } } },
    { doi: "10.1/d", provenance: { origin: "model", status: "verified", identifiers: { doi: "10.1/d" } } },
  ];
  assert.deepEqual(doisToCheck(items, "pubmed"), ["10.1/b", "10.1/c"]);
  assert.deepEqual(doisToCheck(items, "crossref"), ["10.1/a", "10.1/b", "10.1/c"], "the server build's Crossref check keeps every unverified DOI");
});

test("the Cowork prompt is the server prompt: same system text, same user message, same fingerprint", () => {
  const data = { stage: "design" as const, family: null, compact: "STUDY CONTEXT LINE", instruction: "keep it small" };
  const p = coworkPrompt(data);
  assert.ok(p.startsWith(SYSTEM));
  assert.ok(p.endsWith(buildUserMessage(data)));
  assert.equal(serverAi.promptFingerprintText("design"), promptFingerprintText("design"));
  const big = coworkPrompt({ stage: "scan", family: null, compact: "x".repeat(MAX_COMPACT_CHARS), scanPurpose: "appraisal" });
  assert.ok(new TextEncoder().encode(big).length < MAX_PROMPT_BYTES, "the largest context Meridian sends fits one sample call");
});

function withClaude(sample: unknown): void {
  resetCapabilities();
  (globalThis as { claude?: unknown }).claude = { use: async (name: string) => (name === "sample" ? sample : null) };
}

test("runMeridian asks Claude on the most capable tier and records the run", async () => {
  let seen: { input: string; options: { modelTier?: string; cache?: boolean } } | null = null;
  withClaude(async (input: string, options: { modelTier?: string; cache?: boolean }) => {
    seen = { input, options };
    return { text: "Here it is:\n```json\n{\"summary\": \"ok\", \"title\": \"T\"}\n```", truncated: false, modelTierApplied: "complex" };
  });
  const res = await runMeridian({ data: { stage: "problem", family: null, compact: "CTX" } });
  assert.equal(res.ok, true);
  assert.deepEqual(JSON.parse((res as { json: string }).json), { summary: "ok", title: "T" });
  assert.equal(seen!.options.modelTier, "complex");
  assert.equal(seen!.options.cache, false);
  assert.ok(seen!.input.includes("STUDY CONTEXT:\nCTX"));
  const run = (res as { run: { provider: string; model: string; promptSha256: string; outputSha256: string } }).run;
  assert.equal(run.provider, COWORK_PROVIDER);
  assert.equal(run.model, "claude, complex tier");
  assert.equal(run.promptSha256, sha256Hex(promptFingerprintText("problem")));
  assert.equal(run.outputSha256, sha256Hex("Here it is:\n```json\n{\"summary\": \"ok\", \"title\": \"T\"}\n```"));
});

test("runMeridian fails visibly: cut-short answers, refusals, limits and a page outside Claude apply nothing", async () => {
  withClaude(async () => ({ text: "{\"summary\": \"half", truncated: true, modelTierApplied: "default" }));
  const cut = await runMeridian({ data: { stage: "gaps", family: null, compact: "CTX" } });
  assert.equal(cut.ok, false);
  assert.match((cut as { error: string }).error, /cut short/);
  withClaude(async () => {
    throw { code: "rate_limited", message: "limit" };
  });
  const limited = await runMeridian({ data: { stage: "gaps", family: null, compact: "CTX" } });
  assert.match((limited as { error: string }).error, /usage limit or rate limit/);
  withClaude(async () => ({ text: "I cannot produce JSON for this.", truncated: false, modelTierApplied: "complex" }));
  const prose = await runMeridian({ data: { stage: "gaps", family: null, compact: "CTX" } });
  assert.equal(prose.ok, false);
  assert.match((prose as { error: string }).error, /did not return JSON/);
  resetCapabilities();
  delete (globalThis as { claude?: unknown }).claude;
  const outside = await runMeridian({ data: { stage: "gaps", family: null, compact: "CTX" } });
  assert.match((outside as { error: string }).error, /Open Meridian from your Claude account/);
  const invalid = await runMeridian({ data: { stage: "nope", family: null, compact: "CTX" } });
  assert.match((invalid as { error: string }).error, /Unknown stage/);
  assert.match(sampleFailure({ code: "not_granted", message: "" }), /choose Allow/);
  assert.equal(payloadOf({ content: [{ type: "text", text: "{\"a\":1}" }] }) && (payloadOf({ content: [{ type: "text", text: "{\"a\":1}" }] }) as { a: number }).a, 1);
});
