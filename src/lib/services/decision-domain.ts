import { createHash } from "node:crypto";
import type { Preference } from "@/lib/types";
import { normalizeDomain } from "./decision-understanding";

export function domainScope(domain?: string | null): string | null {
  const normalized = normalizeDomain(domain ?? "");
  return !normalized || normalized === "everyday life" ? null : createHash("md5").update(normalized).digest("hex");
}

/** A similarly named activity in a different setting is not personal evidence. */
export function preferencesForDomain(preferences: Preference[], domain?: string | null): Preference[] {
  return preferences.filter(preference => sameKnowledgeDomain(preference.key, domain));
}

/** Both active preferences and forgotten aliases use the same setting boundary. */
export function sameKnowledgeDomain(key: string, domain?: string | null): boolean {
  const scope = domainScope(domain);
  const match = /^learned\.[a-z]+\.scope\.([a-f0-9]{32})\./.exec(key);
  return scope ? match?.[1] === scope : !match;
}

export function sameDecisionDomain(stored: unknown, domain?: string | null): boolean {
  const context = stored && typeof stored === "object" ? stored as Record<string, unknown> : {};
  return domainScope(typeof context.domain === "string" ? context.domain : null) === domainScope(domain);
}
