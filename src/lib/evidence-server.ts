import { createServerFn } from "@tanstack/react-start";
import type { LiveProvider } from "./evidence/live";
import { validateDoiInput, validateSearchInput } from "./evidence/requests";

export { MAX_DOIS, MAX_QUERY_CHARS, MAX_RECORDS, validateDoiInput, validateSearchInput, type SearchLiteratureInput } from "./evidence/requests";

/*
 * Server functions for the production evidence path (literature search and identity checks).
 * They run on the app host, where outbound calls to PubMed, OpenAlex, ClinicalTrials.gov and
 * Crossref are allowed; the browser never calls those hosts directly. In a scenario (replay) build
 * they refuse, so a replayed run can never mix in live data.
 */

/** Sources this build can search (the Cowork edition has no OpenAlex connector). */
export const LIVE_SOURCES: readonly LiveProvider[] = ["pubmed", "openalex", "clinicaltrials"];
/** Registry that answers identity checks in this build. */
export const IDENTITY_PROVIDER = "crossref" as const;

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
      ncbiApiKey: process.env.MERIDIAN_NCBI_API_KEY?.trim() || undefined,
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
