/*
 * Meridian on Cowork: the Claude artifact runtime. `window.claude.use(name)` resolves a capability's
 * functions, or null when this view cannot use it (the page is not open inside a Claude viewer, or the
 * capability was not granted). Each capability resolves once per page load.
 */

export type ModelTier = "default" | "complex" | "quick";

export interface SampleResult {
  text: string;
  truncated: boolean;
  modelTierApplied: ModelTier;
}

export interface SampleOptions {
  modelTier?: ModelTier;
  cache?: boolean;
  signal?: AbortSignal;
  onText?: (update: { text: string; delta: string }) => void;
}

export type SampleFn = (input: string, options?: SampleOptions) => Promise<SampleResult>;

export interface McpCallResult {
  content?: unknown[];
  structuredContent?: unknown;
  payload?: unknown;
}

export interface Mcp {
  callTool(server: string, tool: string, input?: unknown, options?: { cache?: false; signal?: AbortSignal }): Promise<McpCallResult>;
}

export interface Downloads {
  save(request: { filename: string; data: string | Blob }): Promise<{ status: "saved" | "delivered" }>;
}

export interface UserCap {
  id(): Promise<string | null>;
}

/** Built-in `permissions` capability: read consent without asking, or ask once with one batched dialog. */
export interface Permissions {
  state(): Promise<Record<string, string>>;
  request(names?: readonly string[]): Promise<Record<string, string>>;
}

interface CapabilityMap {
  permissions: Permissions;
  sample: SampleFn;
  mcp: Mcp;
  downloads: Downloads;
  db: import("./sync").Db;
  user: UserCap;
}

type ClaudeGlobal = { use?: (name: string) => Promise<unknown> };

const resolved = new Map<string, Promise<unknown>>();

export function capability<K extends keyof CapabilityMap>(name: K): Promise<CapabilityMap[K] | null> {
  let p = resolved.get(name);
  if (!p) {
    const c = (globalThis as { claude?: ClaudeGlobal }).claude;
    p = c && typeof c.use === "function" ? c.use(name).then((v) => v ?? null, () => null) : Promise.resolve(null);
    resolved.set(name, p);
  }
  return p as Promise<CapabilityMap[K] | null>;
}

/** For tests: forget resolved capabilities so a new fake `claude` global is read. */
export function resetCapabilities(): void {
  resolved.clear();
}

/** Connector display names as they appear in claude.ai Settings, Connectors. */
export const PUBMED_SERVER = "PubMed";
export const TRIALS_SERVER = "Clinical Trials";

/** The connector reply's JSON: `payload` when the runtime derived one, else the first text block parsed. */
export function payloadOf(result: McpCallResult): unknown {
  if (result.payload !== undefined) return result.payload;
  if (result.structuredContent !== undefined) return result.structuredContent;
  const first = (result.content ?? []).find(
    (b): b is { type: "text"; text: string } => !!b && typeof b === "object" && (b as { type?: unknown }).type === "text",
  );
  if (!first) return undefined;
  try {
    return JSON.parse(first.text);
  } catch {
    return first.text;
  }
}
