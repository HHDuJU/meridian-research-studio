import type { EvidenceItem } from "../types";
import { publicationStatusFromLabel, type PublicationStatus } from "./access";

const WITHDRAWN: ReadonlySet<PublicationStatus> = new Set(["retracted", "withdrawn"]);

export function isWithdrawnResult(item: Pick<EvidenceItem, "publicationStatus">): boolean {
  return !!item.publicationStatus && WITHDRAWN.has(item.publicationStatus);
}

/** Identity verification may succeed; the withdrawn result still cannot support adoption. */
export function applyPublicationStatus(
  item: EvidenceItem,
  label: string | undefined,
): EvidenceItem {
  const next = publicationStatusFromLabel(label);
  if (isWithdrawnResult(item) && (next === "unknown" || next === "published")) {
    return item;
  }
  return { ...item, publicationStatus: next };
}

export function supportsActiveRecommendation(item: EvidenceItem): boolean {
  return !isWithdrawnResult(item);
}
