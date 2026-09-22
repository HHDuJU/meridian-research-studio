import type { CheckProvider, EvidenceItem, SourceCheck } from "../types";
import { uid, nowIso } from "../utils";
import type { Transport, TransportRequest } from "./transport";
import type { RawRecord } from "./records";
import { normalizeDoi, titleSimilarity, titlesExactlyEquivalent, unicodeTitleKey } from "./identifiers";

/**
 * Identity verification against a bibliographic registry.
 *
 * "verified" is awarded only when a lookup returned the DOI and the returned title/year agree with
 * the record. Everything else is recorded as what it is: mismatch (the DOI points at a different
 * work), not-found, blocked or error. No confidence, label or prose can set "verified".
 */

export interface LookupAdapter {
  provider: CheckProvider;
  buildLookup: (dois: string[]) => TransportRequest;
  parseLookup: (body: string) => { total: number | null; records: RawRecord[] };
}

export const TITLE_MATCH_THRESHOLD = 0.72;

export type Comparison = "match" | "mismatch" | "unresolved";

export interface DateVariant {
  recordYear: number;
  registryYears: number[];
  corroborated: boolean;
}

function polarity(title: string): 1 | -1 {
  return /\b(does not|do not|did not|not prevent|not reduce|no effect)\b/i.test(title) ? -1 : 1;
}

function typedYears(found: RawRecord): number[] {
  const d = found.dates;
  const years = [found.year, d?.online, d?.print, d?.collection].filter((y): y is number => typeof y === "number");
  return [...new Set(years)];
}

function datesCorroborate(itemYear: number, found: RawRecord): boolean {
  if (!found.dates) return false;
  return typedYears(found).includes(itemYear);
}

/** Deterministic comparison of a record with what the registry returned for its DOI. */
export function compareWithRegistry(
  item: Pick<EvidenceItem, "title" | "year" | "doi">,
  found: RawRecord,
): {
  result: Comparison;
  similarity: number;
  yearAgrees: boolean | null;
  yearOffByOne: boolean;
  dateVariant?: DateVariant;
  informative: boolean;
} {
  const similarity = titleSimilarity(item.title, found.title);
  const yearAgrees = item.year === null || found.year === null ? null : item.year === found.year;
  const yearOffByOne = item.year !== null && found.year !== null && Math.abs(item.year - found.year) === 1;
  const opposite = polarity(item.title) !== polarity(found.title) && similarity >= 0.3;
  const titleExact = titlesExactlyEquivalent(item.title, found.title);
  const informative = !!(unicodeTitleKey(item.title) && unicodeTitleKey(found.title));
  const doiExact = !!(normalizeDoi(item.doi) && found.doi && normalizeDoi(item.doi) === normalizeDoi(found.doi));
  const yearDiffers = item.year !== null && found.year !== null && item.year !== found.year;
  const corroborated = yearDiffers && item.year !== null && datesCorroborate(item.year, found);
  const dateVariant: DateVariant | undefined =
    yearDiffers && (doiExact || titleExact) && corroborated
      ? { recordYear: item.year as number, registryYears: typedYears(found), corroborated: true }
      : yearDiffers && (doiExact || titleExact)
        ? { recordYear: item.year as number, registryYears: [found.year as number], corroborated: false }
        : undefined;
  const titleOk = titleExact || (similarity >= TITLE_MATCH_THRESHOLD && !opposite && informative);
  let result: Comparison;
  if (!informative || !titleOk) {
    result = "mismatch";
  } else if (yearAgrees === true || (dateVariant && dateVariant.corroborated)) {
    result = "match";
  } else if (yearAgrees === null || (dateVariant && !dateVariant.corroborated) || yearOffByOne) {
    result = "unresolved";
  } else {
    result = "mismatch";
  }
  return { result, similarity, yearAgrees, yearOffByOne, dateVariant, informative };
}

export interface LookupOutcome {
  /** "ok" when the registry answered; "blocked"/"error" otherwise. */
  status: "ok" | "blocked" | "error";
  records: RawRecord[];
  note?: string;
}

/**
 * Apply the outcome of a DOI lookup to the items whose DOIs were requested. Pure, so a recorded
 * real registry response can be applied in a fixed-packet trial exactly as a live one would be.
 */
export function applyLookupOutcome(
  items: EvidenceItem[],
  requestedDois: string[],
  provider: CheckProvider,
  outcome: LookupOutcome,
  at: string = nowIso(),
): { items: EvidenceItem[]; checks: SourceCheck[] } {
  const requested = new Set(requestedDois.map((d) => normalizeDoi(d)).filter(Boolean));
  const byDoi = new Map<string, RawRecord>();
  for (const r of outcome.records) if (r.doi) byDoi.set(r.doi, r);
  const checks: SourceCheck[] = [];
  const next = items.map((item) => {
    const doi = normalizeDoi(item.doi ?? item.provenance.identifiers.doi);
    if (!doi || !requested.has(doi)) return item;
    let check: SourceCheck;
    let status = item.provenance.status;
    if (outcome.status !== "ok") {
      const retainMismatch = item.provenance.status === "mismatch";
      check = {
        id: uid("chk"),
        at,
        provider,
        identifier: doi,
        result: outcome.status === "blocked" ? "blocked" : "error",
        note: retainMismatch
          ? `${outcome.note ?? outcome.status}; earlier mismatch retained`
          : outcome.note,
      };
      status = retainMismatch ? "mismatch" : "check-failed";
    } else {
      const found = byDoi.get(doi);
      if (!found) {
        check = { id: uid("chk"), at, provider, identifier: doi, result: "not-found", note: "DOI not present in registry response" };
        // Not found is not proof of nonexistence (registry lag, typo); the record stays unverified.
        status = item.provenance.status === "retrieved" ? "retrieved" : "unverified";
      } else {
        const cmp = compareWithRegistry(item, found);
        const yearNote =
          cmp.yearAgrees === null
            ? "not comparable"
            : cmp.yearAgrees
              ? "agrees"
              : cmp.yearOffByOne
                ? "differs"
                : "disagrees";
        const dateNote =
          cmp.dateVariant?.corroborated
            ? `; date variant corroborated (record ${cmp.dateVariant.recordYear}, registry ${cmp.dateVariant.registryYears.join(",")})`
            : cmp.dateVariant
              ? `; year differs without typed-date evidence (record ${cmp.dateVariant.recordYear}, registry ${cmp.dateVariant.registryYears.join(",")})`
              : "";
        check = {
          id: uid("chk"),
          at,
          provider,
          identifier: doi,
          result: cmp.result === "match" ? "match" : cmp.result === "unresolved" ? "unresolved" : "mismatch",
          observed: { title: found.title, year: found.year, venue: found.venue },
          note: `title similarity ${cmp.similarity.toFixed(2)}; year ${yearNote}${dateNote}`,
        };
        status =
          cmp.result === "match"
            ? "verified"
            : cmp.result === "unresolved"
              ? item.provenance.status === "mismatch"
                ? "mismatch"
                : item.provenance.status === "retrieved" || item.provenance.status === "verified"
                  ? "retrieved"
                  : item.provenance.status
              : "mismatch";
      }
    }
    checks.push(check);
    const pmid = found_pmid(byDoi.get(doi));
    return {
      ...item,
      provenance: {
        ...item.provenance,
        status,
        checks: [...item.provenance.checks, check],
        identifiers: { ...item.provenance.identifiers, doi, ...(pmid ? { pmid } : {}) },
      },
      ...(pmid && !item.pmid ? { pmid } : {}),
    };
  });
  return { items: next, checks };
}

function found_pmid(r: RawRecord | undefined): string | undefined {
  return r?.pmid;
}

/** Live path: batch the DOIs, call the registry, apply the outcome. Not exercised in the sandbox. */
export async function verifyByDoi(
  items: EvidenceItem[],
  adapter: LookupAdapter,
  transport: Transport,
  batchSize = 20,
): Promise<{ items: EvidenceItem[]; checks: SourceCheck[]; requests: TransportRequest[] }> {
  const dois = [...new Set(items.map((i) => normalizeDoi(i.doi ?? i.provenance.identifiers.doi)).filter((d): d is string => !!d))];
  let current = items;
  const checks: SourceCheck[] = [];
  const requests: TransportRequest[] = [];
  for (let i = 0; i < dois.length; i += batchSize) {
    const batch = dois.slice(i, i + batchSize);
    const req = adapter.buildLookup(batch);
    requests.push(req);
    const res = await transport(req);
    let outcome: LookupOutcome;
    if (res.status === 0 || res.status === 403 || res.status === 407 || res.status === 451) {
      outcome = { status: "blocked", records: [], note: res.note ?? `HTTP ${res.status}` };
    } else if (res.status < 200 || res.status >= 300) {
      outcome = { status: "error", records: [], note: `HTTP ${res.status}` };
    } else {
      try {
        outcome = { status: "ok", records: adapter.parseLookup(res.body).records };
      } catch (err) {
        outcome = { status: "error", records: [], note: `parse failure: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    const applied = applyLookupOutcome(current, batch, adapter.provider, outcome);
    current = applied.items;
    checks.push(...applied.checks);
  }
  return { items: current, checks, requests };
}

export interface VerificationSummary {
  total: number;
  withDoi: number;
  verified: number;
  mismatch: number;
  notFound: number;
  checkFailed: number;
  unverifiedNoIdentifier: number;
}

export function summarizeVerification(items: EvidenceItem[]): VerificationSummary {
  const s: VerificationSummary = { total: items.length, withDoi: 0, verified: 0, mismatch: 0, notFound: 0, checkFailed: 0, unverifiedNoIdentifier: 0 };
  for (const i of items) {
    const doi = i.doi ?? i.provenance.identifiers.doi;
    if (doi) s.withDoi++;
    else if (!i.provenance.identifiers.pmid) s.unverifiedNoIdentifier++;
    if (i.provenance.status === "verified") s.verified++;
    if (i.provenance.status === "mismatch") s.mismatch++;
    if (i.provenance.status === "check-failed") s.checkFailed++;
    if (i.provenance.checks.some((c) => c.result === "not-found") && i.provenance.status !== "verified") s.notFound++;
  }
  return s;
}
