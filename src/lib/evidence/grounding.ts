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

/** The study's own description (title, need, constraints), used to tell this study from another one. */
export function studyOwnText(study: Pick<Study, "problem" | "title">): string {
  return [study.title, study.problem.rawNeed, study.problem.constraints].filter(Boolean).join("\n");
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
  /** The investigator sentences that hold the anchors; the scope, authority and conflict checks read them. */
  sentences?: string[];
}

/*
 * A sentence of the investigator's that says something is not in place ("has not been requested",
 * "decision pending", "submitted on 2026-09-01") cannot ground a claim that it is in place, even
 * though it contains the same record number or words. Anchors count only from other sentences.
 */
const NOT_IN_PLACE_STRONG = new RegExp(
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
const UNCERTAIN = new RegExp(
  [
    // An open question is not a fact (D10, SYN-LOCAL-02): "permission for secondary use ... is unknown",
    // "unclear whether the custodian agrees", "to be confirmed".
    String.raw`\b(?:unknown|unclear|uncertain|undetermined|unconfirmed|unverified|unanswered|whether|tbc|tbd)\b`,
    String.raw`\b(?:is|are|was|were|remains?)\s+not\s+(?:known|clear|established|confirmed|settled|agreed)\b`,
    String.raw`\bnot\s+(?:yet\s+)?sure\b`,
  ].join("|"),
  "i",
);
const NOT_IN_PLACE = { test: (t: string) => NOT_IN_PLACE_STRONG.test(t) || UNCERTAIN.test(t) };

export function investigatorSentences(investigator: string): { text: string; notInPlace: boolean }[] {
  return (investigator ?? "")
    .split(/\n+|(?<=[.;!?])\s+(?=[A-Z0-9"(])/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => ({ text, notInPlace: NOT_IN_PLACE.test(text) }));
}

function flatWords(s: string): string {
  return normalizeForMatch(s).replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
}

export function groundedInInvestigatorText(statement: string, investigator: string): Grounding {
  const sentences = investigatorSentences(investigator);
  const positiveList = sentences.filter((x) => !x.notInPlace).map((x) => x.text);
  const positive = positiveList.join("\n");
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
  // A verbatim run of 5+ words from one investigator sentence also anchors the statement.
  const words = flatWords(statement).split(" ").filter(Boolean);
  const flatSentences = positiveList.map(flatWords);
  let phrase = "";
  for (let i = 0; i + 5 <= words.length && !phrase; i++) {
    const cand = words.slice(i, i + 5).join(" ");
    if (flatSentences.some((f) => ` ${f} `.includes(` ${cand} `))) phrase = cand;
  }
  const anchors = [...foundIds, ...foundNums, ...(phrase ? [`"${phrase}"`] : [])];
  if (!anchors.length) {
    return { grounded: false, foundAnchors: [], missingAnchors: missingNums, reason: "names nothing the investigator entered (no record number, figure or phrase from the investigator's text)" };
  }
  if (missingNums.length && !phrase && !foundIds.length) {
    return { grounded: false, foundAnchors: anchors, missingAnchors: missingNums, reason: `states ${missingNums.join(", ")}, which the investigator's text does not contain` };
  }
  const statementFigs = figureContexts(statement);
  const anchorSentences = positiveList.filter((sent, k) => {
    const n = normalizeForMatch(sent);
    if (foundIds.some((id) => n.includes(normalizeForMatch(id)))) return true;
    if (phrase && ` ${flatSentences[k]} `.includes(` ${phrase} `)) return true;
    const figs = figureContexts(sent);
    return foundNums.some((num) => {
      const have = figs.get(num);
      const ctx = statementFigs.get(num);
      return !!have && !!ctx && [...ctx].some((w) => have.has(w));
    });
  });
  return { grounded: true, foundAnchors: anchors, missingAnchors: missingNums, reason: `anchored in investigator text: ${anchors.join(", ")}`, sentences: anchorSentences };
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

/*
 * D10 / S5: an anchor shows that the model read the investigator's text, not that the fact it read
 * meets this gate. Four further checks run on the investigator sentence that holds the anchors:
 *
 *  1. Authority. A requirement for an approval, an agreement, funding or consent is met only by a
 *     sentence that names the same kind of authority. "Clinic staff can view the dashboard for patient
 *     care" states access for care, not a data-use approval for research (SYN-LOCAL-04).
 *  2. Another study. A sentence about another, previous or separate study or protocol cannot meet this
 *     study's gate (SYN-LOCAL-05).
 *  3. Scope. A sentence that limits itself ("only", "limited to", "does not cover") meets a gate only
 *     when every content word of the requirement is inside that limit: "the block registry holds treated
 *     patients only" cannot show that it records non-treated candidates (SYN-LOCAL-03), and "covers
 *     protocol CARE-KET-01 only" cannot approve another audit (SYN-LOCAL-05). When the limit names this
 *     study (its own protocol number, or "this study"), the study's own description counts as inside it.
 *  4. Conflict. Another investigator sentence on the same topic that says the resource is absent (zero,
 *     none, no ...), not in place, or gives a different figure in the same unit leaves the gate open until
 *     the investigator decides which holds (SYN-LOCAL-06). Both sentences stay as entered.
 *
 * The investigator can always set a gate directly; these checks bind only a model's "met".
 */
const AUTHORITY_GROUPS: { label: string; re: RegExp }[] = [
  {
    label: "an approval, permission or agreement",
    re: /\b(?:approv\w*|permi(?:t|ts|tted|ssion|ssions)|allow(?:s|ed)?|authori[sz]\w*|clear(?:ed|ance)|sanction\w*|endors\w*|licen[cs]\w*|waive[dr]?|waivers?|exempt\w*|grant(?:ed|s)?|agree(?:d|ment|ments|s)?|contract\w*|signed|signature|signatures|sign-off|signoff|sponsor\w*)\b/i,
  },
  { label: "funding", re: /\b(?:fund(?:ed|ing|s)?|budget\w*|allocat\w*|grant(?:ed|s)?|award(?:ed|s)?|paid|pay|pays)\b/i },
  { label: "consent", re: /\bconsent\w*\b/i },
];
const RESTRICT =
  /\b(?:only(?!\s+(?:after|before|when|once|until|if|then|from|in\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|\d{4}))\b)|solely|exclusively|limited to|restricted to|specific to|confined to|(?:does|do|will|would) not (?:cover|include|extend to|apply to)|excluding|except|no other|any other (?:use|uses|study|studies|project|projects|purpose|purposes|protocol|protocols|analysis|analyses))\b/i;
const OTHER_STUDY =
  /\b(?:another|previous|prior|earlier|former|past|different|separate|sister|parent|companion|older|last year's|other)\s+(?:study|studies|protocol|protocols|project|projects|trial|trials|registry|registries|application|applications|audit|audits|submission|submissions)\b/i;
/** A protocol named by number ("protocol CARE-KET-01"): an approval for it is not an approval for a study that does not carry that number. */
const PROTOCOL_REF = /\bprotocol\s+(?:no\.?\s*|number\s*|#\s*)?([A-Z0-9][A-Za-z0-9/-]*\d[A-Za-z0-9/-]*)/g;
const THIS_STUDY =
  /\b(?:this|the present|the current|the proposed|our current|our proposed)\s+(?:study|project|audit|protocol|trial|review|evaluation|initiative|pilot|work)\b/i;
const CLINICAL_PURPOSE =
  /\bfor\s+(?:patient|clinical|routine|direct|usual)?\s*care\b|\bclinical\s+(?:use|purposes?|operations?|work)\b|\boperational\s+(?:use|purposes?|access)\b|\bfor\s+(?:treatment|care delivery|service delivery)\b/i;
const RESEARCH_PURPOSE = /\bresearch\b|\bsecondary\s+(?:use|analysis)\b|\bpublication\b/i;
/** Words that say how a requirement is met, not what it is about. */
const GENERIC_STEMS = new Set([
  "confi", "docum", "writt", "forma", "obtai", "secur", "place", "requi", "need", "neede", "avail", "befor", "prior", "start",
  "gate", "evide", "local", "facts", "fact", "inves", "suppl", "state", "enter", "study", "studi", "proje", "work",
]);

function topicStems(text: string): Set<string> {
  return new Set([...contentStems(text)].filter((w) => !GENERIC_STEMS.has(w)));
}

function trimQuote(s: string): string {
  return s.length > 160 ? `${s.slice(0, 157)}...` : s;
}

/** The words within five tokens of a restriction marker: what the limit is about. */
function restrictionWindow(sentence: string): string {
  const m = RESTRICT.exec(sentence);
  if (!m) return "";
  const before = sentence.slice(0, m.index).split(/\s+/).slice(-5).join(" ");
  const after = sentence.slice(m.index + m[0].length).split(/\s+/).slice(0, 6).join(" ");
  return `${before} ${m[0]} ${after}`;
}

/** Figures with the word after them ("8 hours", "0.5 FTE"), keyed by that word's stem. Years and figures that end a clause have no unit. */
function figureUnits(text: string): Map<string, Set<string>> {
  const raw = normalizeForMatch(numberWordsToDigits(text)).split(/\s+/).filter(Boolean);
  const out = new Map<string, Set<string>>();
  raw.forEach((tok, i) => {
    const m = tok.match(/^\(?\$?(\d+(?:\.\d+)?)(%?)([.,;:)]?)$/);
    if (!m) return;
    const value = Number(m[1]);
    let unit = "%";
    if (!m[2]) {
      if (Number.isInteger(value) && value >= 1900 && value <= 2100) return;
      const next = raw[i + 1] ?? "";
      if (m[3] || /^[([]/.test(next)) return;
      unit = next.replace(/[^\p{L}]/gu, "").slice(0, 5);
    }
    if (!unit || unit.length < 2) return;
    const set = out.get(unit) ?? new Set<string>();
    set.add(String(value));
    out.set(unit, set);
  });
  return out;
}

const ZERO_WORD = /^(?:0|zero|nil|none|no)$/;

/*
 * Another investigator statement on the requirement's topic (half or more of its topic words, in the same
 * clause) that says the resource is not in place (declined, pending, withdrawn), absent ("zero protected
 * research time", "no research nurse") or of a different amount in the same unit ("8 hours" against
 * "4 hours"). Wishes, needs and questions ("I need help with whether ...") are not facts and never conflict.
 */
export function conflictingFact(requirement: string, anchor: string, investigator: string): string | null {
  const req = [...topicStems(requirement)];
  if (!req.length) return null;
  const anchorUnits = figureUnits(anchor);
  for (const x of investigatorSentences(investigator)) {
    const t = x.text.trim();
    if (t === anchor.trim() || INTENT.test(t) || t.endsWith("?")) continue;
    for (const clause of t.split(/[;:.](?:\s|$)|,\s+(?:but|and|while|although)\s+/)) {
      const stems = contentStems(clause);
      const shared = req.filter((w) => stems.has(w));
      if (shared.length < 2 || shared.length / req.length < 0.5) continue;
      if (NOT_IN_PLACE_STRONG.test(clause)) return t;
      const toks = normalizeForMatch(numberWordsToDigits(clause))
        .split(/\s+/)
        .map((w) => w.replace(/[^\p{L}\p{N}.%]/gu, ""))
        .filter(Boolean);
      if (toks.some((tk, i) => ZERO_WORD.test(tk) && toks.slice(i + 1, i + 3).some((w) => shared.includes(w.slice(0, 5))))) return t;
      for (const [unit, values] of figureUnits(clause)) {
        const mine = anchorUnits.get(unit);
        if (mine && [...values].some((v) => !mine.has(v))) return t;
      }
    }
  }
  return null;
}

/** Why one investigator sentence cannot meet this gate for a model, or null when it can. `cited`: identifiers the model's evidence names (the approval's own number is not what the approval is limited to). */
function sentenceRefusal(requirement: string, sentence: string, own: string, cited: string[] = []): string | null {
  for (const g of AUTHORITY_GROUPS) {
    if (g.re.test(requirement) && !g.re.test(sentence)) {
      return `the investigator's sentence ("${trimQuote(sentence)}") names no ${g.label}, so it does not show that the requirement is met`;
    }
  }
  if (RESEARCH_PURPOSE.test(requirement) && CLINICAL_PURPOSE.test(sentence) && !RESEARCH_PURPOSE.test(sentence)) {
    return `the investigator's sentence ("${trimQuote(sentence)}") describes access for patient care, which is not permission for research use`;
  }
  if (OTHER_STUDY.test(sentence) && !THIS_STUDY.test(sentence)) {
    return `the investigator's sentence ("${trimQuote(sentence)}") is about another study, not this one`;
  }
  // A sentence about the very thing the requirement names (an approved clinical protocol) is not an
  // approval borrowed from another study: two or more of the requirement's subject words must be missing.
  const subject = [...topicStems(AUTHORITY_GROUPS.reduce((t, g) => t.replace(new RegExp(g.re.source, "gi"), " "), requirement))];
  const sentenceStems = contentStems(sentence);
  const aboutSubject = subject.filter((w) => sentenceStems.has(w)).length >= 2 && subject.filter((w) => sentenceStems.has(w)).length / Math.max(1, subject.length) >= 0.6;
  if (!THIS_STUDY.test(sentence) && !aboutSubject) {
    const ownOutside = normalizeForMatch(own.replace(sentence, " "));
    const protocols = [...sentence.matchAll(PROTOCOL_REF)].map((m) => m[1].replace(/[.,;:)]+$/, ""));
    const foreign = protocols.filter((id) => !ownOutside.includes(normalizeForMatch(id)));
    if (foreign.length) {
      return `the investigator's sentence ("${trimQuote(sentence)}") concerns protocol ${foreign.join(", ")}, which this study's own description does not name`;
    }
  }
  if (RESTRICT.test(sentence)) {
    const window = restrictionWindow(sentence);
    const ownOutside = normalizeForMatch(own.replace(sentence, " "));
    const citedNorm = cited.map((c) => normalizeForMatch(c));
    const windowIds = identifierTokens(window).filter((id) => !citedNorm.some((c) => c.includes(normalizeForMatch(id))));
    const otherIds = windowIds.filter((id) => !ownOutside.includes(normalizeForMatch(id)));
    const thisStudy = THIS_STUDY.test(window) || (windowIds.length > 0 && otherIds.length === 0);
    if (otherIds.length) {
      return `the investigator's fact is limited to ${otherIds.join(", ")} ("${trimQuote(sentence)}"), which this study's own description does not name`;
    }
    const inside = new Set([...contentStems(sentence), ...(thisStudy ? contentStems(own.replace(sentence, " ")) : [])]);
    const outside = [...topicStems(requirement)].filter((w) => !inside.has(w));
    if (outside.length) {
      return `the investigator's fact is limited in scope ("${trimQuote(sentence)}"), and the requirement goes beyond it (${outside.join(", ")})`;
    }
  }
  return null;
}

/** The grounding of a gate a model says is met: its evidence anchors first, then the investigator's own statement of the requirement. */
export function gateGrounding(requirement: string, evidence: string, investigator: string, own = ""): Grounding {
  const byEvidence = groundedInInvestigatorText(evidence, investigator);
  const positive = investigatorSentences(investigator).filter((x) => !x.notInPlace).map((x) => x.text).join("\n");
  const hay = normalizeForMatch(positive);
  const unsuppliedIds = identifierTokens(requirement).filter((id) => !hay.includes(normalizeForMatch(id)));
  if (unsuppliedIds.length) {
    return { grounded: false, foundAnchors: [], missingAnchors: unsuppliedIds, reason: `the requirement names ${unsuppliedIds.join(", ")}, which the investigator never supplied` };
  }
  const cited = [...identifierTokens(evidence), ...identifierTokens(requirement)];
  const checked = (g: Grounding, sentences: string[]): Grounding => {
    if (!sentences.length) return g;
    let firstRefusal = "";
    for (const s of sentences) {
      const refusal = sentenceRefusal(requirement, s, own, cited);
      if (refusal) {
        firstRefusal ||= refusal;
        continue;
      }
      const conflict = conflictingFact(requirement, s, investigator);
      if (conflict) {
        firstRefusal ||= `conflicting local facts: "${trimQuote(s)}" and "${trimQuote(conflict)}"; only the investigator can say which holds`;
        continue;
      }
      return g;
    }
    return { ...g, grounded: false, reason: firstRefusal };
  };
  if (byEvidence.grounded) return checked(byEvidence, byEvidence.sentences ?? []);
  // An identifier or a figure in the evidence that the investigator never supplied refuses the gate.
  if (identifierTokens(evidence).length || byEvidence.missingAnchors.length) return byEvidence;
  const stated = requirementStatedByInvestigator(requirement, investigator);
  if (stated.stated) {
    return checked(
      {
        grounded: true,
        foundAnchors: [`"${(stated.sentence ?? "").slice(0, 160)}"`],
        missingAnchors: [],
        reason: `the investigator's own words state the requirement: "${(stated.sentence ?? "").slice(0, 160)}"`,
        sentences: stated.sentence ? [stated.sentence] : [],
      },
      stated.sentence ? [stated.sentence] : [],
    );
  }
  return byEvidence;
}

/*
 * D10 / S5, SYN-LOCAL-04: a model decision that says no approval, review or consent is needed makes an
 * authorization claim. It stands only when one of the investigator's own sentences states that exemption
 * (and is not itself pending, unknown or conditional). Clinical access to data does not count.
 */
const EXEMPTION = new RegExp(
  [
    String.raw`\b(?:needs?|requires?|required)\s+no\s+(?:formal\s+|further\s+|separate\s+|additional\s+|new\s+)?(?:approval|ethics|reb|irb|review|consent|permission|authori[sz]ation|data[- ]use agreement)`,
    String.raw`\bno\s+(?:formal\s+|further\s+|separate\s+|additional\s+|new\s+)?(?:approval|ethics(?:\s+(?:approval|review))?|reb(?:\s+(?:approval|review))?|irb(?:\s+(?:approval|review))?|review|consent|permission|authori[sz]ation)\s+(?:is\s+|are\s+|would be\s+|will be\s+)?(?:needed|required|necessary)`,
    String.raw`\b(?:does|do|did|will|would)\s+not\s+(?:need|require)\s+(?:an?\s+|any\s+)?(?:formal\s+|further\s+|separate\s+|new\s+)?(?:approval|ethics|reb|irb|review|consent|permission|authori[sz]ation)`,
    String.raw`\b(?:doesn't|don't|won't|wouldn't)\s+(?:need|require)\s+(?:an?\s+|any\s+)?(?:approval|ethics|reb|irb|review|consent|permission)`,
    String.raw`\b(?:approval|ethics review|reb review|irb review|consent|permission|authori[sz]ation)\s+(?:is|are|was|would be|will be)\s+(?:not\s+(?:needed|required|necessary)|unnecessary)`,
    String.raw`\bnot\s+requiring\s+(?:an?\s+|any\s+)?(?:formal\s+|further\s+|separate\s+|new\s+)?(?:approval|ethics|reb|irb|review|consent|permission|authori[sz]ation)`,
    String.raw`\b(?:approval|ethics review|reb review|irb review|review|consent|permission)\s+not\s+(?:needed|required|necessary)`,
    String.raw`\bexempt(?:ed)?\s+from\s+(?:ethics\s+|reb\s+|irb\s+|research\s+ethics\s+)?(?:review|approval|oversight|consent)`,
    String.raw`\bno\s+need\s+(?:for|of)\s+(?:an?\s+)?(?:approval|ethics|reb|irb|review|consent|permission)`,
    String.raw`\bwithout\s+(?:the\s+)?need\s+(?:for|of)\s+(?:approval|ethics|reb|irb|review|consent)`,
  ].join("|"),
  "i",
);
const CONDITIONAL = /\b(?:if|whether|unless)\b|\?|\b(?:confirm|check|verify|ask|determine|clarify)\s+(?:whether|if|that)\b/i;

/** Sentences in `text` that say no approval, review or consent is needed, as plain assertions. */
export function exemptionAssertions(text: string): string[] {
  return investigatorSentences(text)
    .map((x) => x.text)
    .filter((t) => EXEMPTION.test(t) && !CONDITIONAL.test(t));
}

/** Whether the investigator's own text states an exemption (not pending, not unknown, not conditional). */
export function investigatorStatesExemption(investigator: string): boolean {
  return investigatorSentences(investigator).some((x) => !x.notInPlace && EXEMPTION.test(x.text) && !CONDITIONAL.test(x.text));
}
