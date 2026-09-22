import type { TransportRequest } from "../transport";
import type { RawRecord } from "../records";

/**
 * ClinicalTrials.gov API v2 (public domain, no key). Used to find registered and ongoing studies
 * before a question is called novel, and to catch trials that were registered but never published.
 * Docs: https://clinicaltrials.gov/data-api/api . The registry summary is stored as the record text;
 * it is registry prose, not a journal abstract.
 */
export const CLINICALTRIALS = {
  id: "clinicaltrials" as const,
  base: "https://clinicaltrials.gov/api/v2",
};

export function clinicalTrialsSearchRequest(term: string, pageSize = 20): TransportRequest {
  const params = new URLSearchParams({ "query.term": term, pageSize: String(pageSize), countTotal: "true", format: "json" });
  return { url: `${CLINICALTRIALS.base}/studies?${params.toString()}`, headers: { Accept: "application/json" } };
}

interface CtStudy {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string; officialTitle?: string; organization?: { fullName?: string } };
    statusModule?: {
      overallStatus?: string;
      startDateStruct?: { date?: string };
      primaryCompletionDateStruct?: { date?: string };
      studyFirstPostDateStruct?: { date?: string };
    };
    descriptionModule?: { briefSummary?: string };
    designModule?: { studyType?: string; phases?: string[]; enrollmentInfo?: { count?: number } };
    sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } };
    conditionsModule?: { conditions?: string[] };
  };
  hasResults?: boolean;
}

function yearOf(date?: string): number | null {
  const m = (date ?? "").match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

/** Map registry records to RawRecords. Status, design and enrolment are kept in the text a reader sees. */
export function parseClinicalTrials(body: string): { total: number | null; records: RawRecord[] } {
  const json = JSON.parse(body) as { totalCount?: number; studies?: CtStudy[] };
  if (!Array.isArray(json.studies)) throw new Error("ClinicalTrials.gov: unexpected response shape");
  return {
    total: typeof json.totalCount === "number" ? json.totalCount : null,
    records: json.studies.flatMap((s) => {
      const p = s.protocolSection ?? {};
      const id = p.identificationModule ?? {};
      const title = (id.officialTitle || id.briefTitle || "").trim();
      const nct = (id.nctId ?? "").trim();
      if (!title || !nct) return [];
      const st = p.statusModule ?? {};
      const design = p.designModule ?? {};
      const facts = [
        `Registry: ClinicalTrials.gov ${nct}`,
        st.overallStatus ? `Status: ${st.overallStatus}` : "",
        design.studyType ? `Type: ${design.studyType}${design.phases?.length ? ` (${design.phases.join(", ")})` : ""}` : "",
        typeof design.enrollmentInfo?.count === "number" ? `Enrollment: ${design.enrollmentInfo.count}` : "",
        st.startDateStruct?.date ? `Start: ${st.startDateStruct.date}` : "",
        st.primaryCompletionDateStruct?.date ? `Primary completion: ${st.primaryCompletionDateStruct.date}` : "",
        s.hasResults ? "Results posted: yes" : "Results posted: no",
      ].filter(Boolean);
      const summary = (p.descriptionModule?.briefSummary ?? "").trim();
      return [
        {
          title,
          authors: p.sponsorCollaboratorsModule?.leadSponsor?.name ?? id.organization?.fullName ?? "",
          year: yearOf(st.studyFirstPostDateStruct?.date) ?? yearOf(st.startDateStruct?.date),
          venue: "ClinicalTrials.gov",
          nct,
          kind: "trial-registry" as const,
          providerType: "registration",
          url: `https://clinicaltrials.gov/study/${nct}`,
          abstract: [facts.join(". "), summary].filter(Boolean).join("\n"),
        },
      ];
    }),
  };
}
