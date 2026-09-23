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

export function orderNeedsReview(ids: readonly string[]): StageId[] {
  const set = new Set(ids);
  return STAGE_IDS.filter((id) => set.has(id));
}

export type StudyStatus = "draft" | "active" | "complete";
export type GradeLevel = "high" | "moderate" | "low" | "very-low";

/**
 * Model-assigned citation label. Kept for compatibility with existing studies and panels.
 * It is a *hint from the generator*, never a verification result. The authoritative record of
 * whether a source was actually retrieved or checked is `EvidenceItem.provenance` (below).
 * @deprecated read `provenance.status` for anything user-facing.
 */
export type Verification = "landmark" | "verify" | "ai-lead";

/**
 * Where a record stands on observable evidence. Only a recorded `SourceCheck` with result
 * "match" may set "verified"; a model label, a confident tone or the word "landmark" cannot.
 *
 * - unverified: exists only as a lead (model-suggested or user-typed), no retrieval, no check
 * - retrieved: returned by a real search (a RetrievalEvent) but identity not yet checked
 * - verified: identity checked against a bibliographic registry (title/year agree)
 * - mismatch: an identifier resolved to a different work than claimed (possible misattribution)
 * - check-failed: a check was attempted but the channel errored or was blocked
 * - access-blocked: the record is known to exist but its content could not be accessed
 *
 * "verified" means the *source exists as described*. It says nothing about whether the source
 * supports a particular claim — that is the job of the claim ledger (`Claim`).
 */
export type SourceStatus =
  | "unverified"
  | "retrieved"
  | "verified"
  | "mismatch"
  | "check-failed"
  | "access-blocked";

export type AccessLevel = "unknown" | "metadata" | "abstract" | "full-text";

export type CheckProvider = "crossref" | "openalex" | "pubmed" | "clinicaltrials" | "manual";

export interface SourceCheck {
  id: string;
  at: string;
  provider: CheckProvider;
  /** The identifier that was looked up (DOI, PMID, NCT…). */
  identifier: string;
  result: "match" | "mismatch" | "not-found" | "error" | "blocked" | "unresolved";
  /** What the registry actually returned, so a reviewer can see the comparison. */
  observed?: { title?: string; year?: number | null; venue?: string };
  note?: string;
}

export interface Provenance {
  /** model: generated as a lead; retrieval: came back from a search; user: typed or imported by the investigator */
  origin: "model" | "retrieval" | "user";
  retrievalEventIds: string[];
  identifiers: { doi?: string; pmid?: string; openalex?: string; nct?: string };
  access: AccessLevel;
  status: SourceStatus;
  checks: SourceCheck[];
  /** Records that are different reports of the same underlying study share a groupId. */
  groupId?: string;
}

/** One real search or lookup, as performed — not as described by a model. */
export interface RetrievalEvent {
  id: string;
  at: string;
  /** e.g. "openalex", "crossref", "pubmed", "consensus-connector" */
  provider: string;
  query: string;
  filters?: Record<string, string>;
  /** Total hits reported by the provider; null when the provider does not report it or the call failed. */
  resultCount: number | null;
  /** Ids of EvidenceItems produced by this event. */
  recordIds: string[];
  status: "ok" | "partial" | "error" | "blocked";
  /** app: Meridian's own adapter; connector: a development-time tool (e.g. a Cowork connector); manual: a person */
  performedBy: "app" | "connector" | "manual";
  note?: string;
}

export type ClaimKind = "source-derived" | "local-fact" | "assumption" | "inference" | "scenario" | "unknown";

export type SupportStatus = "supported" | "unsupported" | "unassessed" | "quarantined";
export type Polarity = "benefit" | "harm" | "null" | "unknown";
export type DerivationMethod = "percent" | "difference" | "ratio" | "sum" | "contains";

/** Unicode code-point span into an immutable SourceDocument. */
export interface SourceSpan {
  documentId: string;
  sha256: string;
  start: number;
  end: number;
}

export interface Derivation {
  method: DerivationMethod;
  operandIds: string[];
  rounding?: { mode: "half-up" | "trunc"; decimals: number };
  unit?: string;
}

export interface ClaimAssertion {
  subject?: string;
  population?: string;
  intervention?: string;
  comparator?: string;
  outcome?: string;
  timeOrigin?: string;
  timeWindow?: string;
  estimate?: string;
  unit?: string;
  denominator?: string;
  polarity?: Polarity;
  supportStatus: SupportStatus;
  spans: SourceSpan[];
  derivation?: Derivation;
}

/** A consequential assertion linked to where it comes from. */
export interface Claim {
  id: string;
  text: string;
  kind: ClaimKind;
  /** EvidenceItem ids that support the claim; empty is allowed only for local-fact/assumption/scenario. */
  sourceIds: string[];
  /** Section, table, figure or page in the source. */
  location?: string;
  /** Short quotation or close paraphrase from that location (check reuse rights before publishing). */
  passage?: string;
  interpretation?: string;
  uncertainty: "low" | "moderate" | "high";
  /** Who wrote the claim. Historical unproven claims migrate as "unknown". */
  origin?: "investigator" | "model" | "system" | "unknown";
  /** Outcome-bound support (S1). Absent on historic unassessed claims. */
  assertion?: ClaimAssertion;
  supportStatus?: SupportStatus;
}

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

/** Canonical stored source bytes. Immutable after capture. */
export interface SourceDocument {
  id: string;
  recordId: string;
  retrievalEventId?: string;
  sha256: string;
  text: string;
  mediaType: string;
  sourceScope: "abstract" | "full-text" | "metadata" | "unknown";
  shortenedAtSource: true | false | "unknown";
  capturedAt: string;
  license?: string;
  supersedes?: string;
}

/** View of a SourceDocument. `text` is a copy at ingestion; `hash` ties it to the document. */
export interface StoredText {
  documentId: string;
  sha256: string;
  text: string;
}

export interface UsageEvent {
  id: string;
  at: string;
  stage?: StageId;
  model?: string;
  elapsedMs?: number | null;
  reasonUnknown?: string;
}

export interface ActivityEvent {
  t: string;
  type: string;
}

export interface EvidenceItem {
  id: string;
  title: string;
  authors: string;
  /** null when not reported. Never a guessed year. */
  year: number | null;
  source: string;
  kind: EvidenceKind;
  /** "unrated" when no certainty judgement has been made. Never a default "low". */
  grade: GradeLevel | "unrated";
  /** 0–100 or null when not assessed. Never a default 50. */
  methodQuality: number | null;
  relevance: number | null;
  notes: string;
  /** Retrieved source text. Model notes must not overwrite this. */
  abstract?: StoredText;
  /** Additional captured versions of the same work (D12). Never discarded for being longer or later. */
  contentVersions?: StoredText[];
  pairingIssue?: "suspect-content-pairing";
  publicationStatus?: "unknown" | "published" | "preprint" | "retracted" | "withdrawn" | "ahead-of-print";
  /** Completed only after a full-text body is stored and every listed section is marked read (F3). */
  fullTextRead?: {
    documentId: string;
    sections: { id: string; heading?: string; read: boolean }[];
    complete: boolean;
    at: string;
  };
  /** Last failed full-text access attempt. Presence is not a read. */
  fullTextAccess?: { ok: false; note: string; at: string } | { ok: true; route: string; at: string };
  /** @deprecated model label; see `provenance.status` */
  verification: Verification;
  doi?: string;
  pmid?: string;
  contextTags: string[];
  keyFindings: string;
  limitations: string;
  provenance: Provenance;
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
  /** 0–100 judgements, or null when not made. A number here must be explained in `rationale`. */
  novelty: number | null;
  need: number | null;
  practiceChange: number | null;
  feasibility: number | null;
  parsimony: number | null;
  rationale: string;
  risks: string;
}

export interface ResearchQuestion {
  id: string;
  text: string;
  /** PCC (Population–Concept–Context) is the frame scoping reviews actually use. */
  framework: "PICO" | "PECO" | "SPIDER" | "PICOT" | "FINER" | "QI-aim" | "PCC";
  population: string;
  intervention?: string;
  comparator?: string;
  /** Scoping (PCC) work states a concept rather than an outcome; `outcome` may then be empty. */
  outcome: string;
  concept?: string;
  context?: string;
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
  score: number | null;
  primaryOutcomeCount: number | null;
  secondaryOutcomeCount: number | null;
  covariateCount: number | null;
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
  /** null when the generator did not say (or said it malformed). Never coerced. */
  patientCentered: boolean | null;
}

export interface VoiceItem {
  id: string;
  source: "patient" | "family" | "clinician" | "partner" | "public" | "social";
  theme: string;
  quote: string;
  implication: string;
  verification: Verification;
}

/**
 * A fact about the local setting that the investigator entered and can document: an approval with
 * its reference, a resource or time commitment, a data-access agreement. Investigator-owned; a model
 * can read these but never create, edit or delete them. Gates are met only by these facts or by the
 * investigator directly.
 */
export interface LocalFact {
  id: string;
  text: string;
  by: "investigator";
  at: string;
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
  /** Investigator-entered local facts (approvals, resources, data access). */
  localFacts?: LocalFact[];
  generatedAt?: string;
}

export interface ScanStage {
  query: string;
  /**
   * Human-readable list derived from `retrievalEvents`. Kept for existing panels.
   * Must not be populated from model text; see `apply-ai.ts`.
   */
  sourcesConsulted: string[];
  items: EvidenceItem[];
  /** Real searches and lookups, in order. Empty means nothing was actually searched. */
  retrievalEvents: RetrievalEvent[];
  /** Consequential assertions with their sources (claim–source ledger). */
  claims: Claim[];
  /** Sources or channels that could not be accessed (paywall, blocked host, robots policy…). */
  unresolvedAccess: string[];
  gradeOverall: GradeLevel | "";
  gradeRationale: string;
  synthesis: string;
  generatedAt?: string;
  quarantine?: { claims: Claim[]; annotations: unknown[]; items?: EvidenceItem[] };
  /** Model claims replaced by a later appraisal of the same records. Kept, never deleted. */
  supersededClaims?: Claim[];
  coverage?: { calls: { callId: string; recordIds: string[]; chars: number }[] };
  /**
   * Set only by an investigator screen action in the store. Model JSON cannot write this.
   * Valid only while queryHash and revision still match the current scan content (D26).
   */
  emptySearchConfirmation?: {
    by: "investigator";
    at: string;
    queryHash: string;
    revision: string;
  };
  emptySearchConfirmedBy?: "investigator";
  emptySearchConfirmedAt?: string;
  /** @deprecated use emptySearchConfirmation */
  emptySearchConfirmed?: { at: string; actor: "investigator" };
  /** Historical GRADE assignment that was not supported by retrieved records. Display is not this value. */
  unsupportedGradeOverall?: { value: GradeLevel; reason: string; status: "stale" | "unknown" };
  completionWithdrawn?: { wasComplete: true; reason: string };
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

/*
 * Decision record — an evidence-backed decision that stays linked to the claims it rests on, the
 * criteria that would justify or defeat it, the gates that must be met before anyone acts on it,
 * and the exact evidence revision it was made against. Status is derived from data
 * (`evidence/decision.ts`), never from a model's own "success" flag.
 *
 * Concepts adapted (no code copied) from AutoSciRub (criteria with verifiable satisfaction
 * conditions), InnoEval's negative example (gates are non-compensatory; no score can cancel them)
 * and OpenResearch (content-identified input snapshot). See docs/EVIDENCE.md.
 */
export type DecisionKind = "pursue" | "narrow" | "defer" | "no-new-study" | "refer" | "implementation" | "replicate";
/**
 * "not-required": the investigator states that this gate does not apply to this decision (for example a
 * gate the model copied from a rejected alternative: "funding for a comparative trial" on a quality
 * improvement decision, live run of 22 September). Investigator only, with the reason in `evidence`;
 * a model reply can never set it.
 */
export type GateStatus = "met" | "unmet" | "unknown" | "not-required";

/** A requirement that must be met before the decision is acted on. Never averaged away. */
export interface DecisionGate {
  id: string;
  requirement: string;
  status: GateStatus;
  /** Where the evidence that the gate is met lives (a document, an approval number) — never model prose. */
  evidence?: string;
  /** Who set the status. A model may only say "met" when its evidence is anchored in investigator text. */
  setBy?: "model" | "investigator";
  /** Why a model "met" was accepted (the investigator anchors found), or why it was refused. */
  grounding?: string;
  /**
   * D10 / S5: a model never sets a gate. Its "met" is kept here as a proposal and the gate stays
   * "unknown" until the investigator confirms it. `supportingFacts` and `concerns` are Meridian's reading
   * of the investigator's local facts and constraints, shown to help that decision; they carry no authority.
   */
  proposal?: GateProposal;
  /**
   * D10 / S5: set only by the store's addGate, when the investigator records the status of one kind of
   * approval for the work from the record form. A model reply can never set it, and confirming a gate never does.
   */
  record?: true;
}

export interface GateProposal {
  status: "met";
  evidence: string;
  /** Investigator facts the model's evidence points to (by reference number or wording). */
  supportingFacts: string[];
  /** What to check before confirming: pending, conflicting, other-study, out-of-scope or clinical-access facts. */
  concerns: string[];
  /** The investigator's facts this reading was made against; a change makes Meridian read them again. */
  factsRevision?: string;
}

/** What would justify or defeat the decision, with the claims that speak to it. */
export interface DecisionCriterion {
  id: string;
  text: string;
  role: "justifies" | "defeats";
  status: "met" | "unmet" | "unknown";
  claimIds: string[];
}

export interface DecisionRecord {
  id: string;
  at: string;
  actor: "model" | "investigator";
  kind: DecisionKind;
  statement: string;
  question: string;
  claimIds: string[];
  /** Claim ids the proposal cited that were not in the ledger. Acceptance stays refused until a re-issued decision omits them. */
  droppedClaimIds?: string[];
  criteria: DecisionCriterion[];
  gates: DecisionGate[];
  /** Simpler credible alternatives that were considered. */
  alternatives: string[];
  /** `evidenceRevision(study)` when the decision was made; a different current revision makes it stale. */
  inputRevision: string;
  status: "proposed" | "accepted" | "stale" | "withdrawn";
  /** Investigator selection. Independent of whether action is allowed (S11). */
  selectionStatus: "proposed" | "accepted" | "withdrawn" | "stale";
  /** Whether the investigator may act. Blocked when gates or other blockers remain (S11). */
  actionStatus: "blocked" | "ready";
  /** Family this decision would pursue, when stated. */
  recommendedFamily?: StudyFamily | "" | null;
  note?: string;
  /**
   * D10 / S5: the investigator's own facts that left an approval open, acted on for this decision: given (with
   * the reference) or set aside as not concerning it (with the reason). Their call, logged in the audit.
   */
  settledItems?: { text: string; how: "given" | "aside"; note: string; at: string }[];
}

export interface DesignStage {
  recommended: StudyFamily | "";
  /** How `recommended` was reached: stated by the investigator, inferred from cues, or not resolvable yet. */
  basis?: "explicit" | "inferred" | "unresolved";
  /** Evidence-backed decisions, newest last. History is kept; superseded ones become "withdrawn" or "stale". */
  decisions: DecisionRecord[];
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
  /** Who caused the entry. Absent on entries written before actors were recorded. */
  actor?: "investigator" | "model" | "system";
}

/**
 * One model call, as it happened. Written for every Illuminate attempt (applied, refused, stale or
 * failed) so an output can be traced to the model, prompt version and exact context that produced
 * it. Hashes let a reviewer confirm that a stored context or reply is the one that was used.
 */
export interface ModelRun {
  id: string;
  at: string;
  stage: StageId;
  purpose?: "appraisal" | "discovery";
  /** "xai" for a live call; "replay" for a recorded scenario response. */
  provider: string;
  model: string | null;
  mode: "live" | "replay";
  /** SHA-256 of the system prompt plus the stage schema the server used. */
  promptSha256: string | null;
  /** SHA-256 of the study context sent, and its length in characters. */
  contextSha256: string;
  contextChars: number;
  instructionSha256?: string;
  /** SHA-256 of the raw model text as received, before parsing. */
  outputSha256: string | null;
  elapsedMs: number | null;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  outcome: "applied" | "refused" | "stale" | "failed";
  issues: number;
  /** Study revision the request was made against. */
  requestRevision: string;
  /** Records sent in this call, for batched appraisal. */
  batch?: { index: number; of: number; recordIds: string[] };
  note?: string;
}

/** One literature search or identity check run by the app, for the audit trail. */
export interface EvidenceRun {
  id: string;
  at: string;
  kind: "search" | "identity-check";
  provider: string;
  query?: string;
  requests: string[];
  status: "ok" | "partial" | "error" | "blocked";
  records: number;
  elapsedMs: number | null;
  note?: string;
}

export interface AuditStage {
  entries: AuditEntry[];
  openFixes: string[];
  improvementNotes: string;
  lastReview?: string;
}

/** Bump when a persisted Study needs migration; see `store.ts` migrate(). Schema 4 is frozen in this phase. */
export const STUDY_SCHEMA_VERSION = 4;

export interface Study {
  id: string;
  title: string;
  subtitle: string;
  family: StudyFamily | null;
  setting: string;
  status: StudyStatus;
  createdAt: string;
  updatedAt: string;
  currentStage: StageId;
  completedStages: StageId[];
  /**
   * Stages that were completed and then had an upstream stage change. They stay "completed"
   * in `completedStages` (history is not erased) but must be re-reviewed before the study can be
   * called complete again. Set by `store.mergeStage`, cleared by `store.markComplete`/`clearReview`.
   */
  needsReview: StageId[];
  schemaVersion: number;
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
  documents?: SourceDocument[];
  usage?: UsageEvent[];
  /** Every model call, append-only (reproducibility). */
  modelRuns?: ModelRun[];
  /** Every live search and identity check, append-only. */
  evidenceRuns?: EvidenceRun[];
  activity?: ActivityEvent[];
  idAliases?: Record<string, string>;
  replayKey?: string;
  /** Schema-3 JSON hash taken before this study was migrated. Not a substitute for the byte backup (D25). */
  migrationBackupHash?: string;
  migrationEvents?: { at: string; from: number; to: number; note: string }[];
  /** Idempotent repair ids already applied (D23). */
  repairsApplied?: string[];
  /** Honest report when the immutable byte backup could not be written. */
  migrationBackupReport?: { written: boolean; key?: string; reason?: string };
  /** Last Illuminate attempt, including refusals. Used by the UI scenario runner. */
  lastIlluminate?: {
    stage: StageId;
    ok: boolean;
    summary: string;
    issues: { path: string; code: string; message?: string }[];
    error?: string;
    at: string;
  };
}

export type StageKey = {
  [K in StageId]: Study[K];
};
