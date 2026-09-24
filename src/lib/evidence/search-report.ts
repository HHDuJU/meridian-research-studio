import type { EvidenceItem, EvidenceRun, RetrievalEvent, SearchLogEntry, SearchLogKey, Study } from "../types";
import { familyOf } from "../stages";

/*
 * Search report: every search Meridian ran, exactly as run, with the facts a journal asks for.
 *
 * Built only from what was recorded (retrieval events, evidence runs, records and their identity checks)
 * and from the investigator's own answers (study.scan.searchLog). Nothing here is written by a model, and a
 * PRISMA-S item Meridian cannot know is marked "needs your answer", never filled in.
 *
 * Sources checked on 24 September 2026:
 * - PRISMA-S, 16 items (Rethlefsen ML et al. Syst Rev. 2021;10(1):39), full text read through PubMed Central.
 * - PRESS 2015, six elements (McGowan J et al. J Clin Epidemiol. 2016;75:40-46), abstract read through PubMed.
 * - PubMed ESearch: lowercase "or" is read as OR; mixed AND/OR is read left to right, e.g. "ketamine OR
 *   esketamine AND depression" became (ketamine OR esketamine) AND depression; an Entry Date range written
 *   1800/01/01:2026/09/24[edat] is read as [Date - Entry]. All three observed in ESearch output.
 * - PubMed "Send to, Citation manager" and ClinicalTrials.gov "Download" seen on the live result pages.
 * - Cochrane MECIR conduct standards C24 (CENTRAL, MEDLINE and Embase) and C27 (trial registers through
 *   ClinicalTrials.gov and the WHO ICTRP portal), both mandatory for Cochrane intervention reviews, read on
 *   cochrane.org.
 */

export const PRISMA_S_REFERENCE =
  "Rethlefsen ML, Kirtley S, Waffenschmidt S, Ayala AP, Moher D, Page MJ, et al. PRISMA-S: an extension to the PRISMA Statement for Reporting Literature Searches in Systematic Reviews. Syst Rev. 2021;10(1):39. doi:10.1186/s13643-020-01542-z";
export const PRESS_REFERENCE =
  "McGowan J, Sampson M, Salzwedel DM, Cogo E, Foerster V, Lefebvre C. PRESS Peer Review of Electronic Search Strategies: 2015 Guideline Statement. J Clin Epidemiol. 2016;75:40-46. doi:10.1016/j.jclinepi.2016.01.021";

/** Study types whose searches must find every eligible study, so every record found has to be screened. */
export const EXHAUSTIVE_FAMILIES: ReadonlySet<string> = new Set(["systematic-review", "scoping-review", "umbrella-review", "rapid-review"]);

interface SourceInfo {
  name: string;
  owner: string;
  kind: "database" | "registry" | "other";
  reproduce?: (strategy: string) => string;
  exportHint?: string;
}

const SOURCE_INFO: Record<string, SourceInfo> = {
  pubmed: {
    name: "PubMed",
    owner: "U.S. National Library of Medicine; includes MEDLINE",
    kind: "database",
    reproduce: (q) => `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(q)}`,
    exportHint: "On the PubMed results page, choose Send to, then Citation manager, to export every record found.",
  },
  clinicaltrials: {
    name: "ClinicalTrials.gov",
    owner: "U.S. National Library of Medicine",
    kind: "registry",
    reproduce: (q) => `https://clinicaltrials.gov/search?term=${encodeURIComponent(q)}`,
    exportHint: "On the ClinicalTrials.gov results page, choose Download to export every registration found.",
  },
  openalex: {
    name: "OpenAlex",
    owner: "OurResearch",
    kind: "database",
    reproduce: (q) => `https://api.openalex.org/works?search=${encodeURIComponent(q)}`,
  },
  "consensus-connector": { name: "Consensus", owner: "Consensus (consensus.app)", kind: "database" },
  fixture: { name: "Recorded test data", owner: "Meridian test fixtures, not a live source", kind: "other" },
};

/** Provider id for a search the investigator ran elsewhere and recorded in Meridian. */
export const EXTERNAL_PROVIDER = "external";

function sourceInfo(provider: string, e?: Pick<RetrievalEvent, "sourceName" | "sourceKind">): SourceInfo {
  if (provider === EXTERNAL_PROVIDER) return { name: e?.sourceName?.trim() || "Source not named", owner: "", kind: e?.sourceKind ?? "database" };
  return SOURCE_INFO[provider] ?? { name: provider, owner: "", kind: "other" };
}

function sourceKey(e: Pick<RetrievalEvent, "provider" | "sourceName">): string {
  return e.provider === EXTERNAL_PROVIDER ? `${EXTERNAL_PROVIDER}:${(e.sourceName ?? "").trim().toLowerCase()}` : e.provider;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "24 September 2026" (UTC). */
export function longDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "date not recorded";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function utcTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

function ymd(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
}

function n(x: number): string {
  return x.toLocaleString("en-US");
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${n(count)} ${count === 1 ? one : many}`;
}

function listJoin(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/* ------------------------------------------------------------------------------------------------ */
/* Strategy checks (automated, PRESS 2015 elements). They are prompts for a person, not a peer review. */
/* ------------------------------------------------------------------------------------------------ */

export type PressElement =
  | "Translation of the research question"
  | "Boolean and proximity operators"
  | "Subject headings"
  | "Text word searching"
  | "Spelling, syntax and line numbers"
  | "Limits and filters";

export interface StrategyCheck {
  element: PressElement;
  text: string;
}

const LIMIT_TAGS: { re: RegExp; label: string }[] = [
  { re: /\[(?:la|lang|language)\]/i, label: "language" },
  { re: /\[(?:dp|pdat|date - publication|publication date)\]/i, label: "publication date" },
  { re: /\[(?:edat|crdt|mhda|date - entry|date - create|date - mesh)\]/i, label: "entry or creation date" },
  { re: /\[(?:pt|ptyp|publication type)\]/i, label: "publication type" },
  { re: /\[(?:sb|subset|filter)\]/i, label: "subset or filter" },
  { re: /"?\b(?:humans|animals)\b"?\s*\[(?:mh|mesh|mesh terms|majr)\]/i, label: "humans or animals" },
  { re: /"?\b(?:infant|child|adolescent|adult|young adult|middle aged|aged|aged, 80 and over)\b"?\s*\[(?:mh|mesh|mesh terms)\]/i, label: "age group" },
  { re: /\bAREA\[/, label: "registry field restriction" },
];

/** Limits written into a strategy (field tags such as [la], [dp], [pt]; NOT; registry AREA[] filters). */
export function strategyLimits(strategy: string): string[] {
  const out: string[] = [];
  for (const { re, label } of LIMIT_TAGS) if (re.test(strategy)) out.push(label);
  if (/\bNOT\b/.test(strategy)) out.push("exclusion with NOT");
  return [...new Set(out)];
}

/** Phrases the source searched as a unit, read from its translation ("rib fractures"[MeSH Terms] gives "rib fractures"). */
function translatedPhrases(translation: string): Set<string> {
  const out = new Set<string>();
  for (const m of translation.matchAll(/"([^"]+)"\s*\[[^\]]+\]/g)) out.add(m[1].toLowerCase().trim());
  return out;
}

/** Runs of two or more plain words (outside quotes and field tags) in a strategy. */
function bareWordRuns(strategy: string): string[][] {
  const runs: string[][] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length >= 2) runs.push(current);
    current = [];
  };
  const tokens = strategy.match(/"[^"]*"(?:\s*\[[^\]]*\])?|\[[^\]]*\]|\(|\)|[^\s()"[\]]+/g) ?? [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1] ?? "";
    if (/^(?:AND|OR|NOT)$/i.test(t) || t === "(" || t === ")" || t.startsWith('"') || t.startsWith("[")) {
      flush();
      continue;
    }
    if (next.startsWith("[")) {
      // a tagged word ends the run: word[tiab]
      flush();
      continue;
    }
    if (/[*?]$/.test(t)) {
      flush();
      continue;
    }
    current.push(t.toLowerCase());
  }
  flush();
  return runs;
}

/** Words of a run that the source searched on their own, not inside any phrase it recognised. */
function splitWords(run: string[], phrases: Set<string>): string[] {
  const single: string[] = [];
  let i = 0;
  while (i < run.length) {
    let matched = 0;
    for (let len = run.length - i; len >= 2; len--) {
      if (phrases.has(run.slice(i, i + len).join(" "))) {
        matched = len;
        break;
      }
    }
    if (matched) {
      i += matched;
    } else {
      single.push(run[i]);
      i += 1;
    }
  }
  return single;
}

function related(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return true;
  const k = Math.min(5, x.length, y.length);
  return k >= 4 && x.slice(0, k) === y.slice(0, k);
}

/** MeSH headings or concepts the source added that share no word stem with what was typed. */
function unexpectedHeadings(strategy: string, translation: string): string[] {
  const typed = (strategy.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []).filter((w) => !["and", "or", "not"].includes(w));
  const out: string[] = [];
  for (const m of translation.matchAll(/"([^"]+)"\s*\[(MeSH Terms|Supplementary Concept)\]/gi)) {
    const heading = m[1].toLowerCase();
    const words = heading.match(/[a-z][a-z'-]+/g) ?? [];
    if (!words.some((w) => typed.some((t) => related(w, t)))) out.push(m[1]);
  }
  return [...new Set(out)];
}

function balanced(strategy: string): { parens: boolean; quotes: boolean } {
  let depth = 0;
  let ok = true;
  for (const ch of strategy.replace(/"[^"]*"/g, "")) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth < 0) ok = false;
  }
  return { parens: ok && depth === 0, quotes: (strategy.match(/"/g) ?? []).length % 2 === 0 };
}

/** Top-level mix of AND and OR with no parentheses to say which goes first. */
function mixedOperators(strategy: string): boolean {
  const flat = strategy.replace(/"[^"]*"/g, " ");
  let depth = 0;
  let hasAnd = false;
  let hasOr = false;
  const tokens = flat.match(/\(|\)|[^\s()]+/g) ?? [];
  for (const t of tokens) {
    if (t === "(") depth++;
    else if (t === ")") depth--;
    else if (depth === 0 && /^AND$/i.test(t)) hasAnd = true;
    else if (depth === 0 && /^OR$/i.test(t)) hasOr = true;
  }
  return hasAnd && hasOr;
}

/** Automated checks on one strategy, grouped by PRESS 2015 element. */
export function strategyChecks(provider: string, entered: string, sent: string, translation?: string): StrategyCheck[] {
  const out: StrategyCheck[] = [];
  const b = balanced(sent);
  if (!b.parens) out.push({ element: "Spelling, syntax and line numbers", text: "Parentheses do not pair up; the source may have read the strategy differently from what was intended." });
  if (!b.quotes) out.push({ element: "Spelling, syntax and line numbers", text: "A quotation mark is unpaired; the phrase it opens may not have been searched as a phrase." });
  if (entered.trim() !== sent.trim()) {
    const dropped = /\*/.test(entered) && !/\*/.test(sent) ? " Truncation (*) was removed because this route does not accept it, so truncated words were searched as written without the asterisk." : "";
    out.push({ element: "Spelling, syntax and line numbers", text: `The strategy sent differs from the one entered.${dropped} The report gives both.` });
  }
  if (mixedOperators(sent)) {
    out.push({
      element: "Boolean and proximity operators",
      text:
        provider === "pubmed"
          ? "AND and OR are mixed without parentheses. PubMed reads left to right, so A OR B AND C is searched as (A OR B) AND C; write the grouping out."
          : "AND and OR are mixed without parentheses; write the grouping out so the order does not depend on the source's rules.",
    });
  }
  if (provider === "pubmed") {
    if (translation) {
      const odd = unexpectedHeadings(sent, translation);
      if (odd.length) {
        out.push({
          element: "Subject headings",
          text: `PubMed also searched ${listJoin(odd.map((h) => `the heading "${h}"`))}, which shares no word with the strategy (automatic term mapping). Check each is intended; quote the phrase or tag it [tiab] to stop the mapping.`,
        });
      }
      const phrases = translatedPhrases(translation);
      const split = bareWordRuns(sent).map((run) => ({ run, single: splitWords(run, phrases) })).filter((r) => r.single.length >= 2);
      for (const r of split) {
        out.push({
          element: "Text word searching",
          text: `The words ${listJoin(r.single.map((w) => `"${w}"`))} were searched one by one (joined with AND), not as a phrase. To search a phrase, quote it and add a field tag, for example "${r.single.join(" ")}"[tiab].`,
        });
      }
    }
    if (!/\[(?:mh|mesh|mesh terms|majr)\]/i.test(sent)) {
      out.push({ element: "Subject headings", text: "No MeSH heading was chosen in the strategy; any headings searched were added by PubMed's automatic term mapping (see its reading of the strategy)." });
    }
  }
  const limits = strategyLimits(sent);
  if (limits.length) out.push({ element: "Limits and filters", text: `The strategy restricts results by ${listJoin(limits)}; the report must say why.` });
  return out;
}

/* ------------------------------------------------------------------------------------------------ */
/* Report model                                                                                        */
/* ------------------------------------------------------------------------------------------------ */

export interface SearchEntry {
  /** Search number in the order run (1-based). */
  n: number;
  eventId: string;
  provider: string;
  /** Groups searches of one source (external searches by source name). */
  sourceKey: string;
  source: string;
  owner: string;
  kind: SourceInfo["kind"];
  at: string;
  date: string;
  time: string;
  /** Strategy as entered in Meridian. */
  entered: string;
  /** Strategy as sent to the source; `sentRecorded` false when rebuilt from the entered one (searches before 24 September 2026). */
  sent: string;
  sentRecorded: boolean;
  translation?: string;
  via: string;
  order: string;
  found: number | null;
  imported: number;
  importCap?: number;
  status: RetrievalEvent["status"];
  performedBy: RetrievalEvent["performedBy"];
  note?: string;
  /** Exact requests sent (URLs, or connector calls), from the evidence run of this search. */
  requests: string[];
  reproduceUrl?: string;
  /** PubMed only: the strategy limited to records added up to the search date, so a later reader sees the same set. */
  asOfStrategy?: string;
  limits: string[];
  checks: StrategyCheck[];
}

export interface SourceRow {
  provider: string;
  source: string;
  owner: string;
  kind: SourceInfo["kind"];
  via: string;
  searches: number;
  firstDate: string;
  lastDate: string;
  /** Latest count per distinct strategy, summed; null when a count is missing. */
  found: number | null;
  imported: number;
  exportHint?: string;
}

export type PrismaSState = "reported" | "not-applicable" | "needs-answer";

export interface PrismaSRow {
  n: number;
  item: string;
  state: PrismaSState;
  text: string;
  where: string;
}

export interface SearchReport {
  studyId: string;
  studyTitle: string;
  familyLabel: string;
  exhaustive: boolean;
  preparedAt: string;
  preparedDate: string;
  searches: SearchEntry[];
  failed: SearchEntry[];
  sources: SourceRow[];
  totals: { found: number | null; imported: number; fromSearches: number; merged: number; inMoreThanOne: number };
  identity: { checked: number; verified: number; mismatch: number; notFound: number; failed: number; providers: string[] };
  otherSources: { modelOnly: number; modelOnlyVerified: number; investigatorOnly: number; models: string[] };
  log: Partial<Record<SearchLogKey, SearchLogEntry>>;
  prismaS: PrismaSRow[];
  methods: string;
  gaps: string[];
}

const COWORK_VIA: Record<string, string> = {
  pubmed: "PubMed connector in Claude (search_articles, get_article_metadata)",
  clinicaltrials: "Clinical Trials connector in Claude (search_trials with an Essie expression, get_trial_details)",
};
const SERVER_VIA: Record<string, string> = {
  pubmed: "NCBI E-utilities API (ESearch, EFetch)",
  openalex: "OpenAlex API (/works, search)",
  clinicaltrials: "ClinicalTrials.gov API version 2 (/studies, query.term)",
};

function viaConnector(e: RetrievalEvent): boolean {
  return /through the (?:PubMed|Clinical Trials) connector/.test(e.note ?? "");
}

/** How the source was reached, for events recorded before the field existed. */
function describeVia(e: RetrievalEvent): string {
  if (e.via) return e.via;
  if (e.performedBy === "connector") return "results pasted from a Claude connector session (run outside Meridian)";
  if (e.performedBy === "manual") return "run outside Meridian and recorded by the investigator";
  if (e.provider === "fixture") return "recorded test data";
  if (viaConnector(e)) return COWORK_VIA[e.provider] ?? "Claude connector";
  return SERVER_VIA[e.provider] ?? "not recorded";
}

/**
 * Order the records came back in, for events recorded before the field existed. Before 24 September
 * 2026 the server build sent PubMed no sort, and ESearch then returns the most recently added records
 * first; ClinicalTrials.gov returns studies unsorted unless asked. The Cowork PubMed route always asked
 * for relevance.
 */
function describeOrder(e: RetrievalEvent): string {
  if (e.order) return e.order;
  if (e.performedBy === "manual") return "not applicable (no records imported)";
  if (e.provider === "pubmed") return viaConnector(e) ? "relevance (PubMed Best Match)" : "most recently added first (PubMed ESearch default; no order was requested)";
  if (e.provider === "clinicaltrials") return "not set: ClinicalTrials.gov returns studies unsorted unless asked";
  if (e.provider === "openalex") return "relevance (OpenAlex relevance score)";
  return "not recorded";
}

/** The strategy as sent, rebuilt for events recorded before `sent` existed (same rules as the search code). */
function describeSent(e: RetrievalEvent): { sent: string; recorded: boolean } {
  if (e.sent) return { sent: e.sent, recorded: true };
  const q = (e.query ?? "").trim();
  if (e.provider === "pubmed") return { sent: viaConnector(e) ? q.replace(/\*/g, "").replace(/\s+/g, " ").trim() : q, recorded: false };
  if (e.provider === "clinicaltrials" || e.provider === "openalex") {
    return { sent: q.replace(/\[[^\]]*\]/g, " ").replace(/\*/g, "").replace(/\s+/g, " ").trim(), recorded: false };
  }
  return { sent: q, recorded: false };
}

function describeTranslation(e: RetrievalEvent): string | undefined {
  if (e.translation) return e.translation;
  const m = (e.note ?? "").match(/PubMed translation: (.*?)(?:; \d+ of \d+ hits ingested|; \d+ PMIDs returned|; \d+ of \d+ records carry|; through the PubMed connector|$)/);
  return m ? m[1].trim() : undefined;
}


function requestsFor(e: RetrievalEvent, runs: EvidenceRun[]): string[] {
  const linked = runs.find((r) => r.eventId === e.id);
  if (linked) return linked.requests;
  // Runs recorded before `eventId` existed: the search run for the same source and strategy closest in time after the event.
  const t = Date.parse(e.at);
  const candidates = runs
    .filter((r) => r.kind === "search" && r.provider === e.provider && (r.query ?? "").trim() === (e.query ?? "").trim())
    .map((r) => ({ r, d: Date.parse(r.at) - t }))
    .filter((x) => Number.isFinite(x.d) && x.d >= -1000 && x.d < 10 * 60 * 1000)
    .sort((a, b) => a.d - b.d);
  return candidates[0]?.r.requests ?? [];
}

function entryFor(e: RetrievalEvent, index: number, runs: EvidenceRun[]): SearchEntry {
  const info = sourceInfo(e.provider, e);
  const { sent, recorded } = describeSent(e);
  const translation = describeTranslation(e);
  const entry: SearchEntry = {
    n: index + 1,
    eventId: e.id,
    provider: e.provider,
    sourceKey: sourceKey(e),
    source: info.name,
    owner: info.owner,
    kind: info.kind,
    at: e.at,
    date: longDate(e.at),
    time: utcTime(e.at),
    entered: (e.query ?? "").trim(),
    sent,
    sentRecorded: recorded,
    translation,
    via: describeVia(e),
    order: describeOrder(e),
    found: e.resultCount,
    imported: e.recordIds.length,
    importCap: typeof e.importCap === "number" ? e.importCap : undefined,
    status: e.status,
    performedBy: e.performedBy,
    note: e.note,
    requests: requestsFor(e, runs),
    reproduceUrl: info.reproduce && sent ? info.reproduce(sent) : undefined,
    limits: strategyLimits(sent),
    checks: strategyChecks(e.provider, (e.query ?? "").trim(), sent, translation),
  };
  if (e.provider === "pubmed" && sent && !Number.isNaN(Date.parse(e.at))) {
    entry.asOfStrategy = `(${sent}) AND 1800/01/01:${ymd(e.at)}[edat]`;
  }
  return entry;
}

const LOG_ITEM: Record<number, SearchLogKey> = { 4: "browsing", 5: "citations", 6: "contacts", 7: "otherMethods", 10: "filters", 11: "priorWork", 12: "updates", 14: "peerReview" };

/** Each yes/no question: its label in the report, the sentence a "no" gives, and the question when unanswered. A "yes" gives the investigator's own words. */
export const SEARCH_QUESTIONS: { key: SearchLogKey; item: number; label: string; no: string; ask: string; placeholder: string }[] = [
  {
    key: "browsing",
    item: 4,
    label: "Online resources and browsing",
    no: "No websites, conference proceedings or journal tables of contents were searched or browsed.",
    ask: "Were any websites, conference proceedings or tables of contents searched or browsed?",
    placeholder: "e.g. We browsed the abstracts of the ASRA Pain Medicine meetings 2023 to 2026 on the society website on 20 September 2026.",
  },
  {
    key: "citations",
    item: 5,
    label: "Citation searching",
    no: "Reference lists and citing articles were not examined.",
    ask: "Were reference lists or citing articles of included studies checked?",
    placeholder: "e.g. We checked the reference lists of all included studies and the articles citing them in Google Scholar.",
  },
  {
    key: "contacts",
    item: 6,
    label: "Contacts",
    no: "No authors, experts or manufacturers were contacted for additional studies or data.",
    ask: "Were authors, experts or manufacturers contacted for more studies or data?",
    placeholder: "e.g. We emailed the corresponding authors of three trials registered without results.",
  },
  {
    key: "otherMethods",
    item: 7,
    label: "Other methods",
    no: "No other search methods were used.",
    ask: "Was any other search method used?",
    placeholder: "e.g. We hand-searched the last two volumes of Regional Anesthesia and Pain Medicine.",
  },
  {
    key: "filters",
    item: 10,
    label: "Search filters",
    no: "No published search filters were used.",
    ask: "Was a published search filter used (for example a randomized trial filter)?",
    placeholder: "e.g. We used the Cochrane Highly Sensitive Search Strategy for randomized trials (sensitivity-maximizing version), PubMed format.",
  },
  {
    key: "priorWork",
    item: 11,
    label: "Prior work",
    no: "The strategies were written for this review; no strategy from an earlier review was reused.",
    ask: "Was a strategy from an earlier review reused or adapted?",
    placeholder: "e.g. The PubMed strategy was adapted from Smith et al. 2024 (reference 12), adding terms for rib fractures.",
  },
  {
    key: "updates",
    item: 12,
    label: "Updates",
    no: "The searches were not updated after the dates shown.",
    ask: "Were the searches rerun, or alerts set up, to catch newer records?",
    placeholder: "e.g. We reran all searches on 15 January 2027 before the analysis.",
  },
  {
    key: "peerReview",
    item: 14,
    label: "Peer review",
    no: "The search strategies were not peer reviewed.",
    ask: "Were the strategies peer reviewed (for example by a librarian using the PRESS 2015 checklist)?",
    placeholder: "e.g. A health sciences librarian peer reviewed the PubMed strategy with the PRESS 2015 checklist on 18 September 2026.",
  },
];

const QUESTION_BY_KEY = Object.fromEntries(SEARCH_QUESTIONS.map((q) => [q.key, q])) as Record<string, (typeof SEARCH_QUESTIONS)[number]>;

function sentence(text: string): string {
  const t = text.trim();
  return /[.!?)"]$/.test(t) ? t : `${t}.`;
}

/** The report's sentence for one answer: a "no" gives the fixed sentence (plus any note), a "yes" the investigator's own words. */
function answered(log: Partial<Record<SearchLogKey, SearchLogEntry>>, key: SearchLogKey): string | null {
  const e = log[key];
  const q = QUESTION_BY_KEY[key];
  if (!e || !q) return null;
  if (e.answer === "no") return e.detail ? `${q.no} ${sentence(e.detail)}` : q.no;
  if (e.answer === "yes" && e.detail.trim()) return sentence(e.detail);
  return null;
}

function itemFromLog(nItem: number, name: string, log: Partial<Record<SearchLogKey, SearchLogEntry>>, extra = ""): PrismaSRow {
  const key = LOG_ITEM[nItem];
  const said = answered(log, key);
  if (said) return { n: nItem, item: name, state: "reported", text: [said, extra].filter(Boolean).join(" "), where: "Section 5" };
  return { n: nItem, item: name, state: "needs-answer", text: [`Not answered yet: ${QUESTION_BY_KEY[key]?.ask ?? ""}`, extra].filter(Boolean).join(" "), where: "Section 5" };
}

export function buildSearchReport(study: Study, now: string = new Date().toISOString()): SearchReport {
  const events = [...(study.scan.retrievalEvents ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const runs = study.evidenceRuns ?? [];
  const all = events.map((e, i) => entryFor(e, i, runs));
  const searches = all.filter((s) => s.status === "ok" || s.status === "partial");
  const failed = all.filter((s) => s.status === "error" || s.status === "blocked");
  const log = study.scan.searchLog?.entries ?? {};
  const family = familyOf(study.family);
  const exhaustive = !!study.family && EXHAUSTIVE_FAMILIES.has(study.family);

  // Sources (PRISMA-S items 1, 3, 13, 15).
  const byProvider = new Map<string, SearchEntry[]>();
  for (const s of searches) byProvider.set(s.sourceKey, [...(byProvider.get(s.sourceKey) ?? []), s]);
  const sources: SourceRow[] = [...byProvider.values()].map((list) => {
    const provider = list[0].provider;
    const info = { ...sourceInfo(provider), name: list[0].source, owner: list[0].owner, kind: list[0].kind };
    const latestPerStrategy = new Map<string, SearchEntry>();
    for (const s of list) latestPerStrategy.set(s.sent, s);
    const counts = [...latestPerStrategy.values()].map((s) => s.found);
    return {
      provider,
      source: info.name,
      owner: info.owner,
      kind: info.kind,
      via: [...new Set(list.map((s) => s.via))].join("; "),
      searches: list.length,
      firstDate: list[0].date,
      lastDate: list[list.length - 1].date,
      found: counts.some((c) => c === null) ? null : counts.reduce<number>((a, c) => a + (c ?? 0), 0),
      imported: list.reduce((a, s) => a + s.imported, 0),
      exportHint: info.exportHint,
    };
  });

  // Records (PRISMA-S items 15 and 16; other sources for item 7).
  const items: EvidenceItem[] = study.scan.items ?? [];
  const fromSearches = items.filter((i) => (i.provenance?.retrievalEventIds ?? []).length > 0);
  const importedTotal = searches.reduce((a, s) => a + s.imported, 0);
  const merged = Math.max(0, importedTotal - fromSearches.length);
  const inMoreThanOne = fromSearches.filter((i) => new Set(i.provenance.retrievalEventIds).size > 1).length;
  const foundCounts = sources.map((s) => s.found);
  const totals = {
    found: foundCounts.some((c) => c === null) ? null : foundCounts.reduce<number>((a, c) => a + (c ?? 0), 0),
    imported: importedTotal,
    fromSearches: fromSearches.length,
    merged,
    inMoreThanOne,
  };
  const modelOnlyItems = items.filter((i) => i.provenance?.origin === "model" && !(i.provenance.retrievalEventIds ?? []).length);
  const models = [
    ...new Set(
      (study.modelRuns ?? [])
        .filter((r) => r.stage === "scan" && r.outcome === "applied" && r.mode === "live")
        .map((r) => r.model ?? r.provider)
        .filter(Boolean),
    ),
  ];
  const otherSources = {
    modelOnly: modelOnlyItems.length,
    modelOnlyVerified: modelOnlyItems.filter((i) => i.provenance.status === "verified").length,
    investigatorOnly: items.filter((i) => i.provenance?.origin === "user" && !(i.provenance.retrievalEventIds ?? []).length).length,
    models,
  };
  const checks = items.flatMap((i) => i.provenance?.checks ?? []).filter((c) => c.provider !== "manual");
  const identity = {
    checked: checks.length,
    verified: checks.filter((c) => c.result === "match").length,
    mismatch: checks.filter((c) => c.result === "mismatch").length,
    notFound: checks.filter((c) => c.result === "not-found").length,
    failed: checks.filter((c) => c.result === "error" || c.result === "blocked" || c.result === "unresolved").length,
    providers: [...new Set(checks.map((c) => c.provider))],
  };

  const databases = sources.filter((s) => s.kind === "database");
  const registries = sources.filter((s) => s.kind === "registry");
  const limitsFound = [...new Set(searches.flatMap((s) => s.limits))];
  const capBySource = new Map<string, Set<number>>();
  for (const s of searches) if (typeof s.importCap === "number") capBySource.set(s.source, new Set([...(capBySource.get(s.source) ?? []), s.importCap]));
  const capText = [...capBySource.entries()].map(([source, caps]) => `up to ${listJoin([...caps].sort((a, b) => a - b).map(String))} records per ${source} search`);
  const imported = searches.filter((s) => s.performedBy !== "manual");
  const importSentence = !imported.length
    ? ""
    : imported.every((s) => s.found !== null && s.imported >= s.found)
      ? "Every record each search found was imported into Meridian."
      : `Meridian imported ${capText.length ? listJoin(capText) : "the first records of each search"}, in the order the source returned them (Table 2 gives the order and the counts); records beyond that were not imported.`;
  const reruns = [...new Set(searches.map((s) => `${s.sourceKey}\u0000${s.sent}`))]
    .map((k) => searches.filter((s) => `${s.sourceKey}\u0000${s.sent}` === k))
    .filter((list) => new Set(list.map((s) => s.date)).size > 1);
  const rerunText = reruns.length
    ? reruns.map((list) => `the ${list[0].source} strategy of search ${list[0].n} was rerun on ${listJoin([...new Set(list.slice(1).map((s) => s.date))])}`).join("; ")
    : "";

  const prismaS: PrismaSRow[] = [];
  prismaS.push(
    databases.length
      ? { n: 1, item: "Database name", state: "reported", text: databases.map((d) => `${d.source}${d.owner ? ` (${d.owner})` : ""}, searched through the ${d.via}`).join("; ") + ".", where: "Table 1" }
      : { n: 1, item: "Database name", state: "not-applicable", text: "No bibliographic database was searched.", where: "Table 1" },
  );
  prismaS.push({ n: 2, item: "Multi-database searching", state: "not-applicable", text: "Each source was searched on its own; no platform searched several databases at once.", where: "Table 1" });
  prismaS.push(
    registries.length
      ? { n: 3, item: "Study registries", state: "reported", text: registries.map((r) => `${r.source}${r.owner ? ` (${r.owner})` : ""}`).join("; ") + ".", where: "Table 1" }
      : { n: 3, item: "Study registries", state: "not-applicable", text: "No study registry was searched.", where: "Table 1" },
  );
  prismaS.push(itemFromLog(4, "Online resources and browsing", log));
  prismaS.push(itemFromLog(5, "Citation searching", log));
  prismaS.push(itemFromLog(6, "Contacts", log));
  const autoOther = [
    otherSources.modelOnly
      ? `A language model${models.length ? ` (${models.join(", ")})` : ""} suggested ${plural(otherSources.modelOnly, "record")} that no search returned; ${n(otherSources.modelOnlyVerified)} of them ${otherSources.modelOnlyVerified === 1 ? "was" : "were"} confirmed to exist by an identity check.`
      : "",
    otherSources.investigatorOnly ? `${plural(otherSources.investigatorOnly, "record")} ${otherSources.investigatorOnly === 1 ? "was" : "were"} added by the investigator without a search.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  prismaS.push(itemFromLog(7, "Other methods", log, autoOther));
  prismaS.push(
    searches.length
      ? {
          n: 8,
          item: "Full search strategies",
          state: "reported",
          text: `Table 2 gives each strategy exactly as sent to the source${searches.some((s) => s.translation) ? ", with PubMed's own reading of it" : ""}, the date, the number of records found and a link that reruns it.${searches.some((s) => !s.sentRecorded) ? " For searches run before 24 September 2026 the strategy sent is rebuilt from the one entered, by the same rules the search used." : ""}`,
          where: "Table 2",
        }
      : { n: 8, item: "Full search strategies", state: "needs-answer", text: "No search has been run yet.", where: "Table 2" },
  );
  const limitsWhy = log.limitsWhy?.detail;
  prismaS.push(
    !searches.length
      ? { n: 9, item: "Limits and restrictions", state: "needs-answer", text: "No search has been run yet.", where: "Section 4" }
      : limitsFound.length
        ? {
            n: 9,
            item: "Limits and restrictions",
            state: limitsWhy ? "reported" : "needs-answer",
            text: `The strategies restrict results by ${listJoin(limitsFound)}. ${limitsWhy ? `Reason: ${limitsWhy}` : "Say why each restriction was used."} ${importSentence}`.trim(),
            where: "Section 4",
          }
        : { n: 9, item: "Limits and restrictions", state: "reported", text: `No language, date, publication-type or other limits were written into any strategy. ${importSentence}`.trim(), where: "Section 4" },
  );
  prismaS.push(itemFromLog(10, "Search filters", log));
  prismaS.push(itemFromLog(11, "Prior work", log));
  prismaS.push(itemFromLog(12, "Updates", log, rerunText ? `Recorded reruns: ${rerunText}.` : ""));
  prismaS.push(
    searches.length
      ? {
          n: 13,
          item: "Dates of searches",
          state: "reported",
          text: searches[0].date === searches[searches.length - 1].date ? `All searches were run on ${searches[0].date}.` : `Searches were run from ${searches[0].date} to ${searches[searches.length - 1].date}; Table 2 gives the date of each.`,
          where: "Tables 1 and 2",
        }
      : { n: 13, item: "Dates of searches", state: "needs-answer", text: "No search has been run yet.", where: "Table 1" },
  );
  prismaS.push(itemFromLog(14, "Peer review", log, "Meridian's automated strategy checks (Section 6) are prompts for a person, not a peer review."));
  prismaS.push(
    searches.length
      ? {
          n: 15,
          item: "Total records",
          state: "reported",
          text: `${sources.map((s) => `${s.source}: ${s.found === null ? "count not reported" : plural(s.found, "record")}`).join("; ")}${totals.found !== null && sources.length > 1 ? `; ${plural(totals.found, "record")} in all` : ""}.`,
          where: "Table 1",
        }
      : { n: 15, item: "Total records", state: "needs-answer", text: "No search has been run yet.", where: "Table 1" },
  );
  prismaS.push({
    n: 16,
    item: "Deduplication",
    state: searches.length ? "reported" : "needs-answer",
    text: searches.length
      ? `Meridian merged records returned by more than one search when they shared a DOI or, without a DOI, the same normalised title and publication year; the merged record keeps a link to every search that returned it. ${plural(totals.imported, "imported record")} became ${plural(totals.fromSearches, "unique record")} (${plural(totals.merged, "duplicate")} merged).`
      : "No search has been run yet.",
    where: "Section 4",
  });

  const gaps: string[] = [];
  if (!searches.length) gaps.push("No search has been run. Run the search on the Scan page first.");
  if (failed.length) gaps.push(`${plural(failed.length, "search", "searches")} failed or were blocked (Table 3); rerun them or report why they were left out.`);
  if (exhaustive && searches.some((s) => s.found !== null && s.imported < s.found)) {
    gaps.push(
      `A ${family.label.toLowerCase()} must screen every record found, and Meridian imported only part of some results. Export the full result of each search with the rerun links in Table 2 and screen those files.`,
    );
  }
  if (exhaustive && !registries.length) {
    gaps.push(
      "No trial registry was searched. For Cochrane intervention reviews, conduct standard C27 (mandatory) requires trial registers searched through ClinicalTrials.gov and the WHO International Clinical Trials Registry Platform, where relevant to the topic.",
    );
  }
  if (exhaustive && databases.length < 2) {
    gaps.push(
      "Only one bibliographic database was searched. For Cochrane intervention reviews, conduct standard C24 (mandatory) requires CENTRAL, MEDLINE and Embase (when available). Run the searches Meridian cannot reach through your library, then add each one here with Record a search run elsewhere.",
    );
  }
  if (searches.some((s) => s.performedBy !== "app")) gaps.push("Some searches were run outside Meridian (Table 2 says which); keep each original export with its date as evidence.");
  if (searches.some((s) => s.provider === "fixture")) gaps.push("This study holds recorded test data, not live searches; this report cannot be used for a publication.");
  const unanswered = prismaS.filter((row) => row.state === "needs-answer" && searches.length && LOG_ITEM[row.n]);
  if (unanswered.length) gaps.push(`Answer the questions in Section 5 still marked Not answered yet (PRISMA-S ${unanswered.length === 1 ? "item" : "items"} ${listJoin(unanswered.map((r) => String(r.n)))}).`);
  if (prismaS[8]?.state === "needs-answer" && searches.length) gaps.push("Say why each restriction written into the strategies was used (PRISMA-S item 9).");

  const methods = methodsParagraph({ searches, databases, registries, limitsFound, limitsWhy, importSentence, totals, log, otherSources });

  return {
    studyId: study.id,
    studyTitle: study.title,
    familyLabel: family.label,
    exhaustive,
    preparedAt: now,
    preparedDate: longDate(now),
    searches,
    failed,
    sources,
    totals,
    identity,
    otherSources,
    log,
    prismaS,
    methods,
    gaps,
  };
}

/** The methods paragraph for the manuscript: facts from the record and the investigator's answers; a missing answer stays in [square brackets]. */
function methodsParagraph(x: {
  searches: SearchEntry[];
  databases: SourceRow[];
  registries: SourceRow[];
  limitsFound: string[];
  limitsWhy?: string;
  importSentence: string;
  totals: SearchReport["totals"];
  log: Partial<Record<SearchLogKey, SearchLogEntry>>;
  otherSources: SearchReport["otherSources"];
}): string {
  if (!x.searches.length) return "";
  const label = (row: SourceRow) =>
    row.provider === "pubmed" ? "PubMed (which includes MEDLINE)" : row.provider === EXTERNAL_PROVIDER ? `${row.source}${row.via && !/^run outside/.test(row.via) ? ` (${row.via})` : ""}` : row.source;
  const names = [...x.databases.map(label), ...x.registries.map((r) => `the ${label(r)} registry`)];
  const first = x.searches[0].date;
  const last = x.searches[x.searches.length - 1].date;
  const when = first === last ? `on ${first}` : `from ${first} to ${last}`;
  const parts: string[] = [];
  parts.push(`We searched ${listJoin(names)} ${when}.`);
  parts.push("The full strategies, exactly as run, with the date and the number of records each search returned, are given in the supplementary search report.");
  if (x.limitsFound.length) {
    parts.push(`The strategies restricted results by ${listJoin(x.limitsFound)}.`);
    parts.push(x.limitsWhy ? sentence(x.limitsWhy) : "[State why each restriction was used.]");
  } else {
    parts.push("We applied no language, date or publication-type limits.");
  }
  if (x.searches.length === 1) {
    if (x.searches[0].found !== null) parts.push(`The search returned ${plural(x.searches[0].found, "record")}.`);
  } else if (x.totals.found !== null) {
    parts.push(`The searches returned ${plural(x.totals.found, "record")} in all.`);
  }
  const filters = answered(x.log, "filters");
  if (x.log.filters?.answer === "yes" && filters) parts.push(filters);
  for (const key of ["priorWork", "browsing", "citations", "contacts", "otherMethods", "updates"] as SearchLogKey[]) {
    if (x.log[key]?.answer === "yes") {
      const said = answered(x.log, key);
      if (said) parts.push(said);
    }
  }
  parts.push(answered(x.log, "peerReview") ?? "[State whether the strategies were peer reviewed, by whom and with which checklist.]");
  if (x.searches.length > 1) {
    parts.push(
      `Records returned by more than one search were merged when they shared a DOI or, without a DOI, the same normalised title and publication year (${plural(x.totals.merged, "duplicate")} merged).`,
    );
  }
  if (x.otherSources.modelOnly) {
    parts.push(
      `A large language model${x.otherSources.models.length ? ` (${x.otherSources.models.join(", ")})` : ""} also suggested ${plural(x.otherSources.modelOnly, "record")}; these were kept apart from the search results, and ${n(x.otherSources.modelOnlyVerified)} ${x.otherSources.modelOnlyVerified === 1 ? "was" : "were"} confirmed to exist by an identity check.`,
    );
  }
  parts.push("The searches were run and recorded with Meridian Research Studio, which stored the date, the strategy as sent, the source's response and the records returned for each search.");
  return parts.join(" ");
}

/* ------------------------------------------------------------------------------------------------ */
/* Document model: one structure rendered as plain text (copy) and as Word (.docx)                    */
/* ------------------------------------------------------------------------------------------------ */

export type ReportBlock =
  | { kind: "heading"; text: string }
  | { kind: "para"; text: string; note?: boolean }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbered"; items: string[] }
  /** `widths` are relative column weights (the Word file turns them into fixed widths). */
  | { kind: "table"; caption: string; head: string[]; rows: string[][]; widths?: number[] }
  /** Label and value pairs; `mono` values are strategies or requests, shown in a fixed-width font and never rewrapped. */
  | { kind: "fields"; title: string; rows: { label: string; value: string; mono?: boolean }[] };

export interface ReportDocument {
  title: string;
  subtitle: string[];
  blocks: ReportBlock[];
}

const STATE_LABEL: Record<PrismaSState, string> = { reported: "Reported", "not-applicable": "Not applicable", "needs-answer": "Not answered yet" };

function runBy(s: SearchEntry): string {
  if (s.performedBy === "app") return "Meridian Research Studio";
  if (s.performedBy === "connector") return "a Claude connector session, outside Meridian";
  return "the investigator, outside Meridian";
}

export function searchReportDocument(r: SearchReport): ReportDocument {
  const blocks: ReportBlock[] = [];
  const h = (text: string) => blocks.push({ kind: "heading", text });
  const p = (text: string, note = false) => blocks.push({ kind: "para", text, note });

  h("1. Search methods (text for the manuscript)");
  p(r.methods || "No search has been run yet.");
  if (/\[[^\]]+\]/.test(r.methods)) p("Text in square brackets needs your answer (Section 5) before it can go into the manuscript.", true);

  h("2. Sources searched");
  blocks.push({
    kind: "table",
    caption: "Table 1. Sources searched",
    head: ["Source", "Route", "Searches", "Date of last search", "Records found", "Records imported"],
    widths: [22, 24, 11, 15, 13, 15],
    rows: r.sources.length
      ? r.sources.map((s) => [
          `${s.source}${s.owner ? ` (${s.owner})` : ""}${s.kind === "registry" ? ", study registry" : ""}`,
          s.via,
          String(s.searches),
          s.lastDate,
          s.found === null ? "not reported" : n(s.found),
          s.provider === EXTERNAL_PROVIDER ? "none (run elsewhere)" : n(s.imported),
        ])
      : [["No source searched yet", "", "", "", "", ""]],
  });
  if (r.sources.length > 1 && r.totals.found !== null) p(`Records found in all sources: ${n(r.totals.found)}. Counts are the latest run of each strategy; records found by two strategies are counted twice here and merged among imported records (Section 4).`, true);

  h("3. Search strategies, exactly as run");
  if (!r.searches.length) p("No search has been run yet.");
  for (const s of r.searches) {
    const rows: { label: string; value: string; mono?: boolean }[] = [
      { label: "Source", value: `${s.source}${s.owner ? ` (${s.owner})` : ""}` },
      { label: "Date and time", value: `${s.date}, ${s.time}` },
      { label: "Route", value: s.via },
      { label: "Run by", value: runBy(s) },
    ];
    if (s.sent === s.entered && s.sentRecorded) {
      rows.push({ label: "Strategy, exactly as sent", value: s.sent, mono: true });
    } else {
      rows.push({ label: "Strategy as entered", value: s.entered, mono: true });
      rows.push({ label: s.sentRecorded ? "Strategy as sent" : "Strategy as sent (rebuilt from the one entered)", value: s.sent, mono: true });
    }
    if (s.translation) rows.push({ label: "PubMed's reading of the strategy", value: s.translation, mono: true });
    rows.push({ label: "Records found", value: s.found === null ? "not reported" : n(s.found) });
    if (s.performedBy !== "manual") {
      rows.push({ label: "Records imported into Meridian", value: `${n(s.imported)}${s.importCap ? ` (at most ${s.importCap} per search)` : ""}` });
      rows.push({ label: "Order of the records", value: s.order });
    }
    if (s.reproduceUrl) rows.push({ label: "Rerun this search", value: s.reproduceUrl, mono: true });
    if (s.asOfStrategy) rows.push({ label: "Same records as on the search date (PubMed, entry date limit)", value: s.asOfStrategy, mono: true });
    for (const q of s.requests) rows.push({ label: "Request sent", value: q, mono: true });
    if (s.note && s.performedBy === "manual") rows.push({ label: "Note", value: s.note });
    blocks.push({ kind: "fields", title: `Search ${s.n}. ${s.source}, ${s.date}`, rows });
  }
  if (r.failed.length) {
    blocks.push({
      kind: "table",
      caption: "Table 2. Searches that failed or were blocked",
      head: ["No.", "Source", "Date", "Result", "Reason"],
      widths: [8, 16, 18, 11, 47],
      rows: r.failed.map((s) => [String(s.n), s.source, `${s.date}, ${s.time}`, s.status, s.note ?? "not recorded"]),
    });
  }

  h("4. Records, limits and duplicates");
  const limitRow = r.prismaS.find((x) => x.n === 9);
  if (limitRow) p(limitRow.text);
  const dedupRow = r.prismaS.find((x) => x.n === 16);
  if (dedupRow && r.searches.length) p(dedupRow.text);
  if (r.totals.inMoreThanOne) p(`${plural(r.totals.inMoreThanOne, "record")} ${r.totals.inMoreThanOne === 1 ? "was" : "were"} returned by more than one search.`);
  if (r.identity.checked) {
    p(
      `Record identity checks by DOI (${listJoin(r.identity.providers.map((x) => (x === "pubmed" ? "PubMed" : x === "crossref" ? "Crossref" : x)))}): ${n(r.identity.checked)} checked; ${n(r.identity.verified)} matched the record, ${n(r.identity.mismatch)} did not match, ${n(r.identity.notFound)} were not found and ${n(r.identity.failed)} could not be checked.`,
    );
  }
  const hints = r.sources.filter((s) => s.exportHint && s.found !== null && s.imported < s.found);
  if (hints.length) p(`To screen every record found: ${hints.map((s) => s.exportHint).join(" ")}`, true);

  h("5. Other search methods");
  blocks.push({
    kind: "table",
    caption: "Table 3. Other search methods and checks",
    head: ["PRISMA-S item", "Question", "Answer"],
    widths: [22, 36, 42],
    rows: SEARCH_QUESTIONS.map((q) => [`${q.item}. ${q.label}`, q.ask, answered(r.log, q.key) ?? "Not answered yet"]),
  });
  if (r.log.searcher?.detail) p(`Searches designed and run by: ${r.log.searcher.detail}`);
  const other = r.prismaS.find((x) => x.n === 7);
  if (other && (r.otherSources.modelOnly || r.otherSources.investigatorOnly)) {
    const auto = [
      r.otherSources.modelOnly
        ? `A language model${r.otherSources.models.length ? ` (${r.otherSources.models.join(", ")})` : ""} suggested ${plural(r.otherSources.modelOnly, "record")} that no search returned; ${n(r.otherSources.modelOnlyVerified)} of them ${r.otherSources.modelOnlyVerified === 1 ? "was" : "were"} confirmed to exist by an identity check.`
        : "",
      r.otherSources.investigatorOnly ? `${plural(r.otherSources.investigatorOnly, "record")} ${r.otherSources.investigatorOnly === 1 ? "was" : "were"} added by the investigator without a search.` : "",
    ].filter(Boolean);
    p(auto.join(" "));
  }

  h("6. Automated checks of the strategies");
  p("Meridian checks each strategy against the six elements of the PRESS 2015 guideline. These are prompts for a person; they are not a peer review.", true);
  const flagged = r.searches.flatMap((s) => s.checks.map((c) => `Search ${s.n} (${s.source}), ${c.element.toLowerCase()}: ${c.text}`));
  blocks.push({ kind: "bullets", items: flagged.length ? flagged : ["No problem found by the automated checks."] });

  h("7. PRISMA-S checklist");
  blocks.push({
    kind: "table",
    caption: "Table 4. PRISMA-S checklist",
    head: ["No.", "Topic", "Status", "Reported as", "Where"],
    widths: [7, 18, 15, 48, 12],
    rows: r.prismaS.map((row) => [String(row.n), row.item, STATE_LABEL[row.state], row.text, row.where]),
  });

  if (r.gaps.length) {
    h("Open items for the authors (not part of the supplement)");
    blocks.push({ kind: "bullets", items: r.gaps });
  }

  h("References");
  blocks.push({ kind: "numbered", items: [PRISMA_S_REFERENCE, PRESS_REFERENCE] });

  const doc: ReportDocument = {
    title: "Literature search report",
    subtitle: [r.studyTitle, `Study type: ${r.familyLabel}`, `Prepared on ${r.preparedDate} from the searches recorded in Meridian Research Studio`],
    blocks,
  };
  const abbreviations = abbreviationsUsed(doc);
  if (abbreviations) doc.blocks.unshift({ kind: "para", text: abbreviations, note: true });
  return doc;
}

/** Abbreviations the document uses, expanded once at the top (journal style). */
const ABBREVIATIONS: [string, string][] = [
  ["API", "application programming interface"],
  ["CENTRAL", "Cochrane Central Register of Controlled Trials"],
  ["DOI", "digital object identifier"],
  ["ICTRP", "International Clinical Trials Registry Platform"],
  ["MeSH", "Medical Subject Headings"],
  ["NCBI", "National Center for Biotechnology Information"],
  ["PRESS", "Peer Review of Electronic Search Strategies"],
  ["PRISMA-S", "Preferred Reporting Items for Systematic reviews and Meta-Analyses literature search extension"],
  ["WHO", "World Health Organization"],
];

function abbreviationsUsed(doc: ReportDocument): string {
  const all = [doc.title, ...doc.subtitle, ...doc.blocks.map((b) => JSON.stringify(b))].join(" ");
  const used = ABBREVIATIONS.filter(([a]) => new RegExp(`(^|[^A-Za-z-])${a.replace(/-/g, "\\-")}([^A-Za-z]|$)`).test(all));
  return used.length ? `Abbreviations: ${used.map(([a, full]) => `${a}, ${full}`).join("; ")}.` : "";
}

/** Plain text of the report document (copy to clipboard, tests). */
export function reportDocumentText(doc: ReportDocument): string {
  const out: string[] = [doc.title, ...doc.subtitle, ""];
  for (const b of doc.blocks) {
    if (b.kind === "heading") out.push("", b.text);
    else if (b.kind === "para") out.push(b.text);
    else if (b.kind === "bullets") for (const i of b.items) out.push(`- ${i}`);
    else if (b.kind === "numbered") b.items.forEach((i, k) => out.push(`${k + 1}. ${i}`));
    else if (b.kind === "table") {
      out.push(b.caption);
      out.push(b.head.join(" | "));
      for (const row of b.rows) out.push(row.join(" | "));
    } else if (b.kind === "fields") {
      out.push(b.title);
      for (const row of b.rows) out.push(`  ${row.label}: ${row.value}`);
    }
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

export function searchReportText(r: SearchReport): string {
  return reportDocumentText(searchReportDocument(r));
}
