import type { StageId, Study, StudyFamily } from "./types";
import { uid, nowIso } from "./utils";

const FAMILIES = new Set<string>([
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
]);

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
}

function familyOf(v: unknown, fallback: StudyFamily): StudyFamily {
  return FAMILIES.has(String(v)) ? (v as StudyFamily) : fallback;
}

function arr<T>(v: unknown, map: (item: Record<string, unknown>, i: number) => T): T[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map(map);
}

export interface AppliedAi {
  stagePatch: Record<string, unknown>;
  studyPatch?: Partial<Pick<Study, "title" | "subtitle" | "family">>;
  summary: string;
}

export function applyAiResult(
  stage: StageId,
  raw: Record<string, unknown>,
  family: StudyFamily,
): AppliedAi {
  const generatedAt = nowIso();
  const summary = str(raw.summary, `${stage} updated.`);

  switch (stage) {
    case "problem":
      return {
        summary,
        studyPatch: {
          title: str(raw.title) || undefined,
          subtitle: str(raw.subtitle) || undefined,
          family: familyOf(raw.family, family),
        },
        stagePatch: {
          statement: str(raw.statement),
          whoAffected: str(raw.whoAffected),
          whatHurts: str(raw.whatHurts),
          currentPractice: str(raw.currentPractice),
          whyNow: str(raw.whyNow),
          constraints: str(raw.constraints),
          patientCenteredGoal: str(raw.patientCenteredGoal),
          generatedAt,
        },
      };
    case "scan":
      return {
        summary,
        stagePatch: {
          query: str(raw.query),
          sourcesConsulted: strs(raw.sourcesConsulted),
          gradeOverall: str(raw.gradeOverall),
          gradeRationale: str(raw.gradeRationale),
          synthesis: str(raw.synthesis),
          items: arr(raw.items, (i, n) => ({
            id: str(i.id, uid("ev")),
            title: str(i.title, `Item ${n + 1}`),
            authors: str(i.authors, "Unknown"),
            year: num(i.year, 2020),
            source: str(i.source),
            kind: str(i.kind, "grey"),
            grade: str(i.grade, "low"),
            methodQuality: num(i.methodQuality, 50),
            relevance: num(i.relevance, 50),
            verification: str(i.verification, "ai-lead"),
            doi: str(i.doi) || undefined,
            contextTags: strs(i.contextTags),
            keyFindings: str(i.keyFindings),
            limitations: str(i.limitations),
            notes: str(i.notes),
          })),
          generatedAt,
        },
      };
    case "map":
      return {
        summary,
        stagePatch: {
          contexts: strs(raw.contexts),
          reading: str(raw.reading),
          nodes: arr(raw.nodes, (i, n) => ({
            id: str(i.id, `n-${n}`),
            label: str(i.label, `Node ${n + 1}`),
            kind: str(i.kind, "context"),
            detail: str(i.detail) || undefined,
          })),
          edges: arr(raw.edges, (i) => ({
            from: str(i.from),
            to: str(i.to),
            relation: str(i.relation, "related"),
          })),
          generatedAt,
        },
      };
    case "gaps":
      return {
        summary,
        stagePatch: {
          items: arr(raw.items, (i, n) => ({
            id: str(i.id, `g-${n}`),
            title: str(i.title),
            kind: str(i.kind, "evidence"),
            severity: str(i.severity, "moderate"),
            whyItMatters: str(i.whyItMatters),
            opportunity: str(i.opportunity),
          })),
          errorsFound: strs(raw.errorsFound),
          reevaluation: str(raw.reevaluation),
          generatedAt,
        },
      };
    case "hypotheses":
      return {
        summary,
        stagePatch: {
          selectedId: str(raw.selectedId) || undefined,
          items: arr(raw.items, (i, n) => ({
            id: str(i.id, `h-${n}`),
            statement: str(i.statement),
            novelty: num(i.novelty),
            need: num(i.need),
            practiceChange: num(i.practiceChange),
            feasibility: num(i.feasibility),
            parsimony: num(i.parsimony),
            rationale: str(i.rationale),
            risks: str(i.risks),
          })),
          generatedAt,
        },
      };
    case "questions":
      return {
        summary,
        stagePatch: {
          finer: str(raw.finer),
          items: arr(raw.items, (i, n) => ({
            id: str(i.id, `q-${n}`),
            text: str(i.text),
            framework: str(i.framework, "PICO"),
            population: str(i.population),
            intervention: str(i.intervention) || undefined,
            comparator: str(i.comparator) || undefined,
            outcome: str(i.outcome),
            time: str(i.time) || undefined,
            setting: str(i.setting) || undefined,
          })),
          generatedAt,
        },
      };
    case "design":
      return {
        summary,
        studyPatch: { family: familyOf(raw.recommended, family) },
        stagePatch: {
          recommended: familyOf(raw.recommended, family),
          rationale: str(raw.rationale),
          alternatives: strs(raw.alternatives),
          guidelines: strs(raw.guidelines),
          whyNotMoreComplex: str(raw.whyNotMoreComplex),
          generatedAt,
        },
      };
    case "protocol": {
      const parsimonyIn = (raw.parsimony ?? {}) as Record<string, unknown>;
      return {
        summary,
        stagePatch: {
          overview: str(raw.overview),
          population: str(raw.population),
          exposure: str(raw.exposure),
          procedures: str(raw.procedures),
          outcomes: arr(raw.outcomes, (i, n) => ({
            id: str(i.id, `o-${n}`),
            role: str(i.role, "secondary"),
            name: str(i.name),
            measure: str(i.measure),
            timing: str(i.timing),
            why: str(i.why),
            patientCentered: Boolean(i.patientCentered),
          })),
          feasibility: str(raw.feasibility),
          biasMitigation: strs(raw.biasMitigation),
          biasFlags: arr(raw.biasFlags, (i, n) => ({
            id: str(i.id, `b-${n}`),
            label: str(i.label),
            severity: str(i.severity, "watch"),
            note: str(i.note),
          })),
          parsimony: {
            score: num(parsimonyIn.score),
            primaryOutcomeCount: num(parsimonyIn.primaryOutcomeCount),
            secondaryOutcomeCount: num(parsimonyIn.secondaryOutcomeCount),
            covariateCount: num(parsimonyIn.covariateCount),
            flags: strs(parsimonyIn.flags),
            simplestPath: str(parsimonyIn.simplestPath),
          },
          theoreticalFramework: str(raw.theoreticalFramework),
          generatedAt,
        },
      };
    }
    case "stats":
      return {
        summary,
        stagePatch: {
          designSummary: str(raw.designSummary),
          sampleSize: str(raw.sampleSize),
          primaryAnalysis: str(raw.primaryAnalysis),
          secondaryAnalysis: str(raw.secondaryAnalysis),
          missingData: str(raw.missingData),
          multiplicity: str(raw.multiplicity),
          software: str(raw.software),
          overfittingGuards: strs(raw.overfittingGuards),
          generatedAt,
        },
      };
    case "ethics":
      return {
        summary,
        stagePatch: {
          risks: str(raw.risks),
          consent: str(raw.consent),
          data: str(raw.data),
          equity: str(raw.equity),
          effectiveness: str(raw.effectiveness),
          efficiency: str(raw.efficiency),
          costs: str(raw.costs),
          grants: str(raw.grants),
          partnerships: str(raw.partnerships),
          rebPath: str(raw.rebPath),
          limitations: str(raw.limitations),
          generatedAt,
        },
      };
    case "voices":
      return {
        summary,
        stagePatch: {
          partnershipPlan: str(raw.partnershipPlan),
          socialListening: str(raw.socialListening),
          items: arr(raw.items, (i, n) => ({
            id: str(i.id, `v-${n}`),
            source: str(i.source, "public"),
            theme: str(i.theme),
            quote: str(i.quote),
            implication: str(i.implication),
            verification: str(i.verification, "ai-lead"),
          })),
          generatedAt,
        },
      };
    case "manuscript":
      return {
        summary,
        stagePatch: {
          title: str(raw.title),
          abstract: str(raw.abstract),
          introduction: str(raw.introduction),
          methods: str(raw.methods),
          results: str(raw.results),
          discussion: str(raw.discussion),
          limitations: str(raw.limitations),
          conclusion: str(raw.conclusion),
          reportingChecklist: str(raw.reportingChecklist),
          generatedAt,
        },
      };
    case "audit":
      return {
        summary,
        stagePatch: {
          openFixes: strs(raw.openFixes),
          improvementNotes: str(raw.improvementNotes),
          lastReview: str(raw.lastReview, generatedAt),
        },
      };
  }
}
