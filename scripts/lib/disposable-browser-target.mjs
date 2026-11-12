/** Bind disposable-account browser checks to an explicitly selected app host. */
export function disposableBrowserTarget(env) {
  if (env.NUDGE_E2E_EXTERNAL !== '1') return { external: false, baseURL: env.NUDGE_E2E_BASE_URL ?? 'http://127.0.0.1:3117' };
  let target, authorized;
  try {
    target = new URL(env.NUDGE_E2E_BASE_URL);
    authorized = new URL(env.NUDGE_E2E_AUTHORIZED_ORIGIN);
  } catch { throw new Error('External disposable checks require NUDGE_E2E_BASE_URL and NUDGE_E2E_AUTHORIZED_ORIGIN.'); }
  for (const value of [target, authorized]) {
    if (value.protocol !== 'https:' || value.username || value.password || value.pathname !== '/' || value.search || value.hash)
      throw new Error('External disposable checks require an exact HTTPS origin without credentials, path, query or fragment.');
  }
  if (target.origin !== authorized.origin) throw new Error('The browser target does not match the explicitly authorized app origin.');
  return { external: true, baseURL: target.origin };
}
