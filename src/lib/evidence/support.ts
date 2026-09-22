import type { Claim, EvidenceItem, SourceDocument, Study } from "../types";

/*
 * Claim support against stored source text (S1, lexical level).
 *
 * A source-derived claim says "this record says X". Meridian stores the record's text (abstract,
 * registry summary or full text) byte-for-byte, so two things can be checked without any model:
 *   1. the quoted passage occurs in the stored text of a record the claim cites;
 *   2. every number the claim states occurs in that stored text.
 * A claim that fails either check is not evidence for a decision until the investigator fixes it.
 * This does not judge whether the source is right or whether the interpretation is sound; it only
 * refuses to let a model attribute words or numbers to a source that does not contain them.
 */

export type SupportStatus =
  | "supported"
  | "close-paraphrase"
  | "no-passage"
  | "no-source-text"
  | "passage-not-found"
  | "numbers-not-in-source"
  | "not-source-derived";

export interface ClaimSupport {
  claimId: string;
  status: SupportStatus;
  /** Blocking statuses mean the claim cannot support a decision. */
  blocking: boolean;
  passageFound: boolean | null;
  missingNumbers: string[];
  checkedSourceIds: string[];
  message: string;
}

const BLOCKING: ReadonlySet<SupportStatus> = new Set(["passage-not-found", "numbers-not-in-source"]);

/** Lower-case, NFKC, one kind of dash and quote, "percent" as %, mid-dot decimals, single spaces. */
export function normalizeForMatch(s: string): string {
  return (s ?? "")
    .normalize("NFKC")
    .replace(/­/g, "")
    .toLowerCase()
    .replace(/[‐-―−⸺⸻]/g, "-")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/(\d)\s*·\s*(\d)/g, "$1.$2")
    .replace(/\s+per\s?cent\b/g, "%")
    .replace(/(\d)\s+%/g, "$1%")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalizeForMatch(s)
    .replace(/[^\p{L}\p{N}%.\- ]+/gu, " ")
    .split(" ")
    .filter((t) => t.length >= 4);
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** "Thirty-eight percent" -> "38 percent", "twenty two" -> "22", "fourteen" -> "14". */
export function numberWordsToDigits(text: string): string {
  const tens = Object.keys(TENS).join("|");
  const units = Object.keys(UNITS).join("|");
  return (text ?? "")
    .replace(new RegExp(`\\b(${tens})[-\\s](one|two|three|four|five|six|seven|eight|nine)\\b`, "gi"), (_, t: string, u: string) =>
      String(TENS[t.toLowerCase()] + UNITS[u.toLowerCase()]),
    )
    .replace(new RegExp(`\\b(${tens})\\b`, "gi"), (_, t: string) => String(TENS[t.toLowerCase()]))
    .replace(new RegExp(`\\b(${units})\\b`, "gi"), (_, u: string) => String(UNITS[u.toLowerCase()]));
}

/**
 * Numbers stated in a text, as canonical strings of their absolute value ("1,212" -> "1212",
 * ".5" -> "0.5", "0.50" -> "0.5", "-2" -> "2", "thirty-eight" -> "38"). Signs are dropped because
 * dash characters are unreliable across sources; the words around a number are the reader's job.
 */
export function extractNumbers(text: string): string[] {
  const t = normalizeForMatch(numberWordsToDigits(text));
  const out = new Set<string>();
  const re = /(?<![\p{L}\d.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?|\.\d+)(?![\d])/gu;
  for (const m of t.matchAll(re)) {
    const raw = m[1].replace(/,/g, "");
    const n = Number(raw.startsWith(".") ? `0${raw}` : raw);
    if (!Number.isFinite(n)) continue;
    out.add(canonicalNumber(n));
  }
  return [...out];
}

function canonicalNumber(n: number): string {
  return String(Number(Math.abs(n).toPrecision(12)));
}

function sourceTexts(item: EvidenceItem, documents: SourceDocument[]): string[] {
  const texts = new Set<string>();
  if (item.abstract?.text) texts.add(item.abstract.text);
  for (const v of item.contentVersions ?? []) if (v?.text) texts.add(v.text);
  for (const d of documents) if (d.recordId === item.id && d.text) texts.add(d.text);
  return [...texts];
}

/** Passage fragments split at ellipses; each must occur in order. */
function passageFragments(passage: string): string[] {
  return normalizeForMatch(passage)
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .split(/\s*(?:\.\.\.|…|\[\.\.\.\])\s*/)
    .map((f) => f.replace(/^[\s"'.,;:]+|[\s"'.,;:]+$/g, ""))
    .filter((f) => f.length >= 8);
}

function containsInOrder(haystack: string, fragments: string[]): boolean {
  let from = 0;
  for (const f of fragments) {
    const i = haystack.indexOf(f, from);
    if (i < 0) return false;
    from = i + f.length;
  }
  return fragments.length > 0;
}

function tokenOverlap(passage: string, haystack: string): number {
  const p = tokens(passage);
  if (!p.length) return 0;
  const h = new Set(tokens(haystack));
  return p.filter((t) => h.has(t)).length / p.length;
}

export function claimSupport(claim: Claim, study: Pick<Study, "scan" | "documents">): ClaimSupport {
  const base = { claimId: claim.id, missingNumbers: [] as string[], checkedSourceIds: [] as string[] };
  if (claim.kind !== "source-derived") {
    return { ...base, status: "not-source-derived", blocking: false, passageFound: null, message: `${claim.kind} claims are not checked against source text` };
  }
  const byId = new Map(study.scan.items.map((i) => [i.id, i]));
  const docs = study.documents ?? [];
  const sources = claim.sourceIds.map((id) => byId.get(id)).filter((i): i is EvidenceItem => !!i);
  const texts = sources.flatMap((s) => sourceTexts(s, docs));
  const checkedSourceIds = sources.filter((s) => sourceTexts(s, docs).length > 0).map((s) => s.id);
  if (!texts.length) {
    return {
      ...base,
      status: "no-source-text",
      blocking: false,
      passageFound: null,
      message: "no stored text for the cited record(s); the claim cannot be checked (metadata or lead only)",
    };
  }
  const haystack = normalizeForMatch(texts.join("\n"));
  let passageFound: boolean | null = null;
  let status: SupportStatus = "supported";
  const passage = (claim.passage ?? "").trim();
  if (passage) {
    const frags = passageFragments(passage);
    if (frags.length && containsInOrder(haystack, frags)) passageFound = true;
    else if (tokenOverlap(passage, haystack) >= 0.85) {
      passageFound = false;
      status = "close-paraphrase";
    } else {
      passageFound = false;
      status = "passage-not-found";
    }
  } else {
    status = "no-passage";
  }
  // Numbers: every number in the claim text must occur in the cited stored text. Years that match a
  // cited record's publication year and small counts equal to the number of cited records are allowed.
  const available = new Set(extractNumbers(texts.join("\n")));
  const years = new Set(sources.map((s) => (s.year === null ? "" : String(s.year))).filter(Boolean));
  // 0 and 1 are skipped: "one of", "a single" and ordinal uses make them unreliable as stated results.
  const missingNumbers = extractNumbers(claim.text).filter(
    (n) => n !== "0" && n !== "1" && !available.has(n) && !years.has(n) && !(n === String(sources.length)),
  );
  if (missingNumbers.length && status !== "passage-not-found") status = "numbers-not-in-source";
  const message =
    status === "supported"
      ? "passage found in the stored source text; every stated number occurs there"
      : status === "close-paraphrase"
        ? "passage is a close paraphrase, not an exact quotation; numbers checked"
        : status === "no-passage"
          ? "no passage given; stated numbers occur in the source text"
          : status === "passage-not-found"
            ? "the quoted passage does not occur in the stored text of the cited record(s)"
            : `number(s) ${missingNumbers.join(", ")} do not occur in the cited record's stored text`;
  return { ...base, status, blocking: BLOCKING.has(status), passageFound, missingNumbers, checkedSourceIds, message };
}

export function supportByClaim(study: Pick<Study, "scan" | "documents">): Map<string, ClaimSupport> {
  return new Map((study.scan.claims ?? []).map((c) => [c.id, claimSupport(c, study)]));
}

/*
 * Grounding of investigator-side facts. A model may say a gate is met ("REB file 26-311 approved,
 * supplied by the investigator") or state a local fact. Meridian can check whether the specific
 * anchors of that statement (record numbers, figures, dates, a verbatim phrase) occur in text the
 * investigator actually entered. An identifier the investigator never supplied cannot count.
 */

/** Everything the investigator typed about the setting: the need, the constraints and the local facts. */
export function investigatorText(study: Pick<Study, "problem">): string {
  const parts = [study.problem.rawNeed, study.problem.constraints];
  for (const f of study.problem.localFacts ?? []) if (f.by === "investigator") parts.push(f.text);
  return parts.filter(Boolean).join("\n");
}

/** Identifier-like tokens: letters-and-digits codes such as REB-2026-188, CGC-2026-031, 26-311, NCT01234567. */
export function identifierTokens(text: string): string[] {
  const t = (text ?? "").normalize("NFKC");
  const ids = new Set<string>();
  for (const m of t.matchAll(/\b[A-Z][A-Z0-9]*(?:[-/][A-Z0-9]+)*[-/]\d[A-Z0-9-]*\b/g)) ids.add(m[0]);
  for (const m of t.matchAll(/\b\d{2,4}-\d{2,5}\b/g)) ids.add(m[0]);
  for (const m of t.matchAll(/\bNCT\d{8}\b/gi)) ids.add(m[0].toUpperCase());
  return [...ids].filter((x) => !/^\d{4}-\d{2}(-\d{2})?$/.test(x));
}

export interface Grounding {
  grounded: boolean;
  foundAnchors: string[];
  missingAnchors: string[];
  reason: string;
}

export function groundedInInvestigatorText(statement: string, investigator: string): Grounding {
  const hay = normalizeForMatch(investigator);
  const ids = identifierTokens(statement);
  const missingIds = ids.filter((id) => !hay.includes(normalizeForMatch(id)));
  if (missingIds.length) {
    return { grounded: false, foundAnchors: [], missingAnchors: missingIds, reason: `cites ${missingIds.join(", ")}, which the investigator never supplied` };
  }
  const nums = extractNumbers(statement).filter((n) => n.replace(".", "").length >= 2);
  const haveNums = new Set(extractNumbers(investigator));
  const foundNums = nums.filter((n) => haveNums.has(n));
  const missingNums = nums.filter((n) => !haveNums.has(n));
  const foundIds = ids;
  // A verbatim run of 5+ words from the investigator's text also anchors the statement.
  const words = normalizeForMatch(statement).replace(/[^\p{L}\p{N} ]+/gu, " ").split(" ").filter(Boolean);
  let phrase = "";
  for (let i = 0; i + 5 <= words.length && !phrase; i++) {
    const cand = words.slice(i, i + 5).join(" ");
    if (normalizeForMatch(hay).replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").includes(cand)) phrase = cand;
  }
  const anchors = [...foundIds, ...foundNums, ...(phrase ? [`"${phrase}"`] : [])];
  if (!anchors.length) {
    return { grounded: false, foundAnchors: [], missingAnchors: missingNums, reason: "names nothing the investigator entered (no record number, figure or phrase from the investigator's text)" };
  }
  if (missingNums.length && !phrase && !foundIds.length) {
    return { grounded: false, foundAnchors: anchors, missingAnchors: missingNums, reason: `states ${missingNums.join(", ")}, which the investigator's text does not contain` };
  }
  return { grounded: true, foundAnchors: anchors, missingAnchors: missingNums, reason: `anchored in investigator text: ${anchors.join(", ")}` };
}
