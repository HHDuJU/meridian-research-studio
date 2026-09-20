import type {
  AuditStage,
  DesignStage,
  EthicsStage,
  GapsStage,
  HypothesesStage,
  ManuscriptStage,
  MapStage,
  Parsimony,
  ProblemStage,
  ProtocolStage,
  QuestionsStage,
  ScanStage,
  StatsStage,
  Study,
  StudyFamily,
  VoicesStage,
} from "./types";
import { uid, nowIso } from "./utils";

export function emptyParsimony(): Parsimony {
  return {
    score: 0,
    primaryOutcomeCount: 0,
    secondaryOutcomeCount: 0,
    covariateCount: 0,
    flags: [],
    simplestPath: "",
  };
}

export function emptyProblem(rawNeed = ""): ProblemStage {
  return {
    rawNeed,
    statement: "",
    whoAffected: "",
    whatHurts: "",
    currentPractice: "",
    whyNow: "",
    constraints: "",
    patientCenteredGoal: "",
  };
}

export function emptyScan(): ScanStage {
  return {
    query: "",
    sourcesConsulted: [],
    items: [],
    gradeOverall: "",
    gradeRationale: "",
    synthesis: "",
  };
}

export function emptyMap(): MapStage {
  return { nodes: [], edges: [], reading: "", contexts: [] };
}

export function emptyGaps(): GapsStage {
  return { items: [], errorsFound: [], reevaluation: "" };
}

export function emptyHypotheses(): HypothesesStage {
  return { items: [] };
}

export function emptyQuestions(): QuestionsStage {
  return { items: [], finer: "" };
}

export function emptyDesign(): DesignStage {
  return {
    recommended: "",
    rationale: "",
    alternatives: [],
    guidelines: [],
    whyNotMoreComplex: "",
  };
}

export function emptyProtocol(): ProtocolStage {
  return {
    overview: "",
    population: "",
    exposure: "",
    procedures: "",
    outcomes: [],
    feasibility: "",
    biasMitigation: [],
    biasFlags: [],
    parsimony: emptyParsimony(),
    theoreticalFramework: "",
  };
}

export function emptyStats(): StatsStage {
  return {
    designSummary: "",
    sampleSize: "",
    primaryAnalysis: "",
    secondaryAnalysis: "",
    missingData: "",
    multiplicity: "",
    software: "",
    overfittingGuards: [],
  };
}

export function emptyEthics(): EthicsStage {
  return {
    risks: "",
    consent: "",
    data: "",
    equity: "",
    effectiveness: "",
    efficiency: "",
    costs: "",
    grants: "",
    partnerships: "",
    rebPath: "",
    limitations: "",
  };
}

export function emptyVoices(): VoicesStage {
  return { items: [], partnershipPlan: "", socialListening: "" };
}

export function emptyManuscript(): ManuscriptStage {
  return {
    title: "",
    abstract: "",
    introduction: "",
    methods: "",
    results: "",
    discussion: "",
    limitations: "",
    conclusion: "",
    reportingChecklist: "",
  };
}

export function emptyAudit(): AuditStage {
  return { entries: [], openFixes: [], improvementNotes: "" };
}

export function createStudy(input: {
  title?: string;
  subtitle?: string;
  family: StudyFamily;
  setting: string;
  rawNeed: string;
}): Study {
  const createdAt = nowIso();
  return {
    id: uid("study"),
    title: input.title || "Untitled study",
    subtitle: input.subtitle || "Draft in the studio",
    family: input.family,
    setting: input.setting,
    status: "draft",
    createdAt,
    updatedAt: createdAt,
    currentStage: "problem",
    completedStages: [],
    problem: emptyProblem(input.rawNeed),
    scan: emptyScan(),
    map: emptyMap(),
    gaps: emptyGaps(),
    hypotheses: emptyHypotheses(),
    questions: emptyQuestions(),
    design: emptyDesign(),
    protocol: emptyProtocol(),
    stats: emptyStats(),
    ethics: emptyEthics(),
    voices: emptyVoices(),
    manuscript: emptyManuscript(),
    audit: emptyAudit(),
  };
}
