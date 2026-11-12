import { readFile, writeFile, lstat } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// These zero rates describe NVIDIA's free API Catalog prototype endpoints,
// checked 26 October 2026. This setup must not be used for a public deployment.
export function nvidiaDevelopmentSettings(env) {
  if (env.NUDGE_PUBLIC_LAUNCH === 'true') throw new Error('Keep public launch off before configuring NVIDIA prototype access.');
  const usable = value => typeof value === 'string' && value.trim() && !/^(your-|<|example)/i.test(value.trim());
  const shared = usable(env.NVIDIA_API_KEY) || (usable(env.AI_API_KEY) && env.AI_API_KEY.trim().startsWith('nvapi-'));
  if (!shared && !(usable(env.NVIDIA_LIGHTNING_API_KEY) && usable(env.NVIDIA_GEMMA_API_KEY)))
    throw new Error('Add NVIDIA_API_KEY, or both NVIDIA_LIGHTNING_API_KEY and NVIDIA_GEMMA_API_KEY, to private .env.local first.');
  return {
    AI_PROVIDER: 'nvidia',
    NVIDIA_ENABLED_MODELS: 'lightning,gemma',
    // Live development checks found Gemma exceeded the interactive deadline.
    // Use Lightning for the short tasks; Gemma remains a bounded fallback.
    NVIDIA_PARSING_MODEL: 'lightning', NVIDIA_EXTRACTION_MODEL: 'lightning',
    NVIDIA_REASONING_MODEL: 'lightning', NVIDIA_SUMMARY_MODEL: 'lightning',
    NUDGE_PUBLIC_LAUNCH: 'false', NUDGE_AI_DEVELOPMENT_FREE: 'true',
    NUDGE_AI_VENDOR: 'NVIDIA API Catalog (development/testing)',
    NUDGE_AI_PRIVACY_URL: 'https://www.nvidia.com/en-us/about-nvidia/privacy-policy/',
    // The existing SQL ledger requires a positive reservation. One microdollar
    // is an accounting sentinel, not a price: reported usage at these zero
    // rates settles at zero. Uncertain attempts keep the sentinel, limiting
    // unresolved attempts to 100 per account / 1000 shared per UTC day.
    NUDGE_AI_USER_DAILY_USD: '0.000100', NUDGE_AI_GLOBAL_DAILY_USD: '0.001000',
    NUDGE_AI_MODEL_PRICES_JSON: JSON.stringify([
      { provider: 'nvidia:lightning', model: 'nvidia/nemotron-3.5-lightning-30b-a3b', inputUsdPerMillion: '0', outputUsdPerMillion: '0', maxAttemptUsd: '0.000001', maxInputBytes: 64000, maxOutputTokens: 1024 },
      { provider: 'nvidia:gemma', model: 'google/gemma-4-31b-it', inputUsdPerMillion: '0', outputUsdPerMillion: '0', maxAttemptUsd: '0.000001', maxInputBytes: 64000, maxOutputTokens: 1024 },
    ]),
  };
}

async function main() {
  const target = path.resolve('.env.local');
  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Use an ordinary private .env.local file in this project.');
  const original = await readFile(target, 'utf8');
  const settings = nvidiaDevelopmentSettings(parseEnv(original));
  const written = new Set();
  const lines = original.split(/\r?\n/).map(line => {
    const name = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1];
    if (!name || !Object.hasOwn(settings, name)) return line;
    if (written.has(name)) return null;
    written.add(name); return `${name}=${settings[name]}`;
  }).filter(line => line !== null);
  for (const [name, value] of Object.entries(settings)) if (!written.has(name)) lines.push(`${name}=${value}`);
  const updated = lines.join('\n').trimEnd() + '\n';
  const parsed = parseEnv(updated);
  if (Object.entries(settings).some(([name, value]) => parsed[name] !== value)) throw new Error('Development settings could not be serialized. No configuration changed.');
  if (await readFile(target, 'utf8') !== original) throw new Error('Configuration changed while preparing it. Retry after saving your edits.');
  await writeFile(target, updated);
  console.log('Configured two NVIDIA prototype models with zero token rates, bounded unknown-usage reservations and public launch off. Credentials were preserved and not printed.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Could not configure NVIDIA development access.'); process.exitCode = 1; });
