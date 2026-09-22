import type { RawRecord } from "../records";
import { normalizeDoi } from "../identifiers";

/**
 * Consensus (consensus.app) — commercial academic search. Meridian has no production API for it;
 * during development its results arrive through a Cowork connector as numbered text. This parser
 * turns that export into records with retrieval provenance so they can be verified like any other
 * lead. It is a development-time channel: `performedBy: "connector"`, never "app".
 *
 * Expected line shape (one record per numbered line, abstract lines indented below):
 *   [3] [Title](https://consensus.app/papers/details/…) (Authors, 2024, 12 citations, Journal, DOI: 10.x/y)
 */
export const CONSENSUS_CONNECTOR = { id: "consensus-connector" as const };

const LINE_RE = /^\[(\d+)\]\s+\[(.+?)\]\((https?:\/\/[^)\s]+)\)\s+\((.+)\)\s*$/;
const META_RE = /^(?<authors>.+?),\s+(?<year>\d{4}),\s+(?<cites>\d+)\s+citations?(?:,\s+(?<rest>.+))?$/;

export function parseConsensusConnectorExport(text: string): { total: number | null; records: RawRecord[] } {
  const lines = text.split(/\r?\n/);
  const totalMatch = text.match(/Found\s+(\d+)\s+papers/i);
  const records: RawRecord[] = [];
  let current: RawRecord | null = null;
  const abstractLines: string[] = [];
  const flush = () => {
    if (current) {
      const abs = abstractLines.join(" ").replace(/\s+/g, " ").trim();
      if (abs) current.abstract = abs;
      records.push(current);
    }
    current = null;
    abstractLines.length = 0;
  };
  for (const line of lines) {
    const m = line.match(LINE_RE);
    if (m) {
      flush();
      const [, , title, url, meta] = m;
      const mm = meta.match(META_RE);
      let authors = meta;
      let year: number | null = null;
      let venue = "";
      let doi: string | undefined;
      if (mm?.groups) {
        authors = mm.groups.authors;
        year = Number(mm.groups.year);
        const rest = mm.groups.rest ?? "";
        const doiIdx = rest.indexOf("DOI:");
        venue = (doiIdx >= 0 ? rest.slice(0, doiIdx) : rest).replace(/,\s*$/, "").trim();
        doi = doiIdx >= 0 ? normalizeDoi(rest.slice(doiIdx + 4)) : undefined;
      }
      current = { title: title.replace(/\.$/, "").trim(), authors, year, venue, doi, url };
      continue;
    }
    if (current && line.trim() && !/^IMPORTANT INSTRUCTIONS/i.test(line.trim())) {
      abstractLines.push(line.trim());
    } else if (/^IMPORTANT INSTRUCTIONS/i.test(line.trim())) {
      flush();
    }
  }
  flush();
  return { total: totalMatch ? Number(totalMatch[1]) : null, records };
}
