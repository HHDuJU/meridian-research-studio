import type { SearchAdapter } from "./retrieve";
import type { RawRecord } from "./records";

/**
 * Synthetic provider used only in scenario mode. Parses the normalized RawRecord
 * list from a retrieve-step recording. Proves the application's retrieval path,
 * not a live registry.
 */
export function fixtureAdapter(): SearchAdapter {
  return {
    provider: "fixture",
    buildSearch(query: string) {
      return { url: `meridian-fixture://search?q=${encodeURIComponent(query)}`, method: "GET" };
    },
    parseSearch(body: string) {
      const parsed = JSON.parse(body) as { total?: number; records?: RawRecord[]; status?: number };
      const records = Array.isArray(parsed.records) ? parsed.records : [];
      return { total: typeof parsed.total === "number" ? parsed.total : records.length, records };
    },
  };
}

export function fixtureRecordingUrl(query: string): string {
  return `meridian-fixture://search?q=${encodeURIComponent(query)}`;
}
