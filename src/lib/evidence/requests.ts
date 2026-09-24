import { LIVE_PROVIDERS, type LiveProvider } from "./live";

/*
 * Request limits and validation for literature search and identity checks. Pure, so the server
 * build and the Cowork edition refuse the same malformed requests with the same words.
 */

export const MAX_QUERY_CHARS = 500;
export const MAX_RECORDS = 50;
export const MAX_DOIS = 100;

export interface SearchLiteratureInput {
  provider: LiveProvider;
  query: string;
  max?: number;
}

export function validateSearchInput(input: unknown): SearchLiteratureInput {
  if (!input || typeof input !== "object") throw new Error("Search request must be an object.");
  const r = input as Record<string, unknown>;
  if (typeof r.provider !== "string" || !(LIVE_PROVIDERS as readonly string[]).includes(r.provider)) {
    throw new Error(`Unknown literature source "${String(r.provider)}".`);
  }
  if (typeof r.query !== "string" || !r.query.trim()) throw new Error("Search query is empty.");
  if (r.query.length > MAX_QUERY_CHARS) throw new Error(`Search query exceeds ${MAX_QUERY_CHARS} characters.`);
  let max: number | undefined;
  if (r.max !== undefined) {
    if (typeof r.max !== "number" || !Number.isInteger(r.max) || r.max < 1 || r.max > MAX_RECORDS) {
      throw new Error(`max must be an integer from 1 to ${MAX_RECORDS}.`);
    }
    max = r.max;
  }
  return { provider: r.provider as LiveProvider, query: r.query.trim(), max };
}

export function validateDoiInput(input: unknown): { dois: string[] } {
  if (!input || typeof input !== "object") throw new Error("Identity check request must be an object.");
  const r = input as Record<string, unknown>;
  if (!Array.isArray(r.dois) || !r.dois.every((d) => typeof d === "string")) throw new Error("dois must be a list of strings.");
  if (r.dois.length === 0) throw new Error("No DOIs to check.");
  if (r.dois.length > MAX_DOIS) throw new Error(`At most ${MAX_DOIS} DOIs per request.`);
  return { dois: r.dois as string[] };
}

type CheckableItem = {
  doi?: string;
  provenance?: { origin?: string; status?: string; identifiers?: { doi?: string; pmid?: string; openalex?: string; nct?: string } };
};

const OWN_IDENTIFIER: Record<string, "pmid" | "openalex" | "nct" | undefined> = { pubmed: "pmid", openalex: "openalex", clinicaltrials: "nct" };

/**
 * DOIs to send for an identity check: records not yet verified or in mismatch. A registry does not
 * confirm its own records, so when PubMed answers the check, a record retrieved from PubMed is left
 * out (its identity came from PubMed in the first place); with Crossref nothing is left out.
 */
export function doisToCheck(items: CheckableItem[], identityProvider: string): string[] {
  const own = OWN_IDENTIFIER[identityProvider];
  return [
    ...new Set(
      items
        .filter((i) => i.provenance?.status !== "verified" && i.provenance?.status !== "mismatch")
        .filter((i) => !(own && i.provenance?.origin === "retrieval" && i.provenance?.identifiers?.[own]))
        .map((i) => i.doi ?? i.provenance?.identifiers?.doi)
        .filter((d): d is string => !!d),
    ),
  ];
}
