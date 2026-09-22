import type { StageId, StudyFamily } from "./types";

export interface FamilyMeta {
  id: StudyFamily;
  group:
    | "synthesis"
    | "trial"
    | "observational"
    | "improvement"
    | "human"
    | "other";
  label: string;
  short: string;
  reporting: string[];
  questionFrame: string;
}

export const FAMILY_META: FamilyMeta[] = [
  {
    id: "systematic-review",
    group: "synthesis",
    label: "Systematic review",
    short: "PRISMA evidence synthesis",
    reporting: ["PRISMA 2020", "PRISMA-P", "GRADE", "AMSTAR 2"],
    questionFrame: "PICO / PECO",
  },
  {
    id: "scoping-review",
    group: "synthesis",
    label: "Scoping review",
    short: "Map a field, not a point estimate",
    reporting: ["PRISMA-ScR", "JBI scoping"],
    questionFrame: "PCC",
  },
  {
    id: "narrative-review",
    group: "synthesis",
    label: "Narrative review",
    short: "Interpretive, not exhaustive",
    reporting: ["SANRA", "narrative best practice"],
    questionFrame: "thematic",
  },
  {
    id: "umbrella-review",
    group: "synthesis",
    label: "Umbrella review",
    short: "Reviews of reviews",
    reporting: ["PRIOR", "GRADE"],
    questionFrame: "PICO",
  },
  {
    id: "rapid-review",
    group: "synthesis",
    label: "Rapid review",
    short: "Time-limited synthesis",
    reporting: ["Cochrane rapid", "PRISMA"],
    questionFrame: "PICO",
  },
  {
    id: "rct",
    group: "trial",
    label: "Randomized trial",
    short: "Explanatory or efficacy RCT",
    reporting: ["SPIRIT", "CONSORT", "TIDieR"],
    questionFrame: "PICO / PICOT",
  },
  {
    id: "pragmatic-trial",
    group: "trial",
    label: "Pragmatic trial",
    short: "Effectiveness in usual care",
    reporting: ["SPIRIT", "CONSORT", "PRECIS-2"],
    questionFrame: "PICOT",
  },
  {
    id: "cohort",
    group: "observational",
    label: "Cohort study",
    short: "Follow exposure over time",
    reporting: ["STROBE", "RECORD"],
    questionFrame: "PECO",
  },
  {
    id: "case-control",
    group: "observational",
    label: "Case-control",
    short: "From outcome back to exposure",
    reporting: ["STROBE"],
    questionFrame: "PECO",
  },
  {
    id: "retrospective",
    group: "observational",
    label: "Retrospective chart / EMR",
    short: "Existing data, new question",
    reporting: ["STROBE", "RECORD", "STROBE-RECORD"],
    questionFrame: "PECO",
  },
  {
    id: "prospective",
    group: "observational",
    label: "Prospective observational",
    short: "New data, no assignment",
    reporting: ["STROBE"],
    questionFrame: "PECO / PICOT",
  },
  {
    id: "cross-sectional",
    group: "observational",
    label: "Cross-sectional",
    short: "One moment in a population",
    reporting: ["STROBE"],
    questionFrame: "PICO / survey",
  },
  {
    id: "qualitative",
    group: "human",
    label: "Qualitative",
    short: "Meaning, experience, context",
    reporting: ["COREQ", "SRQR"],
    questionFrame: "SPIDER",
  },
  {
    id: "mixed-methods",
    group: "human",
    label: "Mixed methods",
    short: "Numbers and meaning together",
    reporting: ["GRAMMS", "COREQ", "STROBE"],
    questionFrame: "mixed",
  },
  {
    id: "diagnostic",
    group: "other",
    label: "Diagnostic accuracy",
    short: "Test vs reference standard",
    reporting: ["STARD", "TRIPOD"],
    questionFrame: "PIRT",
  },
  {
    id: "qi-pdsa",
    group: "improvement",
    label: "QI · PDSA",
    short: "Model for Improvement",
    reporting: ["SQUIRE 2.0", "IHI", "Standards for QIR"],
    questionFrame: "QI-aim",
  },
  {
    id: "qi-lean",
    group: "improvement",
    label: "QI · Lean / A3",
    short: "Waste, flow, standard work",
    reporting: ["SQUIRE 2.0", "A3"],
    questionFrame: "QI-aim",
  },
  {
    id: "implementation",
    group: "improvement",
    label: "Implementation science",
    short: "Uptake of what already works",
    reporting: ["StaRI", "CFIR", "RE-AIM"],
    questionFrame: "PICO + context",
  },
  {
    id: "feasibility",
    group: "other",
    label: "Feasibility / pilot",
    short: "Can the main study be done?",
    reporting: ["CONSORT extension", "Thabane"],
    questionFrame: "feasibility",
  },
  {
    id: "economic",
    group: "other",
    label: "Economic evaluation",
    short: "Cost, value, trade-offs",
    reporting: ["CHEERS 2022"],
    questionFrame: "PICO + cost",
  },
];

export const FAMILY_BY_ID = Object.assign(
  Object.fromEntries(FAMILY_META.map((f) => [f.id, f])) as Record<StudyFamily, FamilyMeta>,
  {
    null: {
      id: "mixed-methods" as StudyFamily,
      group: "other" as const,
      label: "Undetermined",
      short: "Choose a design",
      reporting: [],
      questionFrame: "—",
    },
  },
) as Record<StudyFamily, FamilyMeta> & { null: FamilyMeta };

export function familyOf(id: StudyFamily | null | undefined): FamilyMeta {
  if (!id) return FAMILY_BY_ID.null;
  return FAMILY_BY_ID[id] ?? FAMILY_BY_ID.null;
}

export const FAMILY_GROUPS: { id: FamilyMeta["group"]; label: string }[] = [
  { id: "synthesis", label: "Evidence synthesis" },
  { id: "trial", label: "Trials" },
  { id: "observational", label: "Observational" },
  { id: "improvement", label: "Improvement science" },
  { id: "human", label: "Human science" },
  { id: "other", label: "Other designs" },
];

export interface StageMeta {
  id: StageId;
  n: string;
  label: string;
  kicker: string;
  hint: string;
}

export const STAGES: StageMeta[] = [
  {
    id: "problem",
    n: "01",
    label: "Problem",
    kicker: "What hurts, for whom",
    hint: "Name the clinical or system itch in plain language. Stay with the people it happens to.",
  },
  {
    id: "scan",
    n: "02",
    label: "Scan",
    kicker: "What is already known",
    hint: "Rank evidence by design, bias risk, and relevance. Treat every citation as a lead until verified.",
  },
  {
    id: "map",
    n: "03",
    label: "Map",
    kicker: "Context and connections",
    hint: "Join papers to settings, incentives, equity, and care pathways — not just to other papers.",
  },
  {
    id: "gaps",
    n: "04",
    label: "Gaps",
    kicker: "Where the map breaks",
    hint: "Look for missing outcomes, method errors, and questions that would actually change practice.",
  },
  {
    id: "hypotheses",
    n: "05",
    label: "Hypotheses",
    kicker: "Need, novelty, change",
    hint: "Rank by human need and practice-change potential. Discard clever ideas that cannot be studied cleanly.",
  },
  {
    id: "questions",
    n: "06",
    label: "Questions",
    kicker: "One question, one job",
    hint: "Write the smallest question that is still worth answering. PICO, PECO, SPIDER, or a SMART QI aim.",
  },
  {
    id: "design",
    n: "07",
    label: "Design",
    kicker: "Match question to method",
    hint: "The simplest design that can answer the question. Do not randomize what a run chart can settle.",
  },
  {
    id: "protocol",
    n: "08",
    label: "Protocol",
    kicker: "How, by whom, with what",
    hint: "Feasible procedures, one primary outcome, named bias controls. No kitchen-sink methods.",
  },
  {
    id: "stats",
    n: "09",
    label: "Analysis",
    kicker: "Pre-specify, then stop",
    hint: "Sample size for the primary outcome. Guard against p-hacking, overfitting, and silent multiplicity.",
  },
  {
    id: "ethics",
    n: "10",
    label: "Ethics",
    kicker: "People, equity, cost",
    hint: "REB path, consent, data, PROGRESS-Plus equity, and whether the work is worth the burden.",
  },
  {
    id: "voices",
    n: "11",
    label: "Voices",
    kicker: "Patients, families, field",
    hint: "Co-investigation wherever possible. Listen past the loudest clinician or the loudest feed.",
  },
  {
    id: "manuscript",
    n: "12",
    label: "Manuscript",
    kicker: "Write as you would publish",
    hint: "IMRaD, reporting checklist, honest limits. Language a good journal would not send back for tone.",
  },
  {
    id: "audit",
    n: "13",
    label: "Audit",
    kicker: "The studio that corrects itself",
    hint: "Log what was generated, what was wrong, and what to tighten next time.",
  },
];

export const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s])) as Record<
  StageId,
  StageMeta
>;

/*
 * Study-family routing.
 *
 * Two kinds of signal are kept apart:
 *   design  — the investigator named a design ("scoping review", "mixed methods", "randomised")
 *   cue     — a word that merely hints at a design family ("PRISMA" is a reporting guideline, not a
 *             design; "implement" is a verb; "registry" is a data source)
 * All matches are collected, then resolved by explicit rules. When the text does not settle the
 * design, the result is `unresolved` with candidates — never a substantive default.
 */

interface Signal {
  re: RegExp;
  family: StudyFamily;
  kind: "design" | "cue";
  label: string;
}

const SIGNALS: Signal[] = [
  // synthesis designs
  { re: /\bscoping review/i, family: "scoping-review", kind: "design", label: "scoping review" },
  { re: /\bsystematic(?:ally)? review|\bmeta-?analy/i, family: "systematic-review", kind: "design", label: "systematic review / meta-analysis" },
  { re: /\bumbrella review|\boverview of reviews/i, family: "umbrella-review", kind: "design", label: "umbrella review" },
  { re: /\brapid review/i, family: "rapid-review", kind: "design", label: "rapid review" },
  { re: /\bnarrative review/i, family: "narrative-review", kind: "design", label: "narrative review" },
  // trials
  { re: /\bpragmatic (?:trial|rct)/i, family: "pragmatic-trial", kind: "design", label: "pragmatic trial" },
  { re: /(?<!non-)(?<!non )\brandomi[sz](?:e|ed|ation|ing)\b|\brcts?\b|\bplacebo[- ]controlled/i, family: "rct", kind: "design", label: "randomised trial" },
  // observational
  { re: /\bretrospective|\bchart review|\badministrative data|\bemr (?:review|data)/i, family: "retrospective", kind: "design", label: "retrospective / existing data" },
  { re: /\bprospective (?:observational|cohort)/i, family: "prospective", kind: "design", label: "prospective observational" },
  { re: /\bcohort\b/i, family: "cohort", kind: "design", label: "cohort" },
  { re: /\bcase[- ]control/i, family: "case-control", kind: "design", label: "case-control" },
  { re: /\bcross[- ]sectional/i, family: "cross-sectional", kind: "design", label: "cross-sectional" },
  // human science
  { re: /\bmixed[- ]methods?/i, family: "mixed-methods", kind: "design", label: "mixed methods" },
  { re: /\bqualitative|\binterviews?\b|\bfocus groups?\b|\blived experience/i, family: "qualitative", kind: "design", label: "qualitative component" },
  // other
  { re: /\bdiagnostic accuracy|\bsensitivity and specificity|\bprediction model|\breference standard/i, family: "diagnostic", kind: "design", label: "diagnostic / prediction" },
  { re: /\bcost[- ]effectiveness|\beconomic evaluation|\bcost[- ]utility|\bqalys?\b/i, family: "economic", kind: "design", label: "economic evaluation" },
  { re: /\bfeasibility|\bpilot\b/i, family: "feasibility", kind: "design", label: "feasibility / pilot" },
  { re: /\bimplementation (?:science|study|trial|research)|\bde-?implement|\bcfir\b|\bre-aim\b|\bhybrid (?:type|effectiveness)/i, family: "implementation", kind: "design", label: "implementation study" },
  // improvement
  { re: /\bpdsa|\bplan[- ]do[- ]study[- ]act|\bquality improvement|\bqi (?:project|initiative|study)|\bsquire\b|\brun chart|\bmodel for improvement/i, family: "qi-pdsa", kind: "design", label: "quality improvement (PDSA)" },
  { re: /\blean\b|\ba3\b|\bvalue stream/i, family: "qi-lean", kind: "design", label: "lean / A3" },
  // weak cues — guidelines, tools, verbs, data sources
  { re: /\bprisma\b/i, family: "systematic-review", kind: "cue", label: "PRISMA (reporting guideline)" },
  { re: /\bconsort\b|\bspirit\b/i, family: "rct", kind: "cue", label: "CONSORT/SPIRIT (reporting guideline)" },
  { re: /\bstrobe\b|\brecord\b/i, family: "cohort", kind: "cue", label: "STROBE/RECORD (reporting guideline)" },
  { re: /\bregistry\b|\bdatabase\b/i, family: "retrospective", kind: "cue", label: "registry / database (data source)" },
  { re: /\bimplement(?:ing|ed)?\b|\buptake\b/i, family: "implementation", kind: "cue", label: "implement (verb)" },
  { re: /\baudit\b/i, family: "qi-pdsa", kind: "cue", label: "audit" },
  { re: /\bsurvey\b|\bquestionnaire\b/i, family: "cross-sectional", kind: "cue", label: "survey" },
  { re: /\bcost\b|\bbudget impact/i, family: "economic", kind: "cue", label: "cost" },
];

export interface FamilyClassification {
  /** null when the text does not settle a design. */
  family: StudyFamily | null;
  basis: "explicit" | "inferred" | "unresolved";
  /** Human-readable labels of everything that matched, designs first. */
  matched: string[];
  /** Families worth offering when the choice is not settled. */
  candidates: StudyFamily[];
  note: string;
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

export function classifyFamily(text: string): FamilyClassification {
  const designs = SIGNALS.filter((s) => s.kind === "design" && s.re.test(text));
  const cues = SIGNALS.filter((s) => s.kind === "cue" && s.re.test(text));
  const matched = [...designs.map((d) => d.label), ...cues.map((c) => `${c.label} [cue]`)];
  const designFamilies = uniq(designs.map((d) => d.family));
  const cueFamilies = uniq(cues.map((c) => c.family));

  // Explicit combination rules. Each is a statement about design language, not a guess.
  if (designFamilies.includes("mixed-methods")) {
    const others = designFamilies.filter((f) => f !== "mixed-methods");
    return {
      family: "mixed-methods",
      basis: "explicit",
      matched,
      candidates: ["mixed-methods", ...others],
      note: others.length
        ? `Mixed methods stated; components mentioned: ${others.join(", ")}. Keep quantitative and qualitative aims distinct.`
        : "Mixed methods stated.",
    };
  }
  if (designFamilies.length === 1) {
    const family = designFamilies[0];
    return { family, basis: "explicit", matched, candidates: [family], note: `Design stated: ${designs[0].label}.` };
  }
  if (designFamilies.length > 1) {
    const set = new Set(designFamilies);
    const has = (f: StudyFamily) => set.has(f);
    if (has("feasibility") && has("qualitative") && designFamilies.length === 2) {
      return { family: "feasibility", basis: "explicit", matched, candidates: ["feasibility", "mixed-methods"], note: "Feasibility study with an embedded qualitative component. Report both parts; do not collapse the interviews into the label." };
    }
    if (has("feasibility") && has("rct") && designFamilies.length === 2) {
      return { family: "feasibility", basis: "explicit", matched, candidates: ["feasibility", "rct"], note: "Pilot/feasibility randomised trial. The CONSORT pilot extension applies only if randomised." };
    }
    if (has("retrospective") && has("cohort") && designFamilies.length === 2) {
      return { family: "retrospective", basis: "explicit", matched, candidates: ["retrospective", "cohort"], note: "Retrospective cohort using existing data." };
    }
    if (has("prospective") && has("cohort") && designFamilies.length === 2) {
      return { family: "cohort", basis: "explicit", matched, candidates: ["cohort", "prospective"], note: "Prospective cohort." };
    }
    if (has("scoping-review") && has("systematic-review") && designFamilies.length === 2) {
      // Both named — a scoping review that says "systematic" about its search is common; ask.
      return { family: null, basis: "unresolved", matched, candidates: ["scoping-review", "systematic-review"], note: "Both scoping and systematic review language present. Confirm whether the aim is to map a field (scoping) or to answer a focused question with a point estimate (systematic)." };
    }
    return {
      family: null,
      basis: "unresolved",
      matched,
      candidates: designFamilies,
      note: `Several designs named (${designFamilies.join(", ")}). Confirm the primary design before routing.`,
    };
  }
  if (cueFamilies.length === 1) {
    return { family: cueFamilies[0], basis: "inferred", matched, candidates: cueFamilies, note: `No design stated; inferred from "${cues[0].label}". Confirm before relying on it.` };
  }
  if (cueFamilies.length > 1) {
    return { family: null, basis: "unresolved", matched, candidates: cueFamilies, note: `No design stated; cues point to ${cueFamilies.join(", ")}.` };
  }
  return { family: null, basis: "unresolved", matched, candidates: [], note: "No design stated. Ask what the study is meant to do before choosing a family." };
}

/**
 * @deprecated Use `classifyFamily`. Returns null instead of a default when the text does not name a design.
 */
export function guessFamily(text: string): StudyFamily | null {
  return classifyFamily(text).family;
}
