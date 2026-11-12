import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { createClient } from "@/lib/supabase/server";
import { legalConfig, POLICY_VERSION } from "@/lib/legal/config";
import { createApiAuthenticator } from "./auth";

/** Shared production authentication wiring. No service role or cookie fallback for bearer sessions. */
export function serverApiAuthenticator(readOnly = false) {
  return createApiAuthenticator({ cookieClient: createClient,
    bearerClient: token => createSupabaseClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${token}` } },
    }),
  }, { requireCurrentTerms: legalConfig.publicLaunch, policyVersion: POLICY_VERSION, readOnly });
}
