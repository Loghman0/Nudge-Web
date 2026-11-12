import type { SupabaseClient } from '@supabase/supabase-js';

type DeletionAuth = Pick<SupabaseClient['auth'], 'getSession' | 'getClaims' | 'getUser'>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REAUTH_METHODS = new Set(['password','oauth','otp','magiclink','sso/saml','totp','mfa/totp','mfa/phone','mfa/webauthn']);

/** Validate one captured session, never an account-wide sign-in timestamp.
 * getSession supplies a credential only; getClaims/getUser verify that same
 * token before any claim or identity is used. Token issuance/refresh is not
 * evidence of reauthentication. Missing/custom AMR formats fail closed.
 * https://supabase.com/docs/guides/auth/jwt-fields
 */
export async function recentDeletionUser(auth: DeletionAuth, nowMs = Date.now(), capturedToken?: string) {
  try {
    // Native bearer clients intentionally have no persisted cookie session.
    // A supplied credential is still independently verified below; its decoded
    // claims and the caller's account-wide sign-in timestamp are never trusted.
    const session = capturedToken === undefined ? await auth.getSession() : null;
    const token = capturedToken ?? session?.data.session?.access_token;
    if (session?.error || !token) return null;
    const [verified, identity] = await Promise.all([auth.getClaims(token),auth.getUser(token)]);
    const claims = verified.data?.claims;
    const user = identity.data.user;
    if (verified.error || identity.error || !claims || !user || claims.sub !== user.id || claims.role !== 'authenticated'
      || claims.is_anonymous === true || typeof claims.session_id !== 'string' || !UUID.test(claims.session_id)) return null;
    const now = Math.floor(nowMs / 1000);
    if (!Number.isSafeInteger(now) || !Array.isArray(claims.amr)) return null;
    const fresh = claims.amr.some(entry => typeof entry === 'object' && entry !== null
      && REAUTH_METHODS.has(entry.method) && Number.isSafeInteger(entry.timestamp)
      && entry.timestamp <= now && entry.timestamp >= now - 10 * 60);
    return fresh ? user : null;
  } catch {
    return null;
  }
}
