/** Identical cookie scope for browser login, server actions and token refresh. */
export const AUTH_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * 365,
  secure: process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://") ?? false,
};
