export const STUDY_FAMILIES = [
  "systematic-review",
  "scoping-review",
  "narrative-review",
  "umbrella-review",
  "rapid-review",
  "rct",
  "pragmatic-trial",
  "cohort",
  "case-control",
  "retrospective",
  "prospective",
  "cross-sectional",
  "qualitative",
  "mixed-methods",
  "diagnostic",
  "qi-pdsa",
  "qi-lean",
  "implementation",
  "feasibility",
  "economic",
] as const;

export type StudyFamily = (typeof STUDY_FAMILIES)[number];

export const STAGE_IDS = [
  "problem",
  "scan",
  "map",
  "gaps",
  "hypotheses",
  "questions",
  "design",
  "protocol",
  "stats",
  "ethics",
  "voices",
  "manuscript",
  "audit",
] as const;

export type StageId = (typeof STAGE_IDS)[number];

export type StudyStatus = "draft" | "active" | "complete";
export type GradeLevel = "high" | "moderate" | "low" | "very-low";
export type Verification = "landmark" | "verify" | "ai-lead";

export type EvidenceKind =
  | "guideline"
  | "systematic-review"
  | "rct"
  | "observational"
  | "qi-report"
  | "grey"
  | "qualitative"
  | "patient-voice"
  | "expert"
  | "preprint"
  | "trial-registry";

export type GraphKind = EvidenceKind | "context" | "gap" | "outcome" | "stakeholder" | "framework";

export interface EvidenceItem {
  id: string;
  title: string;
  authors: string;
  year: number;
  source: string;
  kind: EvidenceKind;
  grade: GradeLevel;
  methodQuality: number;
  relevance: number;
  notes: string;
  verification: Verification;
  doi?: string;
  contextTags: string[];
  keyFindings: string;
  limitations: string;
}

export interface GraphNode {
  id: string;
  label: string;
  kind: GraphKind;
  detail?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  relation: string;
}

export interface GapItem {
  id: string;
  title: string;
  kind: "evidence" | "method" | "error" | "equity" | "implementation" | "outcome";
  severity: "high" | "moderate" | "watch";
  whyItMatters: string;
  opportunity: string;
}

export interface Hypothesis {
  id: string;
  statement: string;
  novelty: number;
  need: number;
  practiceChange: number;
  feasibility: number;
  parsimony: number;
  rationale: string;
  risks: string;
}

export interface ResearchQuestion {
  id: string;
  text: string;
  framework: "PICO" | "PECO" | "SPIDER" | "PICOT" | "FINER" | "QI-aim";
  population: string;
  intervention?: string;
  comparator?: string;
  outcome: string;
  time?: string;
  setting?: string;
}

export interface BiasFlag {
  id: string;
  label: string;
  severity: "ok" | "watch" | "high";
  note: string;
}

export interface Parsimony {
  score: number;
  primaryOutcomeCount: number;
  secondaryOutcomeCount: number;
  covariateCount: number;
  flags: string[];
  simplestPath: string;
}

export interface OutcomeItem {
  id: string;
  role: "primary" | "secondary" | "balancing" | "process";
  name: string;
  measure: string;
  timing: string;
  why: string;
  patientCentered: boolean;
}

export interface VoiceItem {
  id: string;
  source: "patient" | "family" | "clinician" | "partner" | "public" | "social";
  theme: string;
  quote: string;
  implication: string;
  verification: Verification;
}

export interface ProblemStage {
  rawNeed: string;
  statement: string;
  whoAffected: string;
  whatHurts: string;
  currentPractice: string;
  whyNow: string;
  constraints: string;
  patientCenteredGoal: string;
  generatedAt?: string;
}

export interface ScanStage {
  query: string;
  sourcesConsulted: string[];
  items: EvidenceItem[];
  gradeOverall: GradeLevel | "";
  gradeRationale: string;
  synthesis: string;
  generatedAt?: string;
}

export interface MapStage {
  nodes: GraphNode[];
  edges: GraphEdge[];
  reading: string;
  contexts: string[];
  generatedAt?: string;
}

export interface GapsStage {
  items: GapItem[];
  errorsFound: string[];
  reevaluation: string;
  generatedAt?: string;
}

export interface HypothesesStage {
  items: Hypothesis[];
  selectedId?: string;
  generatedAt?: string;
}

export interface QuestionsStage {
  items: ResearchQuestion[];
  finer: string;
  generatedAt?: string;
}

export interface DesignStage {
  recommended: StudyFamily | "";
  rationale: string;
  alternatives: string[];
  guidelines: string[];
  whyNotMoreComplex: string;
  generatedAt?: string;
}

export interface ProtocolStage {
  overview: string;
  population: string;
  exposure: string;
  procedures: string;
  outcomes: OutcomeItem[];
  feasibility: string;
  biasMitigation: string[];
  biasFlags: BiasFlag[];
  parsimony: Parsimony;
  theoreticalFramework: string;
  generatedAt?: string;
}

export interface StatsStage {
  designSummary: string;
  sampleSize: string;
  primaryAnalysis: string;
  secondaryAnalysis: string;
  missingData: string;
  multiplicity: string;
  software: string;
  overfittingGuards: string[];
  generatedAt?: string;
}

export interface EthicsStage {
  risks: string;
  consent: string;
  data: string;
  equity: string;
  effectiveness: string;
  efficiency: string;
  costs: string;
  grants: string;
  partnerships: string;
  rebPath: string;
  limitations: string;
  generatedAt?: string;
}

export interface VoicesStage {
  items: VoiceItem[];
  partnershipPlan: string;
  socialListening: string;
  generatedAt?: string;
}

export interface ManuscriptStage {
  title: string;
  abstract: string;
  introduction: string;
  methods: string;
  results: string;
  discussion: string;
  limitations: string;
  conclusion: string;
  reportingChecklist: string;
  generatedAt?: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  kind: "generate" | "edit" | "complete" | "note" | "fix";
  stage: StageId;
  summary: string;
}

export interface AuditStage {
  entries: AuditEntry[];
  openFixes: string[];
  improvementNotes: string;
  lastReview?: string;
}

export interface Study {
  id: string;
  title: string;
  subtitle: string;
  family: StudyFamily;
  setting: string;
  status: StudyStatus;
  createdAt: string;
  updatedAt: string;
  currentStage: StageId;
  completedStages: StageId[];
  problem: ProblemStage;
  scan: ScanStage;
  map: MapStage;
  gaps: GapsStage;
  hypotheses: HypothesesStage;
  questions: QuestionsStage;
  design: DesignStage;
  protocol: ProtocolStage;
  stats: StatsStage;
  ethics: EthicsStage;
  voices: VoicesStage;
  manuscript: ManuscriptStage;
  audit: AuditStage;
}

export type StageKey = {
  [K in StageId]: Study[K];
};
