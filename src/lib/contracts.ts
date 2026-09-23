/**
 * Runtime input/output contracts for model responses and other untrusted JSON.
 *
 * TypeScript annotations and JSON-shaped prompt text are not validation. These helpers make the
 * three distinctions the studio needs at runtime and record every decision as an `Issue`:
 *
 *   omitted   — the key is absent            → leave the stored value alone (do not overwrite)
 *   cleared   — the key is explicitly null   → clear the stored value (an intentional act)
 *   unknown   — the value is present but not usable (wrong type, out of range, bad enum)
 *             → store `null`/drop it and record an Issue; never substitute a plausible default
 *
 * Nothing here invents a year, a score, a boolean or an enum member.
 */

export type IssueCode =
  | "invalid-type"
  | "invalid-enum"
  | "out-of-range"
  | "malformed-boolean"
  | "dropped"
  | "resolved"
  | "cleared"
  | "not-an-object"
  | "unresolved-reference"
  | "id-collision"
  | "unsupported"
  | "quote-not-in-source"
  /** A model said a gate is met, but its evidence is not anchored in investigator-entered text. */
  | "ungrounded-gate"
  /** A source-derived claim whose passage or numbers do not occur in the cited record's stored text. */
  | "claim-unsupported";

export interface Issue {
  path: string;
  code: IssueCode;
  message: string;
  value?: unknown;
}

export class Issues {
  readonly list: Issue[] = [];
  add(path: string, code: IssueCode, message: string, value?: unknown): void {
    this.list.push(value === undefined ? { path, code, message } : { path, code, message, value });
  }
  get hasErrors(): boolean {
    return this.list.some((i) => i.code !== "resolved" && i.code !== "cleared");
  }
}

export function formatPartialApplyNotice(issues: { path: string; code: string; message?: string }[]): string {
  if (!issues.length) return "";
  const detail = issues
    .map((i) => `${i.path}: ${i.message && i.message.trim() ? i.message : i.code}`)
    .join("; ");
  return `Applied with notes. ${detail}`;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** True when the key exists on the object, even if its value is null. */
export function present(raw: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(raw, key);
}

/** A string, or undefined when absent/invalid (issue recorded). */
export function stringOrUndefined(v: unknown, path: string, issues: Issues): string | undefined {
  if (v === undefined) return undefined;
  if (v === null) {
    issues.add(path, "cleared", "explicitly cleared");
    return "";
  }
  if (typeof v === "string") return v;
  issues.add(path, "invalid-type", `expected string, got ${typeof v}`, v);
  return undefined;
}

/** Only genuine strings survive. Objects are dropped with an issue — never coerced to "[object Object]". */
export function stringArray(v: unknown, path: string, issues: Issues): string[] | undefined {
  if (v === undefined) return undefined;
  if (v === null) {
    issues.add(path, "cleared", "explicitly cleared");
    return [];
  }
  if (!Array.isArray(v)) {
    issues.add(path, "invalid-type", `expected string[], got ${typeof v}`, v);
    return undefined;
  }
  const out: string[] = [];
  v.forEach((x, i) => {
    if (typeof x === "string") {
      if (x.trim()) out.push(x);
    } else {
      issues.add(`${path}[${i}]`, "dropped", `non-string element dropped (${typeof x})`, x);
    }
  });
  return out;
}

/**
 * Enum membership. Invalid members are *explicitly resolved* to `fallback` and recorded as an
 * issue, so the resolution is visible. When no fallback is supplied the value becomes undefined.
 */
export function enumOrResolve<T extends string>(
  values: readonly T[],
  v: unknown,
  path: string,
  issues: Issues,
  fallback?: T,
): T | undefined {
  if (v === undefined) return undefined;
  if (v === null) {
    // Explicit null means "none / not applicable" — a legitimate answer, not an invalid member.
    issues.add(path, "cleared", "explicitly null");
    return undefined;
  }
  if (typeof v === "string" && (values as readonly string[]).includes(v)) return v as T;
  if (fallback !== undefined) {
    issues.add(path, "resolved", `"${String(v)}" is not one of [${values.join(", ")}]; resolved to "${fallback}"`, v);
    return fallback;
  }
  issues.add(path, "invalid-enum", `"${String(v)}" is not one of [${values.join(", ")}]`, v);
  return undefined;
}

/** Integer score in [min, max], or null when absent, non-numeric or out of range (issue recorded). */
export function scoreOrNull(
  v: unknown,
  path: string,
  issues: Issues,
  min = 0,
  max = 100,
): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    issues.add(path, "invalid-type", `expected number in [${min}, ${max}], got ${typeof v}`, v);
    return null;
  }
  if (v < min || v > max) {
    issues.add(path, "out-of-range", `${v} is outside [${min}, ${max}]; stored as unknown`, v);
    return null;
  }
  return Math.round(v);
}

/** Publication year as a plausible integer, or null. Never a guessed year. */
export function yearOrNull(v: unknown, path: string, issues: Issues, now = new Date()): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === "string" && /^\d{4}$/.test(v.trim()) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n)) {
    issues.add(path, "invalid-type", `expected a 4-digit year, got ${JSON.stringify(v)}`, v);
    return null;
  }
  const max = now.getFullYear() + 1;
  if (n < 1800 || n > max) {
    issues.add(path, "out-of-range", `${n} is not a plausible publication year (1800–${max})`, v);
    return null;
  }
  return n;
}

/** Only true/false are booleans. "false", "yes", 1, 0 are malformed and become null with an issue. */
export function strictBoolOrNull(v: unknown, path: string, issues: Issues): boolean | null {
  if (v === undefined || v === null) return null;
  if (v === true || v === false) return v;
  issues.add(path, "malformed-boolean", `expected true/false, got ${JSON.stringify(v)}; stored as unknown`, v);
  return null;
}

/** Non-negative integer count, or null. */
export function countOrNull(v: unknown, path: string, issues: Issues): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    issues.add(path, "invalid-type", `expected a non-negative integer, got ${JSON.stringify(v)}`, v);
    return null;
  }
  return v;
}

/** Array of objects; non-object elements are dropped with an issue. */
export function objectArray(
  v: unknown,
  path: string,
  issues: Issues,
): Record<string, unknown>[] | undefined {
  if (v === undefined) return undefined;
  if (v === null) {
    issues.add(path, "cleared", "explicitly cleared");
    return [];
  }
  if (!Array.isArray(v)) {
    issues.add(path, "invalid-type", `expected an array, got ${typeof v}`, v);
    return undefined;
  }
  const out: Record<string, unknown>[] = [];
  v.forEach((x, i) => {
    if (isRecord(x)) out.push(x);
    else issues.add(`${path}[${i}]`, "dropped", `non-object element dropped`, x);
  });
  return out;
}

/** Remove keys whose value is undefined so a spread-merge leaves stored values untouched. */
export function compactPatch<T extends Record<string, unknown>>(patch: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}
