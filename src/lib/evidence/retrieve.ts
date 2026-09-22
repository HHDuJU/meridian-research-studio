import type { EvidenceItem, RetrievalEvent, SourceDocument } from "../types";
import { uid, nowIso } from "../utils";
import type { Transport, TransportRequest } from "./transport";
import { ingestRecords, type RawRecord } from "./records";

/** A discovery adapter: how to ask a provider, and how to read what it returned. */
export interface SearchAdapter {
  provider: string;
  buildSearch: (query: string) => TransportRequest;
  parseSearch: (body: string) => { total: number | null; records: RawRecord[] };
}

export interface RetrievalResult {
  event: RetrievalEvent;
  items: EvidenceItem[];
  documents: SourceDocument[];
  /** The exact request that was (or would have been) sent — kept for the audit trail. */
  request: TransportRequest;
}

/**
 * Run one real search and record it as a RetrievalEvent. Blocked/failed channels produce an event
 * with status "blocked"/"error" and no items — visible, never silently empty.
 */
export async function runSearch(adapter: SearchAdapter, query: string, transport: Transport): Promise<RetrievalResult> {
  const request = adapter.buildSearch(query);
  const at = nowIso();
  const id = uid("ret");
  const res = await transport(request);
  if (res.status === 0 || res.status === 403 || res.status === 407 || res.status === 451) {
    return {
      request,
      items: [],
      documents: [],
      event: { id, at, provider: adapter.provider, query, resultCount: null, recordIds: [], status: "blocked", performedBy: "app", note: res.note ?? `HTTP ${res.status}` },
    };
  }
  if (res.status < 200 || res.status >= 300) {
    return {
      request,
      items: [],
      documents: [],
      event: { id, at, provider: adapter.provider, query, resultCount: null, recordIds: [], status: "error", performedBy: "app", note: `HTTP ${res.status}` },
    };
  }
  try {
    const parsed = adapter.parseSearch(res.body);
    const { items, documents } = ingestRecords(parsed.records, { id, provider: adapter.provider });
    const partial = parsed.total !== null && parsed.total > items.length;
    return {
      request,
      items,
      documents,
      event: {
        id,
        at,
        provider: adapter.provider,
        query,
        resultCount: parsed.total,
        recordIds: items.map((i) => i.id),
        status: partial ? "partial" : "ok",
        performedBy: "app",
        note: partial ? `${items.length} of ${parsed.total} hits ingested` : undefined,
      },
    };
  } catch (err) {
    return {
      request,
      items: [],
      documents: [],
      event: { id, at, provider: adapter.provider, query, resultCount: null, recordIds: [], status: "error", performedBy: "app", note: `parse failure: ${err instanceof Error ? err.message : String(err)}` },
    };
  }
}

/**
 * Ingest results that were obtained outside the app (a connector during development, or a person
 * pasting an export). The event says so (`performedBy`), so a development handoff can never be
 * mistaken for a production integration.
 */
export function ingestExternalSearch(
  provider: string,
  query: string,
  parsed: { total: number | null; records: RawRecord[] },
  performedBy: "connector" | "manual",
  at: string = nowIso(),
  note?: string,
): { event: RetrievalEvent; items: EvidenceItem[]; documents: SourceDocument[] } {
  const id = uid("ret");
  const { items, documents } = ingestRecords(parsed.records, { id, provider });
  const partial = parsed.total !== null && parsed.total > items.length;
  return {
    items,
    documents,
    event: {
      id,
      at,
      provider,
      query,
      resultCount: parsed.total,
      recordIds: items.map((i) => i.id),
      status: partial ? "partial" : "ok",
      performedBy,
      note,
    },
  };
}

/** `sourcesConsulted` for the panel — derived from what was actually searched. */
export function consultedSources(events: RetrievalEvent[]): string[] {
  const seen = new Map<string, string>();
  for (const e of events) {
    const label = `${e.provider} (${e.status}${e.resultCount !== null ? `, ${e.resultCount} hits` : ""})`;
    seen.set(e.provider, label);
  }
  return [...seen.values()];
}
