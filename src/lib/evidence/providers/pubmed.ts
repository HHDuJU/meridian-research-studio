import type { TransportRequest } from "../transport";
import type { RawRecord } from "../records";
import { normalizeDoi } from "../identifiers";

/**
 * NCBI E-utilities (PubMed). Public; NCBI asks for `tool` and `email` parameters and ≤3 requests/s
 * without an API key. Terms: https://www.ncbi.nlm.nih.gov/books/NBK25497/ . Two-step search:
 * esearch → PMIDs, esummary → metadata. Live calls are not exercised in the Cowork sandbox
 * (the host is blocked there); parsers are tested on the documented JSON shapes.
 */
export const PUBMED = {
  id: "pubmed" as const,
  base: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils",
};

export function pubmedSearchRequest(term: string, retmax = 20, tool = "meridian", email?: string): TransportRequest {
  const params = new URLSearchParams({ db: "pubmed", term, retmode: "json", retmax: String(retmax), tool });
  if (email) params.set("email", email);
  return { url: `${PUBMED.base}/esearch.fcgi?${params.toString()}` };
}

export function pubmedSummaryRequest(pmids: string[], tool = "meridian", email?: string): TransportRequest {
  const params = new URLSearchParams({ db: "pubmed", id: pmids.join(","), retmode: "json", tool });
  if (email) params.set("email", email);
  return { url: `${PUBMED.base}/esummary.fcgi?${params.toString()}` };
}

export function parsePubmedSearch(body: string): { total: number | null; pmids: string[]; queryTranslation?: string } {
  const json = JSON.parse(body) as { esearchresult?: { count?: string; idlist?: string[]; querytranslation?: string } };
  const r = json.esearchresult;
  if (!r || !Array.isArray(r.idlist)) throw new Error("PubMed esearch: unexpected response shape");
  const count = Number(r.count);
  return { total: Number.isFinite(count) ? count : null, pmids: r.idlist, queryTranslation: r.querytranslation };
}

interface PubmedDocSum {
  uid?: string;
  title?: string;
  pubdate?: string;
  source?: string;
  fulljournalname?: string;
  authors?: { name?: string }[];
  articleids?: { idtype?: string; value?: string }[];
  pubtype?: string[];
}

export function parsePubmedSummary(body: string): RawRecord[] {
  const json = JSON.parse(body) as { result?: Record<string, PubmedDocSum | string[]> & { uids?: string[] } };
  const result = json.result;
  if (!result || !Array.isArray(result.uids)) throw new Error("PubMed esummary: unexpected response shape");
  return result.uids.flatMap((uid) => {
    const d = result[uid] as PubmedDocSum | undefined;
    const title = d?.title?.trim();
    if (!d || !title) return [];
    const yearMatch = d.pubdate?.match(/\b(1[89]\d{2}|20\d{2})\b/);
    const doi = d.articleids?.find((a) => a.idtype === "doi")?.value;
    return [
      {
        title: title.replace(/\.$/, ""),
        authors: (d.authors ?? []).map((a) => a.name ?? "").filter(Boolean).join(", "),
        year: yearMatch ? Number(yearMatch[1]) : null,
        venue: d.fulljournalname ?? d.source ?? "",
        doi: normalizeDoi(doi),
        pmid: d.uid ?? uid,
        providerType: (d.pubtype ?? []).join("; "),
      },
    ];
  });
}
