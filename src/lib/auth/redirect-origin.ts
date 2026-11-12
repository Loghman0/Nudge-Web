/** Keep PKCE cookies on the initiating host without trusting arbitrary origins. */
export function authRedirectOrigin(configuredUrl: string, requestOrigin: string | null, allowLocalAliases = false): string {
  const configured = new URL(configuredUrl);
  if (!allowLocalAliases || configured.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(configured.hostname)) return configured.origin;
  try {
    const requested = new URL(requestOrigin ?? "");
    if (requestOrigin === requested.origin && requested.protocol === configured.protocol && requested.port === configured.port && ["localhost", "127.0.0.1"].includes(requested.hostname)) return requested.origin;
  } catch { /* Missing or malformed Origin uses the configured address. */ }
  return configured.origin;
}
