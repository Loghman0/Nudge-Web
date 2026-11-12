import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_OPTIONS } from "./cookie-options";
import { safeReturnPath } from "../auth/return-path";

const PROTECTED_PREFIXES = ["/dashboard", "/discovery-save", "/onboarding", "/ask", "/history", "/profile", "/discover", "/analytics", "/groups", "/notifications", "/consent", "/update-password"];
const AUTH_PAGES = ["/login", "/signup", "/reset-password"];

/** Verify identity, refresh cookies and preserve them on every response. */
export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((p) => (pathname===p||pathname.startsWith(`${p}/`)));
  const isAuthPage = AUTH_PAGES.some((p) => (pathname===p||pathname.startsWith(`${p}/`)));

  // Fast path: routes that never depend on auth state skip Supabase entirely.
  if (!isProtected && !isAuthPage) return NextResponse.next({ request });

  request.headers.set("x-nudge-return-to",pathname+request.nextUrl.search);
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[], headers: Record<string, string>) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          const previous = response.cookies.getAll();
          response = NextResponse.next({ request });
          previous.forEach((cookie) => response.cookies.set(cookie));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data } = await supabase.auth.getClaims();
  let user = data?.claims?.sub;
  // Deleted accounts can have a cryptographically valid access token until it
  // expires. Verify an existing identity before redirecting away from login.
  if(user && isAuthPage){
    const verified=await supabase.auth.getUser();
    if(!verified.data.user && (!verified.error || (verified.error.status && verified.error.status<500))){
      await supabase.auth.signOut({scope:"local"});user=undefined;
    }
  }
  function finish(result: NextResponse) {
    response.cookies.getAll().forEach((cookie) => result.cookies.set(cookie));
    result.headers.set("Cache-Control", "private, no-store, max-age=0");
    result.headers.set("Pragma", "no-cache");
    return result;
  }

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search="";
    url.searchParams.set("next", pathname+request.nextUrl.search);
    return finish(NextResponse.redirect(url));
  }

  if (user && isAuthPage) {
    const next = safeReturnPath(request.nextUrl.searchParams.get("next"), pathname === "/signup" ? "/onboarding" : "/dashboard");
    const destination = new URL(next, request.url);
    // A return to another auth page would bounce forever for a signed-in user.
    const url = AUTH_PAGES.some(path => destination.pathname === path || destination.pathname.startsWith(`${path}/`))
      ? new URL("/dashboard", request.url) : destination;
    return finish(NextResponse.redirect(url));
  }

  return finish(response);
}
