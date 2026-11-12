import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/database";
import { AUTH_COOKIE_OPTIONS } from "./cookie-options";

/** Browser-side Supabase client. Safe: uses the public anon key + RLS. */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: AUTH_COOKIE_OPTIONS }
  );
}
