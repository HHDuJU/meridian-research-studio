import type { Claim, EvidenceItem, EvidenceKind, GradeLevel } from "../types";
import {
  Issues,
  enumOrResolve,
  isRecord,
  objectArray,
  scoreOrNull,
  stringArray,
  stringOrUndefined,
} from "../contracts";
import type { Issue } from "../contracts";
import { uid } from "../utils";

/**
 * When evidence comes from retrieval, the model's job at the Scan stage changes: it *annotates*
 * records it was given (relevance, design, findings, limitations, context tags) and proposes claims
 * that point at those records — it does not create records, and it cannot touch identity or
 * provenance. Annotations for unknown ids are dropped with an issue.
 */

const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  "guideline", "systematic-review", "rct", "observational", "qi-report", "grey", "qualitative", "patient-voice", "expert", "preprint", "trial-registry",
];
const GRADES: readonly GradeLevel[] = ["high", "moderate", "low", "very-low"];
const CLAIM_KINDS = ["source-derived", "local-fact", "assumption", "inference", "scenario"] as const;
const UNCERTAINTY = ["low", "moderate", "high"] as const;

export interface AppraisalResult {
  items: EvidenceItem[];
  claims: Claim[];
  synthesis?: string;
  gradeOverall?: GradeLevel;
  gradeRationale?: string;
  issues: Issue[];
  /** ids the model annotated that do not exist — a sign it invented or misremembered records */
  unknownIds: string[];
}

/** Expected model payload: { annotations: [{id, relevance, methodQuality, kind, grade, keyFindings, limitations, contextTags, notes}], claims: [...], synthesis, gradeOverall, gradeRationale } */
export function applyAppraisal(items: EvidenceItem[], raw: unknown): AppraisalResult {
  const issues = new Issues();
  const unknownIds: string[] = [];
  if (!isRecord(raw)) {
    issues.add("$", "not-an-object", "appraisal payload is not an object");
    return { items, claims: [], issues: issues.list, unknownIds };
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const annotated = new Map<string, Partial<EvidenceItem>>();
  for (const a of objectArray(raw.annotations, "annotations", issues) ?? []) {
    const id = typeof a.id === "string" ? a.id : "";
    const p = `annotations[${id || "?"}]`;
    if (!byId.has(id)) {
      unknownIds.push(id || "(missing id)");
      issues.add(p, "dropped", `annotation for unknown record id "${id}" dropped — records cannot be invented at this stage`);
      continue;
    }
    const current = byId.get(id)!;
    const inspected = current.provenance?.status === "retrieved" || current.provenance?.status === "verified";
    if (!inspected) {
      issues.add(p, "dropped", "appraisal of unverified lead refused; annotate retrieved records only");
      continue;
    }
    const patch: Partial<EvidenceItem> = {};
    const rel = scoreOrNull(a.relevance, `${p}.relevance`, issues);
    if (a.relevance !== undefined) patch.relevance = rel;
    const mq = scoreOrNull(a.methodQuality, `${p}.methodQuality`, issues);
    if (a.methodQuality !== undefined) patch.methodQuality = mq;
    const kind = enumOrResolve(EVIDENCE_KINDS, a.kind, `${p}.kind`, issues);
    if (kind) patch.kind = kind;
    const grade = enumOrResolve(GRADES, a.grade, `${p}.grade`, issues);
    if (grade) patch.grade = grade;
    const kf = stringOrUndefined(a.keyFindings, `${p}.keyFindings`, issues);
    if (kf !== undefined) patch.keyFindings = kf;
    const lim = stringOrUndefined(a.limitations, `${p}.limitations`, issues);
    if (lim !== undefined) patch.limitations = lim;
    const notes = stringOrUndefined(a.notes, `${p}.notes`, issues);
    if (notes !== undefined) patch.notes = notes;
    const tags = stringArray(a.contextTags, `${p}.contextTags`, issues);
    if (tags !== undefined) patch.contextTags = tags;
    // Identity, provenance, source text and hashes are not annotatable.
    for (const forbidden of ["title", "year", "doi", "pmid", "authors", "provenance", "verification", "id", "source", "abstract", "access"]) {
      if (forbidden !== "id" && forbidden in a) issues.add(`${p}.${forbidden}`, "dropped", `${forbidden} cannot be changed by appraisal`);
    }
    if ("notes" in a && a.notes !== undefined) {
      // notes are commentary only; retrieved abstract stays on `abstract`.
    }
    annotated.set(id, { ...(annotated.get(id) ?? {}), ...patch });
  }
  const nextItems = items.map((i) => {
    if (!annotated.has(i.id)) return i;
    const patch = annotated.get(i.id)!;
    const next = { ...i, ...patch };
    next.abstract = i.abstract && typeof i.abstract === "object" ? { ...i.abstract } : i.abstract;
    next.provenance = i.provenance;
    return next;
  });

  const claims: Claim[] = [];
  for (const c of objectArray(raw.claims, "claims", issues) ?? []) {
    const p = `claims[${typeof c.id === "string" ? c.id : "?"}]`;
    const text = stringOrUndefined(c.text, `${p}.text`, issues);
    if (!text?.trim()) {
      issues.add(p, "dropped", "claim without text dropped");
      continue;
    }
    const kind = enumOrResolve(CLAIM_KINDS, c.kind, `${p}.kind`, issues);
    if (!kind) {
      issues.add(p, "dropped", "claim with unrecognised kind dropped");
      continue;
    }
    const uncertainty = enumOrResolve(UNCERTAINTY, c.uncertainty, `${p}.uncertainty`, issues, "high") ?? "high";
    const sourceIds = (stringArray(c.sourceIds, `${p}.sourceIds`, issues) ?? []).filter((sid) => {
      if (byId.has(sid)) return true;
      unknownIds.push(sid);
      issues.add(`${p}.sourceIds`, "dropped", `claim cites unknown record id "${sid}"`);
      return false;
    });
    claims.push({
      id: typeof c.id === "string" && c.id.trim() ? c.id : uid("claim"),
      text,
      kind,
      sourceIds,
      location: stringOrUndefined(c.location, `${p}.location`, issues) || undefined,
      passage: stringOrUndefined(c.passage, `${p}.passage`, issues) || undefined,
      interpretation: stringOrUndefined(c.interpretation, `${p}.interpretation`, issues) || undefined,
      uncertainty,
      origin: "model",
    });
  }
  return {
    items: nextItems,
    claims,
    synthesis: stringOrUndefined(raw.synthesis, "synthesis", issues),
    gradeOverall: enumOrResolve(GRADES, raw.gradeOverall, "gradeOverall", issues),
    gradeRationale: stringOrUndefined(raw.gradeRationale, "gradeRationale", issues),
    issues: issues.list,
    unknownIds: [...new Set(unknownIds)],
  };
}

export const APPRAISAL_SCHEMA = `{
  "annotations": [{ "id": string (must be an existing record id), "relevance": 0-100|null, "methodQuality": 0-100|null,
    "kind": "guideline"|"systematic-review"|"rct"|"observational"|"qi-report"|"grey"|"qualitative"|"patient-voice"|"expert"|"preprint"|"trial-registry",
    "grade": "high"|"moderate"|"low"|"very-low"|null, "keyFindings": string, "limitations": string, "contextTags": string[], "notes": string }],
  "claims": [{ "id": string, "text": string, "kind": "source-derived"|"local-fact"|"assumption"|"inference"|"scenario",
    "sourceIds": string[] (existing record ids), "location": string (section/table/figure in the source), "passage": string (short quotation or close paraphrase), "interpretation": string, "uncertainty": "low"|"moderate"|"high" }],
  "synthesis": string, "gradeOverall": "high"|"moderate"|"low"|"very-low"|null, "gradeRationale": string, "summary": string
}`;
