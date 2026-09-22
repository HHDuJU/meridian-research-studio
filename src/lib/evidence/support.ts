/**
 * Outcome-bound support for source-attributed claims.
 * numbers.ts extracts values; this module decides whether they may enter the active ledger.
 *
 * A value that appears anywhere in a cited record is not enough: the estimate, unit, quotation,
 * endpoint and time window must resolve to the same source sentence (or a declared derivation).
 */

import type {
  Claim,
  ClaimAssertion,
  Derivation,
  EvidenceItem,
  SourceDocument,
  SourceSpan,
  SupportStatus,
} from "../types";
import type { Issue } from "../contracts";
import {
  codePoints,
  extractNumbers,
  normalizeDisplay,
  sentenceAt,
  sentencesWithOffsets,
  sliceCp,
} from "./numbers";

export interface SupportVerdict {
  status: SupportStatus;
  spans: SourceSpan[];
  issues: Issue[];
  assertion: ClaimAssertion;
}

const STOP = new Set(
  "a an the of to in at on for vs versus with without and or from by was were is are be been being this that those these".split(
    " ",
  ),
);

export function findExactSpan(haystack: string, needle: string): { start: number; end: number } | null {
  if (!needle.trim()) return null;
  const h = normalizeDisplay(haystack);
  const n = normalizeDisplay(needle.trim());
  const idx = h.text.indexOf(n.text);
  if (idx < 0) return null;
  const start = h.map[idx] ?? 0;
  const last = idx + n.text.length - 1;
  const endExclusive = (h.map[last] ?? start) + 1;
  return { start, end: endExclusive };
}

export function documentsForRecord(recordId: string, documents: SourceDocument[], item?: EvidenceItem): SourceDocument[] {
  const bound = documents.filter((d) => d.recordId === recordId);
  if (bound.length) return bound;
  if (item?.abstract?.text) {
    return [
      {
        id: item.abstract.documentId,
        recordId,
        sha256: item.abstract.sha256,
        text: item.abstract.text,
        mediaType: "text/plain",
        sourceScope: "abstract",
        shortenedAtSource: "unknown",
        capturedAt: "",
      },
    ];
  }
  return [];
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9%\-°]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && (w.length >= 3 || /^\d/.test(w)) && !STOP.has(w));
}

function sentenceHas(sentence: string, required: string[]): boolean {
  if (!required.length) return true;
  const hay = sentence.toLowerCase();
  return required.every((t) => hay.includes(t));
}

function numbersCompatible(claimNum: ReturnType<typeof extractNumbers>[number], sourceNum: ReturnType<typeof extractNumbers>[number]): boolean {
  if (claimNum.value === sourceNum.value) return true;
  if (Math.abs(claimNum.numeric - sourceNum.numeric) < 1e-9) return true;
  return false;
}

function spanOfNumber(doc: SourceDocument, n: ReturnType<typeof extractNumbers>[number]): SourceSpan {
  return { documentId: doc.id, sha256: doc.sha256, start: n.start, end: n.end };
}

export function roundHalfUp(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return (Math.sign(n) * Math.round(Math.abs(n) * f)) / f;
}

export function evaluateDerivation(
  derivation: Derivation,
  byId: Map<string, ClaimAssertion>,
): { ok: boolean; value?: number; reason?: string } {
  const operands = derivation.operandIds.map((id) => byId.get(id));
  if (operands.some((o) => !o)) return { ok: false, reason: "derivation operand is missing" };
  if (operands.some((o) => o!.supportStatus !== "supported")) {
    return { ok: false, reason: "derivation operand is not a supported assertion" };
  }
  const nums = operands.map((o) => Number(o!.estimate));
  if (nums.some((n) => !Number.isFinite(n))) return { ok: false, reason: "derivation operand has no numeric estimate" };
  const decimals = derivation.rounding?.decimals ?? 1;
  let value: number;
  if (derivation.method === "percent") {
    if (nums.length !== 2 || nums[1] === 0) return { ok: false, reason: "percent derivation needs events and a nonzero denominator" };
    value = (nums[0] / nums[1]) * 100;
  } else if (derivation.method === "difference") {
    if (nums.length !== 2) return { ok: false, reason: "difference derivation needs two operands" };
    value = nums[0] - nums[1];
  } else if (derivation.method === "ratio") {
    if (nums.length !== 2 || nums[1] === 0) return { ok: false, reason: "ratio derivation needs two operands" };
    value = nums[0] / nums[1];
  } else if (derivation.method === "sum") {
    value = nums.reduce((a, b) => a + b, 0);
  } else {
    return { ok: false, reason: "unknown derivation method" };
  }
  return { ok: true, value: roundHalfUp(value, decimals) };
}

function issue(path: string, code: Issue["code"], message: string, value?: unknown): Issue {
  return value === undefined ? { path, code, message } : { path, code, message, value };
}

export function supportClaim(
  claim: Claim,
  items: EvidenceItem[],
  documents: SourceDocument[],
  path: string,
  knownAssertions: Map<string, ClaimAssertion> = new Map(),
): SupportVerdict {
  const issues: Issue[] = [];
  const assertion: ClaimAssertion = {
    ...(claim.assertion ?? {}),
    supportStatus: "unassessed",
    spans: [...(claim.assertion?.spans ?? [])],
  };

  if (claim.kind !== "source-derived") {
    assertion.supportStatus = "unassessed";
    return { status: "unassessed", spans: [], issues, assertion };
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  const missing = claim.sourceIds.filter((id) => !byId.has(id));
  if (missing.length || claim.sourceIds.length === 0) {
    issues.push(
      issue(
        `${path}.sourceIds`,
        "unsupported",
        claim.sourceIds.length === 0
          ? "source-derived claim has no source"
          : `source-derived claim cites unknown record id(s): ${missing.join(", ")}`,
        missing,
      ),
    );
    assertion.supportStatus = "quarantined";
    return { status: "quarantined", spans: [], issues, assertion };
  }

  const citedDocs: { item: EvidenceItem; doc: SourceDocument }[] = [];
  for (const id of claim.sourceIds) {
    const item = byId.get(id)!;
    const docs = documentsForRecord(id, documents, item);
    for (const doc of docs) citedDocs.push({ item, doc });
  }
  if (!citedDocs.length) {
    issues.push(issue(path, "unsupported", "no stored source text is bound to the cited records"));
    assertion.supportStatus = "quarantined";
    return { status: "quarantined", spans: [], issues, assertion };
  }

  const passage = (claim.passage ?? "").trim();
  if (passage) {
    let hit: { doc: SourceDocument; start: number; end: number } | null = null;
    for (const { doc } of citedDocs) {
      const found = findExactSpan(doc.text, passage);
      if (found) {
        hit = { doc, ...found };
        break;
      }
    }
    if (!hit) {
      issues.push(
        issue(`${path}.passage`, "quote-not-in-source", "quotation is not an exact span of a cited source", passage),
      );
      assertion.supportStatus = "quarantined";
      return { status: "quarantined", spans: [], issues, assertion };
    }
    assertion.spans.push({
      documentId: hit.doc.id,
      sha256: hit.doc.sha256,
      start: hit.start,
      end: hit.end,
    });
  }

  const claimText = [claim.text, claim.location ?? "", assertion.estimate ?? "", assertion.timeWindow ?? "", assertion.outcome ?? ""].join(
    " ",
  );
  const attributed = extractNumbers(claimText).filter((n) => n.role !== "p-value");
  const outcomeTokens = tokens(assertion.outcome ?? "");
  const timeTokens = tokens(assertion.timeWindow ?? "");

  if (assertion.derivation) {
    const derived = evaluateDerivation(assertion.derivation, knownAssertions);
    if (!derived.ok) {
      issues.push(issue(`${path}.derivation`, "unsupported", derived.reason ?? "derivation is not reproducible"));
      assertion.supportStatus = "quarantined";
      return { status: "quarantined", spans: assertion.spans, issues, assertion };
    }
    const expected = assertion.estimate !== undefined && assertion.estimate !== "" ? Number(assertion.estimate) : derived.value!;
    if (Number.isFinite(expected) && Math.abs(expected - derived.value!) > 1e-9) {
      issues.push(
        issue(
          `${path}.derivation`,
          "unsupported",
          `derived value ${derived.value} does not match estimate ${assertion.estimate}`,
        ),
      );
      assertion.supportStatus = "quarantined";
      return { status: "quarantined", spans: assertion.spans, issues, assertion };
    }
    assertion.estimate = assertion.estimate || String(derived.value);
    assertion.supportStatus = "supported";
    return { status: "supported", spans: assertion.spans, issues, assertion };
  }

  for (const num of attributed) {
    if (num.role === "ci-level" || num.role === "ci-lo" || num.role === "ci-hi") {
      let foundCi = false;
      for (const { doc } of citedDocs) {
        const srcNums = extractNumbers(doc.text);
        const same = srcNums.filter((s) => s.role === num.role && numbersCompatible(num, s));
        if (same.length) {
          foundCi = true;
          assertion.spans.push(spanOfNumber(doc, same[0]));
          break;
        }
      }
      if (!foundCi) {
        issues.push(
          issue(
            `${path}.text`,
            "unsupported",
            `attributed ${num.role} ${num.value} is not in a cited source and has no derivation operands`,
            num.value,
          ),
        );
        assertion.supportStatus = "quarantined";
        return { status: "quarantined", spans: assertion.spans, issues, assertion };
      }
      continue;
    }

    let bound: { doc: SourceDocument; n: ReturnType<typeof extractNumbers>[number]; sentence: string } | null = null;
    for (const { doc } of citedDocs) {
      const srcNums = extractNumbers(doc.text);
      for (const sNum of srcNums) {
        if (!numbersCompatible(num, sNum)) continue;
        if (num.unit && sNum.unit && num.unit.toLowerCase() !== sNum.unit.toLowerCase()) continue;
        const sentence = sentenceAt(doc.text, sNum.start, sNum.end);
        if (outcomeTokens.length || timeTokens.length) {
          if (!sentenceHas(sentence, outcomeTokens) || !sentenceHas(sentence, timeTokens)) continue;
        }
        bound = { doc, n: sNum, sentence };
        break;
      }
      if (bound) break;
    }
    if (!bound) {
      const appearsSomewhere = citedDocs.some(({ doc }) => extractNumbers(doc.text).some((s) => numbersCompatible(num, s)));
      issues.push(
        issue(
          `${path}.text`,
          "unsupported",
          appearsSomewhere
            ? `number ${num.value} appears in a cited source but not with the claimed endpoint/time`
            : `attributed number ${num.value}${num.unit ? " " + num.unit : ""} is not in a cited source`,
          num.value,
        ),
      );
      assertion.supportStatus = "quarantined";
      return { status: "quarantined", spans: assertion.spans, issues, assertion };
    }
    assertion.spans.push(spanOfNumber(bound.doc, bound.n));
  }

  if (!passage && !attributed.length && !assertion.spans.length) {
    issues.push(issue(path, "unsupported", "source-derived claim has no bound quotation, number, or span"));
    assertion.supportStatus = "quarantined";
    return { status: "quarantined", spans: [], issues, assertion };
  }

  assertion.supportStatus = "supported";
  return { status: "supported", spans: assertion.spans, issues, assertion };
}

export function annotationHasUnsupportedNumber(
  text: string,
  item: EvidenceItem,
  documents: SourceDocument[],
): boolean {
  const nums = extractNumbers(text).filter((n) => n.role !== "p-value" && n.role !== "ci-level");
  if (!nums.length) return false;
  const docs = documentsForRecord(item.id, documents, item);
  if (!docs.length) return true;
  const src = docs.flatMap((d) => extractNumbers(d.text));
  return nums.some((n) => !src.some((s) => numbersCompatible(n, s)));
}

export { sentencesWithOffsets, sliceCp, codePoints };
