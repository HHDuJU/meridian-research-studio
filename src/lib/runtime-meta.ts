export type ClientModelMode = "live" | "replay";

export interface RuntimeMeta {
  modelMode: ClientModelMode;
  replayKey?: string | null;
}

let cached: RuntimeMeta = { modelMode: "live", replayKey: null };

export function setRuntimeMeta(meta: Partial<RuntimeMeta>): RuntimeMeta {
  cached = { ...cached, ...meta };
  return cached;
}

export function runtimeMeta(): RuntimeMeta {
  return cached;
}
