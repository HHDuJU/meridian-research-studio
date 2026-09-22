import type { EvidenceItem } from "../types";

/** F3 scaffolding. Live routes are coordinator-authorized; this increment does not call them. */
export const FULLTEXT_ROUTE_KINDS = ["unpaywall", "publisher-html", "library-proxy", "manual-upload"] as const;
export type FulltextRouteKind = (typeof FULLTEXT_ROUTE_KINDS)[number];

export type PublicationStatus =
  | "unknown"
  | "published"
  | "preprint"
  | "retracted"
  | "withdrawn"
  | "ahead-of-print";

export function publicationStatusFromLabel(label: string | undefined): PublicationStatus {
  const t = (label ?? "").toLowerCase();
  if (/retract/.test(t)) return "retracted";
  if (/withdraw/.test(t)) return "withdrawn";
  if (/preprint|posted-content/.test(t)) return "preprint";
  if (/ahead of print|aop/.test(t)) return "ahead-of-print";
  if (/journal-article|published/.test(t)) return "published";
  return "unknown";
}

export function treatAsFullTextRead(item: EvidenceItem, documents: { id: string; recordId: string; sourceScope: string; text: string }[] = []): boolean {
  const manifest = item.fullTextRead;
  if (!manifest?.documentId) return false;
  if (item.provenance.access !== "full-text") return false;
  const sections = Array.isArray(manifest.sections) ? manifest.sections : [];
  if (!manifest.complete || !sections.length || !sections.every((s) => s.read === true)) return false;
  if (!documents.length) return false;
  const doc = documents.find((d) => d.id === manifest.documentId);
  if (!doc || doc.recordId !== item.id) return false;
  if (doc.sourceScope !== "full-text") return false;
  if (typeof doc.text !== "string" || !doc.text.trim()) return false;
  return true;
}

