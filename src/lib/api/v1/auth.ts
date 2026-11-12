import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

type Client = SupabaseClient<Database>;
type AuthResult =
  | { ok: true; client: Client; userId: string }
  | { ok: false; status: 401 | 403 | 503; code: "unauthenticated" | "forbidden" | "needs_terms" | "unavailable"; message: string };
export interface ApiAuthDependencies {
  cookieClient: () => Promise<Client>;
  bearerClient: (token: string) => Client;
}
export interface ApiAuthOptions {
  requireCurrentTerms: boolean;
  policyVersion: string;
  /** Explicit read-only routes may use cookies without a browser Origin. */
  readOnly?: boolean;
}

/** Explicit bearer credentials take precedence; an invalid token never falls back to cookies. */
export function createApiAuthenticator(dependencies: ApiAuthDependencies, options: ApiAuthOptions = { requireCurrentTerms: false, policyVersion: "" }) {
  return async (request: Request): Promise<AuthResult> => {
    const authorization = request.headers.get("authorization");
    const bearer = authorization?.match(/^Bearer ([^\s,]+)$/i)?.[1];
    if (authorization !== null && !bearer) return unauthenticated();
    const safeRead = options.readOnly === true && ["GET", "HEAD"].includes(request.method);
    if (options.readOnly && !safeRead)
      return { ok: false, status: 403, code: "forbidden", message: "This endpoint only reads journal data." };
    if (!bearer && !safeRead && !hasSameRequestOrigin(request))
      return { ok: false, status: 403, code: "forbidden", message: "Cookie requests must come from this app." };
    try {
      const client = bearer ? dependencies.bearerClient(bearer) : await dependencies.cookieClient();
      // getUser verifies with Supabase Auth, including native tokens, rather
      // than trusting decoded claims or caller-supplied identity fields.
      const { data, error } = bearer ? await client.auth.getUser(bearer) : await client.auth.getUser();
      if (error && (error.status === undefined || error.status >= 500))
        return { ok: false, status: 503, code: "unavailable", message: "Couldn't verify your session. Please try again." };
      if (error || !data.user) return unauthenticated();
      if (options.requireCurrentTerms) {
        // API routes bypass AppLayout, so enforce the same public-launch terms
        // boundary here, after verifying identity and before accepting a write.
        const profile = await client.from("profiles").select("terms_version").eq("id", data.user.id).maybeSingle();
        if (profile.error)
          return { ok: false, status: 503, code: "unavailable", message: "Couldn't verify your account. Please try again." };
        if (!profile.data || profile.data.terms_version !== options.policyVersion)
          return { ok: false, status: 403, code: "needs_terms", message: "Review and accept the current terms before continuing." };
      }
      return { ok: true, client, userId: data.user.id };
    } catch {
      return { ok: false, status: 503, code: "unavailable", message: "Couldn't verify your session. Please try again." };
    }
  };
}

function hasSameRequestOrigin(request: Request): boolean {
  const target = new URL(request.url);
  const host = request.headers.get("host");
  let expectedOrigin = target.origin;
  if (target.hostname === "localhost" && host !== null) {
    // NextRequest normalizes literal loopback URL hosts (127.x.x.x / [::1])
    // to localhost. Recover only the actual loopback Host authority, with the
    // same port and scheme. Do not accept forwarded headers or public-host
    // overrides, and do not treat localhost and 127.0.0.1 as interchangeable.
    if (!/^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?$/i.test(host)) return false;
    try {
      const actualTarget = new URL(`${target.protocol}//${host}`);
      if (actualTarget.port !== target.port) return false;
      expectedOrigin = actualTarget.origin;
    } catch { return false; }
  }
  return request.headers.get("origin") === expectedOrigin;
}

function unauthenticated(): AuthResult {
  return { ok: false, status: 401, code: "unauthenticated", message: "Not signed in." };
}
