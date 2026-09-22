import type { EvidenceItem } from "../types";
import { normalizeDoi, titleYearKey } from "./identifiers";

/**
 * Link multiple reports of the same work (same DOI, or same normalised title and year) with a
 * shared `provenance.groupId`, so counts and syntheses do not double-count. Records are kept; only
 * the group id is added.
 */
export function linkReports(items: EvidenceItem[]): { items: EvidenceItem[]; groups: Map<string, string[]> } {
  const keyToGroup = new Map<string, string>();
  const groups = new Map<string, string[]>();
  let n = 0;
  const next = items.map((item) => {
    const doi = normalizeDoi(item.doi ?? item.provenance.identifiers.doi);
    const keys = [doi ? `doi:${doi}` : "", `ty:${titleYearKey(item.title, item.year)}`].filter(Boolean);
    let groupId = keys.map((k) => keyToGroup.get(k)).find(Boolean);
    if (!groupId) groupId = `grp-${++n}`;
    for (const k of keys) keyToGroup.set(k, groupId);
    groups.set(groupId, [...(groups.get(groupId) ?? []), item.id]);
    return { ...item, provenance: { ...item.provenance, groupId } };
  });
  return { items: next, groups };
}

/** Number of distinct works (not reports). */
export function distinctWorks(items: EvidenceItem[]): number {
  return linkReports(items).groups.size;
}

/**
 * Collapse records that are literally the same work returned by more than one search (same DOI)
 * into one EvidenceItem that remembers every retrieval event it came from. Records without a DOI
 * are left alone (title-similar reports may be distinct papers, e.g. a protocol and its trial).
 */
export function collapseIdenticalRecords(items: EvidenceItem[]): { items: EvidenceItem[]; collapsed: number } {
  const byDoi = new Map<string, EvidenceItem>();
  const out: EvidenceItem[] = [];
  let collapsed = 0;
  for (const item of items) {
    const doi = normalizeDoi(item.doi ?? item.provenance.identifiers.doi);
    if (!doi) {
      out.push(item);
      continue;
    }
    const existing = byDoi.get(doi);
    if (!existing) {
      byDoi.set(doi, item);
      out.push(item);
      continue;
    }
    collapsed++;
    existing.provenance = {
      ...existing.provenance,
      retrievalEventIds: [...new Set([...existing.provenance.retrievalEventIds, ...item.provenance.retrievalEventIds])],
    };
    if (item.abstract?.text && existing.abstract?.text && item.abstract.text !== existing.abstract.text) {
      existing.contentVersions = [...(existing.contentVersions ?? [existing.abstract]), item.abstract];
    } else if (item.abstract?.text && !existing.abstract) {
      existing.abstract = item.abstract;
    }
    if (item.notes && existing.notes && item.notes !== existing.notes) {
      existing.notes = `${existing.notes}\n---\nlater version:\n${item.notes}`;
    } else if (!existing.notes && item.notes) existing.notes = item.notes;
    if (existing.year === null && item.year !== null) existing.year = item.year;
  }
  return { items: out, collapsed };
}
