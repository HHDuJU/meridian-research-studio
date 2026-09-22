/**
 * Lexical number extraction for source-attributed claims.
 * This is a subroutine of support.ts — matching a digit in a record is not a support verdict.
 *
 * Identifier tokens (PROMIS-29, ev-x, DOIs) are stripped only from numeric extraction.
 * Citation validation still sees the original string.
 */

export type NumberRole =
  | "ci-level"
  | "ci-lo"
  | "ci-hi"
  | "p-value"
  | "duration"
  | "temperature"
  | "percent"
  | "count"
  | "dose"
  | "estimate";

export interface ExtractedNumber {
  raw: string;
  /** Canonical signed decimal string (no exponent). */
  value: string;
  numeric: number;
  unit?: string;
  role: NumberRole;
  /** Unicode code-point offsets into the original string, half-open. */
  start: number;
  end: number;
}

const ONES: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

export function codePoints(s: string): string[] {
  return [...s];
}

export function sliceCp(s: string, start: number, end: number): string {
  return codePoints(s).slice(start, end).join("");
}

/** Documented display-normalization map. Offsets on the original string are preserved via a parallel index. */
export const DISPLAY_NORM: ReadonlyArray<readonly [RegExp, string]> = [
  [/\u2018|\u2019/g, "'"],
  [/\u201C|\u201D/g, '"'],
  [/\u2013|\u2014|\u2212/g, "-"],
  [/\u00A0|\u202F|\u2009/g, " "],
  [/\u00BA/g, "°"],
];

export function normalizeDisplay(s: string): { text: string; map: number[] } {
  const cps = codePoints(s);
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < cps.length; i++) {
    let ch = cps[i];
    if (ch === "\u2018" || ch === "\u2019") ch = "'";
    else if (ch === "\u201C" || ch === "\u201D") ch = '"';
    else if (ch === "\u2013" || ch === "\u2014" || ch === "\u2212") ch = "-";
    else if (ch === "\u00A0" || ch === "\u202F" || ch === "\u2009") ch = " ";
    else if (ch === "\u00BA") ch = "°";
    text += ch;
    map.push(i);
  }
  return { text, map };
}

function utf16ToCp(s: string, utf16: number): number {
  return codePoints(s.slice(0, utf16)).length;
}

function maskForExtraction(s: string): string {
  return s
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(/\u00BA/g, "°")
    .replace(/\b\d{1,2}:\d{2}\b/g, (m) => " ".repeat(m.length))
    .replace(/\b10\.\d{4,9}\/[^\s]+/g, (m) => " ".repeat(m.length))
    .replace(/\b[A-Za-z][A-Za-z0-9]*-\d+\b/g, (m) => " ".repeat(m.length))
    .replace(/\bev-[A-Za-z0-9]+\b/gi, (m) => " ".repeat(m.length));
}

function push(
  out: ExtractedNumber[],
  occupied: boolean[],
  s: string,
  utf16Start: number,
  utf16End: number,
  raw: string,
  numeric: number,
  role: NumberRole,
  unit?: string,
): void {
  const start = utf16ToCp(s, utf16Start);
  const end = utf16ToCp(s, utf16End);
  for (let i = start; i < end; i++) if (occupied[i]) return;
  for (let i = start; i < end; i++) occupied[i] = true;
  out.push({
    raw,
    value: formatDecimal(numeric),
    numeric,
    unit,
    role,
    start,
    end,
  });
}

function formatDecimal(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

const NUM = "-?\\d+(?:\\.\\d+)?";

export function extractNumbers(original: string): ExtractedNumber[] {
  const s = maskForExtraction(original);
  const occupied: boolean[] = Array.from({ length: codePoints(original).length }, () => false);
  const out: ExtractedNumber[] = [];

  const ci = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*%\\s*CI\\s*,?\\s*(${NUM})\\s*(?:to|[-–])\\s*(${NUM})`,
    "gi",
  );
  for (const m of s.matchAll(ci)) {
    const idx = m.index ?? 0;
    const level = Number(m[1]);
    const lo = Number(m[2]);
    const hi = Number(m[3]);
    const levelAt = idx;
    const levelEnd = idx + m[1].length;
    push(out, occupied, original, levelAt, levelEnd, m[1], level, "ci-level", "%");
    const loAt = idx + m[0].indexOf(m[2]);
    push(out, occupied, original, loAt, loAt + m[2].length, m[2], lo, "ci-lo");
    const hiAt = idx + m[0].lastIndexOf(m[3]);
    push(out, occupied, original, hiAt, hiAt + m[3].length, m[3], hi, "ci-hi");
  }

  const pval = /p\s*[<≤=]\s*(0?\.\d+)/gi;
  for (const m of s.matchAll(pval)) {
    const idx = m.index ?? 0;
    const numAt = idx + m[0].lastIndexOf(m[1]);
    push(out, occupied, original, numAt, numAt + m[1].length, m[1], Number(m[1]), "p-value");
  }

  const temp = new RegExp(`(${NUM})\\s*°\\s*C`, "gi");
  for (const m of s.matchAll(temp)) {
    const idx = m.index ?? 0;
    push(out, occupied, original, idx, idx + m[1].length, m[1], Number(m[1]), "temperature", "°C");
  }

  const wordHour =
    /\b((?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|zero|one|two|three|four|five|six|seven|eight|nine)\s+hours?\b/gi;
  for (const m of s.matchAll(wordHour)) {
    const n = parseNumberWord(m[1]);
    if (n === null) continue;
    const idx = m.index ?? 0;
    push(out, occupied, original, idx, idx + m[0].length, m[0], n, "duration", "hours");
  }

  const wordAny =
    /\b((?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/gi;
  for (const m of s.matchAll(wordAny)) {
    const n = parseNumberWord(m[1]);
    if (n === null) continue;
    const idx = m.index ?? 0;
    push(out, occupied, original, idx, idx + m[0].length, m[0], n, "count");
  }

  const digitHour = new RegExp(`(${NUM})\\s*(hours?|hrs?|h)\\b`, "gi");
  for (const m of s.matchAll(digitHour)) {
    const idx = m.index ?? 0;
    push(out, occupied, original, idx, idx + m[1].length, m[1], Number(m[1]), "duration", "hours");
  }

  const pct = new RegExp(`(${NUM})\\s*%`, "g");
  for (const m of s.matchAll(pct)) {
    const idx = m.index ?? 0;
    push(out, occupied, original, idx, idx + m[1].length, m[1], Number(m[1]), "percent", "%");
  }

  const dose = new RegExp(`(${NUM})\\s*(mg|mcg|µg|g|ml|mL)\\b`, "g");
  for (const m of s.matchAll(dose)) {
    const idx = m.index ?? 0;
    push(out, occupied, original, idx, idx + m[1].length, m[1], Number(m[1]), "dose", m[2]);
  }

  const rest = new RegExp(NUM, "g");
  for (const m of s.matchAll(rest)) {
    const idx = m.index ?? 0;
    const raw = m[0];
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) continue;
    if (/^(19|20)\d{2}$/.test(raw) && Math.abs(numeric) >= 1900) continue;
    push(out, occupied, original, idx, idx + raw.length, raw, numeric, "estimate");
  }

  out.sort((a, b) => a.start - b.start);
  return out;
}

export function parseNumberWord(phrase: string): number | null {
  const p = phrase.trim().toLowerCase().replace(/\s+/g, "-");
  if (p in ONES) return ONES[p];
  if (p in TENS) return TENS[p];
  const parts = p.split("-");
  if (parts.length === 2 && parts[0] in TENS && parts[1] in ONES) return TENS[parts[0]] + ONES[parts[1]];
  return null;
}

export function sentencesWithOffsets(s: string): { text: string; start: number; end: number }[] {
  const cps = codePoints(s);
  const out: { text: string; start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i];
    const next = cps[i + 1];
    const isEnd = ch === "." || ch === "!" || ch === "?" || ch === ";";
    const boundary = isEnd && (next === undefined || /\s/.test(next));
    if (boundary) {
      const text = cps.slice(start, i + 1).join("").trim();
      if (text) out.push({ text, start, end: i + 1 });
      start = i + 1;
    }
  }
  const tail = cps.slice(start).join("").trim();
  if (tail) out.push({ text: tail, start, end: cps.length });
  return out;
}

export function sentenceAt(s: string, start: number, end: number): string {
  for (const sent of sentencesWithOffsets(s)) {
    if (start >= sent.start && end <= sent.end) return sent.text;
  }
  return sliceCp(s, Math.max(0, start - 40), Math.min(codePoints(s).length, end + 40));
}
