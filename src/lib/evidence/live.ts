import type { CheckProvider, EvidenceItem, RetrievalEvent, SourceDocument } from "../types";
import { uid, nowIso } from "../utils";
import type { Transport } from "./transport";
import { ingestRecords } from "./records";
import { runSearch, type SearchAdapter } from "./retrieve";
import { parsePubmedArticles, parsePubmedSearch, pubmedFetchRequest, pubmedSearchRequest } from "./providers/pubmed";
import { openalexDiscoveryRequest, parseOpenAlexWorks } from "./providers/openalex";
import { clinicalTrialsSearchRequest, parseClinicalTrials } from "./providers/clinicaltrials";
import { crossrefLookupRequest, parseCrossrefWorks } from "./providers/crossref";
import type { LookupOutcome } from "./verify";
import { normalizeDoi } from "./identifiers";

/*
 * Production evidence path. Every function takes a Transport, so the same code runs against the
 * live network (server function, fetchTransport) and against recorded responses in tests. A blocked
 * or failed call becomes a visible RetrievalEvent / LookupOutcome, never an empty success.
 */

export const LIVE_PROVIDERS = ["pubmed", "openalex", "clinicaltrials"] as const;
export type LiveProvider = (typeof LIVE_PROVIDERS)[number];

export interface LiveOptions {
  /** Max records ingested per search (the provider's total count is still recorded). */
  max?: number;
  /** Contact address for polite API pools (NCBI `email`, OpenAlex/Crossref `mailto`). */
  contact?: string;
  /** Pause between dependent requests to the same host (NCBI asks for at most 3 requests per second). */
  pauseMs?: number;
  /** Pause before the first retry after HTTP 429 or 5xx (the second waits three times as long). */
  retryPauseMs?: number;
  /** NCBI API key (MERIDIAN_NCBI_API_KEY): raises the PubMed limit from 3 to 10 requests a second. */
  ncbiApiKey?: string;
  sleep?: (ms: number) => Promise<void>;
}

export interface LiveSearchResult {
  event: RetrievalEvent;
  items: EvidenceItem[];
  documents: SourceDocument[];
  /** Exact URLs requested, for the audit trail. */
  requests: string[];
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function failedEvent(provider: string, query: string, status: "blocked" | "error", note: string, extra: Partial<RetrievalEvent> = {}): RetrievalEvent {
  return { id: uid("ret"), at: nowIso(), provider, query, resultCount: null, recordIds: [], status, performedBy: "app", note, ...extra };
}

/** How each source is reached from the server build, and the order it returns records in (search report, PRISMA-S items 1 to 3 and 8). */
export const SERVER_SOURCE_ACCESS: Record<LiveProvider, { via: string; order: string }> = {
  pubmed: { via: "NCBI E-utilities API (ESearch, EFetch)", order: "relevance (PubMed Best Match)" },
  openalex: { via: "OpenAlex API (/works, search)", order: "relevance (OpenAlex relevance score)" },
  clinicaltrials: { via: "ClinicalTrials.gov API version 2 (/studies, query.term)", order: "relevance (@relevance)" },
};

/*
 * Query checks and per-source shaping. Databases need key terms or Boolean groups; a sentence sent
 * verbatim returns nothing (PubMed and OpenAlex require every word) or noise (a stray "or" in a
 * sentence becomes a top-level OR in PubMed), and ClinicalTrials.gov rejects long punctuated text.
 * Found in the first live run on 2026-09-22: three model-written sentence queries gave 0, 0 and
 * 358,453 PubMed hits.
 */
export function queryProblem(query: string): string | null {
  const q = (query ?? "").trim();
  if (!q) return "empty query";
  if (q.length > 300) return `the query is ${q.length} characters; use at most 300 (key terms or Boolean groups)`;
  const hasOperators = /\b(?:AND|OR|NOT)\b/.test(q);
  const words = q.replace(/[()"]/g, " ").split(/\s+/).filter((w) => w && !/^(?:AND|OR|NOT)$/.test(w));
  if (/[;:]\s/.test(q) || /[.?!]$/.test(q) || (!hasOperators && words.length > 10)) {
    return "the query reads like a sentence; databases need 2 to 4 key terms or Boolean groups, e.g. (ketamine) AND (\"neuropathic pain\") AND (infusion)";
  }
  return null;
}

/** PubMed takes the query as written; OpenAlex and ClinicalTrials.gov get it without PubMed field tags or wildcards. */
export function providerQuery(provider: LiveProvider, query: string): string {
  const q = (query ?? "").trim();
  if (provider === "pubmed") return q;
  return q
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * Per-host request gate. NCBI allows 3 requests a second per address without an API key, and
 * Crossref's public pool allows one request at a time; four studies searching at once in the second
 * live run (2026-09-22) got HTTP 429 from both, even after one retry. Requests to the same host now
 * go one at a time with a minimum spacing, in this server process.
 */
const HOST_SPACING_MS: Record<string, number> = {
  "eutils.ncbi.nlm.nih.gov": 400,
  "api.crossref.org": 300,
  "api.openalex.org": 120,
  "clinicaltrials.gov": 120,
};
const hostQueues = new Map<string, Promise<unknown>>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function gated(transport: Transport, sleep: (ms: number) => Promise<void> = defaultSleep): Transport {
  return (req) => {
    const host = hostOf(req.url);
    const spacing = HOST_SPACING_MS[host];
    if (spacing === undefined) return transport(req);
    const prev = hostQueues.get(host) ?? Promise.resolve();
    const run = prev.then(async () => {
      try {
        return await transport(req);
      } finally {
        await sleep(spacing);
      }
    });
    hostQueues.set(host, run.catch(() => undefined));
    return run;
  };
}

/** Up to two retries with growing pauses for rate limits and server errors; other failures are returned as they are. */
function retrying(transport: Transport, sleep: (ms: number) => Promise<void>, pauseMs: number): Transport {
  return async (req) => {
    const statuses: number[] = [];
    let res = await transport(req);
    for (const factor of [1, 3]) {
      if (res.status !== 429 && !(res.status >= 500 && res.status <= 504)) break;
      statuses.push(res.status);
      await sleep(pauseMs * factor);
      res = await transport(req);
    }
    if (!statuses.length) return res;
    return res.status >= 200 && res.status < 300
      ? { ...res, note: `retried after HTTP ${statuses.join(", ")}` }
      : { ...res, note: `HTTP ${[...statuses, res.status].join(", then ")} after retries${res.note ? ` (${res.note})` : ""}` };
  };
}

function transportFailure(status: number): "blocked" | "error" | null {
  if (status === 0 || status === 403 || status === 407 || status === 451) return "blocked";
  if (status < 200 || status >= 300) return "error";
  return null;
}

/**
 * Request URLs are returned to the page and stored in the study's evidence runs; an API key must not
 * travel with them (review of 23 September: MERIDIAN_NCBI_API_KEY would have reached browser storage
 * and every export).
 */
export function redactRequestUrl(url: string): string {
  return url.replace(/([?&](?:api_key|apikey|key|token|access_token)=)[^&#]*/gi, "$1REDACTED");
}

/** PubMed: esearch for PMIDs, then efetch for whole records with abstracts. */
export async function searchPubmedLive(query: string, rawTransport: Transport, opts: LiveOptions = {}): Promise<LiveSearchResult> {
  const max = Math.min(Math.max(opts.max ?? 20, 1), 100);
  const sleep = opts.sleep ?? defaultSleep;
  const transport = retrying(gated(rawTransport, sleep), sleep, opts.retryPauseMs ?? 2000);
  const searchReq = pubmedSearchRequest(query, max, "meridian", opts.contact, opts.ncbiApiKey);
  const requests = [redactRequestUrl(searchReq.url)];
  const access = { sent: query, ...SERVER_SOURCE_ACCESS.pubmed, importCap: max };
  const sres = await transport(searchReq);
  const sfail = transportFailure(sres.status);
  if (sfail) return { event: failedEvent("pubmed", query, sfail, sres.note ?? `esearch HTTP ${sres.status}`, access), items: [], documents: [], requests };
  let found: ReturnType<typeof parsePubmedSearch>;
  try {
    found = parsePubmedSearch(sres.body);
  } catch (err) {
    return { event: failedEvent("pubmed", query, "error", `esearch parse failure: ${err instanceof Error ? err.message : String(err)}`, access), items: [], documents: [], requests };
  }
  const eventId = uid("ret");
  const at = nowIso();
  const described = { ...access, translation: found.queryTranslation || undefined };
  if (!found.pmids.length) {
    return {
      event: { id: eventId, at, provider: "pubmed", query, resultCount: found.total ?? 0, recordIds: [], status: "ok", performedBy: "app", note: found.queryTranslation ? `PubMed translation: ${found.queryTranslation}` : undefined, ...described },
      items: [],
      documents: [],
      requests,
    };
  }
  await sleep(opts.pauseMs ?? 400);
  const fetchReq = pubmedFetchRequest(found.pmids, "meridian", opts.contact, opts.ncbiApiKey);
  requests.push(redactRequestUrl(fetchReq.url));
  const fres = await transport(fetchReq);
  const ffail = transportFailure(fres.status);
  if (ffail) {
    return {
      event: { id: eventId, at, provider: "pubmed", query, resultCount: found.total, recordIds: [], status: ffail, performedBy: "app", note: `esearch returned ${found.pmids.length} PMIDs but efetch failed (${fres.note ?? `HTTP ${fres.status}`}); no records created`, ...described },
      items: [],
      documents: [],
      requests,
    };
  }
  let records: ReturnType<typeof parsePubmedArticles>;
  try {
    records = parsePubmedArticles(fres.body);
  } catch (err) {
    return {
      event: { id: eventId, at, provider: "pubmed", query, resultCount: found.total, recordIds: [], status: "error", performedBy: "app", note: `efetch parse failure: ${err instanceof Error ? err.message : String(err)}`, ...described },
      items: [],
      documents: [],
      requests,
    };
  }
  const { items, documents } = ingestRecords(records, { id: eventId, provider: "pubmed" });
  const shortOfIds = records.length < found.pmids.length;
  const partial = (found.total !== null && found.total > items.length) || shortOfIds;
  const notes = [
    found.queryTranslation ? `PubMed translation: ${found.queryTranslation}` : "",
    found.total !== null && found.total > items.length ? `${items.length} of ${found.total} hits ingested (most relevant first)` : "",
    shortOfIds ? `${found.pmids.length - records.length} PMIDs returned no parsable record` : "",
    `${items.filter((i) => i.abstract?.text).length} of ${items.length} records carry an abstract`,
  ].filter(Boolean);
  return {
    event: { id: eventId, at, provider: "pubmed", query, resultCount: found.total, recordIds: items.map((i) => i.id), status: partial ? "partial" : "ok", performedBy: "app", note: notes.join("; "), ...described },
    items,
    documents,
    requests,
  };
}

function adapterFor(provider: "openalex" | "clinicaltrials", opts: LiveOptions): SearchAdapter {
  const max = Math.min(Math.max(opts.max ?? 20, 1), 100);
  if (provider === "openalex") {
    return { provider, buildSearch: (q) => openalexDiscoveryRequest(q, max, opts.contact), parseSearch: parseOpenAlexWorks };
  }
  return { provider, buildSearch: (q) => clinicalTrialsSearchRequest(q, max), parseSearch: parseClinicalTrials };
}

export async function searchLive(provider: LiveProvider, query: string, transport: Transport, opts: LiveOptions = {}): Promise<LiveSearchResult> {
  const problem = queryProblem(query);
  if (problem) return { event: failedEvent(provider, query, "error", `not searched: ${problem}`), items: [], documents: [], requests: [] };
  const q = providerQuery(provider, query);
  if (provider === "pubmed") return searchPubmedLive(q, transport, opts);
  const sleep = opts.sleep ?? defaultSleep;
  const r = await runSearch(adapterFor(provider, opts), q, retrying(gated(transport, sleep), sleep, opts.retryPauseMs ?? 2000));
  const withAbstract = r.items.filter((i) => i.abstract?.text).length;
  const note = [r.event.note ?? "", r.items.length ? `${withAbstract} of ${r.items.length} records carry an abstract or registry summary` : ""].filter(Boolean).join("; ");
  const described = { sent: q, ...SERVER_SOURCE_ACCESS[provider], importCap: Math.min(Math.max(opts.max ?? 20, 1), 100) };
  return { event: { ...r.event, note: note || undefined, ...described }, items: r.items, documents: r.documents, requests: [redactRequestUrl(r.request.url)] };
}

/**
 * Crossref identity lookup for DOIs, in chunks of 20. Each chunk is returned with its own outcome, so
 * a blocked chunk marks only its own DOIs "check-failed" and never turns them into "not found".
 */
export async function lookupDoisLive(
  dois: string[],
  rawTransport: Transport,
  opts: LiveOptions = {},
): Promise<{ provider: CheckProvider; chunks: { requested: string[]; outcome: LookupOutcome }[]; requests: string[] }> {
  const requested = [...new Set(dois.map((d) => normalizeDoi(d)).filter((d): d is string => !!d))];
  const sleep = opts.sleep ?? defaultSleep;
  const transport = retrying(gated(rawTransport, sleep), sleep, opts.retryPauseMs ?? 2000);
  const requests: string[] = [];
  const chunks: { requested: string[]; outcome: LookupOutcome }[] = [];
  for (let i = 0; i < requested.length; i += 20) {
    const chunk = requested.slice(i, i + 20);
    const req = crossrefLookupRequest(chunk, opts.contact);
    requests.push(redactRequestUrl(req.url));
    const res = await transport(req);
    const fail = transportFailure(res.status);
    if (fail) {
      chunks.push({ requested: chunk, outcome: { status: fail, records: [], note: res.note ?? `HTTP ${res.status}` } });
    } else {
      try {
        chunks.push({ requested: chunk, outcome: { status: "ok", records: parseCrossrefWorks(res.body).records } });
      } catch (err) {
        chunks.push({ requested: chunk, outcome: { status: "error", records: [], note: `parse failure: ${err instanceof Error ? err.message : String(err)}` } });
      }
    }
    if (i + 20 < requested.length) await sleep(opts.pauseMs ?? 250);
  }
  return { provider: "crossref", chunks, requests };
}
