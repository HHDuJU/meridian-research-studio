import type { Claim, ClaimKind, EvidenceItem, SourceDocument } from "../types";
import { uid } from "../utils";
import { supportClaim } from "./support";

/**
 * Claim–source ledger: every consequential assertion says where it comes from and how sure it is.
 * The ledger does not decide truth; it makes the chain inspectable and flags breaks in it.
 */

export function newClaim(input: Omit<Claim, "id"> & { id?: string }): Claim {
  return { id: input.id ?? uid("claim"), ...input };
}

export type LedgerIssueSeverity = "block" | "should" | "note";

export interface LedgerIssue {
  claimId: string;
  severity: LedgerIssueSeverity;
  message: string;
}

const SOURCE_REQUIRED: ClaimKind[] = ["source-derived"];

/**
 * Integrity rules:
 *  - a source-derived claim must name at least one source that exists in the study;
 *  - a source-derived claim whose sources are all unverified/mismatch cannot carry low uncertainty;
 *  - a source-derived claim with low uncertainty should cite a location/passage;
 *  - a claim resting on a "mismatch" source is blocked (the identifier points elsewhere);
 *  - local facts, assumptions and scenarios are allowed without sources but must be labelled so;
 *  - a local fact the model wrote is a proposal and blocks until the investigator enters it (D10 / S5).
 */
export function ledgerIssues(claims: Claim[], items: EvidenceItem[], documents: SourceDocument[] = []): LedgerIssue[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: LedgerIssue[] = [];
  const known = new Map(claims.filter((c) => c.assertion).map((c) => [c.id, c.assertion!]));
  for (const c of claims) {
    if (c.supportStatus === "quarantined" || c.supportStatus === "unsupported" || c.assertion?.supportStatus === "quarantined") {
      out.push({ claimId: c.id, severity: "block", message: "claim is unsupported or quarantined and cannot authorize action" });
    } else if (c.kind === "source-derived" && documents.length) {
      const verdict = supportClaim(c, items, documents, `claims[${c.id}]`, known);
      if (verdict.status === "quarantined" || verdict.status === "unsupported") {
        out.push({ claimId: c.id, severity: "block", message: verdict.issues[0]?.message ?? "source-derived claim failed support recheck" });
      }
    }
    const sources = c.sourceIds.map((id) => byId.get(id));
    const missing = c.sourceIds.filter((id) => !byId.has(id));
    if (missing.length) out.push({ claimId: c.id, severity: "block", message: `references unknown source id(s): ${missing.join(", ")}` });
    if (SOURCE_REQUIRED.includes(c.kind) && c.sourceIds.length === 0) {
      out.push({ claimId: c.id, severity: "block", message: "source-derived claim has no source" });
      continue;
    }
    const present = sources.filter((s): s is EvidenceItem => !!s);
    if (present.some((s) => s.provenance.status === "mismatch")) {
      out.push({ claimId: c.id, severity: "block", message: "rests on a source whose identifier resolved to a different work" });
    }
    if (c.kind === "source-derived") {
      const anyVerified = present.some((s) => s.provenance.status === "verified");
      if (!anyVerified && c.uncertainty === "low") {
        out.push({ claimId: c.id, severity: "should", message: "low uncertainty claimed but no supporting source is verified" });
      }
      if (c.uncertainty === "low" && !c.location && !c.passage) {
        out.push({ claimId: c.id, severity: "should", message: "low-uncertainty claim without a location or passage in the source" });
      }
      const abstractOnly = present.length > 0 && present.every((s) => s.provenance.access !== "full-text");
      if (abstractOnly && c.uncertainty === "low") {
        out.push({ claimId: c.id, severity: "note", message: "supported from abstract/metadata only; full text not read" });
      }
    }
    if (c.kind === "local-fact" && c.origin !== "investigator") {
      // D10 / S5, SYN-LOCAL-01: only the investigator establishes a local fact; a model's is a proposal.
      out.push({ claimId: c.id, severity: "block", message: "local fact proposed by the model; it is not established until the investigator enters it" });
    }
    if ((c.kind === "assumption" || c.kind === "scenario") && c.uncertainty === "low") {
      out.push({ claimId: c.id, severity: "should", message: `${c.kind} labelled low uncertainty — assumptions and scenarios are not facts` });
    }
  }
  return out;
}

export function claimsBySource(claims: Claim[]): Map<string, Claim[]> {
  const m = new Map<string, Claim[]>();
  for (const c of claims) for (const s of c.sourceIds) m.set(s, [...(m.get(s) ?? []), c]);
  return m;
}
