import type { Study } from "./types";

/** D21: never show "missing" until the persisted store has hydrated. */
export function studioAvailability(
  hydrated: boolean,
  study: Study | undefined,
): "loading" | "missing" | "ready" {
  if (!hydrated) return "loading";
  if (!study) return "missing";
  return "ready";
}
