/*
 * Meridian on Cowork: map what the viewer's PubMed and Clinical Trials connectors return into the
 * same RawRecord shape the server build's parsers produce, so ingestion, stored text, identity
 * checks and claim support run unchanged. Pure; tested in tests/cowork.test.ts with payloads shaped
 * like real connector replies (observed 24 September 2026).
 */
import type { RawRecord } from "../lib/evidence/records";
import { normalizeDoi } from "../lib/evidence/identifiers";

/** One article from the PubMed connector's get_article_metadata reply. */
export interface PubmedConnectorArticle {
  identifiers?: { pmid?: string; pmc?: string; doi?: string };
  title?: string;
  abstract?: string;
  doi?: string;
  journal?: { title?: string; iso_abbreviation?: string };
  authors?: { last_name?: string; fore_name?: string; initials?: string; collective_name?: string; name?: string }[];
  publication_date?: { year?: string | number; month?: string; day?: string };
  article_types?: string[];
}

function yearOf(v: unknown): number | null {
  const m = String(v ?? "").match(/\b(1[89]\d{2}|2[01]\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function authorName(a: NonNullable<PubmedConnectorArticle["authors"]>[number]): string {
  const collective = (a.collective_name ?? a.name ?? "").trim();
  if (collective && !a.last_name) return collective;
  return [a.last_name?.trim(), a.initials?.trim()].filter(Boolean).join(" ");
}

/** PubMed connector articles to RawRecords. Records without a title are dropped (nothing is invented). */
export function pubmedArticlesToRecords(articles: PubmedConnectorArticle[]): RawRecord[] {
  const out: RawRecord[] = [];
  for (const a of articles ?? []) {
    const title = (a.title ?? "").replace(/\s+/g, " ").trim().replace(/\.$/, "");
    if (!title) continue;
    const types = (a.article_types ?? []).map((t) => String(t).trim()).filter(Boolean);
    const retracted = types.some((t) => /retracted publication/i.test(t));
    const abstract = (a.abstract ?? "").trim();
    out.push({
      title,
      authors: (a.authors ?? []).map(authorName).filter(Boolean).join(", "),
      year: yearOf(a.publication_date?.year),
      venue: (a.journal?.title ?? "").trim() || (a.journal?.iso_abbreviation ?? "").trim(),
      doi: normalizeDoi(a.identifiers?.doi || a.doi),
      pmid: (a.identifiers?.pmid ?? "").trim() || undefined,
      providerType: types.join("; "),
      abstract: abstract || undefined,
      url: a.identifiers?.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${a.identifiers.pmid}/` : undefined,
      // The connector does not say whether a record is ahead of print; a retraction is in the types.
      publicationStatus: retracted ? "retracted" : "unknown",
    });
  }
  return out;
}

/** One trial from the Clinical Trials connector (search_trials item, merged with get_trial_details). */
export interface TrialConnectorRecord {
  nct_id?: string;
  title?: string;
  brief_title?: string;
  status?: string;
  phase?: string[] | null;
  study_type?: string | null;
  sponsor?: string | null;
  enrollment?: number | null;
  start_date?: string | null;
  primary_completion_date?: string | null;
  brief_summary?: string | null;
  has_results?: boolean | null;
}

/** Same stored text layout as the server parser: registry facts on one line, then the brief summary. */
export function trialToRecord(t: TrialConnectorRecord): RawRecord | null {
  const nct = (t.nct_id ?? "").trim().toUpperCase();
  const title = (t.title || t.brief_title || "").trim();
  if (!nct || !title) return null;
  const phases = Array.isArray(t.phase) ? t.phase.filter(Boolean) : [];
  const facts = [
    `Registry: ClinicalTrials.gov ${nct}`,
    t.status ? `Status: ${t.status}` : "",
    t.study_type ? `Type: ${t.study_type}${phases.length ? ` (${phases.join(", ")})` : ""}` : "",
    typeof t.enrollment === "number" ? `Enrollment: ${t.enrollment}` : "",
    t.start_date ? `Start: ${t.start_date}` : "",
    t.primary_completion_date ? `Primary completion: ${t.primary_completion_date}` : "",
    t.has_results === true ? "Results posted: yes" : t.has_results === false ? "Results posted: no" : "",
  ].filter(Boolean);
  const summary = (t.brief_summary ?? "").trim();
  return {
    title,
    authors: (t.sponsor ?? "").trim(),
    year: yearOf(t.start_date),
    venue: "ClinicalTrials.gov",
    nct,
    kind: "trial-registry",
    providerType: "registration",
    url: `https://clinicaltrials.gov/study/${nct}`,
    abstract: [facts.join(". "), summary].filter(Boolean).join("\n"),
  };
}

/** PubMed takes no wildcard through the connector; field tags and Boolean groups pass as written. */
export function pubmedConnectorQuery(query: string): string {
  return query.replace(/\*/g, "").replace(/\s+/g, " ").trim();
}

/** A connector failure as a status and a note a reader can act on. */
export function connectorFailure(server: string, err: unknown): { status: "blocked" | "error"; note: string } {
  const e = (err ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "error";
  const message = typeof e.message === "string" ? e.message : String(err);
  const blocked = new Set([
    "not_granted",
    "not_in_manifest",
    "server_not_connected",
    "selection_required",
    "needs_reauth",
    "blocked_by_policy",
    "approval_required",
    "capability_disabled",
    "capability_removed",
    "consent_required",
  ]);
  const fix: Record<string, string> = {
    server_not_connected: `add the ${server} connector in claude.ai Settings, Connectors`,
    needs_reauth: `reconnect ${server} in claude.ai Settings, Connectors`,
    not_in_manifest: `allow ${server} for this page when asked`,
    not_granted: `allow ${server} for this page when asked`,
    selection_required: `choose which ${server} connector to use when asked`,
  };
  const how = fix[code] ? `; to fix: ${fix[code]}` : "";
  return { status: blocked.has(code) ? "blocked" : "error", note: `${server} connector: ${code} (${message.slice(0, 200)})${how}` };
}
