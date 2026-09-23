import type { EvidenceItem, EvidenceKind, RetrievalEvent, SourceDocument } from "../types";
import { uid } from "../utils";
import { makeSourceDocument, storedTextOf } from "./documents";
import { normalizeDoi, titleYearKey } from "./identifiers";
import { collapseIdenticalRecords } from "./dedupe";

/** Provider-neutral record shape every adapter parses into. */
export interface RawRecord {
  title: string;
  authors: string;
  year: number | null;
  venue: string;
  doi?: string;
  pmid?: string;
  openalex?: string;
  nct?: string;
  /** Provider's own type label (e.g. "review", "journal-article", "Randomized Controlled Trial"). */
  providerType?: string;
  kind?: EvidenceKind;
  abstract?: string;
  url?: string;
  /** Source-bound typed dates (epub/online vs print). Used to corroborate date variants. */
  dates?: { online?: number; print?: number; collection?: number };
  /** Publication status as the provider states it (e.g. PubMed retraction links, OpenAlex is_retracted). */
  publicationStatus?: EvidenceItem["publicationStatus"];
}

/**
 * Map a provider type label to Meridian's EvidenceKind where the mapping is safe.
 * Anything ambiguous stays "grey" — design appraisal is a human/model judgement, not a label lookup.
 */
export function kindFromProviderType(label: string | undefined): EvidenceKind {
  const t = (label ?? "").toLowerCase();
  if (!t) return "grey";
  if (/systematic review|meta-analysis|^review$/.test(t)) return "systematic-review";
  if (/randomi[sz]ed|clinical trial, phase|^rct$/.test(t)) return "rct";
  if (/guideline|practice guideline/.test(t)) return "guideline";
  if (/preprint|posted-content/.test(t)) return "preprint";
  if (/registry|registration/.test(t)) return "trial-registry";
  if (/observational|cohort|case-control|cross-sectional|retrospective/.test(t)) return "observational";
  if (/qualitative|interview/.test(t)) return "qualitative";
  return "grey";
}

/**
 * Stable, content-derived record id: the same work gets the same id in every session, so
 * annotations, claims and decisions keep pointing at it after re-ingestion. FNV-1a over the DOI
 * (or normalised title+year when there is no DOI); collisions are practically irrelevant at
 * study scale and are detectable because two items would share an id.
 */
export function stableRecordId(r: Pick<RawRecord, "doi" | "title" | "year"> & { nct?: string }): string {
  const nct = typeof r.nct === "string" && /^NCT\d{8}$/i.test(r.nct.trim()) ? `nct:${r.nct.trim().toUpperCase()}` : undefined;
  const key = normalizeDoi(r.doi) ?? nct ?? titleYearKey(r.title, r.year);
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `ev-${h.toString(36).padStart(7, "0")}`;
}

/** Turn retrieved records into EvidenceItems with retrieval provenance and immutable abstracts. */
export function ingestRecords(
  records: RawRecord[],
  event: Pick<RetrievalEvent, "id" | "provider">,
  idFor: (r: RawRecord) => string = stableRecordId,
): { items: EvidenceItem[]; documents: SourceDocument[] } {
  const documents: SourceDocument[] = [];
  const items = records.map((r) => {
    const doi = normalizeDoi(r.doi);
    const id = idFor(r) || uid("ev");
    let abstract: EvidenceItem["abstract"];
    if (r.abstract) {
      const doc = makeSourceDocument({
        recordId: id,
        text: r.abstract,
        retrievalEventId: event.id,
        sourceScope: "abstract",
        shortenedAtSource: "unknown",
      });
      documents.push(doc);
      abstract = storedTextOf(doc);
    }
    return {
      id,
      title: r.title,
      authors: r.authors,
      year: r.year,
      source: r.venue,
      kind: r.kind ?? kindFromProviderType(r.providerType),
      grade: "unrated" as const,
      methodQuality: null,
      relevance: null,
      notes: "",
      abstract,
      verification: "verify" as const,
      doi,
      pmid: r.pmid,
      ...(r.publicationStatus && r.publicationStatus !== "unknown" ? { publicationStatus: r.publicationStatus } : {}),
      contextTags: [],
      keyFindings: "",
      limitations: "",
      provenance: {
        origin: "retrieval" as const,
        retrievalEventIds: [event.id],
        identifiers: {
          ...(doi ? { doi } : {}),
          ...(r.pmid ? { pmid: r.pmid } : {}),
          ...(r.openalex ? { openalex: r.openalex } : {}),
          ...(r.nct ? { nct: r.nct } : {}),
        },
        access: (r.abstract ? "abstract" : "metadata") as EvidenceItem["provenance"]["access"],
        status: "retrieved" as const,
        checks: [],
      },
    };
  });
  return { items: flagSuspectContentPairing(items), documents };
}

/** Keep the first id when a later ingest adds a DOI; record the DOI-derived id as an alias. */
export function retainIdOnCorrection(
  existing: EvidenceItem,
  incoming: RawRecord,
): { id: string; aliases: Record<string, string> } {
  const doiId = stableRecordId({ doi: incoming.doi, title: incoming.title, year: incoming.year });
  const aliases: Record<string, string> = {};
  if (doiId !== existing.id) aliases[doiId] = existing.id;
  return { id: existing.id, aliases };
}

/** Match incoming records to existing ones by id, then DOI, then title+year. Keep the first id. */
export function mergeIngested(
  existing: EvidenceItem[],
  incoming: EvidenceItem[],
  aliases: Record<string, string> = {},
): { items: EvidenceItem[]; aliases: Record<string, string> } {
  const nextAliases = { ...aliases };
  const cloned: EvidenceItem[] = existing.map((i) => ({
    ...i,
    provenance: {
      ...i.provenance,
      retrievalEventIds: [...i.provenance.retrievalEventIds],
      identifiers: { ...i.provenance.identifiers },
      checks: [...(i.provenance.checks ?? [])],
    },
    contentVersions: i.contentVersions ? [...i.contentVersions] : undefined,
  }));
  const byId = new Map(cloned.map((i) => [i.id, i]));

  function findMatch(item: EvidenceItem): EvidenceItem | undefined {
    const mapped = nextAliases[item.id];
    if (byId.has(item.id)) return byId.get(item.id);
    if (mapped && byId.has(mapped)) return byId.get(mapped);
    const doi = normalizeDoi(item.doi ?? item.provenance.identifiers.doi);
    if (doi) {
      const hit = cloned.find((e) => normalizeDoi(e.doi ?? e.provenance.identifiers.doi) === doi);
      if (hit) return hit;
    }
    const ty = titleYearKey(item.title, item.year);
    return cloned.find((e) => !normalizeDoi(e.doi ?? e.provenance.identifiers.doi) && titleYearKey(e.title, e.year) === ty);
  }

  for (const item of incoming) {
    const match = findMatch(item);
    if (match) {
      const { aliases: extra } = retainIdOnCorrection(match, {
        title: item.title,
        authors: item.authors,
        year: item.year,
        venue: item.source,
        doi: item.doi ?? item.provenance.identifiers.doi,
      });
      Object.assign(nextAliases, extra);
      if (item.id !== match.id) nextAliases[item.id] = match.id;
      match.provenance.retrievalEventIds = [...new Set([...match.provenance.retrievalEventIds, ...item.provenance.retrievalEventIds])];
      if (item.abstract?.text && match.abstract?.text && item.abstract.text !== match.abstract.text) {
        match.contentVersions = [...(match.contentVersions ?? [match.abstract]), item.abstract];
      } else if (item.abstract?.text && !match.abstract) {
        match.abstract = item.abstract;
      }
      if (!match.doi && item.doi) match.doi = item.doi;
      if (!match.pmid && item.pmid) match.pmid = item.pmid;
    } else {
      cloned.push(item);
      byId.set(item.id, item);
    }
  }
  const collapsed = collapseIdenticalRecords(cloned);
  return { items: flagSuspectContentPairing(collapsed.items), aliases: nextAliases };
}

export function flagSuspectContentPairing(items: EvidenceItem[]): EvidenceItem[] {
  const next = items.map((i) => ({ ...i }));
  for (let a = 0; a < next.length; a++) {
    for (let b = a + 1; b < next.length; b++) {
      const ta = next[a].abstract?.text ?? "";
      const tb = next[b].abstract?.text ?? "";
      if (ta.length < 80 || tb.length < 80) continue;
      if (ta !== tb) continue;
      const doiA = normalizeDoi(next[a].doi ?? next[a].provenance.identifiers.doi);
      const doiB = normalizeDoi(next[b].doi ?? next[b].provenance.identifiers.doi);
      if (doiA && doiB && doiA !== doiB) {
        next[a] = { ...next[a], pairingIssue: "suspect-content-pairing" };
        next[b] = { ...next[b], pairingIssue: "suspect-content-pairing" };
      }
    }
  }
  return next;
}
