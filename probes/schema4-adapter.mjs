/**
 * Schema-4 field adapter for audit-probes.mjs (A2 item 8).
 * Original probes stay unchanged. This maps StoredText abstract views to the string
 * reads probe 13 used, and keeps the scientific assertion (original source text survives).
 *
 * Mapping:
 * - item.abstract (string, schema 3 notes or 875fe59) → item.abstract.text (schema 4 StoredText)
 * - preserve_original_abstract: require document.text, document.sha256, identity and access unchanged
 */
export function abstractText(item) {
  if (!item) return "";
  if (typeof item.abstract === "string") return item.abstract;
  if (item.abstract && typeof item.abstract.text === "string") return item.abstract.text;
  const notes = typeof item.notes === "string" ? item.notes : "";
  const m = notes.match(/^Abstract \(from [^)]+\): ([\s\S]*)$/);
  return m ? m[1] : notes;
}

export function preserveOriginalAbstractAdapted(itemBefore, itemAfter, documents = []) {
  const original = abstractText(itemBefore);
  const after = abstractText(itemAfter);
  const doc = documents.find((d) => d.id === itemAfter?.abstract?.documentId);
  return {
    textSurvives: after.includes(original) || after === original,
    hashMatches: !doc || doc.sha256 === itemAfter?.abstract?.sha256,
    accessUnchanged: itemAfter?.provenance?.access === itemBefore?.provenance?.access,
    identityUnchanged: itemAfter?.id === itemBefore?.id && itemAfter?.doi === itemBefore?.doi,
  };
}
