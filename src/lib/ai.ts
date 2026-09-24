import { createServerFn } from "@tanstack/react-start";
import { SYSTEM, buildUserMessage, extractJson, LIVE_MODEL, promptFingerprintText, validateMeridianRequest, type MeridianRequest } from "./prompt";

export {
  buildUserMessage,
  extractJson,
  LIVE_MODEL,
  MAX_COMPACT_CHARS,
  MAX_INSTRUCTION_CHARS,
  PROMPT_TEMPLATE_VERSION,
  promptFingerprintText,
  schemaFor,
  SYSTEM,
  validateMeridianRequest,
  type MeridianRequest,
} from "./prompt";

interface LiveCallResult {
  text: string;
  model: string | null;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

async function liveXaiCall(data: MeridianRequest, apiKey: string): Promise<LiveCallResult> {
  const user = buildUserMessage(data);

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
      // An appraisal batch annotates about ten records and quotes their text; 2,600 tokens cut such
      // replies mid-JSON in the live run (stand-in replies reached 2,400 tokens).
      max_tokens: data.stage === "manuscript" ? 3500 : data.scanPurpose === "appraisal" ? 6000 : 2600,
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
