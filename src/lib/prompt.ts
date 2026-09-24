/*
 * Meridian's model prompt: system text, per-stage JSON schema, the user message and the reply parser.
 * Pure (no server imports), so the server build (xAI) and the Cowork edition (Claude through the
 * artifact's sample capability) send the same words and read replies the same way.
 */
import type { StageId, StudyFamily } from "./types";
import { STAGE_IDS, STUDY_FAMILIES } from "./types";
import { STAGE_BY_ID } from "./stages";
import { DECISION_SCHEMA } from "./evidence/decision";
import { APPRAISAL_SCHEMA } from "./evidence/appraise";
import { parseReplayKey } from "./replay-key";

export interface MeridianRequest {
  stage: StageId;
  family: StudyFamily | null;
  compact: string;
  instruction?: string;
  replayKey?: string;
  /** Scan live schema: appraisal of retrieved records vs unverified lead discovery (S13). */
  scanPurpose?: "appraisal" | "discovery";
}

// Sized for the Scan (appraisal) stage, where up to ~40 retrieved records are shown with clipped abstracts.
export const MAX_COMPACT_CHARS = 32_000;
export const MAX_INSTRUCTION_CHARS = 2_000;

/**
 * Runtime validation of the server-function input. Rejects unknown stages/families and oversized
 * payloads with a readable message instead of forwarding whatever arrived to the model.
 */
export function validateMeridianRequest(input: unknown): MeridianRequest {
  if (!input || typeof input !== "object") throw new Error("Request must be an object.");
  const r = input as Record<string, unknown>;
  if (typeof r.stage !== "string" || !(STAGE_IDS as readonly string[]).includes(r.stage)) {
    throw new Error(`Unknown stage "${String(r.stage)}".`);
  }
  if (r.family !== null && (typeof r.family !== "string" || !(STUDY_FAMILIES as readonly string[]).includes(r.family))) {
    throw new Error(`Unknown study family "${String(r.family)}".`);
  }
  if (typeof r.compact !== "string" || !r.compact.trim()) throw new Error("Study context is missing.");
  if (r.compact.length > MAX_COMPACT_CHARS) {
    throw new Error(`Study context is ${r.compact.length} characters; the limit is ${MAX_COMPACT_CHARS}. Narrow the context instead of truncating silently.`);
  }
  if (r.instruction !== undefined) {
    if (typeof r.instruction !== "string") throw new Error("Instruction must be a string.");
    if (r.instruction.length > MAX_INSTRUCTION_CHARS) throw new Error(`Instruction exceeds ${MAX_INSTRUCTION_CHARS} characters.`);
  }
  const replayKey = parseReplayKey(r.replayKey);
  const scanPurpose =
    r.scanPurpose === "appraisal" || r.scanPurpose === "discovery" ? r.scanPurpose : undefined;
  return {
    stage: r.stage as StageId,
    family: r.family as StudyFamily | null,
    compact: r.compact,
    instruction: r.instruction as string | undefined,
    replayKey,
    scanPurpose,
  };
}

export const SYSTEM = `You are Meridian, a senior methodologist sitting with an anesthesiologist / pain physician / improvement scientist.

You design research that can change practice. You are allergic to:
- fake citations and invented PMIDs/DOIs
- kitchen-sink outcomes and covariate hunting
- calling QI a trial, or a trial a QI project
- person-blame in safety work
- overfitting small n
- purple prose and hype

Rules:
1. Return ONLY valid JSON matching the schema for the requested stage. No markdown fences.
2. Citations: only well-known landmark papers you are confident exist. Set verification to "landmark" for those, "ai-lead" for anything you are not sure of. Never invent a DOI. Prefer "verify" when unsure.
3. Patient-important outcomes beat surrogate numbers. A comparative quantitative study prespecifies one primary outcome; a QI project names its outcome measure with process and balancing measures; qualitative work has no primary outcome and no sample-size calculation.
4. Simplest design that answers the question. Name why a more complex design is refused.
5. Name bias, equity (PROGRESS-Plus), feasibility, and the REB/ethics path (Canada TCPS 2 when setting is Canadian; otherwise ICH-GCP / Helsinki).
6. Theoretical frameworks only when they earn their place (SEIPS, IHI, GRADE, IMMPACT, CFIR, COM-B, realist, Donabedian).
7. Language: scholarly, fluent, concrete. Comparable to a good methods paper in BJA, RAPM, Anesthesiology, BMJ Qual Saf — not a grant brochure.
8. If evidence is thin, say so. Do not fill silence with confidence.
9. Stakeholder "quotes" must be labelled as composite/paraphrase, not real identifiable people.
10. Always include a parsimony judgement.
11. Local facts and authority: an approval, resource, budget or data agreement exists only if it appears under LOCAL FACTS or Constraints in the study context. Never write that something was "supplied by the investigator" otherwise; mark such gates "unknown". A decision's gates are what must exist before acting on that decision only; requirements of an alternative you did not choose (the trial you advise against, a larger study for later) are not its gates.
12. Claims about a record quote it: "passage" holds exact words copied from that record's TEXT, and every number in a claim must appear in that text. Derived or pooled numbers are "inference" claims, not "source-derived".`;

export function schemaFor(stage: StageId, scanPurpose?: "appraisal" | "discovery"): string {
  switch (stage) {
    case "problem":
      return `{
  "title": string,
  "subtitle": string,
  "family": StudyFamily,
  "statement": string,
  "whoAffected": string,
  "whatHurts": string,
  "currentPractice": string,
  "whyNow": string,
  "constraints": string,
  "patientCenteredGoal": string,
  "summary": string
}`;
    case "scan":
      if (scanPurpose === "appraisal") {
        return `${APPRAISAL_SCHEMA}
Rule: annotate existing retrieved records by their id. Do not invent records, identifiers, or a new items array. Certainty (gradeOverall) only over retrieved records.`;
      }
      return `{
  "query": string,
  "synthesis": string,
  "items": [{
    "title": string, "authors": string, "year": number, "source": string,
    "kind": "guideline"|"systematic-review"|"rct"|"observational"|"qi-report"|"grey"|"qualitative"|"patient-voice"|"expert"|"preprint"|"trial-registry",
    "grade": "high"|"moderate"|"low"|"very-low",
    "methodQuality": 0-100, "relevance": 0-100,
    "verification": "landmark"|"verify"|"ai-lead",
    "doi": string|optional,
    "contextTags": string[], "keyFindings": string, "limitations": string, "notes": string
  }],
  "summary": string
}
Rule: "query" is what Meridian will send to PubMed, OpenAlex and ClinicalTrials.gov, so write a database search string, not a sentence: 2 to 4 concept groups in parentheses joined by AND, synonyms inside a group joined by OR, "quoted phrases" allowed, no field tags, at most 200 characters. Example: (ketamine OR esketamine) AND ("neuropathic pain" OR neuralgia) AND (infusion OR intravenous).
Rule: no certainty grade and no list of consulted sources here; certainty is assigned only when retrieved records are appraised.`;
    case "map":
      return `{
  "contexts": string[],
  "reading": string,
  "nodes": [{ "id": string, "label": string, "kind": string, "detail": string }],
  "edges": [{ "from": string, "to": string, "relation": string }],
  "summary": string
}`;
    case "gaps":
      return `{
  "items": [{ "id": string, "title": string, "kind": "evidence"|"method"|"error"|"equity"|"implementation"|"outcome", "severity": "high"|"moderate"|"watch", "whyItMatters": string, "opportunity": string }],
  "errorsFound": string[],
  "reevaluation": string,
  "summary": string
}`;
    case "hypotheses":
      return `{
  "items": [{ "id": string, "statement": string, "novelty": 0-100, "need": 0-100, "practiceChange": 0-100, "feasibility": 0-100, "parsimony": 0-100, "rationale": string, "risks": string }],
  "selectedId": string,
  "summary": string
}`;
    case "questions":
      return `{
  "items": [{ "id": string, "text": string, "framework": "PICO"|"PECO"|"SPIDER"|"PICOT"|"FINER"|"QI-aim", "population": string, "intervention": string, "comparator": string, "outcome": string, "time": string, "setting": string }],
  "finer": string,
  "summary": string
}`;
    case "design":
      return `{
  "recommended": StudyFamily,
  "rationale": string,
  "alternatives": string[],
  "guidelines": string[],
  "whyNotMoreComplex": string,
  ${DECISION_SCHEMA},
  "summary": string
}`;
    case "protocol":
      return `{
  "overview": string, "population": string, "exposure": string, "procedures": string,
  "outcomes": [{ "id": string, "role": "primary"|"secondary"|"balancing"|"process", "name": string, "measure": string, "timing": string, "why": string, "patientCentered": boolean }],
  "feasibility": string, "biasMitigation": string[],
  "biasFlags": [{ "id": string, "label": string, "severity": "ok"|"watch"|"high", "note": string }],
  "parsimony": { "score": 0-100, "primaryOutcomeCount": number, "secondaryOutcomeCount": number, "covariateCount": number, "flags": string[], "simplestPath": string },
  "theoreticalFramework": string,
  "summary": string
}`;
    case "stats":
      return `{
  "designSummary": string, "sampleSize": string, "primaryAnalysis": string, "secondaryAnalysis": string,
  "missingData": string, "multiplicity": string, "software": string, "overfittingGuards": string[],
  "summary": string
}`;
    case "ethics":
      return `{
  "risks": string, "consent": string, "data": string, "equity": string, "effectiveness": string,
  "efficiency": string, "costs": string, "grants": string, "partnerships": string, "rebPath": string,
  "limitations": string, "summary": string
}`;
    case "voices":
      return `{
  "partnershipPlan": string, "socialListening": string,
  "items": [{ "id": string, "source": "patient"|"family"|"clinician"|"partner"|"public"|"social", "theme": string, "quote": string, "implication": string, "verification": "landmark"|"verify"|"ai-lead" }],
  "summary": string
}`;
    case "manuscript":
      return `{
  "title": string, "abstract": string, "introduction": string, "methods": string, "results": string,
  "discussion": string, "limitations": string, "conclusion": string, "reportingChecklist": string,
  "summary": string
}`;
    case "audit":
      return `{
  "openFixes": string[], "improvementNotes": string, "lastReview": string, "summary": string
}`;
  }
}

export function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("The model did not return JSON.");
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

/** Identifies the prompt a call used: system text, stage schema and the user-message template. */
export const PROMPT_TEMPLATE_VERSION = "meridian-prompt-2026-09-23a";
export const LIVE_MODEL = "grok-4.5";

export function promptFingerprintText(stage: StageId, scanPurpose?: "appraisal" | "discovery"): string {
  return [PROMPT_TEMPLATE_VERSION, SYSTEM, schemaFor(stage, scanPurpose)].join("\n#\n");
}

/** The user message for one stage call (the system text is SYSTEM). */
export function buildUserMessage(data: MeridianRequest): string {
  const meta = STAGE_BY_ID[data.stage];
  return `Stage to generate: ${meta.label} (${meta.kicker})
Hint: ${meta.hint}
Declared family: ${data.family ?? "undetermined"}

STUDY CONTEXT:
${data.compact}

${data.instruction ? `Investigator steer: ${data.instruction}` : "No extra steer."}

JSON schema:
${schemaFor(data.stage, data.scanPurpose)}

Produce the richest defensible content you can without inventing evidence. For scan, 6–10 items is enough. For hypotheses, 3 ranked. For questions, 1–2. Outcomes follow rule 3.`;
}
