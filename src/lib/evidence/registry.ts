/**
 * Provider registry: what each channel can do, what it costs, what it needs, and — honestly —
 * whether its live path has been exercised. Update `liveTested` only from an observed run.
 */
export interface ProviderInfo {
  id: string;
  kind: "bibliographic" | "registry" | "commercial-synthesis" | "full-text";
  auth: "none" | "polite-mailto" | "api-key" | "subscription";
  rateLimitNote: string;
  reuseNote: string;
  productionPath: "app-adapter" | "connector-only" | "manual-only" | "none";
  liveTested: { app: boolean; note: string };
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "crossref",
    kind: "bibliographic",
    auth: "polite-mailto",
    rateLimitNote: "Polite pool with mailto; back off on 429.",
    reuseNote: "Metadata reusable; check publisher terms for abstracts/full text.",
    productionPath: "app-adapter",
    liveTested: { app: false, note: "Adapter tested on recorded real responses (2026-09-20); host blocked from the Cowork sandbox." },
  },
  {
    id: "openalex",
    kind: "bibliographic",
    auth: "polite-mailto",
    rateLimitNote: "Polite pool with mailto; daily quota applies.",
    reuseNote: "CC0 metadata.",
    productionPath: "app-adapter",
    liveTested: { app: false, note: "Adapter tested on recorded real responses (2026-09-20); host blocked from the Cowork sandbox." },
  },
  {
    id: "pubmed",
    kind: "bibliographic",
    auth: "none",
    rateLimitNote: "≤3 requests/s without key; send tool and email.",
    reuseNote: "Metadata reusable; abstracts subject to publisher terms; PMC text-mining routes are separate.",
    productionPath: "app-adapter",
    liveTested: { app: false, note: "Parsers tested on documented JSON shapes only; host blocked and robots-disallowed from the sandbox." },
  },
  {
    id: "clinicaltrials",
    kind: "registry",
    auth: "none",
    rateLimitNote: "Public API v2.",
    reuseNote: "Public domain.",
    productionPath: "none",
    liveTested: { app: false, note: "No adapter yet; host blocked from the sandbox. Ongoing-trial checks are an open gap." },
  },
  {
    id: "consensus-connector",
    kind: "commercial-synthesis",
    auth: "subscription",
    rateLimitNote: "Connector-dependent.",
    reuseNote: "Abstract text as returned; do not republish publisher abstracts without checking rights.",
    productionPath: "connector-only",
    liveTested: { app: false, note: "Development-time channel via a Cowork connector; export parser tested on a real export (2026-09-20)." },
  },
];

export const PROVIDER_BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p])) as Record<string, ProviderInfo>;
