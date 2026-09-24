/*
 * D10 / S5: approvals and authority are the investigator's.
 *
 * What blocks action is structural and never depends on how the model words its text or labels its decision:
 *  1. Gates: a model never sets one (decision.ts).
 *  2. The ethics record: every decision is ready only when the investigator has recorded, on that decision,
 *     the research ethics status of the work: approved (with the reference) or not required (with the reason;
 *     "no people, records or practice involved" for a decision that leads to no work). Only this explicit
 *     record counts; a confirmed gate that mentions an ethics approval is offered as the reference, never taken
 *     as the record.
 *  3. Open items in the investigator's own facts: a statement that leaves an approval, permission, agreement or
 *     consent unknown, pending, outstanding or still needed blocks every decision until the investigator acts
 *     on that statement for that decision: given (with the reference) or not concerning it (with the reason).
 *     No other record or gate settles it.
 *
 * What the model writes about approvals ("no REB review is needed", "the custodian has approved") is read and
 * shown to the investigator to check, and never settles anything: wording can always evade a reader, so the
 * reading is advisory. All fixtures in the tests are invented.
 */
import type { DecisionGate } from "../types";
import { identifierTokens, normalizeForMatch, factClauses, statusOpen } from "./grounding";

export type AuthorityBody = "ethics" | "consent" | "data";

const ETHICS_RE =
  /\b(?:reb|irb|rec|hireb|hreb|erb|ethics|ethical|research\s+ethics|review\s+boards?|ethics\s+(?:boards?|committees?)|tcps\s*2?|article\s+2\.5|common\s+rule|human\s+subjects?|institutional\s+(?:review|approval))\b|\b(?:formal|institutional|board|committee|privacy|ethics|ethical|full[- ]board|further|separate|additional|prior|new|independent)\s+review\b/i;
const GENERIC_RE = /\b(?:approvals?|approv(?:e|ed|es|ing)|permissions?|authori[sz]ations?|clearance|oversight|sign[- ]off)\b/i;
const CONSENT_RE = /\bconsent\w*\b/i;
const DATA_RE =
  /\b(?:dsa|dua|dta|data[- ](?:use|sharing|access|transfer|processing|release)[- ]agreements?|information[- ]sharing\s+agreements?|data\s+agreements?|custodian\w*|privacy\s+(?:office|officer|review|impact\s+assessment)|pia)\b/i;

/** The kinds of approving body a text names; a bare "approval" or "permission" counts as ethics review. */
export function authorityBodies(text: string): AuthorityBody[] {
  const t = normalizeForMatch(text ?? "");
  const out: AuthorityBody[] = [];
  const consent = CONSENT_RE.test(t);
  const data = DATA_RE.test(t);
  if (ETHICS_RE.test(t) || (GENERIC_RE.test(t) && !consent && !data)) out.push("ethics");
  if (consent) out.push("consent");
  if (data) out.push("data");
  return out;
}

/** The kinds of body a gate's requirement names by name; "manager approval" names none. Used for coverage. */
export function namedBodies(text: string): AuthorityBody[] {
  const t = normalizeForMatch(text ?? "");
  const out: AuthorityBody[] = [];
  if (ETHICS_RE.test(t)) out.push("ethics");
  if (CONSENT_RE.test(t)) out.push("consent");
  if (DATA_RE.test(t)) out.push("data");
  return out;
}

export const BODY_LABEL: Record<AuthorityBody, string> = {
  ethics: "research ethics review or approval",
  consent: "participant consent",
  data: "a data-sharing agreement or the data custodian's approval",
};

/** The gate the investigator adds to record a board's determination, for each kind of body. */
export const DETERMINATION_GATE: Record<AuthorityBody, string> = {
  ethics: "Research ethics review or approval for this work",
  consent: "Participant consent for this work",
  data: "Data-sharing agreement or data custodian approval for this work",
};

const NEED = String.raw`(?:need|needs|needed|needing|require|requires|required|requiring|requirement|requirements|necessary|necessity|prerequisite|mandatory|obligatory|compulsory|apply|applies|applicable|called\s+for|warranted|indicated)`;
const NEG_NEED = new RegExp(
  [
    String.raw`\b(?:not|never|no\s+longer)\b[^.;]{0,40}\b${NEED}\b`,
    String.raw`\bno\b[^.;]{0,60}\b${NEED}\b`,
    String.raw`\b(?:need|needs|require|requires|required)\s+no\b`,
    String.raw`\bneed\s+not\b`,
    String.raw`\b(?:unnecessary|unneeded|needless|superfluous)\b|\bnot\s+necessary\b`,
    String.raw`\bneither\b[^.;]{0,80}\bnor\b[^.;]{0,80}\b${NEED}\b`,
    String.raw`:\s*(?:n/?a|none|not\s+applicable|not\s+required|not\s+needed)\b`,
  ].join("|"),
  "i",
);
const EXEMPT_CUE = new RegExp(
  [
    String.raw`\bexempt(?:ed|s|ion|ions)?\b`,
    String.raw`\bwaiv(?:e|ed|es|er|ers|ing)\b`,
    String.raw`\b(?:skip|skips|skipped|skipping|bypass|bypasses|bypassed|bypassing|forgo|forgoes|forgoing|forgone|sidestep\w*)\b|\bdispens(?:e|ed|ing)\s+with\b`,
    String.raw`\bnot\s+(?:human\s+subjects?\s+)?research\b`,
    String.raw`\b(?:falls?|fell|sits?|lies|is|are)\s+outside\s+(?:of\s+)?(?:the\s+)?(?:[\w-]+\s+){0,2}?(?:review|approval|oversight|scope|remit|purview|jurisdiction)\b|\boutside\s+(?:the\s+)?(?:scope|remit|purview)\s+of\b`,
    String.raw`\bnot\s+subject\s+to\b`,
    String.raw`\bwithout\b`,
    String.raw`\bnot\s+(?:be\s+|being\s+)?(?:sought|obtained|requested|submitted|sent|referred|asked|collected|taken)\b`,
    String.raw`\b(?:will|would|shall|do|does|did)\s+not\s+(?:seek|obtain|request|submit|apply|ask|collect|take|go)\b`,
    String.raw`\bno\s+(?:[\w-]+\s+){0,3}?(?:submission|application|referral)\b`,
    String.raw`\bnot\s+a\s+(?:prerequisite|requirement|condition)\b`,
    String.raw`\bdeemed\s+(?:unnecessary|not\s+required|exempt)\b`,
  ].join("|"),
  "i",
);
/** A need negated outright: "need not", "is not required", "no need", "needs no", "unnecessary", "approval: n/a". */
const DIRECT_NEG_NEED =
  /\bneed\s+not\b|\b(?:not|never|no\s+longer)\s+(?:be\s+|been\s+|being\s+)?(?:\w+\s+)?(?:needed|required|necessary|a\s+prerequisite|applicable|mandatory|compulsory)\b|\bno\s+(?:need|requirement)\b|\b(?:need|needs|require|requires|required)\s+no\b|\b(?:does|do|did|will|would|shall|should)\s+not\s+(?:need|require|apply)\b|\bunnecessary\b|\bnot\s+necessary\b|:\s*(?:n\/?a|none|not\s+applicable|not\s+required|not\s+needed)\b/i;
/** Double negation states an obligation: "no patient is contacted without consent", "without approval, nothing starts". */
const DOUBLE_NEG = new RegExp(
  [
    String.raw`\b(?:no|not|never|nothing|none|nobody|cannot|can\s+not|must\s+not|may\s+not|should\s+not|shall\s+not)\b[^.;]{0,80}\b(?:without|until|unless|before)\b`,
    String.raw`^\s*(?:without|until|unless|before)\b[^.;]{0,100},\s*(?:no|nothing|not|cannot|never|none|nobody)\b`,
  ].join("|"),
  "i",
);
/** Statements that no exemption applies, or about the form or level of review, or a waiver that is only asked for. */
const NOT_EXEMPTION = new RegExp(
  [
    String.raw`\bnot\s+(?:be\s+)?exempt\b|\bnot\s+eligible\s+for\b|\b(?:does|do|did|would|will|could)\s+not\s+qualify\s+for\b`,
    String.raw`\bno\s+(?:exemption|waiver)\s+(?:applies|is\s+available|can\s+be\s+(?:claimed|granted)|was\s+granted)\b|\b(?:exemption|waiver)\b[^.;]{0,30}\b(?:does\s+not\s+apply|is\s+not\s+available|was\s+(?:refused|denied|not\s+granted)|not\s+granted)\b`,
    String.raw`\bwaiver\b[^.;]{0,40}\b(?:not|no\s+longer)\s+(?:needed|required|necessary|sought|requested)\b|\bno\s+waiver\b`,
    String.raw`\bnot\s+required\s+to\s+be\s+(?:written|signed|in\s+writing|formal|documented|recorded)\b`,
    String.raw`\b(?:full[- ]board|convened|expedited|delegated)\b`,
  ].join("|"),
  "i",
);
/** An exemption or waiver that is only asked for or planned, and not said to be granted. */
const ASKED_FOR =
  /\b(?:exemption|waiver)\b[^.;]{0,60}\b(?:requested|sought|applied\s+for|proposed|planned|to\s+be\s+requested)\b|\b(?:request(?:s|ed|ing)?|seek(?:s|ing)?|sought|appl(?:y|ies|ied|ying)|application|ask(?:s|ed|ing)?)\s+(?:for\s+)?(?:an?\s+|the\s+)?(?:[\w'-]+\s+){0,8}?(?:exemption|waiver)\b/i;
/** The decision is still to come: "subject to its decision", "will be asked", "not yet submitted". */
const PENDING =
  /\b(?:subject\s+to|depends?\s+on|depending\s+on|pending|awaiting|will\s+be\s+asked|to\s+be\s+asked|is\s+requested|are\s+requested|yet\s+to\s+be|not\s+yet\s+(?:submitted|sought|requested|decided|approved|granted)|will\s+be\s+(?:submitted|sought|requested|reviewed|referred)|until\s+the\b[^.;]{0,50}\b(?:decides?|approves?|confirms?|rules?|responds?|replies))\b/i;
/** The work goes to the board: "REB review of secondary use with a waiver", "submitted to the ethics committee". */
const REVIEW_PATH =
  /\b(?:reb|irb|rec|hireb|ethics|ethical|board|committee)\s+(?:board\s+|committee\s+)?(?:review|approval|submission|application)\s+(?:of|for|under|as|with|at|by|following)\b|\b(?:submit(?:s|ted|ting)?|submission|appl(?:y|ies|ied|ying)|application|refer(?:red|ral)?)\s+(?:[\w'-]+\s+){0,4}?to\s+(?:the\s+)?(?:[\w'-]+\s+){0,4}?(?:reb|irb|rec|hireb|ethics|board|committee)\b|\bfull\s+(?:reb\s+|irb\s+|ethics\s+|board\s+|committee\s+|research\s+ethics\s+(?:board\s+)?)?review\b/i;
const GRANTED = /\b(?:granted|approved|given|issued|in\s+place|obtained|confirmed)\b/i;
/** A conditional or a question before the claim words: "confirm whether it needs no approval", "if ... then". */
const CONDITIONAL =
  /\b(?:if|whether|unless)\b|\b(?:confirm|check|verify|ask|determine|clarify|establish|find\s+out)\b[^.;]{0,30}?\b(?:whether|if|that)\b|\b(?:apply|applying|request|requesting|seek|seeking)\s+(?:for\s+)?(?:an?\s+)?(?:exemption|waiver)/i;
const QUESTION = /\?\s*\)?\s*$/;

function expandNot(norm: string): string {
  return norm
    .replace(/\bwon't\b/g, "will not")
    .replace(/\bcan't\b/g, "cannot")
    .replace(/\bshan't\b/g, "shall not")
    .replace(/\bneedn't\b/g, "need not")
    .replace(/n't\b/g, " not");
}

/** Sentences, split at full stops that end one ("Aug. 1", "prot. n. 1234" do not). */
export function sentencesOf(text: string): string[] {
  return (text ?? "")
    .split(/\n+|(?<!\b(?:[A-Z]|[Jj]an|[Ff]eb|[Mm]ar|[Aa]pr|[Jj]un|[Jj]ul|[Aa]ug|[Ss]ept?|[Oo]ct|[Nn]ov|[Dd]ec|[Nn]o|[Nn]|[Nn]r|[Pp]rot|[Rr]ef|[Ff]ig|[Dd]r|[Ss]t|vs|approx|e\.g|i\.e|etc|cf)\.)(?<=[.!?])\s+(?=[A-Z0-9"(])/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Clauses of a sentence: parts joined by a semicolon, or by a comma and a conjunction, or by "because". */
function clausesOf(sentence: string): string[] {
  return sentence
    .replace(/[()]/g, "; ")
    .split(/;\s*|,\s+(?=(?:and|but|so|whereas|while|although|though|because|since|as|hence|therefore|thus)\b)|\s+(?=(?:because|since|whereas|although)\b)|\s+(?:but|so\s+that|so)\s+(?=\S)/i)
    .map((x) => x.trim())
    .filter((x) => x.length > 2);
}

/** The text without reference numbers, so that "SB-DSA-2025-09" does not name a data agreement. */
function stripIds(norm: string): string {
  let out = norm;
  for (const id of identifierTokens(norm.toUpperCase())) out = out.replace(new RegExp(id.toLowerCase().replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), "g"), " ");
  return out;
}

export interface AuthorityClaim {
  /** The model's sentence, as written. */
  sentence: string;
  bodies: AuthorityBody[];
  /** The clauses that make the claim, with the bodies each names. */
  clauses: { text: string; bodies: AuthorityBody[] }[];
}

const MAX_CHARS = 40_000;

/**
 * Sentences in `text` that claim an approval, a review, consent or a data agreement is not needed, or that
 * the work is exempt from one or can go ahead without one.
 */
export function authorityClaims(text: string): AuthorityClaim[] {
  const out: AuthorityClaim[] = [];
  for (const sentence of sentencesOf((text ?? "").slice(0, MAX_CHARS))) {
    if (QUESTION.test(sentence)) continue;
    const bodies = new Set<AuthorityBody>();
    const claimClauses: { text: string; bodies: AuthorityBody[] }[] = [];
    for (const clause of clausesOf(sentence)) {
      const n = expandNot(normalizeForMatch(clause));
      const direct = DIRECT_NEG_NEED.exec(n);
      const cue = direct ?? NEG_NEED.exec(n) ?? EXEMPT_CUE.exec(n);
      if (!cue) continue;
      // The body must stand near the cue ("...needs network approval ... the pilot does not need to ask"
      // is not a claim), and a reference number is not a body ("agreement SB-DSA-2025-09").
      const near = n.slice(Math.max(0, cue.index - 60), cue.index + cue[0].length + 60);
      const named = authorityBodies(stripIds(near));
      // "exempt" or "not research" needs no body word: the claim is about review itself.
      if (!named.length && !/\bexempt|\bnot\s+(?:human\s+subjects?\s+)?research\b/.test(n)) continue;
      if (NOT_EXEMPTION.test(n)) continue;
      if (!direct && DOUBLE_NEG.test(n)) continue;
      if (ASKED_FOR.test(n) && !GRANTED.test(n)) continue;
      if (CONDITIONAL.test(n.slice(0, cue.index))) continue;
      if (!direct && (PENDING.test(n) || REVIEW_PATH.test(n) || /\b(?:yet|so\s+far|to\s+date)\b/.test(n))) continue;
      // "Consent is impracticable without distorting behaviour" argues feasibility, it claims nothing.
      if (!direct && /\b(?:impracticable|impractical|infeasible|not\s+feasible|impossible)\b/.test(n)) continue;
      if (direct && PENDING.test(n) && !/\b(?:no|not|never)\b[^.;]{0,20}\b(?:needed|required|necessary)\b/.test(n.slice(0, cue.index + cue[0].length))) continue;
      const these = named.length ? named : (["ethics"] as AuthorityBody[]);
      for (const b of these) bodies.add(b);
      claimClauses.push({ text: clause, bodies: these });
    }
    if (bodies.size) out.push({ sentence, bodies: [...bodies], clauses: claimClauses });
  }
  return out;
}

const CLASSIFIED =
  /\b(?:classified|classifies|determined|determination|registered|deemed|confirmed|assessed|screened|categori[sz]ed|approved|authori[sz]ed)\b[^.;]{0,80}\b(?:service\s+evaluation|quality\s+improvement|qi|clinical\s+audit|audit|program(?:me)?\s+evaluation|not\s+research|non-research)\b|\b(?:service\s+evaluation|quality\s+improvement|qi|clinical\s+audit|program(?:me)?\s+evaluation)\s+(?:determination|classification|registration)\b/i;

/** Later reversal of an approval or determination. */
const REVERSAL = /\b(?:overrul\w*|revok\w*|rescind\w*|withdr[ae]w\w*|suspend\w*|revers\w*|expired?|expires|lapsed|superseded|no\s+longer|cancell?ed|annulled|denied|refused|rejected)\b/i;

const CUE_WORDS = /\b(?:exempt\w*|waiv\w*|need\w*|requir\w*|necessary|unnecessary|approv\w*|review\w*|consent\w*|confirm\w*|decid\w*|determin\w*|writing|written|letter|memo|board|committee|ethics|research|this|that|work|study|audit|project|count|survey|there|which|under|with|from)\b/gi;

/** Words of a clause that say what it is about, without claim words, bodies, dates and reference numbers. */
function subjectWords(norm: string): string[] {
  const rest = norm.replace(CUE_WORDS, " ").replace(/\b[a-z]*\d[\w/-]*\b/g, " ").match(/\p{L}{4,}/gu) ?? [];
  return rest
    .map((w) => w.slice(0, 5))
    .filter((w) => !["janua", "febru", "march", "april", "augus", "septe", "octob", "novem", "decem", "dated", "since", "again", "given", "about", "their", "these", "those", "said", "says", "note", "chair", "offic", "group", "netwo", "unive", "hospi", "insti", "gover", "quali", "revie", "servi", "evalu", "progr", "audit", "impro", "class", "deter", "regis"].includes(w));
}

/**
 * Whether the investigator's own facts settle `claim`: for every kind of body it names, one of their
 * sentences states the same determination (an exemption, a waiver, "no review is needed", or a
 * classification of the work as not research, which settles ethics review) about this work, and nothing in
 * that sentence reverses it. About this work: the clause names this study, or names no other subject, or
 * shares a subject word with the study's own description; a shared reference number alone is not enough.
 * "The REB said the staff survey needs no approval" does not settle a claim about a chart audit.
 */
export function claimCovered(claim: AuthorityClaim, investigator: string, own: string): boolean {
  const ownWords = new Set((normalizeForMatch(own).match(/\p{L}{4,}/gu) ?? []).map((w) => w.slice(0, 5)));
  const said = new Set<AuthorityBody>();
  for (const sentence of sentencesOf(investigator)) {
    const norm = normalizeForMatch(sentence);
    if (REVERSAL.test(norm)) continue;
    const thisWork = (text: string) => {
      const t = normalizeForMatch(text);
      if (/\b(?:this|our|the present|the current)\s+(?:[\w-]+\s+){0,2}?(?:study|audit|project|count|survey|review|evaluation|work|analysis|initiative|pilot|programme|program)\b/.test(t)) return true;
      // "the evaluation", "the audit": the investigator's own work, unless the sentence names another.
      if (/\bthe\s+(?:study|audit|project|evaluation|survey|work|analysis|pilot|initiative|count)\b/.test(t) && !/\b(?:another|other|previous|prior|earlier|separate|different)\s+(?:[\w-]+\s+){0,2}?(?:study|audit|project|evaluation|survey|trial)\b/.test(t)) return true;
      const subject = subjectWords(t);
      return subject.length === 0 || subject.some((w) => ownWords.has(w));
    };
    for (const c of authorityClaims(sentence).flatMap((x) => x.clauses)) if (thisWork(c.text)) for (const b of c.bodies) said.add(b);
    if (CLASSIFIED.test(norm) && thisWork(sentence)) said.add("ethics");
  }
  return claim.bodies.every((b) => said.has(b));
}

/*
 * Local approvals and resources stated as in place ("the data custodian has approved the extract", "two
 * nurses are allocated to the audit"). In a model's decision they are proposals: they stand only when the
 * investigator's own facts support them.
 */
const LOCAL_BODY =
  /\b(?:reb|irb|rec|hireb|ethics|ethical|research\s+ethics|review\s+board|custodian\w*|privacy|consent\w*|agreement|dsa|dua|approval|permission|authori[sz]ation|manager|director|lead|head|chair|committee|department|union|sponsor|funder|funding|budget|grant|nurses?|staff|fte|hours|analysts?|coordinators?|pharmacists?|librarian|capacity|beds|slots)\b|\b(?:protected|research|staff|nurse|nursing|clinician|analyst|reviewer|librarian|investigator|coordinator)\s+time\b/i;
/** A finite statement that something is in place ("has approved", "are available", "approved 100 hours"); adjectives ("the approved hours", "signed-off protocol") are not. */
const IN_PLACE = new RegExp(
  [
    String.raw`\b(?:is|are|was|were|has\s+been|have\s+been)\s+(?:now\s+|already\s+|fully\s+)?(?:approved|granted|signed|obtained|agreed|authori[sz]ed|cleared|allocated|funded|protected|secured|committed|received|available|in\s+place)\b`,
    String.raw`\b(?:has|have|had)\s+(?:now\s+|already\s+)?(?:approved|granted|signed|obtained|agreed|authori[sz]ed|cleared|allocated|funded|secured|committed|received)\b`,
    String.raw`\b(?:approved|granted|signed|allocated|authori[sz]ed|cleared|funded)\s+(?:the|an?|our|their|this|these|\d+|\w+\s+(?:hours|sessions|days|weeks|staff|nurses))\b`,
    String.raw`\bin\s+place\b|\b(?:has|have|holds?)\s+(?:an?\s+)?(?:approval|permission|agreement)\b`,
  ].join("|"),
  "i",
);
const NOT_ASSERTED =
  /\b(?:not|no|never|without|once|after|when|if|unless|until|pending|awaiting|subject\s+to|expected|will\s+be|would\s+be|to\s+be|should|must|need\w*|requir\w*|seek\w*|apply\w*|request\w*|submit\w*|plan\w*|propos\w*|intend\w*|aim\w*|hope\w*|may|might|could|whether|unknown|unclear|confirm\s+that|check\s+that|ask|likely|assum\w*|in\s+the\s+(?:retrieved|cited|included)|in\s+(?:the\s+)?(?:trial|study|studies|review|cohort)\s+(?:by|of|from)|reported|published)\b/i;

/** Clauses of `text` that state a local approval, agreement or resource is in place. */
export function localAssertions(text: string): string[] {
  const out: string[] = [];
  for (const sentence of sentencesOf((text ?? "").slice(0, MAX_CHARS))) {
    if (QUESTION.test(sentence)) continue;
    for (const clause of clausesOf(sentence)) {
      const n = expandNot(normalizeForMatch(clause));
      if (!IN_PLACE.test(n) || !LOCAL_BODY.test(n)) continue;
      if (NOT_ASSERTED.test(n)) continue;
      out.push(clause);
    }
  }
  return out;
}

/** Decision kinds that lead to work with people, records or practice. */
export const ACTIONABLE_KINDS: ReadonlySet<string> = new Set(["pursue", "narrow", "implementation", "replicate"]);

/** The reason recorded for a decision that leads to no work. */
export const NO_WORK_REASON = "No people, records or practice are involved in this decision.";

/** The investigator's explicit record of the research ethics status of the work on this decision. */
export function ethicsRecord(gates: DecisionGate[]): DecisionGate | undefined {
  return gates.find(
    (g) =>
      g.record === true &&
      g.setBy === "investigator" &&
      g.requirement === DETERMINATION_GATE.ethics &&
      (g.status === "met" || g.status === "not-required") &&
      !!g.evidence?.trim(),
  );
}

/** Study families that rely only on published literature (reviews of published work). */
export const LITERATURE_FAMILIES: ReadonlySet<string> = new Set(["systematic-review", "scoping-review", "narrative-review", "umbrella-review", "rapid-review"]);

/**
 * Why a review of published literature needs no research ethics board review. TCPS 2 (2022), Article 2.2, as
 * read on ethics.gc.ca on 24 September 2026: research does not require REB review when it relies exclusively on
 * information in the public domain to which no reasonable expectation of privacy attaches.
 */
export const LITERATURE_ONLY_REASON =
  "This work relies only on published literature in the public domain, so research ethics board review is not required (TCPS 2 (2022), Article 2.2). If it will use individual participant data, unpublished records or people, record the ethics status instead.";

/** One-click reasons the investigator can record (the investigator still clicks; nothing is recorded for them). */
export const RECORD_PRESETS: { label: string; text: string }[] = [
  { label: "Published literature only (TCPS 2, Article 2.2)", text: LITERATURE_ONLY_REASON },
  {
    label: "Quality improvement or program evaluation (TCPS 2, Article 2.5)",
    text: "Quality improvement or program evaluation used only for assessment, management or improvement, which falls outside the scope of research ethics board review (TCPS 2 (2022), Article 2.5). Local QI screening, if the institution requires it: ",
  },
];

/**
 * The ethics status taken from the investigator's own choice of study type. A review of published literature
 * that the investigator chose (familyBy "investigator") needs no REB review, so the decision is not blocked for
 * want of a record. A family a model reply set never counts, and an explicit record on the decision wins.
 */
export function studyTypeEthicsRecord(study: { family?: string | null; familyBy?: string }): DecisionGate | undefined {
  if (!study.family || !LITERATURE_FAMILIES.has(study.family) || study.familyBy !== "investigator") return undefined;
  return {
    id: "ethics-by-study-type",
    requirement: DETERMINATION_GATE.ethics,
    status: "not-required",
    setBy: "investigator",
    evidence: LITERATURE_ONLY_REASON,
    record: true,
  } as DecisionGate;
}

/** The ethics record that settles a decision: the investigator's explicit record, else the study-type record. */
export function ethicsRecordFor(gates: DecisionGate[], study: { family?: string | null; familyBy?: string }): { gate: DecisionGate; byStudyType: boolean } | undefined {
  const explicit = ethicsRecord(gates);
  if (explicit) return { gate: explicit, byStudyType: false };
  const derived = studyTypeEthicsRecord(study);
  return derived ? { gate: derived, byStudyType: true } : undefined;
}

/** Whether a requirement uses the exact wording of an investigator record (a model gate may not). */
export function isRecordWording(requirement: string): boolean {
  const t = (requirement ?? "").trim().toLowerCase();
  return Object.values(DETERMINATION_GATE).some((r) => r.toLowerCase() === t);
}

/** A gate requirement that names a research ethics approval or determination ("REB approval for the audit"). */
const ETHICS_APPROVAL_REQ =
  /\b(?:reb|irb|rec|hireb|hreb|erb|research\s+ethics|ethics|ethical)\b[^.;()]{0,50}?\b(?:approval|approved|review|clearance|favou?rable\s+opinion|determination)\b|\b(?:approval|clearance|determination)\b[^.;()]{0,20}\b(?:reb|irb|rec|hireb|research\s+ethics|ethics)\b/i;

/** Another piece of work, or a step still to come: never offered as this work's ethics status. */
export const OTHER_WORK =
  /\b(?:another|other|previous|prior|earlier|original|parent|sister|separate|companion|last\s+year's|lead\s+site'?s?|coordinating\s+site|staff\s+survey|survey\s+of)\b|\b(?:19|20)\d\d\s+(?:[\w-]+\s+){0,3}?(?:study|audit|survey|trial|project|review)\b/i;
const PENDING_OR_DENIED = /\b(?:requested|pending|expected|awaiting|submitted|applied|to\s+follow|not\s+(?:needed|required)|no\s+(?:reb|ethics|irb)|unknown|unclear|draft)\b/i;

/** Confirmed gates for this work's ethics approval or determination: offered as the record's reference, never taken as it. */
export function ethicsGateCandidates(gates: DecisionGate[]): DecisionGate[] {
  return gates.filter((g) => {
    if (g.setBy !== "investigator" || g.status !== "met" || g.record) return false;
    const text = normalizeForMatch(`${g.requirement} ${g.evidence ?? ""}`);
    // "no REB review required" is a claim unless it is a board's determination with its reference number.
    const determination =
      /\b(?:determination|determined|classified|classification|screen\w*|registered|registration)\b/.test(text) &&
      identifierTokens(g.evidence ?? "").length > 0 &&
      !/\b(?:requested|pending|expected|awaiting|submitted|applied|draft|to\s+follow|unknown|unclear)\b/.test(text);
    return ETHICS_APPROVAL_REQ.test(normalizeForMatch(g.requirement)) && !OTHER_WORK.test(text) && (determination || !PENDING_OR_DENIED.test(text));
  });
}

const APPROVAL_WORDS =
  /\b(?:approv\w*|permission\w*|permit\w*|authori[sz]\w*|agree\w*|consent\w*|sign-?off|signed|signature|unsigned|clearance|reb|irb|rec|hireb|ethics|determination|custodian\w*|steward\w*|waiver|dsa|dua|committee|board|licen[cs]e\w*|governance|privacy|pia|impact\s+assessment|contract|application|resubmission|access\s+request|data\s+request)\b/i;
/** Words that leave something open, beyond the grounding reader's not-in-place and uncertain statements. */
const APPROVAL_OBJECT = String.raw`(?:approval|permission|authori[sz]ation|sign-?off|agreement|waiver|consent|clearance|licen[cs]e|dsa|dua|determination|review\s+by)`;
const OPEN_WORDS = new RegExp(
  [
    String.raw`\b(?:waiting(?!\s+(?:list|lists|time|times|room))|awaiting|outstanding|unsigned|tbd|tbc|in\s+progress|underway|under\s+way|unresolved|undecided|open\s+question)\b`,
    // "The DUA is with legal for review"; "sent to the vendor for signature"; "is being negotiated";
    // "still reviewing"; "is looking at the request"; "in the queue"; "due to be heard"; "has not come back";
    // "asked to agree"; "goes in next month"; "still have to ask"; "conditional approval"; "resubmission".
    String.raw`\b(?:is|are|was|were)\s+with\s+(?:the\s+)?(?:[\w'-]+\s+){0,3}?(?:reb|irb|rec|legal|custodian|committee|board|office|vendor|lawyers?)\b|\bfor\s+(?:signature|review|approval)\b`,
    String.raw`\b(?:is|are)\s+(?:still\s+)?being\s+\w+ed\b|\bstill\s+\w+ing\b|\b(?:is|are)\s+(?:reviewing|looking\s+at|considering|negotiating|assessing)\b|\bin\s+the\s+queue\b`,
    String.raw`\bdue\s+to\s+be\b|\bto\s+be\s+(?:heard|considered|reviewed|discussed|decided)\b|\b(?:has|have)\s+not\s+(?:yet\s+)?(?:come\s+back|arrived|been\s+returned)\b`,
    String.raw`\b(?:have|has|had)\s+(?:applied|submitted)\b(?![^.;]{0,60}\b(?:and|was|were|has\s+been)\s+(?:approved|granted|signed))|\basked\s+to\s+(?:agree|approve|sign|consent|review)\b|\b(?:goes|go|going)\s+in\b|\bstill\s+(?:have|has)\s+to\b|\bconditional(?:ly)?\s+approv\w*|\bsubject\s+to\b|\bresubmi\w*`,
    String.raw`\b(?:agreement|dsa|dua|contract|consent\s+form|application|licen[cs]e)\b[^.;]{0,20}\bdraft(?:ed)?\b|\bdraft(?:ed)?\s+(?:[\w-]+\s+){0,2}?(?:agreement|dsa|dua|contract|consent\s+form|application|licen[cs]e)\b`,
    String.raw`\b(?:not|never)\s+(?:yet\s+)?(?:been\s+)?(?:signed|approved|agreed|given|granted|obtained|issued|received|decided|confirmed)\b`,
    String.raw`\byet\s+to\b|\bstill\s+(?:needs?|requires?|to)\b|\bto\s+be\s+(?:signed|approved|agreed|obtained|requested|submitted|confirmed)\b`,
    String.raw`\b${APPROVAL_OBJECT}\b[^.;]{0,30}\b(?:was|were|has\s+been|have\s+been|is|are)\s+(?:submitted|requested|sought|applied\s+for)\b`,
    String.raw`\b(?:submitted|requested|sought|applied\s+for)\s+(?:an?\s+|the\s+)?(?:[\w-]+\s+){0,3}?${APPROVAL_OBJECT}\b|\b(?:application|submission)\s+(?:to|for)\b`,
    String.raw`\b(?:need|needs|needed|require|requires|required|must\s+(?:be|have|get|obtain|sign)|has\s+to|have\s+to)\b[^.;]{0,80}\b(?:before|prior\s+to|first|until)\b`,
    String.raw`\b(?:will|shall|plan\s+to|intend\s+to|going\s+to)\s+(?:apply|seek|request|submit|ask|obtain)\b`,
    // "Research governance approval: requested 2026-08-20"; "No reply yet from the custodian"; "The board
    // meets in November to approve the design"; "has not agreed to release staff time".
    String.raw`:\s*(?:requested|submitted|applied|pending|draft|in\s+progress|awaited|expected)\b`,
    String.raw`\bno\s+(?:reply|response|answer|decision|word)\b`,
    String.raw`\bmeets?\b[^.;]{0,50}\bto\s+(?:approve|decide|review|consider|sign)\b|\bwill\s+(?:approve|decide|consider|sign)\b`,
    String.raw`\b(?:has|have|had)\s+not\s+(?:yet\s+)?(?:agreed|responded|replied|signed|decided|approved)\b`,
  ].join("|"),
  "i",
);
/** A statement that the approval was given ("signed off the draft protocol"), unless it also says something is still open. */
const COMPLETED_AFFIRM = /\b(?:signed(?:\s+off)?|approved|granted|agreed|obtained|issued|in\s+place)\b/i;
const STILL_OPEN = /\b(?:not|never|yet|awaiting|waiting|pending|outstanding|still|unsigned|draft)\b/i;
/** A statistic or a past episode ("consent was declined by 3 of 40 families"), not the status of this work. */
const NOT_A_STATUS = /\b\d+\s+(?:of|out\s+of)\s+\d+\b|\d\s*%|\bpercent\b|\b(?:last|previous|prior|earlier)\s+(?:year|years|pilot|audit|study|round)\b/i;
const DATA_WORDS = /\b(?:data|extract\w*|linkage|records?|registry|dataset|logs?|custodian\w*|steward\w*|privacy|dsa|dua)\b/i;

export interface OpenItem {
  /** The investigator's own words. */
  text: string;
  /** Kinds of body the statement names; empty for another approval (a pharmacy's, a manager's, a board's). */
  bodies: AuthorityBody[];
}

/**
 * Statements in the investigator's facts that leave an approval, permission, agreement or consent open:
 * unknown, pending, expected, outstanding, in draft, requested, not yet given, or still needed before the work
 * ("Whether research use of the dashboard data needs a data-use approval is unknown", "Data-sharing agreement:
 * draft", "We need the pharmacy committee's sign-off before the rollout").
 */
export function openApprovalItems(investigatorFacts: string): OpenItem[] {
  const out: OpenItem[] = [];
  const seen = new Set<string>();
  for (const c of factClauses(investigatorFacts)) {
    // The clause names the approval, or it is a relative clause that leaves the approval named before it open
    // ("needs the data governance lead's approval, which has not been requested").
    const relative = /^(?:which|that|but|and)\b/.test(c.norm);
    if (!APPROVAL_WORDS.test(c.norm) && !(relative && APPROVAL_WORDS.test(normalizeForMatch(c.sentence)))) continue;
    // Another study's approval that has lapsed says nothing about this work.
    if (OTHER_WORK.test(c.norm)) continue;
    const byWords = OPEN_WORDS.test(c.norm) && !(COMPLETED_AFFIRM.test(c.norm) && !STILL_OPEN.test(c.norm.replace(/\bdraft\s+(?:[\w-]+\s+){0,2}?protocol\b/g, "protocol")));
    if (!(statusOpen(c.text) || byWords)) continue;
    if (NOT_A_STATUS.test(c.norm)) continue;
    if (seen.has(c.sentence)) continue;
    seen.add(c.sentence);
    const sn = normalizeForMatch(c.sentence);
    const bodies: AuthorityBody[] = [];
    if (CONSENT_RE.test(sn)) bodies.push("consent");
    if (DATA_RE.test(sn) || (DATA_WORDS.test(sn) && !ETHICS_RE.test(sn))) bodies.push("data");
    if (ETHICS_RE.test(sn)) bodies.push("ethics");
    out.push({ text: c.sentence, bodies });
  }
  return out;
}

/** Every statement in the investigator's facts that is about an approval, open or not: shown when they record. */
export function approvalFacts(investigatorFacts: string): string[] {
  const out: string[] = [];
  for (const c of factClauses(investigatorFacts)) if (APPROVAL_WORDS.test(normalizeForMatch(c.sentence)) && !out.includes(c.sentence)) out.push(c.sentence);
  return out;
}
