import type {
  EvidenceItem,
  EvidenceKind,
  GapItem,
  GradeLevel,
  GraphKind,
  ResearchQuestion,
  StageId,
  Study,
  StudyFamily,
  Verification,
} from "./types";
import { STUDY_FAMILIES } from "./types";
import {
  Issues,
  compactPatch,
  countOrNull,
  enumOrResolve,
  isRecord,
  objectArray,
  present,
  scoreOrNull,
  strictBoolOrNull,
  stringArray,
  stringOrUndefined,
  yearOrNull,
} from "./contracts";
import type { Issue } from "./contracts";
import { uid, nowIso } from "./utils";
import { applyDecision } from "./evidence/decision";
import { applyAppraisal } from "./evidence/appraise";
import { knownSetForApply, markUnknownIdsInPatch } from "./evidence/ids";

/*
 * Maps a model's JSON onto a stage patch.
 *
 * Contract (see contracts.ts):
 *   - a key the model omitted is not in the patch, so the store keeps what the investigator had;
 *   - a key set to null clears the field (explicit) — except investigator-owned
 *     `problem.constraints`, which the model cannot null, empty, or replace;
 *   - an unusable value becomes null/dropped and is reported in `issues` — nothing is invented.
 * Model-suggested evidence always carries provenance {origin: "model", status: "unverified"};
 * the model's own "sourcesConsulted" text is discarded because consulted sources are derived from
 * real RetrievalEvents (see evidence/retrieve.ts), not from prose.
 * Direct human UI / mergeStage editing and clearing of constraints remains.
 */

const EVIDENCE_KINDS = [
  "guideline",
  "systematic-review",
  "rct",
  "observational",
  "qi-report",
  "grey",
  "qualitative",
  "patient-voice",
  "expert",
  "preprint",
  "trial-registry",
] as const satisfies readonly EvidenceKind[];

const GRADES = ["high", "moderate", "low", "very-low"] as const satisfies readonly GradeLevel[];
const VERIFICATIONS = ["landmark", "verify", "ai-lead"] as const satisfies readonly Verification[];
const GRAPH_KINDS = [
  ...EVIDENCE_KINDS,
  "context",
  "gap",
  "outcome",
  "stakeholder",
  "framework",
] as const satisfies readonly GraphKind[];
const GAP_KINDS = ["evidence", "method", "error", "equity", "implementation", "outcome"] as const satisfies readonly GapItem["kind"][];
const GAP_SEVERITIES = ["high", "moderate", "watch"] as const satisfies readonly GapItem["severity"][];
const FRAMEWORKS = ["PICO", "PECO", "SPIDER", "PICOT", "FINER", "QI-aim", "PCC"] as const satisfies readonly ResearchQuestion["framework"][];
const OUTCOME_ROLES = ["primary", "secondary", "balancing", "process"] as const;
const BIAS_SEVERITIES = ["ok", "watch", "high"] as const;
const VOICE_SOURCES = ["patient", "family", "clinician", "partner", "public", "social"] as const;

export interface AppliedAi {
  /** false when the payload was not an object or contained nothing recognisable; keep previous state. */
  ok: boolean;
  stagePatch: Record<string, unknown>;
  studyPatch?: Partial<Pick<Study, "title" | "subtitle" | "family">>;
  summary: string;
  issues: Issue[];
}

function str(raw: Record<string, unknown>, key: string, issues: Issues): string | undefined {
  return stringOrUndefined(raw[key], key, issues);
}

function strs(raw: Record<string, unknown>, key: string, issues: Issues): string[] | undefined {
  return stringArray(raw[key], key, issues);
}

function nonEmpty(v: string | undefined): string | undefined {
  return v && v.trim() ? v : undefined;
}

function recognised(raw: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((k) => present(raw, k));
}

/**
 * problem.constraints is investigator-owned local feasibility.
 * The model may omit it (store unchanged) or echo it exactly (no patch, no issue).
 * Null, empty string, or any other replacement is dropped with an issue; the stored text stays.
 * Human mergeStage / the Constraints field still edit and clear it.
 */
function refuseModelConstraints(raw: Record<string, unknown>, study: Study | undefined, issues: Issues): void {
  if (!present(raw, "constraints")) return;
  const stored = study?.problem.constraints ?? "";
  const v = raw.constraints;
  if (typeof v === "string" && v === stored) return;
  if (v !== null && typeof v !== "string") {
    issues.add("constraints", "invalid-type", `expected string, got ${typeof v}`, v);
    return;
  }
  issues.add(
    "constraints",
    "dropped",
    "investigator constraints are not model-editable; null, empty string, or replacement was refused",
    v,
  );
}

export function applyAiResult(
  stage: StageId,
  input: unknown,
  family: StudyFamily | null,
  /** The current study, needed for stages whose payload must be validated against ledger content (design → decision). */
  study?: Study,
): AppliedAi {
  const applied = applyStage(stage, input, family, study);
  if (!applied.ok || !study) return applied;
  const known = knownSetForApply(study, applied.stagePatch);
  markUnknownIdsInPatch(applied.stagePatch, known, (path, id) => {
    applied.issues.push({
      path,
      code: "unresolved-reference",
      message: `unresolved active id "${id}" is marked, not resolved`,
      value: id,
    });
  });
  return applied;
}

function applyStage(
  stage: StageId,
  input: unknown,
  family: StudyFamily | null,
  study?: Study,
): AppliedAi {
  const issues = new Issues();
  if (!isRecord(input)) {
    issues.add("$", "not-an-object", "model payload is not a JSON object; nothing applied", input);
    return { ok: false, stagePatch: {}, summary: `${stage}: nothing applied.`, issues: issues.list };
  }
  const raw: Record<string, unknown> = { ...input };
  for (const gate of ["investigatorConfirmsEmptySearch", "emptySearchConfirmed", "confirmEmptySearch"] as const) {
    if (gate in raw) {
      issues.add(gate, "dropped", "model cannot authorize an investigator gate");
      delete raw[gate];
    }
  }
  const generatedAt = nowIso();
  const summary = nonEmpty(stringOrUndefined(raw.summary, "summary", issues)) ?? `${stage} updated.`;

  switch (stage) {
    case "problem": {
      const keys = ["statement", "whoAffected", "whatHurts", "currentPractice", "whyNow", "constraints", "patientCenteredGoal", "title", "subtitle", "family"];
      refuseModelConstraints(raw, study, issues);
      const fam = present(raw, "family")
        ? enumOrResolve(STUDY_FAMILIES, raw.family, "family", issues, family ?? undefined)
        : undefined;
      return {
        ok: recognised(raw, keys),
        summary,
        issues: issues.list,
        studyPatch: compactPatch({
          title: nonEmpty(str(raw, "title", issues)),
          subtitle: nonEmpty(str(raw, "subtitle", issues)),
          family: fam,
        }),
        stagePatch: compactPatch({
          statement: str(raw, "statement", issues),
          whoAffected: str(raw, "whoAffected", issues),
          whatHurts: str(raw, "whatHurts", issues),
          currentPractice: str(raw, "currentPractice", issues),
          whyNow: str(raw, "whyNow", issues),
          patientCenteredGoal: str(raw, "patientCenteredGoal", issues),
          generatedAt,
        }),
      };
    }

    case "scan": {
      if (present(raw, "sourcesConsulted")) {
        issues.add(
          "sourcesConsulted",
          "dropped",
          "model-described consulted sources are not applied; sourcesConsulted is derived from real retrieval events",
          raw.sourcesConsulted,
        );
      }
      const currentItems = study?.scan.items ?? [];
      const retrievedCount = currentItems.filter(
        (i) => i.provenance?.status === "retrieved" || i.provenance?.status === "verified",
      ).length;
      const hasAppraisalShape = present(raw, "annotations") || present(raw, "claims");
      if (hasAppraisalShape) {
        const appraisal = applyAppraisal(currentItems, raw, study?.documents ?? []);
        issues.list.push(...appraisal.issues);
        const refuseCertainty = retrievedCount === 0;
        if (refuseCertainty && present(raw, "gradeOverall")) {
          issues.add("gradeOverall", "dropped", "certainty over uninspected records is not assignable");
        }
        const prevQ = study?.scan.quarantine;
        const qClaims = [...(prevQ?.claims ?? []), ...(appraisal.quarantine.claims ?? [])];
        const qAnns = [...(prevQ?.annotations ?? []), ...(appraisal.quarantine.annotations ?? [])];
        const qItems = prevQ?.items ?? [];
        const hasQ = qClaims.length + qAnns.length + qItems.length > 0;
        return {
          ok: recognised(raw, ["annotations", "claims", "synthesis", "gradeOverall", "gradeRationale"]),
          summary,
          issues: issues.list,
          stagePatch: compactPatch({
            items: appraisal.items,
            claims: appraisal.claims,
            synthesis: appraisal.synthesis,
            gradeOverall: refuseCertainty ? "" : appraisal.gradeOverall,
            gradeRationale: refuseCertainty && appraisal.gradeOverall ? undefined : appraisal.gradeRationale,
            quarantine: hasQ ? { items: qItems, claims: qClaims, annotations: qAnns } : undefined,
            generatedAt,
          }),
        };
      }
      const rawItems = objectArray(raw.items, "items", issues) ?? [];
      const mapped: { n: number; item: EvidenceItem }[] = [];
      rawItems.forEach((i, n) => {
        const p = `items[${n}]`;
        const title = nonEmpty(stringOrUndefined(i.title, `${p}.title`, issues));
        if (!title) {
          issues.add(`${p}`, "dropped", "evidence item without a title dropped");
          return;
        }
        const doi = nonEmpty(stringOrUndefined(i.doi, `${p}.doi`, issues));
        const pmid = nonEmpty(stringOrUndefined(i.pmid, `${p}.pmid`, issues));
        const verification =
          enumOrResolve(VERIFICATIONS, i.verification, `${p}.verification`, issues, "ai-lead") ?? "ai-lead";
        mapped.push({
          n,
          item: {
            id: nonEmpty(stringOrUndefined(i.id, `${p}.id`, issues)) ?? uid("ev"),
            title,
            authors: nonEmpty(stringOrUndefined(i.authors, `${p}.authors`, issues)) ?? "",
            year: yearOrNull(i.year, `${p}.year`, issues),
            source: stringOrUndefined(i.source, `${p}.source`, issues) ?? "",
            kind: enumOrResolve(EVIDENCE_KINDS, i.kind, `${p}.kind`, issues, "grey") ?? "grey",
            grade: enumOrResolve(GRADES, i.grade, `${p}.grade`, issues) ?? "unrated",
            methodQuality: scoreOrNull(i.methodQuality, `${p}.methodQuality`, issues),
            relevance: scoreOrNull(i.relevance, `${p}.relevance`, issues),
            verification,
            doi,
            pmid,
            contextTags: stringArray(i.contextTags, `${p}.contextTags`, issues) ?? [],
            keyFindings: stringOrUndefined(i.keyFindings, `${p}.keyFindings`, issues) ?? "",
            limitations: stringOrUndefined(i.limitations, `${p}.limitations`, issues) ?? "",
            notes: stringOrUndefined(i.notes, `${p}.notes`, issues) ?? "",
            provenance: {
              origin: "model" as const,
              retrievalEventIds: [],
              identifiers: compactPatch({ doi, pmid }),
              access: "unknown" as const,
              status: "unverified" as const,
              checks: [],
            },
          } as EvidenceItem,
        });
      });
      const existingIds = new Set(currentItems.map((x) => x.id));
      const kept: EvidenceItem[] = [];
      const collided: EvidenceItem[] = [];
      for (const { n, item } of mapped) {
        const id = item.id;
        if (id && existingIds.has(id)) {
          collided.push(item);
          issues.add(`items[${n}]`, "id-collision", `model item id "${id}" collides with an ingested record and was quarantined`, id);
        } else {
          kept.push(item);
          if (id) existingIds.add(id);
        }
      }
      const afterItems = kept.length ? [...currentItems, ...kept] : currentItems;
      const requestedGrade = enumOrResolve(GRADES, raw.gradeOverall, "gradeOverall", issues);
      if (requestedGrade) {
        issues.add("gradeOverall", "dropped", "certainty is assigned only by appraisal over retrieved records, not by discovery leads");
      }
      const retrievedHere = currentItems.filter(
        (i) => i.provenance?.status === "retrieved" || i.provenance?.status === "verified",
      ).length;
      // Discovery never assigns certainty. Over retrieved records it must not clear an appraisal grade (T-5).
      const gradeOverall = retrievedHere > 0 ? undefined : "";
      const prevQ = study?.scan.quarantine;
      return {
        ok: recognised(raw, ["items", "query", "gradeOverall", "gradeRationale", "synthesis"]),
        summary,
        issues: issues.list,
        stagePatch: compactPatch({
          query: str(raw, "query", issues),
          gradeOverall,
          gradeRationale: retrievedHere > 0 || requestedGrade ? undefined : str(raw, "gradeRationale", issues),
          synthesis: str(raw, "synthesis", issues),
          items: kept.length ? afterItems : undefined,
          quarantine: collided.length
            ? {
                items: [...(prevQ?.items ?? []), ...collided],
                claims: prevQ?.claims ?? [],
                annotations: prevQ?.annotations ?? [],
              }
            : undefined,
          generatedAt,
        }),
      };
    }

    case "map": {
      const nodes = objectArray(raw.nodes, "nodes", issues)?.flatMap((i, n) => {
        const p = `nodes[${n}]`;
        const label = nonEmpty(stringOrUndefined(i.label, `${p}.label`, issues));
        if (!label) {
          issues.add(p, "dropped", "node without a label dropped");
          return [];
        }
        return [
          {
            id: nonEmpty(stringOrUndefined(i.id, `${p}.id`, issues)) ?? `n-${n}`,
            label,
            kind: enumOrResolve(GRAPH_KINDS, i.kind, `${p}.kind`, issues, "context") ?? "context",
            detail: nonEmpty(stringOrUndefined(i.detail, `${p}.detail`, issues)),
          },
        ];
      });
      const edges = objectArray(raw.edges, "edges", issues)?.flatMap((i, n) => {
        const p = `edges[${n}]`;
        const from = nonEmpty(stringOrUndefined(i.from, `${p}.from`, issues));
        const to = nonEmpty(stringOrUndefined(i.to, `${p}.to`, issues));
        if (!from || !to) {
          issues.add(p, "dropped", "edge without both endpoints dropped");
          return [];
        }
        // A relation without a label is an unexplained connection; keep it visible as such.
        return [{ from, to, relation: nonEmpty(stringOrUndefined(i.relation, `${p}.relation`, issues)) ?? "unlabelled" }];
      });
      return {
        ok: recognised(raw, ["nodes", "edges", "reading", "contexts"]),
        summary,
        issues: issues.list,
        stagePatch: compactPatch({
          contexts: strs(raw, "contexts", issues),
          reading: str(raw, "reading", issues),
          nodes,
          edges,
          generatedAt,
        }),
      };
    }

    case "gaps": {
      const items = objectArray(raw.items, "items", issues)?.flatMap((i, n) => {
        const p = `items[${n}]`;
        const title = nonEmpty(stringOrUndefined(i.title, `${p}.title`, issues));
        if (!title) {
          issues.add(p, "dropped", "gap without a title dropped");
          return [];
        }
        const kind = enumOrResolve(GAP_KINDS, i.kind, `${p}.kind`, issues);
        const severity = enumOrResolve(GAP_SEVERITIES, i.severity, `${p}.severity`, issues, "watch") ?? "watch";
        if (!kind) {
          issues.add(p, "dropped", "gap with an unrecognised kind dropped rather than guessed");
          return [];
        }
        return [
          {
            id: nonEmpty(stringOrUndefined(i.id, `${p}.id`, issues)) ?? `g-${n}`,
            title,
            kind,
            severity,
            whyItMatters: stringOrUndefined(i.whyItMatters, `${p}.whyItMatters`, issues) ?? "",
            opportunity: stringOrUndefined(i.opportunity, `${p}.opportunity`, issues) ?? "",
          },
        ];
      });
      return {
        ok: recognised(raw, ["items", "errorsFound", "reevaluation"]),
        summary,
        issues: issues.list,
        stagePatch: compactPatch({
          items,
          errorsFound: strs(raw, "errorsFound", issues),
          reevaluation: str(raw, "reevaluation", issues),
          generatedAt,
        }),
      };
    }

    case "hypotheses": {
      const items = objectArray(raw.items, "items", issues)?.flatMap((i, n) => {
        const p = `items[${n}]`;
        const statement = nonEmpty(stringOrUndefined(i.statement, `${p}.statement`, issues));
        if (!statement) {
          issues.add(p, "dropped", "hypothesis without a statement dropped");
          return [];
        }
        return [
          {
            id: nonEmpty(stringOrUndefined(i.id, `${p}.id`, issues)) ?? `h-${n}`,
            statement,
            novelty: scoreOrNull(i.novelty, `${p}.novelty`, issues),
            need: scoreOrNull(i.need, `${p}.need`, issues),
            practiceChange: scoreOrNull(i.practiceChange, `${p}.practiceChange`, issues),
            feasibility: scoreOrNull(i.feasibility, `${p}.feasibility`, issues),
            parsimony: scoreOrNull(i.parsimony, `${p}.parsimony`, issues),
            rationale: stringOrUndefined(i.rationale, `${p}.rationale`, issues) ?? "",
            risks: stringOrUndefined(i.risks, `${p}.risks`, issues) ?? "",
          },
        ];
      });
      const selectedId = nonEmpty(str(raw, "selectedId", issues));
      if (selectedId && items && !items.some((h) => h.id === selectedId)) {
        issues.add("selectedId", "dropped", `selectedId "${selectedId}" does not match any returned hypothesis`);
      }
      return {
        ok: recognised(raw, ["items", "selectedId"]),
        summary,
        issues: issues.list,
        stagePatch: compactPatch({
          selectedId: selectedId && items?.some((h) => h.id === selectedId) ? selectedId : undefined,
          items,
          generatedAt,
        }),
      };
    }

    case "questions": {
      const items = objectArray(raw.items, "items", issues)?.flatMap((i, n) => {
        const p = `items[${n}]`;
        const text = nonEmpty(stringOrUndefined(i.text, `${p}.text`, issues));
        if (!text) {
          issues.add(p, "dropped", "question without text dropped");
          return [];
        }
        const framework = enumOrResolve(FRAMEWORKS, i.framework, `${p}.framework`, issues);
        if (!framework) {
          issues.add(p, "dropped", "question with an unrecognised framework dropped rather than relabelled");
          return [];
        }
        return [
          compactPatch({
            id: nonEmpty(stringOrUndefined(i.id, `${p}.id`, issues)) ?? `q-${n}`,
            text,
            framework,
            population: stringOrUndefined(i.population, `${p}.population`, issues) ?? "",
            intervention: nonEmpty(stringOrUndefined(i.intervention, `${p}.intervention`, issues)),
            comparator: nonEmpty(stringOrUndefined(i.comparator, `${p}.comparator`, issues)),
            outcome: stringOrUndefined(i.outcome, `${p}.outcome`, issues) ?? "",
            concept: nonEmpty(stringOrUndefined(i.concept, `${p}.concept`, issues)),
            context: nonEmpty(stringOrUndefined(i.context, `${p}.context`, issues)),
            time: nonEmpty(stringOrUndefined(i.time, `${p}.time`, issues)),
            setting: nonEmpty(stringOrUndefined(i.setting, `${p}.setting`, issues)),
          }) as ResearchQuestion,
        ];
      });
      return {
        ok: recognised(raw, ["items", "finer"]),
        summary,
        issues: issues.list,
        stagePatch: compactPatch({
          finer: str(raw, "finer", issues),
          items,
          generatedAt,
        }),
      };
    }

    case "design": {
      const recommended = enumOrResolve(STUDY_FAMILIES, raw.recommended, "recommended", issues);
      // A proposed decision is validated against the study's ledger; without the study it cannot be accepted.
      let decisions: Study["design"]["decisions"] | undefined;
      if (present(raw, "decision")) {
        if (!study) {
          issues.add("decision", "dropped", "decision cannot be validated without the current study (ledger claim ids)");
        } else {
          const r = applyDecision(raw.decision, study);
          issues.list.push(...r.issues);
          if (r.decision) {
            const fromDecision =
              typeof r.decision.recommendedFamily === "string" &&
              (STUDY_FAMILIES as readonly string[]).includes(r.decision.recommendedFamily)
                ? r.decision.recommendedFamily
                : undefined;
            const chosen = fromDecision ?? recommended;
            if (chosen) r.decision.recommendedFamily = chosen;
            else r.decision.recommendedFamily = null;
            // Earlier proposed decisions are superseded, not erased.
            decisions = [
              ...(study.design.decisions ?? []).map((d) =>
                d.status === "proposed" || d.selectionStatus === "proposed"
                  ? { ...d, status: "withdrawn" as const, selectionStatus: "withdrawn" as const, actionStatus: "blocked" as const, note: `${d.note ? d.note + " " : ""}superseded by ${r.decision!.id}` }
                  : d,
              ),
              r.decision,
            ];
          }
        }
      }
      return {
        ok: recognised(raw, ["recommended", "rationale", "alternatives", "guidelines", "whyNotMoreComplex", "decision"]),
        summary,
        issues: issues.list,
        // S11 / A4.2 T-3: a proposed recommendation never writes study.family. Acceptance does.
        // A4.2 T-2: design.basis is owned by create / investigator setFamily / accept, not by a proposal.
        stagePatch: compactPatch({
          recommended,
          decisions,
          rationale: str(raw, "rationale", issues),
          alternatives: strs(raw, "alternatives", issues),
          guidelines: strs(raw, "guidelines", issues),
          whyNotMoreComplex: str(raw, "whyNotMoreComplex", issues),
          generatedAt,
        }),
      };
    }

    case "protocol": {
      const outcomes = objectArray(raw.outcomes, "outcomes", issues)?.flatMap((i, n) => {
        const p = `outcomes[${n}]`;
        const name = nonEmpty(stringOrUndefined(i.name, `${p}.name`, issues));
        if (!name) {
          issues.add(p, "dropped", "outcome without a name dropped");
          return [];
        }
        const role = enumOrResolve(OUTCOME_ROLES, i.role, `${p}.role`, issues);
        if (!role) {
          issues.add(p, "dropped", "outcome with an unrecognised role dropped rather than demoted to secondary");
          return [];
        }
        return [
          {
            id: nonEmpty(stringOrUndefined(i.id, `${p}.id`, issues)) ?? `o-${n}`,
            role,
            name,
            measure: stringOrUndefined(i.measure, `${p}.measure`, issues) ?? "",
            timing: stringOrUndefined(i.timing, `${p}.timing`, issues) ?? "",
            why: stringOrUndefined(i.why, `${p}.why`, issues) ?? "",
            patientCentered: strictBoolOrNull(i.patientCentered, `${p}.patientCentered`, issues),
          },
        ];
      });
      const biasFlags = objectArray(raw.biasFlags, "biasFlags", issues)?.flatMap((i, n) => {
        const p = `biasFlags[${n}]`;
        const label = nonEmpty(stringOrUndefined(i.label, `${p}.label`, issues));
        if (!label) {
          issues.add(p, "dropped", "bias flag without a label dropped");
          return [];
        }
        return [
          {
            id: nonEmpty(stringOrUndefined(i.id, `${p}.id`, issues)) ?? `b-${n}`,
            label,
            severity: enumOrResolve(BIAS_SEVERITIES, i.severity, `${p}.severity`, issues, "watch") ?? "watch",
            note: stringOrUndefined(i.note, `${p}.note`, issues) ?? "",
          },
        ];
      });
      const parsimony = isRecord(raw.parsimony)
        ? {
            score: scoreOrNull(raw.parsimony.score, "parsimony.score", issues),
            primaryOutcomeCount: countOrNull(raw.parsimony.primaryOutcomeCount, "parsimony.primaryOutcomeCount", issues),
            secondaryOutcomeCount: countOrNull(raw.parsimony.secondaryOutcomeCount, "parsimony.secondaryOutcomeCount", issues),
            covariateCount: countOrNull(raw.parsimony.covariateCount, "parsimony.covariateCount", issues),
            flags: stringArray(raw.parsimony.flags, "parsimony.flags", issues) ?? [],
            simplestPath: stringOrUndefined(raw.parsimony.simplestPath, "parsimony.simplestPath", issues) ?? "",
          }
        : undefined;
      if (present(raw, "parsimony") && !parsimony) {
        issues.add("parsimony", "invalid-type", "parsimony is not an object; left unchanged", raw.parsimony);
      }
      return {
        ok: recognised(raw, ["overview", "population", "exposure", "procedures", "outcomes", "feasibility", "biasMitigation", "biasFlags", "parsimony", "theoreticalFramework"]),
        summary,
        issues: issues.list,
        stagePatch: compactPatch({
          overview: str(raw, "overview", issues),
          population: str(raw, "population", issues),
          exposure: str(raw, "exposure", issues),
          procedures: str(raw, "procedures", issues),
          outcomes,
          feasibility: str(raw, "feasibility", issues),
          biasMitigation: strs(raw, "biasMitigation", issues),
          biasFlags,
          parsimony,
          theoreticalFramework: str(raw, "theoreticalFramework", issues),
          generatedAt,
        }),
      };
    }

    case "stats":
      return {
        ok: recognised(raw, ["designSummary", "sampleSize", "primaryAnalysis", "secondaryAnalysis", "missingData", "multiplicity", "software", "overfittingGuards"]),
        summary,
        issues: issues.list,
        stagePatch: compactPatch({
          designSummary: str(raw, "designSummary", issues),
          sampleSize: str(raw, "sampleSize", issues),
          primaryAnalysis: str(raw, "primaryAnalysis", issues),
          secondaryAnalysis: str(raw, "secondaryAnalysis", issues),
          missingData: str(raw, "missingData", issues),
          multiplicity: str(raw, "multiplicity", issues),
          software: str(raw, "software", issues),
          overfittingGuards: strs(raw, "overfittingGuards", issues),
          generatedAt,
        }),
      };

    case "ethics":
      return {
        ok: recognised(raw, ["risks", "consent", "data", "equity", "effectiveness", "efficiency", "costs", "grants", "partnerships", "rebPath", "limitations"]),
        summary,
        issues: issues.list,
        stagePatch: compactPatch({
          risks: str(raw, "risks", issues),
          consent: str(raw, "consent", issues),
          data: str(raw, "data", issues),
          equity: str(raw, "equity", issues),
          effectiveness: str(raw, "effectiveness", issues),
          efficiency: str(raw, "efficiency", issues),
          costs: str(raw, "costs", issues),
          grants: str(raw, "grants", issues),
          partnerships: str(raw, "partnerships", issues),
          rebPath: str(raw, "rebPath", issues),
          limitations: str(raw, "limitations", issues),
          generatedAt,
        }),
      };

    case "voices": {
      const items = objectArray(raw.items, "items", issues)?.flatMap((i, n) => {
        const p = `items[${n}]`;
        const theme = nonEmpty(stringOrUndefined(i.theme, `${p}.theme`, issues));
        if (!theme) {
          issues.add(p, "dropped", "voice without a theme dropped");
          return [];
        }
        return [
          {
            id: nonEmpty(stringOrUndefined(i.id, `${p}.id`, issues)) ?? `v-${n}`,
            source: enumOrResolve(VOICE_SOURCES, i.source, `${p}.source`, issues, "public") ?? "public",
            theme,
            quote: stringOrUndefined(i.quote, `${p}.quote`, issues) ?? "",
            implication: stringOrUndefined(i.implication, `${p}.implication`, issues) ?? "",
            // Generated voices are composites by construction; they can never be "landmark".
            verification: "ai-lead" as const,
          },
        ];
      });
      return {
        ok: recognised(raw, ["items", "partnershipPlan", "socialListening"]),
        summary,
        issues: issues.list,
        stagePatch: compactPatch({
          partnershipPlan: str(raw, "partnershipPlan", issues),
          socialListening: str(raw, "socialListening", issues),
          items,
          generatedAt,
        }),
      };
    }

    case "manuscript":
      return {
        ok: recognised(raw, ["title", "abstract", "introduction", "methods", "results", "discussion", "limitations", "conclusion", "reportingChecklist"]),
        summary,
        issues: issues.list,
        stagePatch: compactPatch({
          title: str(raw, "title", issues),
          abstract: str(raw, "abstract", issues),
          introduction: str(raw, "introduction", issues),
          methods: str(raw, "methods", issues),
          results: str(raw, "results", issues),
          discussion: str(raw, "discussion", issues),
          limitations: str(raw, "limitations", issues),
          conclusion: str(raw, "conclusion", issues),
          reportingChecklist: str(raw, "reportingChecklist", issues),
          generatedAt,
        }),
      };

    case "audit":
      return {
        ok: recognised(raw, ["openFixes", "improvementNotes", "lastReview"]),
        summary,
        issues: issues.list,
        stagePatch: compactPatch({
          openFixes: strs(raw, "openFixes", issues),
          improvementNotes: str(raw, "improvementNotes", issues),
          lastReview: nonEmpty(str(raw, "lastReview", issues)) ?? generatedAt,
        }),
      };
  }
}
