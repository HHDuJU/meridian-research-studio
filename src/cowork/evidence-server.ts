/*
 * Meridian on Cowork: literature search and identity checks through the viewer's claude.ai
 * connectors (PubMed; Clinical Trials for ClinicalTrials.gov). The page cannot reach those hosts
 * itself, so the calls go through the `mcp` capability with the viewer's own connector access. Results
 * become RawRecords (./records) and are ingested exactly as the server build ingests them: stored
 * text, retrieval events and identity checks keep the same shapes and rules. A failed or refused call
 * becomes a visible event with the reason, never an empty success.
 */
import { validateDoiInput, validateSearchInput } from "../lib/evidence/requests";
import { providerQuery, queryProblem, type LiveProvider } from "../lib/evidence/live";
import { ingestRecords, type RawRecord } from "../lib/evidence/records";
import type { LookupOutcome } from "../lib/evidence/verify";
import { normalizeDoi } from "../lib/evidence/identifiers";
import type { EvidenceItem, RetrievalEvent, SourceDocument } from "../lib/types";
import { nowIso, uid } from "../lib/utils";
import { capability, payloadOf, PUBMED_SERVER, TRIALS_SERVER, type Mcp } from "./runtime";
import {
  connectorFailure,
  pubmedArticlesToRecords,
  pubmedConnectorQuery,
  trialToRecord,
  type PubmedConnectorArticle,
  type TrialConnectorRecord,
} from "./records";

export { MAX_DOIS, MAX_QUERY_CHARS, MAX_RECORDS, validateDoiInput, validateSearchInput, type SearchLiteratureInput } from "../lib/evidence/requests";

/** How each source is reached in Cowork and the order it returns records in (search report, PRISMA-S items 1 to 3 and 8). */
export const COWORK_SOURCE_ACCESS = {
  pubmed: { via: "PubMed connector in Claude (search_articles, get_article_metadata)", order: "relevance (PubMed Best Match)" },
  clinicaltrials: {
    via: "Clinical Trials connector in Claude (search_trials with an Essie expression, get_trial_details)",
    order: "not set: the connector has no sort option and ClinicalTrials.gov returns studies unsorted unless asked",
  },
} as const;

/** Sources with a connector in Cowork. OpenAlex has none. */
export const LIVE_SOURCES: readonly LiveProvider[] = ["pubmed", "clinicaltrials"];
/** Identity checks run against PubMed (Crossref has no connector). */
export const IDENTITY_PROVIDER = "pubmed" as const;

export interface ConnectorSearchResult {
  event: RetrievalEvent;
  items: EvidenceItem[];
  documents: SourceDocument[];
  requests: string[];
}

function failed(provider: string, query: string, status: "blocked" | "error", note: string, requests: string[] = [], extra: Partial<RetrievalEvent> = {}): ConnectorSearchResult {
  return {
    event: { id: uid("ret"), at: nowIso(), provider, query, resultCount: null, recordIds: [], status, performedBy: "app", note, ...extra },
    items: [],
    documents: [],
    requests,
  };
}

async function call(mcp: Mcp, server: string, tool: string, input: Record<string, unknown>): Promise<unknown> {
  return payloadOf(await mcp.callTool(server, tool, input, { cache: false }));
}

function describe(server: string, tool: string, input: Record<string, unknown>): string {
  return `${server} connector ${tool} ${JSON.stringify(input)}`.slice(0, 600);
}

async function searchPubmed(mcp: Mcp, query: string, max: number): Promise<ConnectorSearchResult> {
  const q = pubmedConnectorQuery(providerQuery("pubmed", query));
  const searchInput = { query: q, max_results: max, sort: "relevance" };
  const requests = [describe(PUBMED_SERVER, "search_articles", searchInput)];
  const access = { sent: q, ...COWORK_SOURCE_ACCESS.pubmed, importCap: max };
  let found: { pmids?: unknown; total_count?: unknown; query_translation?: unknown };
  try {
    found = ((await call(mcp, PUBMED_SERVER, "search_articles", searchInput)) ?? {}) as typeof found;
  } catch (err) {
    const f = connectorFailure(PUBMED_SERVER, err);
    return failed("pubmed", query, f.status, f.note, requests, access);
  }
  const pmids = Array.isArray(found.pmids) ? found.pmids.map(String).filter((p) => /^\d{1,9}$/.test(p)).slice(0, max) : [];
  const total = typeof found.total_count === "number" ? found.total_count : null;
  const translation = typeof found.query_translation === "string" ? `PubMed translation: ${found.query_translation}` : "";
  const described = { ...access, translation: typeof found.query_translation === "string" && found.query_translation ? found.query_translation : undefined };
  const eventId = uid("ret");
  const at = nowIso();
  if (!pmids.length) {
    return {
      event: { id: eventId, at, provider: "pubmed", query, resultCount: total ?? 0, recordIds: [], status: "ok", performedBy: "app", note: [translation, "through the PubMed connector"].filter(Boolean).join("; "), ...described },
      items: [],
      documents: [],
      requests,
    };
  }
  const metaInput = { pmids };
  requests.push(describe(PUBMED_SERVER, "get_article_metadata", { pmids: `${pmids.length} PMIDs` }));
  let articles: PubmedConnectorArticle[];
  try {
    const meta = ((await call(mcp, PUBMED_SERVER, "get_article_metadata", metaInput)) ?? {}) as { articles?: unknown };
    articles = Array.isArray(meta.articles) ? (meta.articles as PubmedConnectorArticle[]) : [];
  } catch (err) {
    const f = connectorFailure(PUBMED_SERVER, err);
    return {
      event: { id: eventId, at, provider: "pubmed", query, resultCount: total, recordIds: [], status: f.status, performedBy: "app", note: `search returned ${pmids.length} PMIDs but the records could not be read (${f.note}); no records created`, ...described },
      items: [],
      documents: [],
      requests,
    };
  }
  const records = pubmedArticlesToRecords(articles);
  const { items, documents } = ingestRecords(records, { id: eventId, provider: "pubmed" });
  const shortOfIds = records.length < pmids.length;
  const partial = (total !== null && total > items.length) || shortOfIds;
  const notes = [
    translation,
    total !== null && total > items.length ? `${items.length} of ${total} hits ingested (most relevant first)` : "",
    shortOfIds ? `${pmids.length - records.length} PMIDs returned no readable record` : "",
    `${items.filter((i) => i.abstract?.text).length} of ${items.length} records carry an abstract`,
    "through the PubMed connector",
  ].filter(Boolean);
  return {
    event: { id: eventId, at, provider: "pubmed", query, resultCount: total, recordIds: items.map((i) => i.id), status: partial ? "partial" : "ok", performedBy: "app", note: notes.join("; "), ...described },
    items,
    documents,
    requests,
  };
}

/** Run `fn` over `items` with at most `limit` calls in flight. */
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function searchTrials(mcp: Mcp, query: string, max: number): Promise<ConnectorSearchResult> {
  const q = providerQuery("clinicaltrials", query);
  const searchInput = { advanced_query: q, page_size: max, count_total: true };
  const requests = [describe(TRIALS_SERVER, "search_trials", searchInput)];
  const access = { sent: q, ...COWORK_SOURCE_ACCESS.clinicaltrials, importCap: max };
  let found: { total?: unknown; items?: unknown };
  try {
    found = ((await call(mcp, TRIALS_SERVER, "search_trials", searchInput)) ?? {}) as typeof found;
  } catch (err) {
    const f = connectorFailure(TRIALS_SERVER, err);
    return failed("clinicaltrials", query, f.status, f.note, requests, access);
  }
  const listed = (Array.isArray(found.items) ? (found.items as TrialConnectorRecord[]) : []).slice(0, max);
  const total = typeof found.total === "number" ? found.total : null;
  let detailFailures = 0;
  const merged = await pooled(listed, 4, async (t) => {
    if (!t?.nct_id) return t;
    try {
      const d = ((await call(mcp, TRIALS_SERVER, "get_trial_details", { nct_id: t.nct_id })) ?? {}) as { found?: unknown; trial?: unknown };
      if (d.trial && typeof d.trial === "object") return { ...t, ...(d.trial as TrialConnectorRecord) };
      detailFailures++;
      return t;
    } catch {
      detailFailures++;
      return t;
    }
  });
  if (listed.length) requests.push(describe(TRIALS_SERVER, "get_trial_details", { nct_id: `${listed.length} trials` }));
  const records = merged.map((t) => trialToRecord(t)).filter((r): r is RawRecord => !!r);
  const eventId = uid("ret");
  const { items, documents } = ingestRecords(records, { id: eventId, provider: "clinicaltrials" });
  const withSummary = merged.filter((t) => !!(t?.brief_summary ?? "").trim()).length;
  const partial = (total !== null && total > items.length) || detailFailures > 0;
  const notes = [
    total !== null && total > items.length ? `${items.length} of ${total} registrations ingested` : "",
    items.length ? `${withSummary} of ${items.length} records carry a registry summary` : "",
    detailFailures ? `${detailFailures} registrations could not be read in full; their records hold the registry facts only` : "",
    "through the Clinical Trials connector",
  ].filter(Boolean);
  return {
    event: { id: eventId, at: nowIso(), provider: "clinicaltrials", query, resultCount: total, recordIds: items.map((i) => i.id), status: partial ? "partial" : "ok", performedBy: "app", note: notes.join("; "), ...access },
    items,
    documents,
    requests,
  };
}

export async function searchConnector(provider: LiveProvider, query: string, max: number, mcpOverride?: Mcp | null): Promise<ConnectorSearchResult> {
  const problem = queryProblem(query);
  if (problem) return failed(provider, query, "error", `not searched: ${problem}`);
  if (provider === "openalex") {
    return failed("openalex", query, "blocked", "OpenAlex has no connector in Meridian on Cowork; search PubMed and ClinicalTrials.gov instead.");
  }
  const mcp = mcpOverride === undefined ? await capability("mcp") : mcpOverride;
  if (!mcp) return failed(provider, query, "blocked", "Connectors are not reachable from this page. Open Meridian from your Claude account (claude.ai or the Claude app).");
  return provider === "pubmed" ? searchPubmed(mcp, query, max) : searchTrials(mcp, query, max);
}

export async function searchLiterature({ data: input }: { data: unknown }) {
  let data: ReturnType<typeof validateSearchInput>;
  try {
    data = validateSearchInput(input);
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
  const started = Date.now();
  const result = await searchConnector(data.provider, data.query, data.max ?? 20);
  return { ok: true as const, json: JSON.stringify(result), elapsedMs: Date.now() - started };
}

/**
 * Identity check against PubMed, 20 DOIs per chunk: DOI to PMID (convert_article_ids), then the
 * PubMed record (get_article_metadata). A DOI PubMed does not index comes back "not found", which
 * leaves a record's status as it was. A failed chunk marks only its own DOIs.
 */
export async function lookupDoisConnector(dois: string[], mcpOverride?: Mcp | null): Promise<{ provider: "pubmed"; chunks: { requested: string[]; outcome: LookupOutcome }[]; requests: string[] }> {
  const requested = [...new Set(dois.map((d) => normalizeDoi(d)).filter((d): d is string => !!d))];
  const mcp = mcpOverride === undefined ? await capability("mcp") : mcpOverride;
  const chunks: { requested: string[]; outcome: LookupOutcome }[] = [];
  const requests: string[] = [];
  for (let i = 0; i < requested.length; i += 20) {
    const chunk = requested.slice(i, i + 20);
    if (!mcp) {
      chunks.push({ requested: chunk, outcome: { status: "blocked", records: [], note: "Connectors are not reachable from this page." } });
      continue;
    }
    requests.push(describe(PUBMED_SERVER, "convert_article_ids", { ids: `${chunk.length} DOIs`, id_type: "doi" }));
    try {
      const conv = ((await call(mcp, PUBMED_SERVER, "convert_article_ids", { ids: chunk, id_type: "doi" })) ?? {}) as { records?: unknown };
      const pmids = (Array.isArray(conv.records) ? (conv.records as { pmid?: unknown }[]) : [])
        .map((r) => String(r?.pmid ?? ""))
        .filter((p) => /^\d{1,9}$/.test(p));
      if (!pmids.length) {
        chunks.push({ requested: chunk, outcome: { status: "ok", records: [] } });
        continue;
      }
      requests.push(describe(PUBMED_SERVER, "get_article_metadata", { pmids: `${pmids.length} PMIDs` }));
      const meta = ((await call(mcp, PUBMED_SERVER, "get_article_metadata", { pmids })) ?? {}) as { articles?: unknown };
      const records = pubmedArticlesToRecords(Array.isArray(meta.articles) ? (meta.articles as PubmedConnectorArticle[]) : []);
      chunks.push({ requested: chunk, outcome: { status: "ok", records } });
    } catch (err) {
      const f = connectorFailure(PUBMED_SERVER, err);
      chunks.push({ requested: chunk, outcome: { status: f.status, records: [], note: f.note } });
    }
  }
  return { provider: "pubmed", chunks, requests };
}

export async function checkIdentities({ data: input }: { data: unknown }) {
  let data: ReturnType<typeof validateDoiInput>;
  try {
    data = validateDoiInput(input);
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
  const mcp = await capability("mcp");
  if (!mcp) return { ok: false as const, error: "Connectors are not reachable from this page. Open Meridian from your Claude account (claude.ai or the Claude app)." };
  return { ok: true as const, json: JSON.stringify(await lookupDoisConnector(data.dois, mcp)) };
}
