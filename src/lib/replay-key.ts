export type ModelMode = "live" | "replay";

export const REPLAY_KEY_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** Replay exists only with both flags. `record` is deferred and treated as live. */
export function parseModelMode(raw: string | undefined | null): ModelMode {
  return raw === "replay" ? "replay" : "live";
}

/**
 * Immutable compile-time permission. Vite inlines `import.meta.env.VITE_SCENARIO_MODE`.
 * Runtime `process.env.VITE_SCENARIO_MODE` cannot enable replay on a production build.
 */
export function scenarioBuildPermission(): string {
  try {
    const env = (import.meta as ImportMeta & { env?: { VITE_SCENARIO_MODE?: string } }).env;
    return String(env?.VITE_SCENARIO_MODE ?? "");
  } catch {
    return "";
  }
}

export function replayEnabledFromEnv(
  env: {
    VITE_SCENARIO_MODE?: string;
    MERIDIAN_MODEL_MODE?: string;
  },
  buildPermission: string = scenarioBuildPermission(),
): boolean {
  return buildPermission === "true" && env.MERIDIAN_MODEL_MODE === "replay";
}

export function parseReplayKey(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string" || !REPLAY_KEY_PATTERN.test(raw)) {
    throw new Error(`Invalid replayKey "${String(raw)}".`);
  }
  if (raw === "." || raw === "..") {
    throw new Error(`Invalid replayKey "${raw}".`);
  }
  return raw;
}
