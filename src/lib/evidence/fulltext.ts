import type { EvidenceItem, SourceDocument } from "../types";
import { makeSourceDocument } from "./documents";
import { nowIso } from "../utils";
import { treatAsFullTextRead } from "./access";

export { treatAsFullTextRead };

function sectionsFromBody(text: string): { id: string; heading?: string; read: boolean }[] {
  const out: { id: string; heading?: string; read: boolean }[] = [];
  const re = /<sec\b([^>]*)>([\s\S]*?)(?=<sec\b|<\/sec>)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const attrs = m[1] ?? "";
    const inner = m[2] ?? "";
    const id = /\bid\s*=\s*['"]([^'"]+)['"]/i.exec(attrs)?.[1] ?? `sec-${out.length + 1}`;
    const heading = /<title>([^<]*)<\/title>/i.exec(inner)?.[1];
    out.push({ id, heading, read: false });
  }
  if (!out.length && text.trim()) out.push({ id: "body", read: false });
  return out;
}

/** A URL, OA flag or metadata link is not a full-text read. */
export function linkIsNotFullTextRead(item: EvidenceItem, _fullTextUrl?: string): boolean {
  return treatAsFullTextRead(item) === false;
}

export function recordFailedFullTextFetch(item: EvidenceItem, note: string, at = nowIso()): EvidenceItem {
  return {
    ...item,
    provenance: {
      ...item.provenance,
      access: item.provenance.access === "full-text" ? "abstract" : item.provenance.access,
      status:
        item.provenance.status === "verified" || item.provenance.status === "retrieved" || item.provenance.status === "mismatch"
          ? item.provenance.status
          : "access-blocked",
    },
    fullTextAccess: { ok: false, note, at },
  };
}

export function putFullTextBody(
  item: EvidenceItem,
  text: string,
  opts: { mediaType?: string; retrievalEventId?: string } = {},
): { item: EvidenceItem; document: SourceDocument } {
  const document = makeSourceDocument({
    recordId: item.id,
    text,
    retrievalEventId: opts.retrievalEventId,
    sourceScope: "full-text",
    shortenedAtSource: false,
  });
  if (opts.mediaType) document.mediaType = opts.mediaType;
  const sections = sectionsFromBody(text);
  return {
    document,
    item: {
      ...item,
      fullTextAccess: { ok: true, route: "store-put", at: document.capturedAt },
      fullTextRead: {
        documentId: document.id,
        sections,
        complete: false,
        at: document.capturedAt,
      },
    },
  };
}

export function recordSectionRead(
  item: EvidenceItem,
  document: SourceDocument,
  sections: { id: string; heading?: string }[],
): EvidenceItem {
  const previous = item.fullTextRead?.sections?.length
    ? item.fullTextRead.sections.map((s) => ({ ...s }))
    : sectionsFromBody(document.text);
  const byId = new Map(previous.map((s) => [s.id, s]));
  for (const s of sections) {
    const cur = byId.get(s.id) ?? { id: s.id, heading: s.heading, read: false };
    byId.set(s.id, { ...cur, heading: s.heading ?? cur.heading, read: true });
  }
  const listed = [...byId.values()];
  const complete = listed.length > 0 && listed.every((s) => s.read) && document.sourceScope === "full-text" && !!document.text;
  return {
    ...item,
    provenance: complete ? { ...item.provenance, access: "full-text" } : item.provenance,
    fullTextRead: {
      documentId: document.id,
      sections: listed,
      complete,
      at: nowIso(),
    },
  };
}
