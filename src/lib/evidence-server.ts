import { createServerFn } from "@tanstack/react-start";
import { LIVE_PROVIDERS, type LiveProvider } from "./evidence/live";

/*
 * Server functions for the production evidence path (literature search and identity checks).
 * They run on the app host, where outbound calls to PubMed, OpenAlex, ClinicalTrials.gov and
 * Crossref are allowed; the browser never calls those hosts directly. In a scenario (replay) build
 * they refuse, so a replayed run can never mix in live data.
 */

export const MAX_QUERY_CHARS = 500;
export const MAX_RECORDS = 50;
export const MAX_DOIS = 100;

export interface SearchLiteratureInput {
  provider: LiveProvider;
  query: string;
  max?: number;
}

export function validateSearchInput(input: unknown): SearchLiteratureInput {
  if (!input || typeof input !== "object") throw new Error("Search request must be an object.");
  const r = input as Record<string, unknown>;
  if (typeof r.provider !== "string" || !(LIVE_PROVIDERS as readonly string[]).includes(r.provider)) {
    throw new Error(`Unknown literature source "${String(r.provider)}".`);
  }
  if (typeof r.query !== "string" || !r.query.trim()) throw new Error("Search query is empty.");
  if (r.query.length > MAX_QUERY_CHARS) throw new Error(`Search query exceeds ${MAX_QUERY_CHARS} characters.`);
  let max: number | undefined;
  if (r.max !== undefined) {
    if (typeof r.max !== "number" || !Number.isInteger(r.max) || r.max < 1 || r.max > MAX_RECORDS) {
      throw new Error(`max must be an integer from 1 to ${MAX_RECORDS}.`);
    }
    max = r.max;
  }
  return { provider: r.provider as LiveProvider, query: r.query.trim(), max };
}

export function validateDoiInput(input: unknown): { dois: string[] } {
  if (!input || typeof input !== "object") throw new Error("Identity check request must be an object.");
  const r = input as Record<string, unknown>;
  if (!Array.isArray(r.dois) || !r.dois.every((d) => typeof d === "string")) throw new Error("dois must be a list of strings.");
  if (r.dois.length === 0) throw new Error("No DOIs to check.");
  if (r.dois.length > MAX_DOIS) throw new Error(`At most ${MAX_DOIS} DOIs per request.`);
  return { dois: r.dois as string[] };
}

async function liveAllowed(): Promise<string | null> {
  const { replayEnabledFromEnv, scenarioBuildPermission } = await import("./replay-key");
  if (replayEnabledFromEnv(process.env, scenarioBuildPermission())) {
    return "Live literature search is disabled in scenario replay mode.";
  }
  return null;
}

export const searchLiterature = createServerFn({ method: "POST" })
  .validator((input: unknown) => validateSearchInput(input))
  .handler(async ({ data }) => {
    const refused = await liveAllowed();
    if (refused) return { ok: false as const, error: refused };
    const { searchLive } = await import("./evidence/live");
    const { fetchTransport } = await import("./evidence/transport");
    const started = Date.now();
    const result = await searchLive(data.provider, data.query, fetchTransport(), {
      max: data.max ?? 20,
      contact: process.env.MERIDIAN_CONTACT_EMAIL?.trim() || undefined,
    });
    return {
      ok: true as const,
      json: JSON.stringify({ event: result.event, items: result.items, documents: result.documents, requests: result.requests }),
      elapsedMs: Date.now() - started,
    };
  });

export const checkIdentities = createServerFn({ method: "POST" })
  .validator((input: unknown) => validateDoiInput(input))
  .handler(async ({ data }) => {
    const refused = await liveAllowed();
    if (refused) return { ok: false as const, error: refused };
    const { lookupDoisLive } = await import("./evidence/live");
    const { fetchTransport } = await import("./evidence/transport");
    const result = await lookupDoisLive(data.dois, fetchTransport(), {
      contact: process.env.MERIDIAN_CONTACT_EMAIL?.trim() || undefined,
    });
    return { ok: true as const, json: JSON.stringify(result) };
  });
