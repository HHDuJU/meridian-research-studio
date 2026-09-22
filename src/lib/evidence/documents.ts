import type { SourceDocument, StoredText } from "../types";
import { nowIso, uid } from "../utils";
import { sha256Hex } from "./hash";

const ABSTRACT_PREFIX = /^Abstract \(from [^)]+\): /;

export function abstractPrefixMatch(notes: string): { providerLabel: string; text: string } | null {
  const m = notes.match(ABSTRACT_PREFIX);
  if (!m) return null;
  return { providerLabel: m[0], text: notes.slice(m[0].length) };
}

export function makeSourceDocument(input: {
  recordId: string;
  text: string;
  retrievalEventId?: string;
  sourceScope?: SourceDocument["sourceScope"];
  shortenedAtSource?: SourceDocument["shortenedAtSource"];
  capturedAt?: string;
}): SourceDocument {
  const text = input.text;
  return {
    id: uid("doc"),
    recordId: input.recordId,
    retrievalEventId: input.retrievalEventId,
    sha256: sha256Hex(text),
    text,
    mediaType: "text/plain",
    sourceScope: input.sourceScope ?? "abstract",
    shortenedAtSource: input.shortenedAtSource ?? "unknown",
    capturedAt: input.capturedAt ?? nowIso(),
  };
}

export function storedTextOf(doc: SourceDocument): StoredText {
  return { documentId: doc.id, sha256: doc.sha256, text: doc.text };
}

export function storedTextIntact(view: StoredText | undefined, documents: SourceDocument[]): boolean {
  if (!view) return false;
  const doc = documents.find((d) => d.id === view.documentId);
  if (!doc) return false;
  return doc.sha256 === view.sha256 && doc.text === view.text && sha256Hex(doc.text) === doc.sha256;
}
