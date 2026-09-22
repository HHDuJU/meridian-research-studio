import type { TransportRequest } from "../transport";
import type { RawRecord } from "../records";
import { normalizeDoi } from "../identifiers";

/**
 * OpenAlex — open scholarly index (works, DOIs, PMIDs, venues). Public, no key; polite pool via
 * mailto. Terms: https://docs.openalex.org/ (CC0 metadata). Used for discovery and DOI↔PMID
 * mapping. Live calls are not exercised in the Cowork sandbox.
 */
export const OPENALEX = {
  id: "openalex" as const,
  base: "https://api.openalex.org",
  select: "id,doi,title,publication_year,type,ids,primary_location,authorships,cited_by_count",
  /** Lookups keep the URL short (proxy limits) and need only identity fields. */
  lookupSelect: "id,doi,title,publication_year,type,ids,primary_location",
};

export function openalexSearchRequest(query: string, perPage = 10, mailto?: string): TransportRequest {
  const params = new URLSearchParams({ search: query, "per-page": String(perPage), select: OPENALEX.select });
  if (mailto) params.set("mailto", mailto);
  return { url: `${OPENALEX.base}/works?${params.toString()}`, headers: { Accept: "application/json" } };
}

export function openalexLookupRequest(dois: string[], mailto?: string): TransportRequest {
  // Bare DOIs keep the URL short (OpenAlex accepts them without the resolver prefix).
  const filter = dois
    .map((d) => normalizeDoi(d))
    .filter((d): d is string => !!d)
    .join("|");
  const params = new URLSearchParams({ filter: `doi:${filter}`, "per-page": String(Math.max(dois.length, 1)), select: OPENALEX.lookupSelect });
  if (mailto) params.set("mailto", mailto);
  return { url: `${OPENALEX.base}/works?${params.toString()}`, headers: { Accept: "application/json" } };
}

interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  publication_year?: number | null;
  type?: string;
  ids?: { openalex?: string; doi?: string; pmid?: string };
  primary_location?: { source?: { display_name?: string } | null } | null;
  authorships?: { author?: { display_name?: string } }[];
}

export function parseOpenAlexWorks(body: string): { total: number | null; records: RawRecord[] } {
  const json = JSON.parse(body) as { meta?: { count?: number }; results?: OpenAlexWork[] };
  if (!Array.isArray(json.results)) throw new Error("OpenAlex: unexpected response shape");
  return {
    total: typeof json.meta?.count === "number" ? json.meta.count : null,
    records: json.results.flatMap((w) => {
      const title = w.title?.trim();
      if (!title) return [];
      const pmid = w.ids?.pmid?.match(/(\d+)\s*$/)?.[1];
      return [
        {
          title,
          authors: (w.authorships ?? []).map((a) => a.author?.display_name ?? "").filter(Boolean).join(", "),
          year: typeof w.publication_year === "number" ? w.publication_year : null,
          venue: w.primary_location?.source?.display_name ?? "",
          doi: normalizeDoi(w.doi ?? w.ids?.doi ?? undefined),
          pmid,
          openalex: w.id ?? w.ids?.openalex,
          providerType: w.type,
        },
      ];
    }),
  };
}
