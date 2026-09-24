import { XMLParser } from "fast-xml-parser";
import type { TransportRequest } from "../transport";
import type { RawRecord } from "../records";
import { normalizeDoi } from "../identifiers";

/**
 * NCBI E-utilities (PubMed). Public; NCBI asks for `tool` and `email` parameters and ≤3 requests/s
 * without an API key. Terms: https://www.ncbi.nlm.nih.gov/books/NBK25497/ .
 *
 * Production search is two steps: esearch → PMIDs, then efetch (XML) → full records including the
 * whole abstract, typed dates, publication types and retraction links. esummary (JSON) is kept for
 * the older lookup path; it carries no abstract, so appraisal cannot run on it.
 */
export const PUBMED = {
  id: "pubmed" as const,
  base: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils",
};

/**
 * ESearch with `sort=relevance` (PubMed Best Match). Without it ESearch returns the most recently added
 * records first: on 24 September 2026 the query "erector spinae plane block rib fractures" gave PMIDs
 * 42582163, 42538106, ... unsorted and 27501016, 37334278, ... with sort=relevance (106 hits either way),
 * so the first 20 imported were the newest 20, not the most relevant.
 */
export function pubmedSearchRequest(term: string, retmax = 20, tool = "meridian", email?: string, apiKey?: string): TransportRequest {
  const params = new URLSearchParams({ db: "pubmed", term, retmode: "json", retmax: String(retmax), sort: "relevance", tool });
  if (email) params.set("email", email);
  if (apiKey) params.set("api_key", apiKey);
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

/** efetch returns full PubMed records (XML) for up to ~200 PMIDs per request. */
export function pubmedFetchRequest(pmids: string[], tool = "meridian", email?: string, apiKey?: string): TransportRequest {
  const params = new URLSearchParams({ db: "pubmed", id: pmids.join(","), retmode: "xml", rettype: "abstract", tool });
  if (email) params.set("email", email);
  if (apiKey) params.set("api_key", apiKey);
  return { url: `${PUBMED.base}/efetch.fcgi?${params.toString()}` };
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decode XML character references and strip inline markup (<i>, <sup>, <sub>, <b>, <u>, MathML). */
export function xmlInlineText(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  const s = typeof raw === "object" ? String((raw as Record<string, unknown>)["#text"] ?? "") : String(raw);
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n: string) => XML_ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return String((v as Record<string, unknown>)["#text"] ?? "").trim();
  return String(v).trim();
}

function yearFrom(date: unknown): number | undefined {
  if (!date || typeof date !== "object") return undefined;
  const d = date as Record<string, unknown>;
  const y = Number(text(d.Year));
  if (Number.isInteger(y) && y > 1800 && y < 2200) return y;
  const m = text(d.MedlineDate).match(/\b(1[89]\d{2}|2[01]\d{2})\b/);
  return m ? Number(m[1]) : undefined;
}

const PUBMED_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  // Mixed content (inline italics, superscripts) is kept raw and flattened by xmlInlineText.
  stopNodes: ["*.AbstractText", "*.ArticleTitle", "*.VernacularTitle", "*.Title"],
  isArray: (name) =>
    ["PubmedArticle", "PubmedBookArticle", "AbstractText", "Author", "PublicationType", "ArticleId", "ELocationID", "CommentsCorrections", "ArticleDate"].includes(name),
});

export interface PubmedFetchedRecord extends RawRecord {
  /** Publication types exactly as PubMed lists them. */
  publicationTypes: string[];
  /** "retracted" when PubMed lists a retraction notice or the "Retracted Publication" type. */
  publicationStatus: "published" | "ahead-of-print" | "retracted" | "unknown";
  /** PMIDs of retraction or erratum notices linked to this record. */
  notices: { type: string; pmid?: string }[];
}

/**
 * Parse an efetch PubmedArticleSet. Records without a title are dropped (nothing is invented).
 * The abstract is the concatenation of every AbstractText section in order, with its label, so a
 * structured abstract reaches appraisal whole.
 */
export function parsePubmedArticles(xml: string): PubmedFetchedRecord[] {
  const doc = PUBMED_PARSER.parse(xml) as Record<string, unknown>;
  const set = doc.PubmedArticleSet as Record<string, unknown> | undefined;
  if (!set || typeof set !== "object") throw new Error("PubMed efetch: unexpected response shape");
  const out: PubmedFetchedRecord[] = [];
  for (const art of asArray(set.PubmedArticle as Record<string, unknown>[] | undefined)) {
    const mc = (art.MedlineCitation ?? {}) as Record<string, unknown>;
    const article = (mc.Article ?? {}) as Record<string, unknown>;
    const pmid = text(mc.PMID);
    const title = xmlInlineText(article.ArticleTitle).replace(/\.$/, "");
    if (!title) continue;
    const journal = (article.Journal ?? {}) as Record<string, unknown>;
    const issue = (journal.JournalIssue ?? {}) as Record<string, unknown>;
    const printYear = yearFrom(issue.PubDate);
    const onlineYear = asArray(article.ArticleDate as Record<string, unknown>[] | undefined)
      .map((d) => yearFrom(d))
      .find((y): y is number => typeof y === "number");
    const abstractSections = asArray(((article.Abstract ?? {}) as Record<string, unknown>).AbstractText as unknown[] | undefined);
    const abstract = abstractSections
      .map((sec) => {
        const label = sec && typeof sec === "object" ? String((sec as Record<string, unknown>)["@_Label"] ?? "").trim() : "";
        const body = xmlInlineText(sec);
        return body ? (label ? `${label}: ${body}` : body) : "";
      })
      .filter(Boolean)
      .join("\n");
    const authors = asArray(((article.AuthorList ?? {}) as Record<string, unknown>).Author as Record<string, unknown>[] | undefined)
      .map((a) => {
        const collective = text(a.CollectiveName);
        if (collective) return collective;
        const last = text(a.LastName);
        const initials = text(a.Initials);
        return [last, initials].filter(Boolean).join(" ");
      })
      .filter(Boolean)
      .join(", ");
    const pubtypes = asArray(((article.PublicationTypeList ?? {}) as Record<string, unknown>).PublicationType as unknown[] | undefined)
      .map((p) => text(p))
      .filter(Boolean);
    const data = (art.PubmedData ?? {}) as Record<string, unknown>;
    const ids = asArray(((data.ArticleIdList ?? {}) as Record<string, unknown>).ArticleId as Record<string, unknown>[] | undefined);
    const doiFromIds = ids.find((i) => String(i["@_IdType"] ?? "") === "doi");
    const doiFromLocation = asArray(article.ELocationID as Record<string, unknown>[] | undefined).find(
      (e) => String(e["@_EIdType"] ?? "") === "doi",
    );
    const doi = normalizeDoi(text(doiFromIds) || text(doiFromLocation));
    const notices = asArray(((mc.CommentsCorrectionsList ?? {}) as Record<string, unknown>).CommentsCorrections as Record<string, unknown>[] | undefined)
      .map((c) => ({ type: String(c["@_RefType"] ?? ""), pmid: text(c.PMID) || undefined }))
      .filter((c) => /RetractionIn|ErratumIn|ExpressionOfConcernIn|RetractionOf/.test(c.type));
    const pubStatus = text(data.PublicationStatus).toLowerCase();
    const retracted =
      pubtypes.some((t) => /retracted publication/i.test(t)) || notices.some((n) => n.type === "RetractionIn");
    out.push({
      title,
      authors,
      year: printYear ?? onlineYear ?? null,
      venue: xmlInlineText(journal.Title) || text(journal.ISOAbbreviation),
      doi,
      pmid: pmid || undefined,
      providerType: pubtypes.join("; "),
      abstract: abstract || undefined,
      dates: printYear || onlineYear ? { print: printYear, online: onlineYear } : undefined,
      publicationTypes: pubtypes,
      publicationStatus: retracted ? "retracted" : pubStatus === "aheadofprint" ? "ahead-of-print" : pubStatus ? "published" : "unknown",
      notices,
    });
  }
  return out;
}
