import { createServerFn } from "@tanstack/react-start";
import type { StageId, StudyFamily } from "./types";
import { STAGE_IDS, STUDY_FAMILIES } from "./types";
import { STAGE_BY_ID } from "./stages";
import { DECISION_SCHEMA } from "./evidence/decision";
import {
  parseReplayKey,
} from "./replay-key";

export interface MeridianRequest {
  stage: StageId;
  family: StudyFamily | null;
  compact: string;
  instruction?: string;
  replayKey?: string;
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
  return {
    stage: r.stage as StageId,
    family: r.family as StudyFamily | null,
    compact: r.compact,
    instruction: r.instruction as string | undefined,
    replayKey,
  };
}

const SYSTEM = `You are Meridian, a senior methodologist sitting with an anesthesiologist / pain physician / improvement scientist.

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
3. Patient-important outcomes beat surrogate numbers. One primary outcome.
4. Simplest design that answers the question. Name why a more complex design is refused.
5. Name bias, equity (PROGRESS-Plus), feasibility, and the REB/ethics path (Canada TCPS 2 when setting is Canadian; otherwise ICH-GCP / Helsinki).
6. Theoretical frameworks only when they earn their place (SEIPS, IHI, GRADE, IMMPACT, CFIR, COM-B, realist, Donabedian).
7. Language: scholarly, fluent, concrete. Comparable to a good methods paper in BJA, RAPM, Anesthesiology, BMJ Qual Saf — not a grant brochure.
8. If evidence is thin, say so. Do not fill silence with confidence.
9. Stakeholder "quotes" must be labelled as composite/paraphrase, not real identifiable people.
10. Always include a parsimony judgement.`;

function schemaFor(stage: StageId): string {
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
      return `{
  "query": string,
  "sourcesConsulted": string[],
  "gradeOverall": "high"|"moderate"|"low"|"very-low",
  "gradeRationale": string,
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
}`;
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

function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("The model did not return JSON.");
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

async function liveXaiCall(data: MeridianRequest, apiKey: string): Promise<string> {
  const meta = STAGE_BY_ID[data.stage];
  const user = `Stage to generate: ${meta.label} (${meta.kicker})
Hint: ${meta.hint}
Declared family: ${data.family ?? "undetermined"}

STUDY CONTEXT:
${data.compact}

${data.instruction ? `Investigator steer: ${data.instruction}` : "No extra steer."}

JSON schema:
${schemaFor(data.stage)}

Produce  the richest defensible content you can without inventing evidence. For scan, 6–10 items is enough. For hypotheses, 3 ranked. For questions, 1–2. One primary outcome always.`;

  const base = (process.env.XAI_BASE_URL?.trim() || "https://api.x.ai/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-4.5",
      temperature: data.stage === "hypotheses" || data.stage === "voices" ? 0.5 : 0.25,
      max_tokens: data.stage === "manuscript" ? 3500 : 2600,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`xAI API error ${res.status}`);
  }

  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return body.choices?.[0]?.message?.content ?? "";
}

export const getMeridianRuntime = createServerFn({ method: "GET" }).handler(async () => {
  const { replayEnabledFromEnv: enabled, scenarioBuildPermission } = await import("./replay-key");
  const replay = enabled(process.env, scenarioBuildPermission());
  return { mode: replay ? ("replay" as const) : ("live" as const) };
});

export const runMeridian = createServerFn({ method: "POST" })
  .validator((input: unknown) => validateMeridianRequest(input))
  .handler(async ({ data }) => {
    const { parseModelMode: modeOf, resolveModelText } = await import("./model-runtime");
    const { replayEnabledFromEnv: enabled, scenarioBuildPermission } = await import("./replay-key");
    const replay = enabled(process.env, scenarioBuildPermission());
    const mode = replay ? modeOf(process.env.MERIDIAN_MODEL_MODE) : "live";
    const replayKey = replay ? data.replayKey : undefined;
    try {
      const resolved = await resolveModelText({
        mode,
        replayKey,
        stage: data.stage,
        live: async () => {
          const apiKey = process.env.XAI_API_KEY;
          if (!apiKey) {
            throw new Error("AI is not available in this environment.");
          }
          return liveXaiCall(data, apiKey);
        },
      });
      try {
        const parsed = extractJson(resolved.text);
        return { ok: true as const, json: JSON.stringify(parsed), modelMode: resolved.mode, replayKey: replayKey ?? null };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : "Could not parse the model output.",
          modelMode: resolved.mode,
          replayKey: replayKey ?? null,
        };
      }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "Generation failed.",
        modelMode: mode,
        replayKey: replayKey ?? null,
      };
    }
  });
