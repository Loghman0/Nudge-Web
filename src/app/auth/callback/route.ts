import { safeReturnPath } from "@/lib/auth/return-path";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";
import { authRedirectOrigin } from "@/lib/auth/redirect-origin";

/** Exchange the code and attach the session directly to the redirect response. */
export async function GET(request: NextRequest) {
  const target = new URL(request.url);
  const { searchParams } = target;
  // Next can normalize loopback URLs to localhost. Recover only an explicitly
  // permitted local Host; public deployments always use their configured URL.
  const origin = authRedirectOrigin(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000", request.headers.get("host") ? `${target.protocol}//${request.headers.get("host")}` : target.origin, process.env.NUDGE_PUBLIC_LAUNCH !== "true");
  const code = searchParams.get("code");
  const next=safeReturnPath(searchParams.get("next"));
  const response = NextResponse.redirect(new URL(next, origin));
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  if (code) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        cookieOptions: AUTH_COOKIE_OPTIONS,
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll(cookies, headers) {
            cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
            Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
          },
        },
      }
    );
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return response;
  }
  const failed = NextResponse.redirect(new URL("/login?error=auth", origin));
  response.cookies.getAll().forEach((cookie) => failed.cookies.set(cookie));
  failed.headers.set("Cache-Control", "private, no-store, max-age=0");
  return failed;
}
