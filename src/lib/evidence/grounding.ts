import type { Claim, ClaimAssertion, Study } from "../types";
import { documentsForRecord, supportClaim } from "./support";

/*
 * Two checks that sit beside S1 (support.ts), which stays the one authority on whether a claim's
 * quotation and numbers resolve to a cited source sentence:
 *
 *  1. checkClaim(claim, study): the ledger-level re-check used when a claim is shown, counted or used
 *     for a decision. It re-runs S1 on the study's current stored texts (a claim admitted at appraisal
 *     time is re-checked if texts change, and claims that entered the ledger by another route are
 *     checked at all) and adds one check S1 does not make: a stored text that shares no content word
 *     with its record's title may belong to another work.
 *  2. groundedInInvestigatorText(statement, investigator): whether a statement a model makes about the
 *     investigator's world (a gate "met", a local fact) is anchored in text the investigator entered.
 */

export type LedgerCheckStatus = "supported" | "not-source-derived" | "no-source-text" | "text-title-mismatch" | "unsupported";

export interface LedgerCheck {
  claimId: string;
  status: LedgerCheckStatus;
  /** Blocking statuses mean the claim cannot support a decision. */
  blocking: boolean;
  /** Fractions and ratios in words ("about three quarters", "one in five"): shown to compare, not checked. */
  approximateFigures: string[];
  checkedSourceIds: string[];
  message: string;
}

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

/*
 * A provider can attach the wrong abstract to a record. In the live run of 2026-09-22 OpenAlex gave a
 * CMAJ paper on medication errors in critical care the abstract of a stroke thrombectomy study, and the
 * Crossref check still "verified" it (the check compares titles, not text). A stored text that shares
 * none of the title's content words is flagged: a claim cannot rest on it until checked.
 */
const TITLE_STOP = new Set([
  "study", "studies", "trial", "trials", "patients", "patient", "review", "reviews", "analysis", "effect", "effects",
  "among", "using", "based", "versus", "after", "during", "between", "clinical", "randomized", "randomised",
  "systematic", "cohort", "retrospective", "prospective", "their", "which", "within", "without", "adults", "adult",
  "outcomes", "outcome", "results", "evaluation", "assessment", "impact", "association", "associated", "report",
]);

export function textMatchesTitle(title: string, text: string): { ok: boolean; titleWords: number; found: number } {
  const words = [...new Set((normalizeForMatch(title).match(/\p{L}{5,}/gu) ?? []).filter((w) => !TITLE_STOP.has(w)))];
  if (words.length < 4 || !text) return { ok: true, titleWords: words.length, found: words.length };
  const body = normalizeForMatch(text);
  const found = words.filter((w) => body.includes(w.slice(0, 5))).length;
  // Zero shared content words only: real abstracts in the bank share a single distinctive title word
  // ("fluoridation", "vignettes"), so one shared word is not a mismatch.
  return { ok: found > 0, titleWords: words.length, found };
}

/*
 * Fractions and ratios written in words are approximations of a source figure, not numbers the source
 * must contain verbatim ("about three quarters" for a reported 76 percent is faithful). S1's extractor
 * does not read them as numbers; the ledger lists them so the reader can compare with the source.
 */
const FRACTION_NOUN = "halves|half|thirds|third|quarters|quarter|fifths|fifth|sixths|sixth|tenths|tenth";
const SMALL_WORD = "a|an|one|two|three|four|five|six|seven|eight|nine";
const FRACTION_RE = new RegExp(
  [
    `\\b(?:${SMALL_WORD})[-\\s]+(?:${FRACTION_NOUN})\\b`,
    `\\bhalf\\b`,
    `\\b(?:${SMALL_WORD})\\s+(?:in|out of)\\s+(?:two|three|four|five|six|seven|eight|nine|ten|twenty|\\d{1,3})\\b`,
    `\\b\\d{1,2}\\s+in\\s+\\d{1,3}\\b`,
  ].join("|"),
  "gi",
);

export function approximateFigures(text: string): string[] {
  return [...new Set([...(text ?? "").matchAll(FRACTION_RE)].map((m) => m[0].toLowerCase().replace(/\s+/g, " ")))];
}

/** The ledger-level check of one claim against the study's current stored texts. */
export function checkClaim(claim: Claim, study: Pick<Study, "scan" | "documents">): LedgerCheck {
  const approx = approximateFigures(claim.text);
  const base = { claimId: claim.id, approximateFigures: approx, checkedSourceIds: [] as string[] };
  if (claim.kind !== "source-derived") {
    return { ...base, status: "not-source-derived", blocking: false, message: `${claim.kind} claims are not checked against source text` };
  }
  const documents = study.documents ?? [];
  const byId = new Map(study.scan.items.map((i) => [i.id, i]));
  const cited = claim.sourceIds.map((id) => byId.get(id)).filter((i): i is NonNullable<typeof i> => !!i);
  const withText = cited
    .map((item) => ({ item, docs: documentsForRecord(item.id, documents, item).filter((d) => d.text) }))
    .filter((x) => x.docs.length > 0);
  const checkedSourceIds = withText.map((x) => x.item.id);
  if (claim.sourceIds.length && cited.length === claim.sourceIds.length && !withText.length) {
    return {
      ...base,
      status: "no-source-text",
      blocking: false,
      message: "no stored text for the cited record(s); the claim cannot be checked (metadata or lead only)",
    };
  }
  const mismatched = withText.filter(({ item, docs }) => docs.some((d) => !textMatchesTitle(item.title ?? "", d.text).ok));
  if (mismatched.length) {
    return {
      ...base,
      status: "text-title-mismatch",
      blocking: true,
      checkedSourceIds,
      message: `the stored text of ${mismatched.map((m) => m.item.id).join(", ")} shares no content word with its title and may belong to another work; check the record before relying on this claim`,
    };
  }
  const known = new Map<string, ClaimAssertion>(
    (study.scan.claims ?? []).filter((c) => c.assertion && c.id !== claim.id).map((c) => [c.id, c.assertion!]),
  );
  const verdict = supportClaim(claim, study.scan.items, documents, `claims[${claim.id}]`, known);
  const note = approx.length ? `; approximate figure(s) in words, compare with the source: ${approx.join(", ")}` : "";
  if (verdict.status === "supported") {
    return { ...base, status: "supported", blocking: false, checkedSourceIds, message: `quotation and numbers resolve to the cited source text${note}` };
  }
  const reasons = verdict.issues.map((i) => i.message).filter(Boolean);
  return {
    ...base,
    status: "unsupported",
    blocking: true,
    checkedSourceIds,
    message: `${reasons.length ? reasons.join("; ") : "the claim does not resolve to the cited source text"}${note}`,
  };
}

export function ledgerChecks(study: Pick<Study, "scan" | "documents">): Map<string, LedgerCheck> {
  return new Map((study.scan.claims ?? []).map((c) => [c.id, checkClaim(c, study)]));
}

/*
 * Grounding of investigator-side facts. A model may say a gate is met ("REB file 26-311 approved,
 * supplied by the investigator") or state a local fact. Meridian can check whether the specific
 * anchors of that statement (record numbers, figures, a verbatim phrase) occur in text the investigator
 * actually entered. An identifier the investigator never supplied cannot count.
 */

/** Everything the investigator typed about the setting: the need, the constraints and the local facts. */
export function investigatorText(study: Pick<Study, "problem">): string {
  const parts = [study.problem.rawNeed, study.problem.constraints];
  for (const f of study.problem.localFacts ?? []) if (f.by === "investigator") parts.push(f.text);
  return parts.filter(Boolean).join("\n");
}

/*
 * D10 / S5: the investigator's statements of fact about the setting are the constraints and the local
 * facts. The need is a request for help (wishes, questions, plans) and never grounds a gate. In the
 * recorded bank replies, 169 of the 179 met gates rest on local facts and 10 on constraints; none needs
 * the need text.
 */
export function investigatorFactText(study: Pick<Study, "problem">): string {
  const parts = [study.problem.constraints];
  for (const f of study.problem.localFacts ?? []) if (f.by === "investigator") parts.push(f.text);
  return parts.filter(Boolean).join("\n");
}

/** The study's own description as the investigator typed it: the need and the constraints (a model reply can set the title). */
export function studyOwnText(study: Pick<Study, "problem">): string {
  return [study.problem.rawNeed, study.problem.constraints].filter(Boolean).join("\n");
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

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const TENS_UNITS_RE = new RegExp(`\\b(${Object.keys(TENS).join("|")})[-\\s](one|two|three|four|five|six|seven|eight|nine)\\b`, "gi");
const TENS_RE = new RegExp(`\\b(${Object.keys(TENS).join("|")})\\b`, "gi");
const UNITS_RE = new RegExp(`\\b(${Object.keys(UNITS).join("|")})\\b`, "gi");

function numberWordsToDigits(text: string): string {
  return (text ?? "")
    .replace(TENS_UNITS_RE, (_, t: string, u: string) => String(TENS[t.toLowerCase()] + UNITS[u.toLowerCase()]))
    .replace(TENS_RE, (_, t: string) => String(TENS[t.toLowerCase()]))
    .replace(UNITS_RE, (_, u: string) => String(UNITS[u.toLowerCase()]));
}

/*
 * Figures as anchors ("48 beds", "2 FTE") count only with their context: the same figure must appear in
 * the investigator's text beside at least one of the content words that stand within four words of it
 * in the statement, so "12 months of protected time" is not anchored by "The unit has 12 beds". This is
 * anchor matching, not claim support (S1 in support.ts decides that).
 */
function figureContexts(text: string): Map<string, Set<string>> {
  const toks = normalizeForMatch(numberWordsToDigits(text)).split(/[\s/;:()[\]]+/).filter(Boolean);
  const out = new Map<string, Set<string>>();
  toks.forEach((tok, i) => {
    const m = tok.match(/^\$?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(%?)[.,]?$/);
    if (!m) return;
    const key = `${String(Number(m[1].replace(/,/g, "")))}${m[2]}`;
    const ctx = out.get(key) ?? new Set<string>();
    for (let j = Math.max(0, i - 4); j <= Math.min(toks.length - 1, i + 4); j++) {
      if (j === i) continue;
      const w = toks[j].replace(/[^\p{L}]/gu, "");
      if (w.length >= 4 && !CONTENT_STOP.has(w)) ctx.add(w.slice(0, 5));
    }
    out.set(key, ctx);
  });
  return out;
}

/** Figures of two or more digits (or percentages); single digits are too common to anchor anything. */
function significantFigures(figs: Map<string, Set<string>>): [string, Set<string>][] {
  return [...figs].filter(([n]) => n.endsWith("%") || n.replace(/\./g, "").length >= 2);
}

export interface Grounding {
  grounded: boolean;
  foundAnchors: string[];
  missingAnchors: string[];
  reason: string;
  /** The investigator clauses that hold the anchors; the scope, authority and conflict checks read them. */
  sentences?: string[];
  /** The same clauses with the sentence they come from and whether an identifier anchored them. */
  clauseAnchors?: { text: string; sentence: string; byId: boolean }[];
}

/*
 * A sentence of the investigator's that says something is not in place ("has not been requested",
 * "decision pending", "submitted on 2026-09-01", "is expected in October") cannot ground a claim that
 * it is in place, even though it contains the same record number or words.
 */
const NOT_IN_PLACE_STRONG = new RegExp(
  [
    // Strong signals only. Generic negation ("do not need review", "is not covered", "not requiring")
    // and "requested" ("the committee requested the review") describe things that are in place; the
    // bank rerun showed six such false alarms with a broader pattern.
    String.raw`\b(?:has|have|had)\s+not\s+(?:yet\s+)?(?:been\s+)?(?:approved|granted|agreed|decided|confirmed|obtained|signed|funded|reviewed|requested|submitted|given|issued|said|answered|replied|received|sought|renewed)\b`,
    String.raw`\b(?:hasn't|haven't|hadn't)\s+(?:yet\s+)?(?:been\s+)?\w+`,
    String.raw`\bnot\s+yet\b`,
    String.raw`\bno\s+longer\b`,
    String.raw`\b(?:confirmed|acknowledged)\s+receipt\b|\breceived\s+(?:the|our)\s+(?:application|submission|request)\b|\b(?:application|submission)\s+(?:was\s+|has been\s+)?received\b`,
    String.raw`\b(?:is|are|was|were)\s+not\s+(?:approved|granted|signed|funded|agreed|confirmed|issued|given|renewed|extended|available)\b`,
    String.raw`\b(?:was|were|has been|have been|is|are)\s+(?:declined|refused|rejected|denied|withdrawn|suspended|revoked|cancell?ed|rescinded|terminated|stopped|removed)\b`,
    String.raw`\b(?:pending|awaiting|undecided|unresolved|expired|lapsed|yet to|under review|in review|unknown whether|under consideration|being considered|being reviewed|in preparation)\b`,
    String.raw`\b(?:is|are)\s+expected\b|\bexpect(?:s|ed)?\s+(?:it|them|approval|a decision|a reply|an answer)\b|\bexpected\s+(?:in|by|on|before|after|next|later)\b`,
    String.raw`\b(?:submitted|applied for)\b(?![^.;]*\b(?:approved|granted|agreed|accepted)\b)`,
    String.raw`\bto be (?:decided|confirmed|determined|requested|approved|granted|signed|agreed|funded|issued)\b`,
    String.raw`\bno\s+(?:approval|decision|agreement|permission)\s+(?:yet|has been|was)\b`,
  ].join("|"),
  "i",
);
/*
 * An open question is not a fact (D10, SYN-LOCAL-02): "permission for secondary use ... is unknown",
 * "unclear whether the custodian agrees", "status: to be confirmed". Predicate forms only, so that
 * "cancer of unknown primary" stays a fact.
 */
const UNCERTAIN = new RegExp(
  [
    String.raw`\b(?:is|are|was|were|remains?|remained|still|currently|status|as yet)\s+(?:\w+\s+){0,2}?(?:unknown|unclear|uncertain|undetermined|unconfirmed|unverified|unanswered|undecided)\b`,
    String.raw`\b(?:unknown|unclear|uncertain|undecided|not known|not clear)\s+(?:whether|if|how|when|who|what)\b`,
    String.raw`(?:^|:\s*|\(\s*)(?:unknown|unclear|uncertain|not known|tbd|to be confirmed)\b`,
    String.raw`\b(?:not known|do not know|does not know|did not know|don't know|doesn't know|not sure|to be confirmed|to be determined)\b`,
    String.raw`(?:^|\b(?:unknown|unclear|uncertain|undecided|decide[sd]?|deciding|ask(?:ed|s)?|asking|check(?:ed|s)?|checking|know|knows|sure|determine[sd]?|confirm(?:ed|s)?|confirming|wonder(?:ing)?|consider(?:s|ed|ing)?|discuss(?:ed|ing)?|said|say|told)\s+)whether\b`,
    String.raw`\b(?:is|are|was|were|remains?)\s+not\s+(?:known|clear|established|confirmed|settled|agreed)\b`,
  ].join("|"),
  "i",
);
/** Questions, needs, obligations and wishes are not facts either ("We need REB approval", "must be approved"). */
const QUESTION = /\?\s*\)?\s*$/;
const OBLIGATION =
  /\b(?:must|has to|have to|had to|needs? to|we need|i need|they need|you need|is required|are required|will be required|should|would like|wants? to|wanted to|wish(?:es)? to|hopes? to|plans? to|planning to|intends? to|intending to|aims? to|would need)\b/i;
const NOT_IN_PLACE = { test: (t: string) => NOT_IN_PLACE_STRONG.test(normalizeForMatch(t)) || UNCERTAIN.test(normalizeForMatch(t)) };

export function investigatorSentences(investigator: string): { text: string; notInPlace: boolean }[] {
  return (investigator ?? "")
    .split(/\n+|(?<=[.;!?])\s+(?=[A-Z0-9"(])/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => ({ text, notInPlace: NOT_IN_PLACE.test(text) }));
}

/** Lower-case words and digits only, with "n't" written out as " not". */
function flatWords(s: string): string {
  return normalizeForMatch(s).replace(/n't\b/g, " not").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
}

export interface FactClause {
  text: string;
  sentence: string;
  norm: string;
  flat: string;
  stems: Set<string>;
  /** Not a statement of fact: not in place, uncertain, a question, a need, an obligation or a wish. */
  notFact: boolean;
}

const clauseCache = new Map<string, FactClause[]>();
const STATUS_STEMS = new Set(["statu", "pendi", "unkno", "uncle", "uncer", "confi", "await", "expec", "decis", "revie", "known", "clear", "sure", "yet", "still", "outst", "open", "curre", "later", "month", "week", "decid", "deter"]);

/*
 * The investigator's text in clauses: sentences split at semicolons. A clause that says something is
 * pending or unknown does not take a separate, settled clause of the same sentence down with it ("REB
 * approval granted; whether the pharmacy signs is unknown"), unless it names nothing of its own.
 */
export function factClauses(investigator: string): FactClause[] {
  const key = investigator ?? "";
  const hit = clauseCache.get(key);
  if (hit) return hit;
  const out: FactClause[] = [];
  for (const s of investigatorSentences(key)) {
    const parts: FactClause[] = [];
    for (const part of s.text.split(/;\s+/)) {
      const text = part.trim();
      if (!text) continue;
      const norm = normalizeForMatch(text);
      const notFact = NOT_IN_PLACE_STRONG.test(norm) || UNCERTAIN.test(norm) || QUESTION.test(norm) || OBLIGATION.test(norm);
      parts.push({ text, sentence: s.text, norm, flat: flatWords(text), stems: contentStems(text), notFact });
    }
    // "REB approval REB-2026-188; status: pending": a status clause with no subject of its own speaks
    // about the rest of the sentence.
    if (parts.some((c) => c.notFact && [...c.stems].every((w) => STATUS_STEMS.has(w)))) for (const c of parts) c.notFact = true;
    out.push(...parts);
  }
  if (clauseCache.size > 64) clauseCache.clear();
  clauseCache.set(key, out);
  return out;
}

const NEGATION_WORDS = new Set(["no", "not", "never", "none", "nil", "zero", "0", "without", "nobody", "neither", "nor", "cannot", "lacks", "lack", "lacking", "lost"]);

/** Whether `phrase` occurs in `flat` at least once without a negation within the three words before it. */
function nonNegatedOccurrence(flat: string, phrase: string): boolean {
  const hay = ` ${flat} `;
  let from = 0;
  for (;;) {
    const at = hay.indexOf(` ${phrase} `, from);
    if (at < 0) return false;
    const before = hay.slice(0, at).trim().split(" ").slice(-3);
    if (!before.some((w) => NEGATION_WORDS.has(w))) return true;
    from = at + 1;
  }
}

export function groundedInInvestigatorText(statement: string, investigator: string): Grounding {
  const clauses = factClauses(investigator);
  const facts = clauses.filter((c) => !c.notFact);
  const hay = facts.map((c) => c.norm).join("\n");
  const ids = identifierTokens(statement);
  const missingIds = ids.filter((id) => !hay.includes(normalizeForMatch(id)));
  if (missingIds.length) {
    const contradicting = clauses.find((c) => c.notFact && missingIds.some((id) => c.norm.includes(normalizeForMatch(id))));
    return {
      grounded: false,
      foundAnchors: [],
      missingAnchors: missingIds,
      reason: contradicting
        ? `the evidence cites ${missingIds.join(", ")}, but the investigator's own words say it is not in place: "${trimQuote(contradicting.sentence)}"`
        : `the evidence cites ${missingIds.join(", ")}, which the investigator never supplied as a fact`,
    };
  }
  const statementFigs = figureContexts(statement);
  const factFigs = facts.map((c) => figureContexts(c.text));
  const foundNums: string[] = [];
  const missingNums: string[] = [];
  for (const [n, ctx] of significantFigures(statementFigs)) {
    const ok = factFigs.some((figs) => {
      const have = figs.get(n);
      return !!have && [...ctx].some((w) => have.has(w));
    });
    (ok ? foundNums : missingNums).push(n);
  }
  // A verbatim run of 5+ words from one investigator clause also anchors the statement, unless the
  // investigator's words negate it there ("no research time is allocated to this project").
  const words = flatWords(statement).split(" ").filter(Boolean);
  let phrase = "";
  for (let i = 0; i + 5 <= words.length && !phrase; i++) {
    const run = words.slice(i, i + 5);
    if (run.some((w) => NEGATION_WORDS.has(w))) continue;
    const cand = run.join(" ");
    if (facts.some((c) => nonNegatedOccurrence(c.flat, cand))) phrase = cand;
  }
  const anchors = [...ids, ...foundNums, ...(phrase ? [`"${phrase}"`] : [])];
  if (!anchors.length) {
    return {
      grounded: false,
      foundAnchors: [],
      missingAnchors: missingNums,
      reason: "the evidence names nothing the investigator entered as a fact (no record number, figure or phrase from the local facts or constraints)",
    };
  }
  if (missingNums.length && !phrase && !ids.length) {
    return { grounded: false, foundAnchors: anchors, missingAnchors: missingNums, reason: `the evidence states ${missingNums.join(", ")}, which the investigator's facts do not contain` };
  }
  const clauseAnchors: { text: string; sentence: string; byId: boolean }[] = [];
  facts.forEach((c, k) => {
    const byId = ids.some((id) => c.norm.includes(normalizeForMatch(id)));
    const byPhrase = !!phrase && nonNegatedOccurrence(c.flat, phrase);
    const byFigure = foundNums.some((num) => {
      const have = factFigs[k].get(num);
      const ctx = statementFigs.get(num);
      return !!have && !!ctx && [...ctx].some((w) => have.has(w));
    });
    if (byId || byPhrase || byFigure) clauseAnchors.push({ text: c.text, sentence: c.sentence, byId });
  });
  return {
    grounded: true,
    foundAnchors: anchors,
    missingAnchors: missingNums,
    reason: `anchored in investigator text: ${anchors.join(", ")}`,
    sentences: clauseAnchors.map((a) => a.text),
    clauseAnchors,
  };
}

/*
 * A gate can also rest on the investigator's own statement of the requirement: a model that paraphrases
 * a local fact ("network data team capability stated in the investigator's local facts") names no
 * record number or verbatim phrase, yet the investigator did write that the resource exists (bank
 * scenario sc-083: "the network data team can extract coded consultations and prescriptions monthly").
 * The requirement counts as stated only when one investigator sentence asserts it: the sentence covers
 * at least three of the requirement's content words and 60 percent of them, contains every figure the
 * requirement names, and is a plain statement. Sentences that say something is pending, refused or
 * unknown, that negate ("no", "not", "without"), that state a need, plan, wish or condition ("must",
 * "will", "would like", "if", "is required", a question), or that report part of what the requirement
 * asks for all of ("eleven of the 14 practices" against "all 14 practices") never count. Identifiers or
 * figures the investigator never supplied, in the requirement or in the model's evidence, refuse the gate.
 */
const NEGATED =
  /\b(?:no|not|none|never|without|cannot|can't|unable|unavailable|lack|lacks|lacking|nobody|neither|nor|unsigned|unapproved|unfunded|unconfirmed|returned)\b/i;
/*
 * Words that carry authority (an approval, an agreement, a signature, funding): when the requirement
 * names one, the investigator's sentence must name the same thing, not only its topic ("analysis only
 * through the custodian's secure service" does not say the custodian approved the analysis).
 */
const AUTHORITY_STEMS = ["approv", "agree", "consent", "permi", "authori", "sign", "waive", "clear", "licen", "contract", "fund", "budget", "allocat", "grant", "endorse", "sanction", "mandate"];
function authorityStems(text: string): string[] {
  const t = normalizeForMatch(text);
  return AUTHORITY_STEMS.filter((st) => new RegExp(`\\b${st}`, "i").test(t));
}
const INTENT =
  /\b(?:must|needs?|needed|require[sd]?|requiring|will|would|shall|should|could|may|might|plan(?:s|ned|ning)?|intend(?:s|ed)?|hope(?:s|d)?|wish(?:es)?|want(?:s|ed)?|aim(?:s|ed)?|propos(?:e|es|ed)|expect(?:s|ed)?|if|unless|whether|seek(?:s|ing)?|apply|applying|to be)\b/i;
const ALL_OF = /\b(?:all|every|each|whole|entire)\b/i;
const PARTIAL =
  /\b(?:[a-z]+|\d+)\s+of\s+(?:the\s+)?\d+\b|\b\d+(?:\.\d+)?\s*(?:%|percent|per cent)|\b(?:some|most|many|few|half|part|several|majority|minority|about|around|approximately|nearly|almost)\b/i;
const CONTENT_STOP = new Set(
  "that this these those with from into onto over under their there which while where when what will would could should must have been being also only such than then them they your ours about after before during each every other more most some many much very because since already therefore thus hence still just".split(
    " ",
  ),
);

function contentStems(text: string): Set<string> {
  const words = normalizeForMatch(text).match(/\p{L}{4,}/gu) ?? [];
  return new Set(words.filter((w) => !CONTENT_STOP.has(w)).map((w) => w.slice(0, 5)));
}

export function requirementStatedByInvestigator(requirement: string, investigator: string): { stated: boolean; sentence?: string; share: number } {
  const req = contentStems(requirement);
  if (req.size < 3) return { stated: false, share: 0 };
  const reqFigures = significantFigures(figureContexts(requirement)).map(([n]) => n);
  const wantsAll = ALL_OF.test(requirement);
  const authority = authorityStems(requirement);
  let best = { stated: false, sentence: undefined as string | undefined, share: 0 };
  for (const x of investigatorSentences(investigator)) {
    const t = x.text.trim();
    if (x.notInPlace || NEGATED.test(t) || INTENT.test(t) || t.endsWith("?")) continue;
    if (wantsAll && PARTIAL.test(t)) continue;
    const said = authorityStems(t);
    if (authority.some((st) => !said.includes(st))) continue;
    const figs = figureContexts(t);
    if (reqFigures.some((n) => !figs.has(n))) continue;
    const have = contentStems(t);
    const hits = [...req].filter((w) => have.has(w)).length;
    const share = hits / req.size;
    if (hits >= 3 && share >= 0.6 && share > best.share) best = { stated: true, sentence: t, share };
  }
  return best;
}

/*
 * D10 / S5: an anchor shows that the model read the investigator's facts, not that the fact it read meets
 * this gate. For a model "met", at least one investigator clause that holds the anchors must pass all of:
 *
 *  1. Topic. A clause anchored only by a phrase or a figure must be about the requirement: it holds half
 *     or more of the requirement's subject words (an approval number anchors without this).
 *  2. Authority. A requirement for an approval, permission or agreement, for funding, or for consent is met
 *     only by a clause that names the same kind of authority.
 *  3. Purpose. Access for patient care is not permission to use data for a study (SYN-LOCAL-04).
 *  4. Another study. A clause about another, previous or separate study, or about a protocol or study
 *     number this study's own description does not name, cannot meet this study's gate (SYN-LOCAL-05).
 *  5. Scope. A clause that limits itself ("only", "limited to") meets a gate only when the requirement
 *     stays inside the limit; a clause that excludes something ("excluding free-text notes") fails only
 *     for a requirement about what it excludes (SYN-LOCAL-03, -05).
 *  6. Conflict. No other clause of the investigator's facts on the same subject says the thing is absent
 *     ("zero protected research time", "no longer"), not in place, unknown, or of a different amount in the
 *     same unit; nor does the anchoring clause itself deny what the evidence quotes (SYN-LOCAL-06). Both
 *     statements stay as entered, and only the investigator decides which holds.
 *
 * Anchors that cannot be tied to one clause refuse the gate. The investigator can always set a gate.
 */
const AUTHORITY_GROUPS: { label: string; need: RegExp; has: RegExp }[] = [
  {
    label: "approval, permission or agreement",
    need: /\b(?:approv\w*|permi(?:t|ts|tted|ssion|ssions)|authori[sz]\w*|clearance|sanction\w*|endors\w*|licen[cs]\w*|waivers?|exemptions?|agreements?|agreed|contracts?|signed|signature|sign-off)\b/i,
    has: /\b(?:approv\w*|permi(?:t|ts|tted|ssion|ssions)|allow(?:s|ed)?|authori[sz]\w*|clear(?:ed|ance)|sanction\w*|endors\w*|licen[cs]\w*|waive[dr]?|waivers?|exempt\w*|grant(?:ed|s)?|agree(?:d|ment|ments|s)?|contract\w*|signed|signature|signatures|sign-off|signoff|sponsor\w*|favou?rable\s+opinion|classified|determined|determination|decided|decision|confirm\w*|screened|accepted|supported|commissioned|requested)\b/i,
  },
  {
    label: "funding",
    need: /\b(?:fund(?:ed|ing|s)?|budget\w*|costs?|costing|payment|paid|award(?:ed|s)?|research\s+grant)\b/i,
    has: /\b(?:fund(?:ed|ing|s)?|budget\w*|costs?|costing|payments?|paid|pay|pays|award(?:ed|s)?|grant(?:ed|s)?|allocat\w*)\b/i,
  },
  { label: "consent", need: /\bconsent\w*\b/i, has: /\bconsent\w*\b/i },
];
const CLINICAL_PURPOSE =
  /\bfor\s+(?:\w+\s+){0,2}care\b|\bclinical\s+(?:use|purposes?|operations?|work|care)\b|\boperational\s+(?:use|purposes?|access)\b|\bfor\s+(?:treatment|care delivery|service delivery|patient management)\b/i;
const STUDY_PURPOSE = /\b(?:research|study|studies|audit|evaluation|analysis|analyses|secondary use|publication|quality improvement|project|review)\b/i;
const DATA_USE = /\b(?:data|record|records|chart|charts|dashboard|registry|database|extracts?|extraction|access\w*|use|view\w*|linkage|notes)\b/i;
const OTHER_STUDY =
  /\b(?:another|previous|prior|earlier|former|past|different|separate|sister|parent|companion|older|last\s+year's|other)\s+(?:\w+\s+){0,2}?(?:study|studies|protocol|protocols|project|projects|trial|trials|registry|registries|application|applications|audit|audits|submission|submissions|review|reviews)\b/i;
const THIS_STUDY =
  /\b(?:this|the present|the current|the proposed|our current|our proposed)\s+(?:[\w-]+\s+){0,2}?(?:study|sub-study|substudy|project|audit|protocol|trial|review|evaluation|initiative|pilot|work|survey|analysis)\b/i;
/** What an approval verb applies to, up to the next punctuation. */
const APPROVED_OBJECT = /\b(?:approved|granted|cleared|endorsed|authori[sz]ed|sanctioned|permitted)\s+(?:the\s+|an?\s+|our\s+|their\s+)?([^.;,()]{0,80})/i;
const STUDY_NOUN = /\b(?:study|studies|sub-study|substudy|project|audit|trial|registry|protocol|evaluation|review|survey|pilot)\b/i;
/** Words about the document rather than its subject ("protocol outline", "full protocol"). */
const DOCUMENT_STEMS = new Set(["outli", "versi", "draft", "amend", "full", "final", "revis", "updat", "origi", "initi", "packa", "summa", "templ", "plan", "descr", "appli", "submi", "dated", "refer"]);
/** A protocol or study named by number ("protocol CARE-KET-01", "study CARE-KET-01"). */
const PROTOCOL_REF = /\b(?:protocol|study|trial|project)\s+(?:no\.?\s*|number\s*|#\s*)?([a-z0-9][a-z0-9/-]*\d[a-z0-9/-]*)/gi;
const INCLUDE_LIMIT =
  /\b(?:only(?!\s+(?:after|before|when|once|until|if|then|from|in\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|\d{4}))\b)|solely|exclusively|limited to|restricted to|specific to|confined to)\b/i;
const EXCLUDE_LIMIT =
  /\b(?:excluding|except(?:\s+for)?|other than|(?:does|do|will|would) not (?:cover|include|extend to|apply to)|not (?:covering|including))\b/i;
/** Words that say how a requirement is met, not what it is about. */
const GENERIC_STEMS = new Set([
  "confi", "docum", "writt", "forma", "obtai", "secur", "place", "requi", "need", "neede", "needs", "avail", "befor", "prior", "start",
  "gate", "evide", "local", "facts", "fact", "inves", "suppl", "state", "enter", "study", "studi", "proje", "work", "curre", "propo",
]);
/** Units and time words: two statements about "hours per week" are not on the same subject for that alone. */
const UNIT_STEMS = new Set(["hours", "hour", "week", "weeks", "month", "days", "year", "years", "minut", "sessi", "perce"]);
const AUTHORITY_WORD = new RegExp(AUTHORITY_GROUPS.map((g) => g.has.source).join("|"), "gi");

function topicStems(text: string): Set<string> {
  return new Set([...contentStems(text)].filter((w) => !GENERIC_STEMS.has(w)));
}

/** The requirement's subject words: its topic without the words of authority ("approval", "agreement"). */
function subjectStems(text: string): string[] {
  return [...topicStems((text ?? "").replace(AUTHORITY_WORD, " "))];
}

/** The original words for some stems, for messages ("night-time, opioid", not "night, opioi"). */
function wordsFor(stems: string[], text: string): string {
  const words = normalizeForMatch(text).match(/\p{L}{4,}/gu) ?? [];
  return stems.map((st) => words.find((w) => w.slice(0, 5) === st) ?? st).join(", ");
}

function trimQuote(s: string): string {
  return s.length > 160 ? `${s.slice(0, 157)}...` : s;
}

const UNIT_ALIASES: Record<string, string> = { hrs: "hours", hr: "hours", h: "hours", hour: "hours", mins: "minut", min: "minut", wks: "weeks", wk: "weeks", week: "weeks", days: "days", day: "days" };
/** Month names: "10 September" is a date, not an amount of Septembers. */
const MONTHS = new Set(["janua", "febru", "march", "april", "may", "june", "july", "augus", "septe", "octob", "novem", "decem", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"]);
const NEGATORS = new Set([...NEGATION_WORDS, "forbids", "forbid", "forbidden", "prohibits", "prohibited", "bars", "barred", "excludes", "excluded", "excluding"]);

/** Words and numbers, with "n't" as " not" and decimals kept whole ("0.4 FTE" is not a zero). */
function tokensOf(text: string): string[] {
  return normalizeForMatch(numberWordsToDigits(text))
    .replace(/n't\b/g, " not")
    .replace(/(\d)\.(\d)/g, "$1d$2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Each figure with its unit (the word after it) and the content words within three tokens of it. Dates and years are not amounts. */
function figureMentions(text: string): { value: string; unit: string; ctx: Set<string> }[] {
  const toks = tokensOf(text);
  const out: { value: string; unit: string; ctx: Set<string> }[] = [];
  toks.forEach((tok, i) => {
    const m = tok.match(/^(\d+(?:d\d+)?)(h|hrs?|mins?)?$/);
    if (!m) return;
    const value = m[1].replace("d", ".");
    const n = Number(value);
    if (!m[2] && Number.isInteger(n) && n >= 1900 && n <= 2100) return;
    const next = toks[i + 1] ?? "";
    const unit = m[2] ? UNIT_ALIASES[m[2]] ?? m[2] : UNIT_ALIASES[next] ?? next.slice(0, 5);
    if (!unit || unit.length < 2 || /^\d/.test(unit) || MONTHS.has(unit) || MONTHS.has(next)) return;
    if (MONTHS.has((toks[i - 1] ?? "").slice(0, 5))) return;
    const ctx = new Set<string>();
    for (let j = Math.max(0, i - 3); j <= Math.min(toks.length - 1, i + 4); j++) {
      const w = toks[j];
      if (j === i || j === i + 1 || w.length < 4 || /\d/.test(w) || CONTENT_STOP.has(w)) continue;
      const st = w.slice(0, 5);
      if (!UNIT_STEMS.has(st) && !MONTHS.has(st) && !GENERIC_STEMS.has(st)) ctx.add(st);
    }
    out.push({ value, unit, ctx });
  });
  return out;
}

/**
 * The stems the text says are absent, read within one segment (commas, parentheses and colons end it):
 * "zero protected research time", "no research nurse", "no longer has protected time", "forbids
 * individual performance management", "does not have protected time", "protected time = 0". After "not"
 * only the next word is negated ("may not leave the programme's system" negates leaving), unless that word
 * is a verb of having ("does not have X"). "No funding beyond a departmental grant" and "not per
 * prescriber" say something else.
 */
const NOUN_NEGATORS = new Set(["no", "zero", "none", "nil", "0", "without", "lost", "lacks", "lack", "lacking", "nobody", "forbids", "forbid", "forbidden", "prohibits", "prohibited", "bars", "barred", "excludes", "excluded", "excluding"]);
const WORD_NEGATORS = new Set(["not", "never", "cannot", "nor", "neither"]);
const HAVING = /^(?:have|has|had|hold|holds|get|gets|receive|receives|include|includes|cover|covers|provide|provides|offer|offers|give|gives|allocate|allocates|fund|funds)$/;
function absentStems(text: string): Set<string> {
  const out = new Set<string>();
  const add = (w: string) => {
    if (w.length >= 3 && !/\d/.test(w)) out.add(w.slice(0, 5));
  };
  const norm = normalizeForMatch(numberWordsToDigits(text)).replace(/n't\b/g, " not").replace(/(\d)\.(\d)/g, "$1d$2");
  for (const segment of norm.split(/[(),;:.!?]+/)) {
    const toks = segment.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    toks.forEach((t, i) => {
      if (!NOUN_NEGATORS.has(t) && !WORD_NEGATORS.has(t)) return;
      let ahead = toks.slice(i + 1, i + 4);
      if (ahead.some((w) => /^(?:beyond|other|than|except|apart|besides|more|further|additional|extra|per|before|after|until|only|just|later|yet)$/.test(w))) return;
      if (WORD_NEGATORS.has(t)) {
        if (ahead[0] === "be" || ahead[0] === "been") ahead = ahead.slice(1);
        ahead = HAVING.test(ahead[0] ?? "") ? toks.slice(i + 2, i + 5) : ahead.slice(0, 1);
      }
      for (const w of ahead) add(w);
      if (/^(?:0|zero|none|nil)$/.test(t)) for (const w of toks.slice(Math.max(0, i - 3), i)) add(w);
    });
  }
  return out;
}

const DIFFERENT_SUBJECT = /\b(?:second|another|other|different|separate|additional|extra)\b/i;
const TOTAL = /\b(?:in total|total|overall|altogether|in all|combined|whole-time|full-time)\b/i;

/**
 * Another clause of the investigator's facts that contradicts the anchoring clause on what the gate is
 * about, or the anchoring clause itself when it denies what the evidence quotes. A status clause (pending,
 * unknown, withdrawn) counts when it shares the anchor's reference number or most of the requirement's
 * subject; an absence counts for a word the anchor affirms and the requirement or evidence names; a
 * different amount counts for the same unit said of the same thing.
 */
export function conflictingFact(requirement: string, anchor: string, investigator: string, quoted = ""): string | null {
  const clauses = factClauses(investigator);
  const anchorClause = clauses.find((c) => c.text === anchor.trim()) ?? null;
  const anchorStems = new Set(subjectStems(anchor).filter((w) => !UNIT_STEMS.has(w)));
  const deniedInAnchor = absentStems(anchor);
  const denied = new Set([...absentStems(requirement), ...absentStems(quoted)]);
  const said = new Set([...subjectStems(requirement), ...subjectStems(quoted)].filter((w) => !UNIT_STEMS.has(w) && !denied.has(w)));
  if ([...deniedInAnchor].some((w) => said.has(w))) return anchorClause?.sentence ?? anchor;
  const reqSubject = subjectStems(requirement);
  const anchorIds = identifierTokens(anchor).map((id) => normalizeForMatch(id));
  const anchorFigures = figureMentions(anchor);
  for (const c of clauses) {
    if (c.text === anchor.trim()) continue;
    if (QUESTION.test(c.norm) || OBLIGATION.test(c.norm)) continue;
    const sameItem = anchorIds.some((id) => c.norm.includes(id));
    const reqShare = reqSubject.length ? reqSubject.filter((w) => c.stems.has(w)).length / reqSubject.length : 0;
    if ((NOT_IN_PLACE_STRONG.test(c.norm) || UNCERTAIN.test(c.norm)) && (sameItem || (reqShare >= 0.6 && reqSubject.length >= 2))) return c.sentence;
    const shared = [...anchorStems].filter((w) => c.stems.has(w));
    const aboutRequirement = reqSubject.some((w) => c.stems.has(w));
    if (shared.length >= 2 && aboutRequirement && [...absentStems(c.text)].some((w) => said.has(w) && anchorStems.has(w) && !deniedInAnchor.has(w))) return c.sentence;
    if (DIFFERENT_SUBJECT.test(c.norm) || TOTAL.test(c.norm)) continue;
    for (const f of figureMentions(c.text)) {
      for (const a of anchorFigures) {
        if (f.unit === a.unit && f.value !== a.value && [...f.ctx].filter((w) => a.ctx.has(w)).length >= 2) return c.sentence;
      }
    }
  }
  return null;
}

/** The words within five tokens before and six after a limit marker: what the limit is about. */
function limitWindow(text: string, re: RegExp): { before: string; after: string } | null {
  const m = re.exec(text);
  if (!m) return null;
  return {
    before: text.slice(0, m.index).split(/\s+/).slice(-5).join(" "),
    after: text.slice(m.index + m[0].length).split(/\s+/).slice(0, 6).join(" "),
  };
}

/** Why one investigator clause cannot meet this gate for a model, or null when it can. */
function clauseRefusal(
  requirement: string,
  anchor: { text: string; sentence: string; byId: boolean },
  own: string,
  cited: string[],
  investigator: string,
  quoted: string,
): string | null {
  const clause = anchor.text;
  const norm = normalizeForMatch(clause);
  const clauseStems = contentStems(clause);
  const subject = subjectStems(requirement);
  const quote = `"${trimQuote(clause)}"`;
  const sentenceNorm = normalizeForMatch(anchor.sentence);
  for (const g of AUTHORITY_GROUPS) {
    if (g.need.test(requirement) && !g.has.test(sentenceNorm)) {
      return `the investigator's statement ${quote} names no ${g.label}, so it does not show that the requirement is met`;
    }
  }
  if (CLINICAL_PURPOSE.test(norm) && !STUDY_PURPOSE.test(norm) && DATA_USE.test(requirement)) {
    return `the investigator's statement ${quote} describes access for patient care, which is not permission to use the data for this study`;
  }
  const thisStudy = THIS_STUDY.test(norm);
  // "The REB approved our previous study (REB-2024-310), and this project builds on it": read the part
  // that holds the reference or the authority word.
  const parts = norm.split(/,\s+(?:and|but|while|whereas)\s+|;\s+/);
  const citedNormAll = cited.map((c) => normalizeForMatch(c));
  const keyPart = parts.find((pt) => citedNormAll.some((c) => pt.includes(c))) ?? parts.find((pt) => AUTHORITY_GROUPS.some((g) => g.has.test(pt))) ?? norm;
  if (OTHER_STUDY.test(keyPart) && !THIS_STUDY.test(keyPart)) {
    return `the investigator's statement ${quote} is about another study, not this one`;
  }
  const ownOutside = normalizeForMatch(own.replace(anchor.sentence, " ").replace(clause, " "));
  // "REB-2025-077 approved the ketamine registry study": an approval whose named object shares no word
  // with this study's own description or the requirement is an approval for something else.
  if (!THIS_STUDY.test(keyPart)) {
    // The object's noun phrase stops at the first preposition ("the survey protocol as minimal risk").
    const object = (APPROVED_OBJECT.exec(keyPart)?.[1] ?? "").split(/\s+(?:as|on|in|for|with|at|by|from|under|until|dated|to|of|subject|provided|pending|while|and|but)\s+/)[0];
    if (STUDY_NOUN.test(object)) {
      const naming = [...topicStems(object.replace(new RegExp(STUDY_NOUN.source, "gi"), " "))].filter((w) => !DOCUMENT_STEMS.has(w) && !UNIT_STEMS.has(w) && !MONTHS.has(w));
      const ownStemsAll = contentStems(ownOutside);
      if (naming.length && !naming.some((w) => ownStemsAll.has(w) || subject.includes(w))) {
        return `the investigator's statement ${quote} gives an approval for ${object.trim()}, which is not what this study is about`;
      }
    }
  }
  const citedNorm = cited.map((c) => normalizeForMatch(c));
  const isCited = (id: string) => citedNorm.some((c) => c.includes(normalizeForMatch(id)));
  const aboutSubject = subject.filter((w) => clauseStems.has(w)).length >= 2 && subject.filter((w) => clauseStems.has(w)).length / Math.max(1, subject.length) >= 0.6;
  if (!thisStudy && !aboutSubject) {
    // Cited or not: evidence that says "REB-2025-077 for protocol CARE-KET-01" still ties the approval
    // to a number this study does not carry.
    const numbered = [...clause.matchAll(PROTOCOL_REF)].map((m) => m[1].replace(/[.,;:)]+$/, ""));
    const foreign = numbered.filter((id) => !ownOutside.includes(normalizeForMatch(id)));
    if (foreign.length) {
      return `the investigator's statement ${quote} concerns ${foreign.join(", ")}, a number this study's own description does not give; if it is this study's, add the number to the study's description or confirm the gate yourself`;
    }
  }
  const include = limitWindow(clause, INCLUDE_LIMIT);
  if (include) {
    const window = `${include.before} ${include.after}`;
    const windowIds = identifierTokens(window).filter((id) => !isCited(id));
    const otherIds = windowIds.filter((id) => !ownOutside.includes(normalizeForMatch(id)));
    if (otherIds.length) {
      return `the investigator's statement is limited to ${otherIds.join(", ")} ${quote}, which this study's own description does not name`;
    }
    const pointsHere = thisStudy || windowIds.length > 0;
    const ownStems = contentStems(ownOutside);
    const object = [...topicStems(window.replace(AUTHORITY_WORD, " ").replace(INCLUDE_LIMIT, " "))].filter((w) => !UNIT_STEMS.has(w));
    if (!pointsHere && object.length && !object.some((w) => ownStems.has(w) || subject.includes(w))) {
      return `the investigator's statement is limited to ${wordsFor(object, window)} ${quote}, which is not what this study is about`;
    }
    const allowed = new Set([...clauseStems, ...contentStems(anchor.sentence), ...(pointsHere ? ownStems : [])]);
    const outside = subject.filter((w) => !allowed.has(w));
    if (outside.length) {
      return `the investigator's statement is limited in scope ${quote}, and the requirement goes beyond it (${wordsFor(outside, requirement)})`;
    }
  }
  const exclude = limitWindow(clause, EXCLUDE_LIMIT);
  if (exclude) {
    const excluded = topicStems(exclude.after);
    const hit = subject.filter((w) => excluded.has(w));
    if (hit.length) {
      return `the investigator's statement excludes ${wordsFor(hit, requirement)} ${quote}`;
    }
  }
  const conflict = conflictingFact(requirement, clause, investigator, quoted);
  if (conflict) {
    return conflict === anchor.sentence
      ? `the investigator's statement "${trimQuote(conflict)}" both states and denies it; only the investigator can say which holds`
      : `the investigator's facts conflict: ${quote} and "${trimQuote(conflict)}"; only the investigator can say which holds`;
  }
  return null;
}

/** The grounding of a gate a model says is met: its evidence anchors first, then the investigator's own statement of the requirement. */
export function gateGrounding(requirement: string, evidence: string, investigator: string, own = ""): Grounding {
  const byEvidence = groundedInInvestigatorText(evidence, investigator);
  const hay = factClauses(investigator)
    .filter((c) => !c.notFact)
    .map((c) => c.norm)
    .join("\n");
  const unsuppliedIds = identifierTokens(requirement).filter((id) => !hay.includes(normalizeForMatch(id)));
  if (unsuppliedIds.length) {
    return { grounded: false, foundAnchors: [], missingAnchors: unsuppliedIds, reason: `the requirement names ${unsuppliedIds.join(", ")}, which the investigator never supplied as a fact` };
  }
  const cited = [...identifierTokens(evidence), ...identifierTokens(requirement)];
  const checked = (g: Grounding, anchors: { text: string; sentence: string; byId: boolean }[]): Grounding => {
    if (!anchors.length) {
      return { ...g, grounded: false, reason: "the evidence's anchors could not be tied to one statement of fact by the investigator" };
    }
    let firstRefusal = "";
    for (const a of anchors) {
      const refusal = clauseRefusal(requirement, a, own, cited, investigator, evidence);
      if (!refusal) return g;
      firstRefusal ||= refusal;
    }
    return { ...g, grounded: false, reason: firstRefusal };
  };
  if (byEvidence.grounded) return checked(byEvidence, byEvidence.clauseAnchors ?? []);
  // An identifier or a figure in the evidence that the investigator never supplied refuses the gate.
  if (identifierTokens(evidence).length || byEvidence.missingAnchors.length) return byEvidence;
  const stated = requirementStatedByInvestigator(requirement, investigator);
  if (stated.stated && stated.sentence) {
    const sentence = stated.sentence;
    return checked(
      {
        grounded: true,
        foundAnchors: [`"${trimQuote(sentence)}"`],
        missingAnchors: [],
        reason: `the investigator's own words state the requirement: "${trimQuote(sentence)}"`,
        sentences: [sentence],
      },
      [{ text: sentence, sentence, byId: true }],
    );
  }
  return byEvidence;
}

/*
 * D10 / S5, SYN-LOCAL-04: a model decision that says no approval, review or consent is needed makes an
 * authorization claim. It stands only when one of the investigator's own statements of fact states that
 * exemption for the same activity (shared subject words or a shared reference number), and is itself
 * settled. Clinical access to data does not count.
 */
const EXEMPTION = new RegExp(
  [
    String.raw`\b(?:needs?|requires?|required)\s+no\s+(?:formal\s+|further\s+|separate\s+|additional\s+|new\s+)?(?:approval|ethics|reb|irb|review|consent|permission|authori[sz]ation|data[- ]use agreement)`,
    String.raw`\bno\s+(?:formal\s+|further\s+|separate\s+|additional\s+|new\s+)?(?:approval|ethics|reb|irb|review|consent|permission|authori[sz]ation)(?:\s+(?:approval|review|submission|application|form))?s?\s+(?:is\s+|are\s+|would be\s+|will be\s+)?(?:needed|required|necessary)`,
    String.raw`\b(?:does|do|did|will|would)\s+not\s+(?:need|require)\s+(?:an?\s+|any\s+)?(?:formal\s+|further\s+|separate\s+|new\s+)?(?:approval|ethics|reb|irb|review|consent|permission|authori[sz]ation)`,
    String.raw`\bnot\s+requiring\s+(?:an?\s+|any\s+)?(?:formal\s+|further\s+|separate\s+|new\s+)?(?:approval|ethics|reb|irb|review|consent|permission|authori[sz]ation)`,
    String.raw`\b(?:approval|ethics|reb|irb|review|consent|permission|authori[sz]ation)(?:\s+(?:approval|review))?\s*:?\s*(?:is\s+not|are\s+not|was\s+not|will\s+not\s+be|would\s+not\s+be|not)\s+(?:needed|required|necessary)`,
    String.raw`\b(?:approval|ethics|reb|irb|review|consent|permission)(?:\s+(?:approval|review))?\s+(?:is|are|was|will be|would be)\s+unnecessary`,
    String.raw`\bexempt(?:ed)?\s+from\s+(?:ethics\s+|reb\s+|irb\s+|research\s+ethics\s+)?(?:review|approval|oversight|consent)`,
    String.raw`\bexemption\s+from\s+(?:ethics\s+|reb\s+|irb\s+|research\s+ethics\s+)?(?:review|approval|oversight)`,
    String.raw`\bno\s+need\s+(?:for|of)\s+(?:an?\s+)?(?:approval|ethics|reb|irb|review|consent|permission)`,
    String.raw`\bno\s+requirement\s+for\s+(?:an?\s+)?(?:ethics\s+|reb\s+|irb\s+|research\s+ethics\s+)?(?:review|approval|consent)`,
    String.raw`\bnot\s+subject\s+to\s+(?:ethics\s+|reb\s+|irb\s+|research\s+ethics\s+)?(?:review|approval)`,
    String.raw`\b(?:falls?|is|are)\s+outside\s+(?:the\s+)?(?:scope\s+of\s+)?(?:ethics|reb|irb|research\s+ethics)(?:\s+(?:review|approval|board))?`,
    String.raw`\bwithout\s+(?:the\s+need\s+(?:for|of)\s+|(?:any\s+)?)(?:ethics|reb|irb|research\s+ethics)(?:\s+(?:review|approval))?`,
    String.raw`\b(?:review|approval|consent)\s+(?:is|was|can be|will be|may be)\s+waived\b`,
  ].join("|"),
  "i",
);
const CONDITIONAL = /\b(?:if|whether|unless|until)\b|\b(?:confirm|check|verify|ask|determine|clarify)\s+(?:whether|if|that)\b|\b(?:apply|applying|request|requesting|seek|seeking)\s+(?:for\s+)?(?:an?\s+)?(?:exemption|waiver)/i;
const NEGATED_OBLIGATION = /\b(?:cannot|can not|must not|should not|may not|not\s+\w+\s+without|no\s+\w+\s+without)\b[^.;]*\bwithout\b/i;
const EXEMPTION_VOCAB = new Set([
  "needs", "need", "neede", "requi", "appro", "ethic", "revie", "conse", "permi", "exemp", "board", "commi", "confi", "writi", "lette", "resea",
  "autho", "waive", "offic", "said", "states", "state", "forma", "furth", "separ", "addit", "under", "scope", "outsi", "subje", "unnec", "neces",
]);

/** The parts of a sentence that say no approval, review or consent is needed, as settled assertions. */
function exemptionClauses(sentence: string): string[] {
  const norm = normalizeForMatch(sentence)
    .replace(/\bwon't\b/g, "will not")
    .replace(/\bcan't\b/g, "cannot")
    .replace(/\bshan't\b/g, "shall not")
    .replace(/n't\b/g, " not");
  if (QUESTION.test(norm)) return [];
  return norm
    .replace(/\([^)]*\)/g, " ")
    .split(/[;,]\s+|\s+(?:and|but|so)\s+/)
    .filter((part) => EXEMPTION.test(part) && !CONDITIONAL.test(part) && !NEGATED_OBLIGATION.test(part));
}

/** Sentences in `text` that say no approval, review or consent is needed, as plain assertions. */
export function exemptionAssertions(text: string): string[] {
  return investigatorSentences(text)
    .map((x) => x.text)
    .filter((t) => exemptionClauses(t).length > 0);
}

/** Whether one of the investigator's settled statements of fact states the same exemption as `assertion`. */
export function exemptionCovered(assertion: string, investigator: string): boolean {
  const ids = identifierTokens(assertion).map((id) => normalizeForMatch(id));
  const subject = [...topicStems(assertion)].filter((w) => !EXEMPTION_VOCAB.has(w));
  return factClauses(investigator).some((c) => {
    if (c.notFact) return false;
    return c.text.split(/,\s+(?=but\b)|\s+but\s+/).some((part) => {
      if (!exemptionClauses(part).length) return false;
      const partNorm = normalizeForMatch(part);
      if (ids.some((id) => partNorm.includes(id))) return true;
      const stems = contentStems(part);
      return subject.filter((w) => stems.has(w)).length >= 2;
    });
  });
}

/** Whether the investigator's own facts state any exemption (kept for callers that do not know the assertion). */
export function investigatorStatesExemption(investigator: string): boolean {
  return factClauses(investigator).some((c) => !c.notFact && exemptionClauses(c.text).length > 0);
}

/** Whether a local-fact claim repeats one of the investigator's own local facts (then it is established, not a proposal). */
export function localFactEstablished(text: string, facts: string[]): boolean {
  const n = flatWords(text);
  if (!n) return false;
  const stems = contentStems(text);
  return facts.some((f) => {
    const fn = flatWords(f);
    if (!fn) return false;
    if (fn.includes(n) || n.includes(fn)) return true;
    const fs = contentStems(f);
    const inter = [...stems].filter((w) => fs.has(w)).length;
    const union = new Set([...stems, ...fs]).size;
    return union > 0 && inter / union >= 0.8;
  });
}

/*
 * D10 / S5, SYN-LOCAL-01: a model claim labelled an assumption or a scenario that asserts local capacity or
 * permission ("two funded research nurses are available") is a local-fact proposal under another name.
 */
const LOCAL_RESOURCE =
  /\b(?:nurses?|pharmacists?|analysts?|coordinators?|assistants?|staff|fte|whole-time|protected time|hours|sessions|funding|funded|budget|grant|approval|approved|permission|access|agreement|signed|capacity|beds|slots|allocated|available|availability)\b/i;

export function assertsLocalResource(text: string): boolean {
  return LOCAL_RESOURCE.test(normalizeForMatch(text));
}
