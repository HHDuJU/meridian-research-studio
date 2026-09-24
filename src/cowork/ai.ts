/*
 * Meridian on Cowork: the model call. It sends the same system text, stage schema and user message as
 * the server build (src/lib/prompt.ts) to Claude through the page's `sample` capability, on the
 * viewer's own Claude plan, and parses the reply with the same extractJson. The store applies it under
 * the same rules (D10, S1 and the rest), so only the model and the transport differ.
 */
import { buildUserMessage, extractJson, promptFingerprintText, SYSTEM, validateMeridianRequest, type MeridianRequest } from "../lib/prompt";
import { sha256Hex } from "../lib/evidence/hash";
import { capability, type ModelTier } from "./runtime";

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
} from "../lib/prompt";

/** The most capable Claude tier; the platform names the tier that answered in each reply. */
export const COWORK_MODEL_TIER: ModelTier = "complex";
export const COWORK_PROVIDER = "claude-cowork";
/** The sample capability takes at most 64 KiB of text per call. */
export const MAX_PROMPT_BYTES = 65_536;

export async function getMeridianRuntime(): Promise<{ mode: "live" }> {
  return { mode: "live" };
}

/** The full text Claude reads: Meridian's system rules, then the stage request. */
export function coworkPrompt(data: MeridianRequest): string {
  return `${SYSTEM}\n\n${buildUserMessage(data)}`;
}

/** A sample rejection as a message the investigator can act on. */
export function sampleFailure(err: unknown): string {
  const e = (err ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  switch (code) {
    case "not_granted":
      return "Claude is not allowed for this page. Reload Meridian and choose Allow when Claude asks.";
    case "sampling_disabled":
      return "Claude is not available to this account or organization.";
    case "rate_limited":
      return "Claude's usage limit or rate limit was reached; nothing was applied. Try again later.";
    case "prompt_too_large":
      return "The study context is too large for one Claude call; nothing was applied.";
    case "refused":
      return "Claude declined this request; nothing was applied.";
    case "empty_completion":
      return "Claude returned no text; nothing was applied.";
    case "session_expired":
      return "Your Claude session expired. Sign in again, then retry.";
    case "cancelled":
      return "The call was stopped; nothing was applied.";
    case "":
      return `Claude could not answer: ${err instanceof Error ? err.message : String(err)}`;
    default:
      return `Claude could not answer (${code}); nothing was applied. Try again.`;
  }
}

export async function runMeridian({ data: input }: { data: unknown }) {
  const started = Date.now();
  let data: MeridianRequest;
  try {
    data = validateMeridianRequest(input);
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err), modelMode: "live" as const, replayKey: null };
  }
  const run = (outputText: string | null, tier: string | null) => ({
    model: tier ? `claude, ${tier} tier` : null,
    provider: COWORK_PROVIDER,
    promptSha256: sha256Hex(promptFingerprintText(data.stage, data.scanPurpose)),
    contextSha256: sha256Hex(data.compact),
    contextChars: data.compact.length,
    instructionSha256: data.instruction ? sha256Hex(data.instruction) : undefined,
    outputSha256: outputText === null ? null : sha256Hex(outputText),
    elapsedMs: Date.now() - started,
  });
  const prompt = coworkPrompt(data);
  if (new TextEncoder().encode(prompt).length > MAX_PROMPT_BYTES) {
    return { ok: false as const, error: sampleFailure({ code: "prompt_too_large" }), modelMode: "live" as const, replayKey: null, run: run(null, null) };
  }
  const sample = await capability("sample");
  if (!sample) {
    return {
      ok: false as const,
      error: "Claude is not reachable from this page. Open Meridian from your Claude account (claude.ai or the Claude app).",
      modelMode: "live" as const,
      replayKey: null,
      run: run(null, null),
    };
  }
  try {
    const res = await sample(prompt, { modelTier: COWORK_MODEL_TIER, cache: false });
    if (res.truncated) {
      return {
        ok: false as const,
        error: "Claude's answer was cut short at the length limit; nothing was applied. Retry, or appraise fewer records per batch.",
        modelMode: "live" as const,
        replayKey: null,
        run: run(res.text, res.modelTierApplied),
      };
    }
    try {
      const parsed = extractJson(res.text);
      return { ok: true as const, json: JSON.stringify(parsed), modelMode: "live" as const, replayKey: null, run: run(res.text, res.modelTierApplied) };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "Could not parse the model output.",
        modelMode: "live" as const,
        replayKey: null,
        run: run(res.text, res.modelTierApplied),
      };
    }
  } catch (err) {
    const partial = (err as { text?: unknown })?.text;
    return {
      ok: false as const,
      error: sampleFailure(err),
      modelMode: "live" as const,
      replayKey: null,
      run: run(typeof partial === "string" ? partial : null, null),
    };
  }
}
