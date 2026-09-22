/** Identifier and title normalisation shared by adapters, verification and de-duplication. */

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"'<>)\]]+)/i;

/** Lower-case DOI without resolver prefix or trailing punctuation; undefined when none is found. */
export function normalizeDoi(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const m = input.match(DOI_RE);
  if (!m) return undefined;
  return m[1].replace(/[.,;:]+$/, "").toLowerCase();
}

export function isPmid(input: string | undefined | null): boolean {
  return !!input && /^\d{1,9}$/.test(input.trim());
}

const STOP = new Set([
  "a", "an", "and", "the", "of", "in", "for", "on", "with", "to", "at", "by", "from", "versus", "vs",
  "or", "as", "is", "are", "be", "study", "trial", "randomized", "randomised", "controlled",
]);

/** ASCII tokenisation used for Latin titles. Empty for CJK-only strings. */
export function normalizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));
}

/** Unicode-aware title key. Empty input is not equivalent to any other empty input. */
export function unicodeTitleKey(title: string): string {
  return (title ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titlesExactlyEquivalent(a: string, b: string): boolean {
  const ua = unicodeTitleKey(a);
  const ub = unicodeTitleKey(b);
  if (!ua || !ub) return false;
  if (ua === ub) return true;
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  return na.length > 0 && nb.length > 0 && na.join(" ") === nb.join(" ");
}

/** Token Jaccard similarity in [0, 1]. Deterministic; no model involved. Unicode letters when ASCII tokens are empty. */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeTitle(a));
  const tb = new Set(normalizeTitle(b));
  if (ta.size && tb.size) {
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return inter / (ta.size + tb.size - inter);
  }
  const ua = unicodeTitleKey(a).replace(/\s+/g, "");
  const ub = unicodeTitleKey(b).replace(/\s+/g, "");
  if (!ua || !ub) return 0;
  const sa = new Set(ua);
  const sb = new Set(ub);
  let inter = 0;
  for (const c of sa) if (sb.has(c)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Key used to link reports of the same work when no DOI is available. */
export function titleYearKey(title: string, year: number | null): string {
  const ascii = normalizeTitle(title).slice(0, 12).join(" ");
  const key = ascii || unicodeTitleKey(title).slice(0, 48);
  return `${key}|${year ?? "?"}`;
}
