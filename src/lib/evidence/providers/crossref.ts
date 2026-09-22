import type { TransportRequest } from "../transport";
import type { RawRecord } from "../records";
import { normalizeDoi } from "../identifiers";

/**
 * Crossref REST API — DOI registry metadata. Public, no key; the "polite pool" asks for a
 * contact mailto in the query string. Terms: https://www.crossref.org/documentation/retrieve-metadata/rest-api/
 * Used here for *identity verification* (does this DOI exist and does it describe the claimed work?).
 * Live calls are not exercised in the Cowork sandbox.
 */
export const CROSSREF = {
  id: "crossref" as const,
  base: "https://api.crossref.org",
  select: "DOI,title,container-title,issued,author,type",
  /** Lookups omit `author`: identity is judged on title/year/venue and the payload stays small. */
  lookupSelect: "DOI,title,container-title,issued,type",
};

export function crossrefLookupRequest(dois: string[], mailto?: string): TransportRequest {
  const filter = dois
    .map((d) => normalizeDoi(d))
    .filter((d): d is string => !!d)
    .map((d) => `doi:${d}`)
    .join(",");
  const params = new URLSearchParams({ filter, rows: String(Math.max(dois.length, 1)), select: CROSSREF.lookupSelect });
  if (mailto) params.set("mailto", mailto);
  return { url: `${CROSSREF.base}/works?${params.toString()}`, headers: { Accept: "application/json" } };
}

export function crossrefSearchRequest(query: string, rows = 10, mailto?: string): TransportRequest {
  const params = new URLSearchParams({ query, rows: String(rows), select: CROSSREF.select });
  if (mailto) params.set("mailto", mailto);
  return { url: `${CROSSREF.base}/works?${params.toString()}`, headers: { Accept: "application/json" } };
}

interface CrossrefWork {
  DOI?: string;
  title?: string[];
  "container-title"?: string[];
  issued?: { "date-parts"?: number[][] };
  "published-print"?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
  author?: { family?: string; given?: string; name?: string }[];
  type?: string;
}

function yearOf(d?: { "date-parts"?: number[][] }): number | undefined {
  const y = d?.["date-parts"]?.[0]?.[0];
  return typeof y === "number" ? y : undefined;
}

export function parseCrossrefWorks(body: string): { total: number | null; records: RawRecord[] } {
  const json = JSON.parse(body) as { status?: string; message?: { "total-results"?: number; items?: CrossrefWork[] } };
  if (json.status !== "ok" || !json.message) throw new Error("Crossref: unexpected response shape");
  const items = json.message.items ?? [];
  return {
    total: typeof json.message["total-results"] === "number" ? json.message["total-results"] : null,
    records: items.flatMap((w) => {
      const title = w.title?.[0]?.trim();
      if (!title) return [];
      const year = yearOf(w.issued);
      const print = yearOf(w["published-print"]);
      const online = yearOf(w["published-online"]);
      const dates = print || online ? { print, online } : undefined;
      return [
        {
          title,
          authors: (w.author ?? [])
            .map((a) => a.family ?? a.name ?? "")
            .filter(Boolean)
            .join(", "),
          year: typeof year === "number" ? year : print ?? online ?? null,
          venue: w["container-title"]?.[0] ?? "",
          doi: normalizeDoi(w.DOI),
          providerType: w.type,
          ...(dates ? { dates } : {}),
        },
      ];
    }),
  };
}
