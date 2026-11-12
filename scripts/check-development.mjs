import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { readAiAccountingConfig } from '../src/lib/services/ai/accounting-config.ts';

const packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const presetProviders = {
  groq: { key: 'GROQ_API_KEY', model: 'llama-3.3-70b-versatile' },
  gemini: { key: 'GEMINI_API_KEY', model: 'gemini-2.5-flash' },
  openrouter: { key: 'OPENROUTER_API_KEY', model: 'meta-llama/llama-3.3-70b-instruct:free' },
  mistral: { key: 'MISTRAL_API_KEY', model: 'mistral-small-latest' },
  openai: { key: 'OPENAI_API_KEY', model: 'gpt-4o-mini' },
};
// Keep these route identities synchronized with ai/nvidia.ts. The tests compare
// the map with the application's exports, without creating a provider or call.
export const DEVELOPMENT_NVIDIA_MODELS = {
  lightning: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  super: 'nvidia/nemotron-3-super-120b-a12b', ultra: 'nvidia/nemotron-3-ultra-550b-a55b',
  gpt_oss: 'openai/gpt-oss-20b', gemma: 'google/gemma-4-31b-it',
};
const nvidiaKeys = { lightning: 'NVIDIA_LIGHTNING_API_KEY', super: 'NVIDIA_SUPER_API_KEY', ultra: 'NVIDIA_ULTRA_API_KEY', gpt_oss: 'NVIDIA_GPT_OSS_API_KEY', gemma: 'NVIDIA_GEMMA_API_KEY' };
const nvidiaRoleDefaults = { parsing: 'lightning', extraction: 'gemma', reasoning: 'gemma', summary: 'gemma' };
const nvidiaRoleVars = { parsing: 'NVIDIA_PARSING_MODEL', extraction: 'NVIDIA_EXTRACTION_MODEL', reasoning: 'NVIDIA_REASONING_MODEL', summary: 'NVIDIA_SUMMARY_MODEL' };
const nvidiaFallbacks = ['lightning', 'gemma', 'gpt_oss'];
const nvidiaSlot = value => Object.keys(DEVELOPMENT_NVIDIA_MODELS).find(slot => slot === value || DEVELOPMENT_NVIDIA_MODELS[slot] === value);
const usable = value => typeof value === 'string' && !!value.trim() && !/^(?:your[-_ ]|<|example|placeholder|replace[-_ ]|change[-_ ]?me)/i.test(value.trim());
const tuple = value => /^v?(\d+)\.(\d+)\.(\d+)$/.test(value ?? '') ? value.replace(/^v/, '').split('.').map(Number) : null;
const compare = (left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2];

/** Small parser for this package's published caret / lower-bound engine ranges. */
export function supportsDevelopmentNode(version, range = packageInfo.engines.node) {
  const actual = tuple(version);
  if (!actual || typeof range !== 'string') return false;
  const alternatives = range.split('||').map(part => part.trim());
  if (alternatives.some(part => !/^(?:\^|>=)\d+\.\d+\.\d+$/.test(part))) return false;
  return alternatives.some(part => {
    const minimum = tuple(part.replace(/^(?:\^|>=)/, ''));
    return compare(actual, minimum) >= 0 && (part.startsWith('>=') || actual[0] === minimum[0]);
  });
}
function loopback(hostname) { return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || /^127\./.test(hostname); }
function rootUrl(value, requireRoot = true) {
  try {
    const url = new URL(value);
    if (url.username || url.password || (requireRoot && url.pathname !== '/') || url.search || url.hash ||
        !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback(url.hostname)))) return null;
    return url;
  } catch { return null; }
}
function publicBackend(env) {
  if (!usable(env.NEXT_PUBLIC_SUPABASE_URL) || !usable(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) return false;
  const url = rootUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!url || /(?:^|\.)(?:example|your-project|placeholder)(?:\.|$)/i.test(url.hostname)) return false;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim();
  if (/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(key)) return true;
  if (/^sb_secret_/.test(key)) return false;
  try {
    const parts = key.split('.');
    if (parts.length !== 3 || !parts.every(Boolean)) return false;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (claims?.role !== 'anon') return false;
    // This prevents configuration mixups; it does not verify a JWT signature.
    if (url.hostname.endsWith('.supabase.co') && claims.ref !== url.hostname.slice(0, -'.supabase.co'.length)) return false;
    return true;
  } catch { return false; }
}
/** Mirrors the application's credential-free allowlist/role policy. */
export function readDevelopmentNvidiaRouting(env) {
  const raw = env.NVIDIA_ENABLED_MODELS === undefined ? 'lightning,gemma' : env.NVIDIA_ENABLED_MODELS;
  if (typeof raw !== 'string') return null;
  const names = raw.split(',').map(name => name.trim());
  if (!names.length || names.some(name => !name || !nvidiaSlot(name))) return null;
  const enabled = [...new Set(names.map(nvidiaSlot))], roles = { ...nvidiaRoleDefaults };
  for (const role of Object.keys(nvidiaRoleDefaults)) {
    const rawRole = env[nvidiaRoleVars[role]];
    if (rawRole !== undefined && typeof rawRole !== 'string') return null;
    const value = rawRole?.trim();
    if (!value) continue;
    const slot = nvidiaSlot(value);
    if (!slot || !enabled.includes(slot)) return null;
    roles[role] = slot;
  }
  return { enabled, roles };
}
function activeAiRoutes(env) {
  const wanted = typeof env.AI_PROVIDER === 'string' ? env.AI_PROVIDER.trim().toLowerCase() : '';
  if (wanted && !['anthropic', 'custom', 'nvidia', ...Object.keys(presetProviders)].includes(wanted))
    return { provider: null, routes: [], issues: ['Choose a supported AI_PROVIDER.'] };
  let provider = wanted;
  if (!provider) {
    if (usable(env.ANTHROPIC_API_KEY)) provider = 'anthropic';
    else if (Object.keys(env).some(key => /^NVIDIA_.*API_KEY$/.test(key) && usable(env[key]))) provider = 'nvidia';
    else provider = Object.keys(presetProviders).find(name => usable(env[presetProviders[name].key])) ?? '';
  }
  if (!provider) return { provider: null, routes: [], issues: ['Configure an active optional AI provider and its private key.'] };
  if (provider === 'nvidia') {
    const routing = readDevelopmentNvidiaRouting(env);
    if (!routing) return { provider, routes: [], issues: ['Choose valid NVIDIA_ENABLED_MODELS and enabled NVIDIA role selections.'] };
    const clean = value => typeof value === 'string' ? value.trim() : '';
    const generic = clean(env.AI_API_KEY), shared = clean(env.NVIDIA_API_KEY) || (generic.startsWith('nvapi-') ? generic : '');
    const available = routing.enabled.filter(slot => !['super', 'ultra'].includes(slot) || Object.values(routing.roles).includes(slot))
      .filter(slot => usable(clean(env[nvidiaKeys[slot]]) || shared));
    // Match the actual two-attempt plans, rather than requiring prices for
    // unselected legacy slots or an unreachable third fallback.
    const plans = Object.values(routing.roles).map(primary => [...new Set([primary, ...nvidiaFallbacks])].filter(slot => available.includes(slot)).slice(0, 2));
    const used = [...new Set(plans.flat())];
    const routes = used.map(slot => ({ provider: `nvidia:${slot}`, model: DEVELOPMENT_NVIDIA_MODELS[slot], outputTokens: slot === 'gpt_oss' ? 2048 : 1024 }));
    return { provider, routes, issues: !available.length ? ['Configure an active NVIDIA private key.']
      : plans.some(plan => !plan.length) ? ['Provide an enabled keyed NVIDIA route for every configured AI role.'] : [] };
  }
  if (provider === 'anthropic') return {
    provider, routes: [{ provider, model: 'claude-sonnet-4-6', outputTokens: 600 }],
    issues: usable(env.ANTHROPIC_API_KEY || env.AI_API_KEY) ? [] : ['Configure the active Anthropic private key.'],
  };
  if (provider === 'custom') return {
    provider, routes: usable(env.AI_MODEL) ? [{ provider, model: env.AI_MODEL, outputTokens: 600 }] : [],
    issues: [...(!usable(env.AI_API_KEY) ? ['Configure the active custom provider private key.'] : []),
      ...(!usable(env.AI_MODEL) || !rootUrl(env.AI_BASE_URL, false) ? ['Configure the custom AI model and HTTPS or loopback base URL.'] : [])],
  };
  const preset = presetProviders[provider];
  return { provider, routes: [{ provider, model: env.AI_MODEL ?? preset.model, outputTokens: 600 }],
    issues: usable(env.AI_API_KEY ?? env[preset.key]) ? [] : ['Configure the active provider private key.'] };
}

/** Read-only configuration validation. Never calls providers, changes env, or returns credentials. */
export function validateDevelopmentEnvironment(env, { nodeVersion = process.versions.node, nodeRange = packageInfo.engines.node, requireAi = false } = {}) {
  const checks = {
    supportedNode: supportsDevelopmentNode(nodeVersion, nodeRange),
    publicBackendConfiguration: publicBackend(env),
    deletionKeyPresent: usable(env.SUPABASE_SERVICE_ROLE_KEY),
    developmentSiteUrl: !!rootUrl(env.NEXT_PUBLIC_SITE_URL),
    publicLaunchDisabled: env.NUDGE_PUBLIC_LAUNCH === undefined || env.NUDGE_PUBLIC_LAUNCH === '' || env.NUDGE_PUBLIC_LAUNCH === 'false',
  };
  const issues = [];
  if (!checks.supportedNode) issues.push('Use a Node.js version supported by package.json engines.node.');
  if (!checks.publicBackendConfiguration) issues.push('Set a real NEXT_PUBLIC_SUPABASE_URL and matching public anon or publishable key; never use an admin key in browser configuration.');
  if (!checks.deletionKeyPresent) issues.push('Set the private SUPABASE_SERVICE_ROLE_KEY for account deletion and server accounting.');
  if (!checks.developmentSiteUrl) issues.push('Set NEXT_PUBLIC_SITE_URL to the app root, using HTTPS or HTTP on loopback for local development.');
  if (!checks.publicLaunchDisabled) issues.push('Keep NUDGE_PUBLIC_LAUNCH=false for the development-only gate.');
  const active = activeAiRoutes(env), aiIssues = [...active.issues];
  const accounting = readAiAccountingConfig(env);
  if (!accounting) aiIssues.push('Configure verified AI model prices, per-attempt ceilings and positive user/global daily budgets.');
  else if (active.routes.some(route => !accounting.models.some(price => price.provider === route.provider && price.model === route.model && price.maxOutputTokens >= route.outputTokens)))
    aiIssues.push('Provide matching verified model prices and output ceilings for every configured active AI route.');
  if (!checks.deletionKeyPresent) aiIssues.push('Optional AI accounting requires the private server key.');
  const optionalAi = { provider: active.provider, status: aiIssues.length ? 'unavailable' : 'configuration_present', issues: aiIssues };
  if (requireAi && aiIssues.length) issues.push(...aiIssues.map(issue => `Optional AI: ${issue}`));
  return { ok: issues.length === 0, checks, issues, optionalAi, notices: [
    optionalAi.status === 'unavailable' ? 'Optional AI is unavailable or incompletely configured; manual comparisons and journal flows can still be checked.' : 'Optional AI configuration is present; account consent, backend reachability and live provider quality still require verification.',
    'This is a development configuration gate. It does not establish public-launch readiness, service availability or legal facts.',
  ] };
}
export function formatDevelopmentCheck(result) {
  return [result.ok ? 'Development configuration passed.' : 'Development configuration is incomplete.',
    ...result.issues.map(issue => ` - ${issue}`), ...result.notices].join('\n');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => !['--require-ai', '--json'].includes(arg))) throw new Error('Invalid development check argument');
    const local = existsSync('.env.local') ? parseEnv(readFileSync('.env.local', 'utf8')) : {};
    const result = validateDevelopmentEnvironment({ ...local, ...process.env }, { requireAi: args.includes('--require-ai') });
    const output = args.includes('--json') ? JSON.stringify(result, null, 2) : formatDevelopmentCheck(result);
    (result.ok ? console.log : console.error)(output);
    if (!result.ok) process.exitCode = 1;
  } catch { console.error('Could not check development configuration. Use only --require-ai or --json and check the private environment file locally.'); process.exitCode = 1; }
}
