import { createServerFn } from "@tanstack/react-start";
import type { StageId, StudyFamily } from "./types";
import { STAGE_IDS, STUDY_FAMILIES } from "./types";
import { STAGE_BY_ID } from "./stages";
import { DECISION_SCHEMA } from "./evidence/decision";
import { APPRAISAL_SCHEMA } from "./evidence/appraise";
import {
  parseReplayKey,
} from "./replay-key";

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
3. Patient-important outcomes beat surrogate numbers. A comparative quantitative study prespecifies one primary outcome; a QI project names its outcome measure with process and balancing measures; qualitative work has no primary outcome and no sample-size calculation.
4. Simplest design that answers the question. Name why a more complex design is refused.
5. Name bias, equity (PROGRESS-Plus), feasibility, and the REB/ethics path (Canada TCPS 2 when setting is Canadian; otherwise ICH-GCP / Helsinki).
6. Theoretical frameworks only when they earn their place (SEIPS, IHI, GRADE, IMMPACT, CFIR, COM-B, realist, Donabedian).
7. Language: scholarly, fluent, concrete. Comparable to a good methods paper in BJA, RAPM, Anesthesiology, BMJ Qual Saf — not a grant brochure.
8. If evidence is thin, say so. Do not fill silence with confidence.
9. Stakeholder "quotes" must be labelled as composite/paraphrase, not real identifiable people.
10. Always include a parsimony judgement.
11. Local facts and authority: an approval, resource, budget or data agreement exists only if it appears under LOCAL FACTS or Constraints in the study context. Never write that something was "supplied by the investigator" otherwise; mark such gates "unknown".
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

/** Identifies the prompt a call used: system text, stage schema and the user-message template. */
export const PROMPT_TEMPLATE_VERSION = "meridian-prompt-2026-09-22b";
export const LIVE_MODEL = "grok-4.5";

export function promptFingerprintText(stage: StageId, scanPurpose?: "appraisal" | "discovery"): string {
  return [PROMPT_TEMPLATE_VERSION, SYSTEM, schemaFor(stage, scanPurpose)].join("\n#\n");
}

interface LiveCallResult {
  text: string;
  model: string | null;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

async function liveXaiCall(data: MeridianRequest, apiKey: string): Promise<LiveCallResult> {
  const meta = STAGE_BY_ID[data.stage];
  const user = `Stage to generate: ${meta.label} (${meta.kicker})
Hint: ${meta.hint}
Declared family: ${data.family ?? "undetermined"}

STUDY CONTEXT:
${data.compact}

${data.instruction ? `Investigator steer: ${data.instruction}` : "No extra steer."}

JSON schema:
${schemaFor(data.stage, data.scanPurpose)}

Produce the richest defensible content you can without inventing evidence. For scan, 6–10 items is enough. For hypotheses, 3 ranked. For questions, 1–2. Outcomes follow rule 3.`;

  const base = (process.env.XAI_BASE_URL?.trim() || "https://api.x.ai/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: LIVE_MODEL,
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
    model?: string;
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  return {
    text: body.choices?.[0]?.message?.content ?? "",
    model: typeof body.model === "string" ? body.model : LIVE_MODEL,
    usage: body.usage
      ? { promptTokens: body.usage.prompt_tokens, completionTokens: body.usage.completion_tokens, totalTokens: body.usage.total_tokens }
      : undefined,
  };
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
    const { createHash } = await import("node:crypto");
    const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
    const started = Date.now();
    let live: LiveCallResult | null = null;
    // Reproducibility record returned with every reply (applied or not): which model, which prompt,
    // which context and which exact output text.
    const run = (outputText: string | null) => ({
      model: mode === "live" ? live?.model ?? LIVE_MODEL : null,
      provider: mode === "live" ? "xai" : "replay",
      promptSha256: sha(promptFingerprintText(data.stage, data.scanPurpose)),
      contextSha256: sha(data.compact),
      contextChars: data.compact.length,
      instructionSha256: data.instruction ? sha(data.instruction) : undefined,
      outputSha256: outputText === null ? null : sha(outputText),
      elapsedMs: Date.now() - started,
      usage: live?.usage,
    });
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
          live = await liveXaiCall(data, apiKey);
          return live.text;
        },
      });
      try {
        const parsed = extractJson(resolved.text);
        return { ok: true as const, json: JSON.stringify(parsed), modelMode: resolved.mode, replayKey: replayKey ?? null, run: run(resolved.text) };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : "Could not parse the model output.",
          modelMode: resolved.mode,
          replayKey: replayKey ?? null,
          run: run(resolved.text),
        };
      }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "Generation failed.",
        modelMode: mode,
        replayKey: replayKey ?? null,
        run: run(null),
      };
    }
  });
