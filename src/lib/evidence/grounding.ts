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

function numberWordsToDigits(text: string): string {
  const tens = Object.keys(TENS).join("|");
  const units = Object.keys(UNITS).join("|");
  return (text ?? "")
    .replace(new RegExp(`\\b(${tens})[-\\s](one|two|three|four|five|six|seven|eight|nine)\\b`, "gi"), (_, t: string, u: string) =>
      String(TENS[t.toLowerCase()] + UNITS[u.toLowerCase()]),
    )
    .replace(new RegExp(`\\b(${tens})\\b`, "gi"), (_, t: string) => String(TENS[t.toLowerCase()]))
    .replace(new RegExp(`\\b(${units})\\b`, "gi"), (_, u: string) => String(UNITS[u.toLowerCase()]));
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
}

/*
 * A sentence of the investigator's that says something is not in place ("has not been requested",
 * "decision pending", "submitted on 2026-09-01") cannot ground a claim that it is in place, even
 * though it contains the same record number or words. Anchors count only from other sentences.
 */
const NOT_IN_PLACE = new RegExp(
  [
    // Strong signals only. Generic negation ("do not need review", "is not covered", "not requiring")
    // and "requested" ("the committee requested the review") describe things that are in place; the
    // bank rerun showed six such false alarms with a broader pattern.
    String.raw`\b(?:has|have|had)\s+not\s+(?:yet\s+)?(?:been\s+)?(?:approved|granted|agreed|decided|confirmed|obtained|signed|funded|reviewed|requested|submitted|given|issued|said|answered|replied|received)\b`,
    String.raw`\b(?:hasn't|haven't|hadn't)\s+(?:yet\s+)?(?:been\s+)?\w+`,
    String.raw`\bnot\s+yet\b`,
    String.raw`\b(?:was|were|has been|have been)\s+(?:declined|refused|rejected|denied|withdrawn|suspended|revoked)\b`,
    String.raw`\b(?:pending|awaiting|undecided|unresolved|expired|lapsed|yet to|under review|in review|unknown whether)\b`,
    String.raw`\b(?:submitted|applied for)\b(?![^.;]*\b(?:approved|granted|agreed|accepted)\b)`,
    String.raw`\bto be (?:decided|confirmed|determined|requested)\b`,
    String.raw`\bno\s+(?:approval|decision|agreement|permission)\s+(?:yet|has been|was)\b`,
  ].join("|"),
  "i",
);

export function investigatorSentences(investigator: string): { text: string; notInPlace: boolean }[] {
  return (investigator ?? "")
    .split(/\n+|(?<=[.;!?])\s+(?=[A-Z0-9"(])/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => ({ text, notInPlace: NOT_IN_PLACE.test(text) }));
}

export function groundedInInvestigatorText(statement: string, investigator: string): Grounding {
  const sentences = investigatorSentences(investigator);
  const positive = sentences.filter((x) => !x.notInPlace).map((x) => x.text).join("\n");
  const negative = sentences.filter((x) => x.notInPlace);
  const hay = normalizeForMatch(positive);
  const ids = identifierTokens(statement);
  const missingIds = ids.filter((id) => !hay.includes(normalizeForMatch(id)));
  if (missingIds.length) {
    const contradicting = negative.find((x) => missingIds.some((id) => normalizeForMatch(x.text).includes(normalizeForMatch(id))));
    return {
      grounded: false,
      foundAnchors: [],
      missingAnchors: missingIds,
      reason: contradicting
        ? `cites ${missingIds.join(", ")}, but the investigator's own words say it is not in place: "${contradicting.text.slice(0, 160)}"`
        : `cites ${missingIds.join(", ")}, which the investigator never supplied`,
    };
  }
  const invFigs = figureContexts(positive);
  const foundNums: string[] = [];
  const missingNums: string[] = [];
  for (const [n, ctx] of significantFigures(figureContexts(statement))) {
    const have = invFigs.get(n);
    if (have && [...ctx].some((w) => have.has(w))) foundNums.push(n);
    else missingNums.push(n);
  }
  const foundIds = ids;
  // A verbatim run of 5+ words from the investigator's text also anchors the statement.
  const words = normalizeForMatch(statement).replace(/[^\p{L}\p{N} ]+/gu, " ").split(" ").filter(Boolean);
  const flatHay = hay.replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ");
  let phrase = "";
  for (let i = 0; i + 5 <= words.length && !phrase; i++) {
    const cand = words.slice(i, i + 5).join(" ");
    if (flatHay.includes(cand)) phrase = cand;
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
  "that this these those with from into onto over under their there which while where when what will would could should must have been being also only such than then them they your ours about after before during each every other more most some many much very".split(
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

/** The grounding of a gate a model says is met: its evidence anchors first, then the investigator's own statement of the requirement. */
export function gateGrounding(requirement: string, evidence: string, investigator: string): Grounding {
  const byEvidence = groundedInInvestigatorText(evidence, investigator);
  const positive = investigatorSentences(investigator).filter((x) => !x.notInPlace).map((x) => x.text).join("\n");
  const hay = normalizeForMatch(positive);
  const unsuppliedIds = identifierTokens(requirement).filter((id) => !hay.includes(normalizeForMatch(id)));
  if (unsuppliedIds.length) {
    return { grounded: false, foundAnchors: [], missingAnchors: unsuppliedIds, reason: `the requirement names ${unsuppliedIds.join(", ")}, which the investigator never supplied` };
  }
  if (byEvidence.grounded) return byEvidence;
  // An identifier or a figure in the evidence that the investigator never supplied refuses the gate.
  if (identifierTokens(evidence).length || byEvidence.missingAnchors.length) return byEvidence;
  const stated = requirementStatedByInvestigator(requirement, investigator);
  if (stated.stated) {
    return {
      grounded: true,
      foundAnchors: [`"${(stated.sentence ?? "").slice(0, 160)}"`],
      missingAnchors: [],
      reason: `the investigator's own words state the requirement: "${(stated.sentence ?? "").slice(0, 160)}"`,
    };
  }
  return byEvidence;
}
