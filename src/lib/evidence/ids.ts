import type { Study } from "../types";
import { isRecord } from "../contracts";

const ID_RE = /\b((?:ev|claim|doc|unk|local|dec|gate|crit)-[a-z0-9-]*\d[a-z0-9-]*)\b/gi;

/** "Dec-2019" and "Dec-19" in prose are dates, not decision ids (uid() suffixes are 8 characters). */
function isMonthYear(id: string): boolean {
  return /^dec-(?:\d{2}|\d{4})$/i.test(id);
}

export interface IdHit {
  path: string;
  id: string;
  kind: "active" | "quoted-source";
  known: boolean;
}

export function knownIds(study: Study): Set<string> {
  const ids = new Set<string>();
  const add = (id?: string) => {
    if (id) ids.add(id);
  };
  for (const i of study.scan.items) {
    add(i.id);
    add(i.provenance.groupId);
    for (const c of i.provenance.checks ?? []) add(c.id);
  }
  for (const c of study.scan.claims ?? []) add(c.id);
  for (const e of study.scan.retrievalEvents ?? []) add(e.id);
  for (const d of study.documents ?? []) add(d.id);
  for (const g of study.gaps.items ?? []) add(g.id);
  for (const h of study.hypotheses.items ?? []) add(h.id);
  for (const q of study.questions.items ?? []) add(q.id);
  for (const n of study.map.nodes ?? []) add(n.id);
  for (const d of study.design.decisions ?? []) {
    add(d.id);
    for (const c of d.criteria ?? []) add(c.id);
    for (const g of d.gates ?? []) add(g.id);
  }
  for (const o of study.protocol.outcomes ?? []) add(o.id);
  for (const b of study.protocol.biasFlags ?? []) add(b.id);
  for (const v of study.voices.items ?? []) add(v.id);
  for (const a of study.audit.entries ?? []) add(a.id);
  for (const [from, to] of Object.entries(study.idAliases ?? {})) {
    add(from);
    add(to);
  }
  return ids;
}

function walk(value: unknown, path: string, hits: IdHit[], known: Set<string>, quoted: boolean) {
  if (typeof value === "string") {
    for (const m of value.matchAll(ID_RE)) {
      const id = m[1];
      if (isMonthYear(id)) continue;
      hits.push({ path, id, kind: quoted ? "quoted-source" : "active", known: known.has(id) });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, hits, known, quoted));
    return;
  }
  if (isRecord(value)) {
    for (const [k, v] of Object.entries(value)) {
      const nextQuoted = quoted || k === "text" && path.includes("documents") || k === "passage" && path.includes("abstract");
      walk(v, path ? `${path}.${k}` : k, hits, known, nextQuoted);
    }
  }
}

/** Walk active study fields. Source document bodies and historical quotes are classified, not rewritten. */
export function lintActiveReferences(study: Study): IdHit[] {
  const known = knownIds(study);
  const hits: IdHit[] = [];
  const skip = new Set(["documents", "usage", "activity", "audit", "migrationBackupHash", "migrationEvents"]);
  for (const [k, v] of Object.entries(study)) {
    if (skip.has(k)) continue;
    walk(v, k, hits, known, false);
  }
  for (const d of study.documents ?? []) {
    walk(d.text, `documents[${d.id}].text`, hits, known, true);
  }
  return hits;
}

export function unresolvedActiveIds(study: Study): IdHit[] {
  return lintActiveReferences(study).filter((h) => h.kind === "active" && !h.known);
}

export function markUnknownIds(text: string, known: Set<string>): { text: string; unknown: string[] } {
  const held: string[] = [];
  const protectedText = text.replace(
    /⟦unresolved:(?:ev|claim|doc|unk|local|dec|gate|crit)-[a-z0-9-]*\d[a-z0-9-]*⟧/gi,
    (all) => {
      held.push(all);
      return `\u0000WRAP${held.length - 1}\u0000`;
    },
  );
  const unknown: string[] = [];
  let next = protectedText.replace(
    /\b((?:ev|claim|doc|unk|local|dec|gate|crit)-[a-z0-9-]*\d[a-z0-9-]*)\b/gi,
    (all, id: string) => {
      if (known.has(id) || isMonthYear(id)) return all;
      unknown.push(id);
      return `⟦unresolved:${id}⟧`;
    },
  );
  next = next.replace(/\u0000WRAP(\d+)\u0000/g, (_, n) => held[Number(n)] ?? "");
  return { text: next, unknown: [...new Set(unknown)] };
}

export function resolveAlias(study: Study, id: string): string | undefined {
  if (study.scan.items.some((i) => i.id === id)) return id;
  const mapped = study.idAliases?.[id];
  if (mapped && study.scan.items.some((i) => i.id === mapped)) return mapped;
  return undefined;
}

// Quoted and stored source text (a record's abstract and content versions, documents) and enumerated
// fields (kinds, statuses, levels) are never rewritten. Review of 23 September: the appraisal patch
// carries items[].abstract.text, and "Dec-2019" in a retrieved abstract became "⟦unresolved:Dec-2019⟧".
const QUOTED_KEYS = new Set([
  "passage", "quote", "abstract", "contentVersions", "documents",
  "kind", "status", "uncertainty", "grade", "origin", "severity", "selectionStatus", "actionStatus",
]);

function collectPatchIds(value: unknown, into: Set<string>) {
  if (Array.isArray(value)) {
    value.forEach((v) => collectPatchIds(v, into));
    return;
  }
  if (isRecord(value)) {
    if (typeof value.id === "string" && value.id) into.add(value.id);
    for (const v of Object.values(value)) collectPatchIds(v, into);
  }
}

/** Objects the investigator wrote (claims, local facts, gates they set) carry their text as entered. */
function investigatorAuthored(value: Record<string, unknown>): boolean {
  return value.origin === "investigator" || value.by === "investigator" || value.setBy === "investigator";
}

/**
 * Mark unknown active ids in a model patch. Quoted source fields are left alone, and so are objects the
 * investigator wrote that a patch carries over (the appraisal merge keeps investigator claims): marking
 * would rewrite investigator text. Marking is not a resolution.
 */
export function markUnknownIdsInPatch(
  patch: Record<string, unknown>,
  known: Set<string>,
  onUnknown: (path: string, id: string) => void,
  path = "",
): void {
  if (investigatorAuthored(patch)) return;
  for (const [k, v] of Object.entries(patch)) {
    if (QUOTED_KEYS.has(k)) continue;
    const next = path ? `${path}.${k}` : k;
    if (typeof v === "string") {
      const r = markUnknownIds(v, known);
      if (r.unknown.length) {
        patch[k] = r.text;
        for (const id of r.unknown) onUnknown(next, id);
      }
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "string") {
          const r = markUnknownIds(item, known);
          if (r.unknown.length) {
            v[i] = r.text;
            for (const id of r.unknown) onUnknown(`${next}[${i}]`, id);
          }
        } else if (isRecord(item)) {
          markUnknownIdsInPatch(item, known, onUnknown, `${next}[${i}]`);
        }
      });
    } else if (isRecord(v)) {
      markUnknownIdsInPatch(v, known, onUnknown, next);
    }
  }
}

export function knownSetForApply(study: Study | undefined, patch: Record<string, unknown>): Set<string> {
  const known = study ? knownIds(study) : new Set<string>();
  collectPatchIds(patch, known);
  return known;
}
