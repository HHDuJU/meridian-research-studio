import { STUDY_SCHEMA_VERSION } from "./types";
import type {
  AuditStage,
  EvidenceItem,
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
  SourceDocument,
  StatsStage,
  Study,
  StudyFamily,
  VoicesStage,
} from "./types";
import { uid, nowIso } from "./utils";
import { abstractPrefixMatch, makeSourceDocument, storedTextOf } from "./evidence/documents";
import { sha256Hex } from "./evidence/hash";

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
    retrievalEvents: [],
    claims: [],
    unresolvedAccess: [],
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
    decisions: [],
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
  family: StudyFamily | null;
  setting: string;
  rawNeed: string;
  replayKey?: string;
  constraints?: string;
}): Study {
  const createdAt = nowIso();
  const study: Study = {
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
    needsReview: [],
    schemaVersion: STUDY_SCHEMA_VERSION,
    ...(input.replayKey ? { replayKey: input.replayKey } : {}),
    problem: { ...emptyProblem(input.rawNeed), constraints: input.constraints ?? "" },
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
    documents: [],
    repairsApplied: [],
    migrationEvents: [],
    idAliases: {},
  };
  return {
    ...study,
    migrationBackupHash: sha256Hex(JSON.stringify({ ...study, migrationBackupHash: undefined })),
  };
}

/*
 * Migration of persisted studies (localStorage, key "meridian-studio-v2").
 * Adds fields introduced after a study was saved; never removes or rewrites investigator content.
 * Items saved before provenance existed are labelled as what they were: model/seed leads, unverified.
 */
function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function migrateEvidenceItem(raw: unknown): EvidenceItem | null {
  if (!isObj(raw) || typeof raw.title !== "string") return null;
  const doi = typeof raw.doi === "string" && raw.doi ? raw.doi : undefined;
  const pmid = typeof raw.pmid === "string" && raw.pmid ? raw.pmid : undefined;
  const provenance = isObj(raw.provenance)
    ? (raw.provenance as unknown as EvidenceItem["provenance"])
    : {
        origin: "model" as const,
        retrievalEventIds: [],
        identifiers: { ...(doi ? { doi } : {}), ...(pmid ? { pmid } : {}) },
        access: "unknown" as const,
        status: "unverified" as const,
        checks: [],
      };
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    id: typeof raw.id === "string" ? raw.id : uid("ev"),
    title: raw.title,
    authors: typeof raw.authors === "string" ? raw.authors : "",
    year: num(raw.year),
    source: typeof raw.source === "string" ? raw.source : "",
    kind: (typeof raw.kind === "string" ? raw.kind : "grey") as EvidenceItem["kind"],
    grade: (typeof raw.grade === "string" && raw.grade ? raw.grade : "unrated") as EvidenceItem["grade"],
    methodQuality: num(raw.methodQuality),
    relevance: num(raw.relevance),
    notes: typeof raw.notes === "string" ? raw.notes : "",
    abstract: isObj(raw.abstract)
      ? (raw.abstract as unknown as EvidenceItem["abstract"])
      : undefined,
    verification: (typeof raw.verification === "string" ? raw.verification : "ai-lead") as EvidenceItem["verification"],
    doi,
    pmid,
    contextTags: Array.isArray(raw.contextTags) ? raw.contextTags.filter((x): x is string => typeof x === "string") : [],
    keyFindings: typeof raw.keyFindings === "string" ? raw.keyFindings : "",
    limitations: typeof raw.limitations === "string" ? raw.limitations : "",
    pairingIssue: raw.pairingIssue === "suspect-content-pairing" ? "suspect-content-pairing" : undefined,
    publicationStatus:
      typeof raw.publicationStatus === "string" ? (raw.publicationStatus as EvidenceItem["publicationStatus"]) : undefined,
    fullTextRead: isObj(raw.fullTextRead) ? (raw.fullTextRead as EvidenceItem["fullTextRead"]) : undefined,
    contentVersions: Array.isArray(raw.contentVersions) ? (raw.contentVersions as EvidenceItem["contentVersions"]) : undefined,
    provenance,
  };
}

export function migrateStudy(raw: unknown): Study {
  const base = createStudy({ family: null, setting: "", rawNeed: "" });
  if (!isObj(raw)) return base;
  const s = raw as Partial<Study> & Record<string, unknown>;
  const fromVersion = typeof s.schemaVersion === "number" ? s.schemaVersion : 3;
  const backupHash = typeof s.migrationBackupHash === "string" ? s.migrationBackupHash : sha256Hex(JSON.stringify(raw));
  const scanRaw = isObj(s.scan) ? (s.scan as Record<string, unknown>) : {};
  const documents: SourceDocument[] = Array.isArray(s.documents)
    ? ([...s.documents] as SourceDocument[])
    : [];
  const items = (Array.isArray(scanRaw.items) ? scanRaw.items : [])
    .map(migrateEvidenceItem)
    .filter((x): x is EvidenceItem => !!x)
    .map((item) => {
      if (item.abstract?.text) return item;
      const extracted = abstractPrefixMatch(item.notes);
      if (!extracted) return item;
      const doc = makeSourceDocument({
        recordId: item.id,
        text: extracted.text,
        retrievalEventId: item.provenance.retrievalEventIds[0],
        sourceScope: "abstract",
        shortenedAtSource: "unknown",
      });
      documents.push(doc);
      return {
        ...item,
        abstract: storedTextOf(doc),
        notes: "",
        provenance: {
          ...item.provenance,
          access: item.provenance.access === "unknown" ? "abstract" : item.provenance.access,
        },
      };
    });
  const claims = (Array.isArray(scanRaw.claims) ? (scanRaw.claims as Study["scan"]["claims"]) : []).map((c) => ({
    ...c,
    origin: c.origin ?? ("unknown" as const),
  }));
  const retrieved = items.some((i) => {
    const events = Array.isArray(scanRaw.retrievalEvents) ? (scanRaw.retrievalEvents as ScanStage["retrievalEvents"]) : [];
    const ok = events.filter((e) => e.status === "ok" || e.status === "partial");
    const eventIds = new Set(ok.map((e) => e.id));
    const recordIds = new Set(ok.flatMap((e) => e.recordIds));
    return recordIds.has(i.id) || (i.provenance?.retrievalEventIds ?? []).some((id) => eventIds.has(id));
  });
  const emptyItems = items.length === 0;
  const rawGrade = typeof scanRaw.gradeOverall === "string" ? scanRaw.gradeOverall : "";
  const grades = ["high", "moderate", "low", "very-low"] as const;
  const assignedGrade = grades.find((g) => g === rawGrade);
  let gradeOverall: ScanStage["gradeOverall"] = assignedGrade ?? (rawGrade === "" ? "" : "");
  let unsupportedGradeOverall = isObj(scanRaw.unsupportedGradeOverall)
    ? (scanRaw.unsupportedGradeOverall as ScanStage["unsupportedGradeOverall"])
    : undefined;
  const repairsApplied = new Set(Array.isArray(s.repairsApplied) ? s.repairsApplied : []);
  if (assignedGrade && !retrieved) {
    unsupportedGradeOverall = {
      value: assignedGrade,
      reason: emptyItems
        ? "no retrieved records; historical GRADE assignment is unsupported and stale"
        : "leads only; certainty is not assignable over uninspected model leads",
      status: "stale",
    };
    gradeOverall = "";
    repairsApplied.add(REPAIR_EMPTY_SCAN_GRADE);
  }
  const existingEvents = Array.isArray(s.migrationEvents) ? s.migrationEvents : [];
  const alreadyV4 = fromVersion >= STUDY_SCHEMA_VERSION || existingEvents.some((e) => e.to === STUDY_SCHEMA_VERSION);
  const migrationEvents = alreadyV4
    ? existingEvents
    : [
        ...existingEvents,
        {
          at: nowIso(),
          from: fromVersion,
          to: STUDY_SCHEMA_VERSION,
          note: "schema 4: immutable abstracts, documents, origin unknown for unproven claims",
        },
      ];
  const completedStages = Array.isArray(s.completedStages) ? ([...s.completedStages] as Study["completedStages"]) : [];
  let completionWithdrawn = isObj(scanRaw.completionWithdrawn)
    ? (scanRaw.completionWithdrawn as ScanStage["completionWithdrawn"])
    : undefined;
  const needsReview = Array.isArray(s.needsReview) ? ([...s.needsReview] as Study["needsReview"]) : [];
  const emptySearchConfirmation = (() => {
    const c = isObj(scanRaw.emptySearchConfirmation) ? scanRaw.emptySearchConfirmation : null;
    if (c && c.by === "investigator" && typeof c.queryHash === "string" && typeof c.revision === "string") {
      return {
        by: "investigator" as const,
        at: typeof c.at === "string" ? c.at : nowIso(),
        queryHash: c.queryHash,
        revision: c.revision,
      };
    }
    return undefined;
  })();
  const scanForGate: ScanStage = {
    ...emptyScan(),
    ...(scanRaw as Partial<ScanStage>),
    items,
    retrievalEvents: Array.isArray(scanRaw.retrievalEvents) ? (scanRaw.retrievalEvents as ScanStage["retrievalEvents"]) : [],
    claims,
    emptySearchConfirmation,
  };
  // Legacy actor-only flags cannot keep an empty scan complete (receipt 2026-09-22).
  if (completedStages.includes("scan") && !scanMayComplete({ ...base, scan: scanForGate } as Study)) {
    completionWithdrawn = {
      wasComplete: true,
      reason: "scan completion withdrawn: confirmation is not valid for the current query/content, or no retrieved records",
    };
    const idx = completedStages.indexOf("scan");
    if (idx >= 0) completedStages.splice(idx, 1);
    if (!needsReview.includes("scan")) needsReview.push("scan");
    repairsApplied.add(REPAIR_EMPTY_SCAN_COMPLETION);
  }
  return {
    ...base,
    ...(s as Partial<Study>),
    needsReview,
    completedStages,
    schemaVersion: STUDY_SCHEMA_VERSION,
    documents,
    migrationBackupHash: backupHash,
    migrationEvents,
    repairsApplied: [...repairsApplied],
    scan: {
      ...emptyScan(),
      ...(scanRaw as Partial<ScanStage>),
      items,
      retrievalEvents: Array.isArray(scanRaw.retrievalEvents) ? (scanRaw.retrievalEvents as ScanStage["retrievalEvents"]) : [],
      claims,
      unresolvedAccess: Array.isArray(scanRaw.unresolvedAccess) ? (scanRaw.unresolvedAccess as string[]) : [],
      gradeOverall,
      unsupportedGradeOverall,
      completionWithdrawn,
      emptySearchConfirmation,
      emptySearchConfirmed:
        isObj(scanRaw.emptySearchConfirmed) && scanRaw.emptySearchConfirmed.actor === "investigator"
          ? (scanRaw.emptySearchConfirmed as ScanStage["emptySearchConfirmed"])
          : undefined,
      emptySearchConfirmedBy:
        scanRaw.emptySearchConfirmedBy === "investigator" ||
        (isObj(scanRaw.emptySearchConfirmed) && scanRaw.emptySearchConfirmed.actor === "investigator")
          ? "investigator"
          : undefined,
      emptySearchConfirmedAt:
        typeof scanRaw.emptySearchConfirmedAt === "string"
          ? scanRaw.emptySearchConfirmedAt
          : isObj(scanRaw.emptySearchConfirmed) && typeof scanRaw.emptySearchConfirmed.at === "string"
            ? scanRaw.emptySearchConfirmed.at
            : undefined,
    },
    design: {
      ...emptyDesign(),
      ...(isObj(s.design) ? (s.design as Partial<DesignStage>) : {}),
      decisions: isObj(s.design) && Array.isArray((s.design as Record<string, unknown>).decisions) ? ((s.design as DesignStage).decisions) : [],
    },
    audit: isObj(s.audit) ? { ...emptyAudit(), ...(s.audit as Partial<AuditStage>) } : emptyAudit(),
  } as Study;
}

export const REPAIR_EMPTY_SCAN_GRADE = "d20-empty-scan-certainty";
export const REPAIR_EMPTY_SCAN_COMPLETION = "d20-empty-scan-completion";

export function queryHashOf(query: string): string {
  return sha256Hex(query ?? "");
}

/** Scan-content snapshot stored on emptySearchConfirmation.revision (D26). */
export function scanContentRevision(study: Pick<Study, "scan">): string {
  const payload = JSON.stringify({
    query: study.scan.query ?? "",
    itemIds: [...study.scan.items.map((i) => i.id)].sort(),
    events: [...(study.scan.retrievalEvents ?? []).map((e) => `${e.id}:${e.status}`)].sort(),
  });
  return `sc1-${sha256Hex(payload).slice(0, 16)}`;
}

export function scanHasRetrievedRecord(study: Pick<Study, "scan">): boolean {
  const events = study.scan.retrievalEvents ?? [];
  const ok = events.filter((e) => e.status === "ok" || e.status === "partial");
  if (!ok.length) return false;
  const eventIds = new Set(ok.map((e) => e.id));
  const recordIds = new Set(ok.flatMap((e) => e.recordIds));
  return study.scan.items.some(
    (i) => recordIds.has(i.id) || (i.provenance?.retrievalEventIds ?? []).some((id) => eventIds.has(id)),
  );
}

export function emptySearchConfirmationValid(study: Pick<Study, "scan">): boolean {
  const c = study.scan.emptySearchConfirmation;
  if (!c || c.by !== "investigator") return false;
  if (c.queryHash !== queryHashOf(study.scan.query ?? "")) return false;
  if (c.revision !== scanContentRevision(study)) return false;
  return true;
}

export function scanMayComplete(study: Study): boolean {
  if (scanHasRetrievedRecord(study)) return true;
  return emptySearchConfirmationValid(study);
}

/** Drop scan from completedStages when the empty-search gate is no longer valid. */
export function withdrawScanCompletionIfInvalid(study: Study): Study {
  if (scanMayComplete(study) || !study.completedStages.includes("scan")) return study;
  return {
    ...study,
    completedStages: study.completedStages.filter((s) => s !== "scan"),
    needsReview: (study.needsReview ?? []).includes("scan")
      ? study.needsReview
      : [...(study.needsReview ?? []), "scan"],
    scan: {
      ...study.scan,
      completionWithdrawn: {
        wasComplete: true,
        reason: "scan completion withdrawn: confirmation is not valid for the current query/content, or no retrieved records",
      },
    },
  };
}
