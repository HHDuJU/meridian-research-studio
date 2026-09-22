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

function failedEvent(provider: string, query: string, status: "blocked" | "error", note: string): RetrievalEvent {
  return { id: uid("ret"), at: nowIso(), provider, query, resultCount: null, recordIds: [], status, performedBy: "app", note };
}

function transportFailure(status: number): "blocked" | "error" | null {
  if (status === 0 || status === 403 || status === 407 || status === 451) return "blocked";
  if (status < 200 || status >= 300) return "error";
  return null;
}

/** PubMed: esearch for PMIDs, then efetch for whole records with abstracts. */
export async function searchPubmedLive(query: string, transport: Transport, opts: LiveOptions = {}): Promise<LiveSearchResult> {
  const max = Math.min(Math.max(opts.max ?? 20, 1), 100);
  const sleep = opts.sleep ?? defaultSleep;
  const searchReq = pubmedSearchRequest(query, max, "meridian", opts.contact);
  const requests = [searchReq.url];
  const sres = await transport(searchReq);
  const sfail = transportFailure(sres.status);
  if (sfail) return { event: failedEvent("pubmed", query, sfail, sres.note ?? `esearch HTTP ${sres.status}`), items: [], documents: [], requests };
  let found: ReturnType<typeof parsePubmedSearch>;
  try {
    found = parsePubmedSearch(sres.body);
  } catch (err) {
    return { event: failedEvent("pubmed", query, "error", `esearch parse failure: ${err instanceof Error ? err.message : String(err)}`), items: [], documents: [], requests };
  }
  const eventId = uid("ret");
  const at = nowIso();
  if (!found.pmids.length) {
    return {
      event: { id: eventId, at, provider: "pubmed", query, resultCount: found.total ?? 0, recordIds: [], status: "ok", performedBy: "app", note: found.queryTranslation ? `PubMed translation: ${found.queryTranslation}` : undefined },
      items: [],
      documents: [],
      requests,
    };
  }
  await sleep(opts.pauseMs ?? 400);
  const fetchReq = pubmedFetchRequest(found.pmids, "meridian", opts.contact);
  requests.push(fetchReq.url);
  const fres = await transport(fetchReq);
  const ffail = transportFailure(fres.status);
  if (ffail) {
    return {
      event: { id: eventId, at, provider: "pubmed", query, resultCount: found.total, recordIds: [], status: ffail, performedBy: "app", note: `esearch returned ${found.pmids.length} PMIDs but efetch failed (${fres.note ?? `HTTP ${fres.status}`}); no records created` },
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
      event: { id: eventId, at, provider: "pubmed", query, resultCount: found.total, recordIds: [], status: "error", performedBy: "app", note: `efetch parse failure: ${err instanceof Error ? err.message : String(err)}` },
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
    event: { id: eventId, at, provider: "pubmed", query, resultCount: found.total, recordIds: items.map((i) => i.id), status: partial ? "partial" : "ok", performedBy: "app", note: notes.join("; ") },
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
  const q = query.trim();
  if (!q) return { event: failedEvent(provider, query, "error", "empty query; nothing searched"), items: [], documents: [], requests: [] };
  if (provider === "pubmed") return searchPubmedLive(q, transport, opts);
  const r = await runSearch(adapterFor(provider, opts), q, transport);
  const withAbstract = r.items.filter((i) => i.abstract?.text).length;
  const note = [r.event.note ?? "", r.items.length ? `${withAbstract} of ${r.items.length} records carry an abstract or registry summary` : ""].filter(Boolean).join("; ");
  return { event: { ...r.event, note: note || undefined }, items: r.items, documents: r.documents, requests: [r.request.url] };
}

/**
 * Crossref identity lookup for DOIs, in chunks of 20. Each chunk is returned with its own outcome, so
 * a blocked chunk marks only its own DOIs "check-failed" and never turns them into "not found".
 */
export async function lookupDoisLive(
  dois: string[],
  transport: Transport,
  opts: LiveOptions = {},
): Promise<{ provider: CheckProvider; chunks: { requested: string[]; outcome: LookupOutcome }[]; requests: string[] }> {
  const requested = [...new Set(dois.map((d) => normalizeDoi(d)).filter((d): d is string => !!d))];
  const sleep = opts.sleep ?? defaultSleep;
  const requests: string[] = [];
  const chunks: { requested: string[]; outcome: LookupOutcome }[] = [];
  for (let i = 0; i < requested.length; i += 20) {
    const chunk = requested.slice(i, i + 20);
    const req = crossrefLookupRequest(chunk, opts.contact);
    requests.push(req.url);
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
