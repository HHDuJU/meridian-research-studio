import fs from "node:fs";
import path from "node:path";
import { parseReplayKey, type ModelMode } from "./replay-key";

export type { ModelMode } from "./replay-key";
export { parseModelMode, parseReplayKey, REPLAY_KEY_PATTERN, replayEnabledFromEnv } from "./replay-key";

function counterStore(): Map<string, number> {
  const g = globalThis as typeof globalThis & { __meridianReplayCounters?: Map<string, number> };
  if (!g.__meridianReplayCounters) g.__meridianReplayCounters = new Map();
  return g.__meridianReplayCounters;
}

/** Per-attempt reset. Pass a key to clear that key only; omit to clear all. */
export function resetReplayCounters(key?: string): void {
  const counters = counterStore();
  if (!key) {
    counters.clear();
    return;
  }
  for (const id of [...counters.keys()]) {
    if (id === key || id.startsWith(`${key}/`)) counters.delete(id);
  }
}

export function nextReplayCall(key: string, stage: string): number {
  const counters = counterStore();
  const id = `${key}/${stage}`;
  const n = (counters.get(id) ?? 0) + 1;
  counters.set(id, n);
  return n;
}

export function replayDirFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.MERIDIAN_REPLAY_DIR?.trim();
  return raw ? path.resolve(raw) : path.resolve("scenarios/replay");
}

export function xaiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.XAI_BASE_URL?.trim();
  return (raw || "https://api.x.ai/v1").replace(/\/$/, "");
}

export function replayFilePath(dir: string, key: string, stage: string, n: number): string {
  parseReplayKey(key);
  const root = path.resolve(dir);
  const file = path.resolve(root, key, `${stage}.${n}.json`);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!file.startsWith(prefix)) {
    throw new Error(`replay path leaves the replay root for ${key}/${stage}.${n}`);
  }
  return file;
}

export function readReplayText(dir: string, key: string, stage: string, n: number): string {
  const file = replayFilePath(dir, key, stage, n);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`no recorded response for ${key}/${stage}.${n}`);
  }
  return fs.readFileSync(file, "utf8");
}

/** Test helper to write fixtures. The server does not record in this increment (A3.1). */
export function writeReplayText(dir: string, key: string, stage: string, n: number, text: string): void {
  const file = replayFilePath(dir, key, stage, n);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/**
 * Resolve the model text for one stage call.
 * live: never reads MERIDIAN_REPLAY_DIR.
 * replay: a missing file is an error, never a default.
 * record is deferred: treated as live, no file writes.
 */
export async function resolveModelText(opts: {
  mode: ModelMode;
  replayKey?: string;
  stage: string;
  live: () => Promise<string>;
  env?: NodeJS.ProcessEnv;
}): Promise<{ text: string; mode: ModelMode; call: number | null }> {
  const env = opts.env ?? process.env;
  const dir = replayDirFromEnv(env);
  if (opts.mode === "replay") {
    if (!opts.replayKey) throw new Error("replayKey is required in replay mode.");
    const n = nextReplayCall(opts.replayKey, opts.stage);
    const text = readReplayText(dir, opts.replayKey, opts.stage, n);
    return { text, mode: "replay", call: n };
  }
  const text = await opts.live();
  return { text, mode: "live", call: null };
}
