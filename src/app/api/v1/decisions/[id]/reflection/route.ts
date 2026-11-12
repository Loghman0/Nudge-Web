import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { createClient } from "@/lib/supabase/server";
import { createApiAuthenticator } from "@/lib/api/v1/auth";
import { createReflectionPostHandler } from "@/lib/api/v1/reflection-route";
import { legalConfig, POLICY_VERSION } from "@/lib/legal/config";

export const dynamic = "force-dynamic";
export const POST = createReflectionPostHandler({
  authenticate: createApiAuthenticator({
    cookieClient: createClient,
    bearerClient: token => createSupabaseClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      },
    ),
  }, { requireCurrentTerms: legalConfig.publicLaunch, policyVersion: POLICY_VERSION }),
});
