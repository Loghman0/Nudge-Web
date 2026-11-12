import { safeReturnPath } from "./return-path";

/** Setup may defer a deliberate local destination, never loop through auth. */
export function postFoundationPath(value: unknown, fallback = "/ask"): string {
  const safe = safeReturnPath(value, fallback);
  const path = new URL(safe, "https://nudge.local").pathname;
  return ["/onboarding", "/login", "/signup", "/reset-password", "/update-password"].some(prefix => path === prefix || path.startsWith(prefix + "/")) ? fallback : safe;
}
export function signupFoundationPath(value: unknown): string {
  const next = postFoundationPath(value);
  if (next === '/discovery-save') return next;
  return next === "/ask" ? "/onboarding" : `/onboarding?next=${encodeURIComponent(next)}`;
}
