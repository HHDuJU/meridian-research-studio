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

export const FAMILY_BY_ID = Object.fromEntries(
  FAMILY_META.map((f) => [f.id, f]),
) as Record<StudyFamily, FamilyMeta>;

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

export function guessFamily(text: string): StudyFamily {
  const t = text.toLowerCase();
  if (/\b(pdsa|squire|run chart|lean|a3|quality improvement|qi project)\b/.test(t))
    return "qi-pdsa";
  if (/\b(implement|uptake|de-implement|cfir|re-aim)\b/.test(t)) return "implementation";
  if (/\b(systematic review|meta-analys|prisma)\b/.test(t)) return "systematic-review";
  if (/\b(scoping review)\b/.test(t)) return "scoping-review";
  if (/\b(randomi[sz]e|rct|placebo|pragmatic trial)\b/.test(t)) {
    return t.includes("pragmatic") ? "pragmatic-trial" : "rct";
  }
  if (/\b(interview|focus group|lived experience|qualitative)\b/.test(t))
    return "qualitative";
  if (/\b(mixed method)\b/.test(t)) return "mixed-methods";
  if (/\b(chart review|retrospective|emr|administrative data)\b/.test(t))
    return "retrospective";
  if (/\b(cohort|follow-up)\b/.test(t)) return "cohort";
  if (/\b(pilot|feasibility)\b/.test(t)) return "feasibility";
  if (/\b(cost|economic|qaly)\b/.test(t)) return "economic";
  if (/\b(diagnostic|sensitivity|auc)\b/.test(t)) return "diagnostic";
  return "mixed-methods";
}
