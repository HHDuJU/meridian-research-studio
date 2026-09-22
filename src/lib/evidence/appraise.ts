import type { Claim, ClaimAssertion, DerivationMethod, EvidenceItem, EvidenceKind, GradeLevel, SourceDocument } from "../types";
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
import { annotationHasUnsupportedNumber, supportClaim } from "./support";

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
const DERIVATION_METHODS = ["percent", "difference", "ratio", "sum"] as const satisfies readonly DerivationMethod[];

export interface AppraisalResult {
  items: EvidenceItem[];
  claims: Claim[];
  synthesis?: string;
  gradeOverall?: GradeLevel;
  gradeRationale?: string;
  issues: Issue[];
  /** ids the model annotated that do not exist — a sign it invented or misremembered records */
  unknownIds: string[];
  quarantine: { claims: Claim[]; annotations: unknown[] };
}

function parseDerivation(raw: unknown): ClaimAssertion["derivation"] {
  if (!isRecord(raw) || typeof raw.method !== "string") return undefined;
  if (!(DERIVATION_METHODS as readonly string[]).includes(raw.method)) return undefined;
  return {
    method: raw.method as DerivationMethod,
    operandIds: Array.isArray(raw.operandIds) ? raw.operandIds.filter((x): x is string => typeof x === "string") : [],
    rounding:
      isRecord(raw.rounding) && typeof raw.rounding.decimals === "number"
        ? { mode: raw.rounding.mode === "trunc" ? "trunc" : "half-up", decimals: raw.rounding.decimals }
        : undefined,
    unit: typeof raw.unit === "string" ? raw.unit : undefined,
  };
}

/** Expected model payload: { annotations: [{id, relevance, methodQuality, kind, grade, keyFindings, limitations, contextTags, notes}], claims: [...], synthesis, gradeOverall, gradeRationale } */
export function applyAppraisal(items: EvidenceItem[], raw: unknown, documents: SourceDocument[] = []): AppraisalResult {
  const issues = new Issues();
  const unknownIds: string[] = [];
  const quarantine: { claims: Claim[]; annotations: unknown[] } = { claims: [], annotations: [] };
  if (!isRecord(raw)) {
    issues.add("$", "not-an-object", "appraisal payload is not an object");
    return { items, claims: [], issues: issues.list, unknownIds, quarantine };
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
    if (kf !== undefined) {
      if (annotationHasUnsupportedNumber(kf, current, documents)) {
        issues.add(`${p}.keyFindings`, "unsupported", "annotation number is not in the cited source; it cannot validate a claim");
        quarantine.annotations.push({ id, field: "keyFindings", value: kf });
      } else {
        patch.keyFindings = kf;
      }
    }
    const lim = stringOrUndefined(a.limitations, `${p}.limitations`, issues);
    if (lim !== undefined) {
      if (annotationHasUnsupportedNumber(lim, current, documents)) {
        issues.add(`${p}.limitations`, "unsupported", "annotation number is not in the cited source; it cannot validate a claim");
        quarantine.annotations.push({ id, field: "limitations", value: lim });
      } else {
        patch.limitations = lim;
      }
    }
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
  const pendingAssertions = new Map<string, NonNullable<Claim["assertion"]>>();
  for (const c of objectArray(raw.claims, "claims", issues) ?? []) {
    const id = typeof c.id === "string" && c.id.trim() ? c.id : uid("claim");
    const p = `claims[${id}]`;
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
    const sourceIds = stringArray(c.sourceIds, `${p}.sourceIds`, issues) ?? [];
    for (const sid of sourceIds) {
      if (!byId.has(sid)) unknownIds.push(sid);
    }
    const assertionRaw = isRecord(c.assertion)
      ? c.assertion
      : c.outcome !== undefined || c.timeWindow !== undefined || c.estimate !== undefined || c.derivation !== undefined
        ? c
        : undefined;
    const assertion: ClaimAssertion | undefined = assertionRaw
      ? {
          subject: typeof assertionRaw.subject === "string" ? assertionRaw.subject : undefined,
          population: typeof assertionRaw.population === "string" ? assertionRaw.population : undefined,
          intervention: typeof assertionRaw.intervention === "string" ? assertionRaw.intervention : undefined,
          comparator: typeof assertionRaw.comparator === "string" ? assertionRaw.comparator : undefined,
          outcome: typeof assertionRaw.outcome === "string" ? assertionRaw.outcome : undefined,
          timeOrigin: typeof assertionRaw.timeOrigin === "string" ? assertionRaw.timeOrigin : undefined,
          timeWindow: typeof assertionRaw.timeWindow === "string" ? assertionRaw.timeWindow : undefined,
          estimate: assertionRaw.estimate !== undefined && assertionRaw.estimate !== null ? String(assertionRaw.estimate) : undefined,
          unit: typeof assertionRaw.unit === "string" ? assertionRaw.unit : undefined,
          denominator: typeof assertionRaw.denominator === "string" ? assertionRaw.denominator : undefined,
          polarity:
            assertionRaw.polarity === "benefit" ||
            assertionRaw.polarity === "harm" ||
            assertionRaw.polarity === "null" ||
            assertionRaw.polarity === "unknown"
              ? assertionRaw.polarity
              : undefined,
          supportStatus: "unassessed",
          spans: [],
          derivation: parseDerivation(assertionRaw.derivation),
        }
      : undefined;
    const drafted: Claim = {
      id,
      text,
      kind,
      sourceIds,
      location: stringOrUndefined(c.location, `${p}.location`, issues) || undefined,
      passage: stringOrUndefined(c.passage, `${p}.passage`, issues) || undefined,
      interpretation: stringOrUndefined(c.interpretation, `${p}.interpretation`, issues) || undefined,
      uncertainty,
      origin: "model",
      assertion,
    };
    const verdict = supportClaim(drafted, items, documents, p, pendingAssertions);
    issues.list.push(...verdict.issues);
    const next: Claim = {
      ...drafted,
      assertion: verdict.assertion,
      supportStatus: verdict.status,
    };
    if (verdict.status === "supported" || verdict.status === "unassessed") {
      claims.push(next);
      pendingAssertions.set(id, verdict.assertion);
    } else {
      quarantine.claims.push(next);
    }
  }
  return {
    items: nextItems,
    claims,
    synthesis: stringOrUndefined(raw.synthesis, "synthesis", issues),
    gradeOverall: enumOrResolve(GRADES, raw.gradeOverall, "gradeOverall", issues),
    gradeRationale: stringOrUndefined(raw.gradeRationale, "gradeRationale", issues),
    issues: issues.list,
    unknownIds: [...new Set(unknownIds)],
    quarantine,
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
