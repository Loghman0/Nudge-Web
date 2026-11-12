import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { validateDevelopmentEnvironment, readDevelopmentNvidiaRouting, DEVELOPMENT_NVIDIA_MODELS } from './check-development.mjs';
import { readAiAccountingConfig } from '../src/lib/services/ai/accounting-config.ts';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const NVIDIA_LIVE_OPERATION_LIMIT = 6;
export const NVIDIA_LIVE_ATTEMPT_LIMIT = 12;
const currentSlots = ['lightning', 'gemma'];

/** All guards run before creating an account or resolving a provider. */
export function validateNvidiaLiveEnvironment(env, options = {}) {
  const issues = [];
  if (env.NUDGE_ALLOW_HOSTED_DISPOSABLE_TESTS !== '1' || env.NUDGE_ALLOW_LIVE_NVIDIA_TESTS !== '1')
    issues.push('Explicit hosted-disposable and live-NVIDIA opt-ins are required.');
  const ref = env.NUDGE_E2E_TARGET_PROJECT_REF;
  try {
    const target = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
    if (!/^[a-z0-9]{20}$/.test(ref ?? '') || target.href !== `https://${ref}.supabase.co/`)
      issues.push('The explicit target project reference must exactly match the backend URL.');
  } catch { issues.push('The explicit target project reference must exactly match the backend URL.'); }
  if (env.AI_PROVIDER?.trim().toLowerCase() !== 'nvidia' || env.NUDGE_PUBLIC_LAUNCH !== 'false' || env.NUDGE_AI_DEVELOPMENT_FREE !== 'true')
    issues.push('Select NVIDIA free development configuration and keep public launch explicitly false.');
  const routing = readDevelopmentNvidiaRouting(env);
  if (!routing || routing.enabled.some(slot => !currentSlots.includes(slot)) || Object.values(routing.roles).some(slot => !currentSlots.includes(slot)))
    issues.push('This bounded verifier permits only the current Lightning and Gemma prototype routes.');
  const config = readAiAccountingConfig(env);
  if (!config || config.models.some(row => !currentSlots.some(slot => row.provider === `nvidia:${slot}` && row.model === DEVELOPMENT_NVIDIA_MODELS[slot])
      || row.inputMicrosPerMillion !== 0 || row.outputMicrosPerMillion !== 0 || row.maxAttemptMicros !== 1))
    issues.push('Use the verified zero-rate development entries with one-microdollar unknown-usage reservations.');
  const gate = validateDevelopmentEnvironment(env, { ...options, requireAi: true });
  if (!gate.ok) issues.push('The strict development configuration gate must pass before live verification.');
  return { ok: issues.length === 0, issues };
}

/** Never returns or logs raw generated text, credentials or journal fields. */
export async function evaluateNvidiaOperations({ interpret, extract, recap, readUsage, readCounts, now = () => performance.now() }) {
  const operations = [];
  const samples = [
    { id: 'explicit-synthetic-setting', text: 'Should I choose Copper task or Willow task? The setting is a synthetic workshop. My goal is to finish a short task.' },
    { id: 'ambiguous-mining', text: 'Should I go mining or cut trees?', missingDomain: true },
    { id: 'explicit-game-setting', text: 'In Minecraft Java Edition, should I go mining or cut trees? My goal is to gather building supplies.' },
    { id: 'whole-word-camera', text: 'Should I repair a camera or organize a cupboard?', missingDomain: true, forbiddenOption: 'car' },
  ];
  for (const sample of samples) {
    const start = now();
    try {
      const draft = await interpret(sample.text);
      const valid = draft?.source === 'ai' && Array.isArray(draft.options) && draft.options.length >= 2 && draft.options.length <= 8
        && (!sample.missingDomain || draft.domain === '')
        && (!sample.forbiddenOption || !draft.options.some(label => label.trim().toLowerCase() === sample.forbiddenOption));
      operations.push({ id: sample.id, action: 'interpret', status: valid ? 'pipeline_validated' : 'manual_review_needed',
        optionCount: Array.isArray(draft?.options) ? Math.min(draft.options.length, 8) : 0, elapsedMs: Math.max(0, Math.round(now() - start)) });
    } catch { operations.push({ id: sample.id, action: 'interpret', status: 'unavailable', elapsedMs: Math.max(0, Math.round(now() - start)) }); }
  }
  for (const task of [
    { id: 'reviewable-memory-draft', action: 'extract', run: () => extract('I practice sketching every Sunday. I want to finish a sketchbook this year.'),
      valid: value => Array.isArray(value) && value.length <= 6, count: value => value.length },
    { id: 'synthetic-outcome-recap', action: 'recap', run: () => recap({ windowDays: 30, totalDecisions: 2,
      topCategories: [{ category: 'hobbies', count: 2 }], bestRated: [{ question: 'Which synthetic task?', chosen: 'Copper task', rating: 4 }],
      regretted: [], averageRating: 4, sampled: true }), valid: value => typeof value === 'string' && value.trim().length > 0 && value.length <= 6000 },
  ]) {
    const start = now();
    try {
      const value = await task.run();
      operations.push({ id: task.id, action: task.action, status: task.valid(value) ? 'pipeline_validated' : 'manual_review_needed',
        ...(task.count && task.valid(value) ? { draftCount: task.count(value) } : {}), elapsedMs: Math.max(0, Math.round(now() - start)) });
    } catch { operations.push({ id: task.id, action: task.action, status: 'unavailable', elapsedMs: Math.max(0, Math.round(now() - start)) }); }
  }
  const rawUsage = await readUsage();
  if (!Array.isArray(rawUsage) || rawUsage.length > NVIDIA_LIVE_ATTEMPT_LIMIT) throw new Error('usage_contract_failed');
  const safeNumber = value => value === null ? null : Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 1_000_000_000 ? Number(value) : null;
  const usage = rawUsage.map(row => {
    if (!currentSlots.some(slot => row.provider === `nvidia:${slot}` && row.model === DEVELOPMENT_NVIDIA_MODELS[slot])
      || !['interpret', 'extract', 'recap'].includes(row.action) || !['reserved', 'unknown', 'settled'].includes(row.status)) throw new Error('usage_contract_failed');
    return { action: row.action, provider: row.provider, model: row.model, status: row.status,
      inputTokens: safeNumber(row.input_tokens), outputTokens: safeNumber(row.output_tokens),
      reservedCostMicros: safeNumber(row.reserved_cost_micros), actualCostMicros: safeNumber(row.actual_cost_micros) };
  });
  const counts = await readCounts();
  const noDurableContent = counts?.decisions === 0 && counts?.ai_memories === 0;
  const completed = operations.filter(row => row.status === 'pipeline_validated').length;
  return { status: completed === NVIDIA_LIVE_OPERATION_LIMIT && noDurableContent && usage.length >= NVIDIA_LIVE_OPERATION_LIMIT ? 'passed' : 'needs_review',
    operations, usage, operationLimit: NVIDIA_LIVE_OPERATION_LIMIT, attemptLimit: NVIDIA_LIVE_ATTEMPT_LIMIT,
    noDurableContent, humanReviewRequired: true, semanticAccuracyMeasured: false,
    notice: 'Pipeline checks cover bounded synthetic inputs. No model text was retained; semantic quality requires a separate human review.' };
}

/** Cleanup can address only the ID returned by this invocation's createAccount. */
export async function withDisposableNvidiaFixture(deps) {
  if (await deps.hasJournal()) return { status: 'failed', failure: 'previous_cleanup_journal_present', cleanup: false, fixtureCreated: false };
  let id, journalWritten = false;
  const report = { status: 'failed', cleanup: false, fixtureCreated: false };
  try {
    id = await deps.createAccount();
    if (!UUID.test(id ?? '')) { id = undefined; throw new Error('missing_fixture_identity'); }
    report.fixtureCreated = true;
    await deps.writeJournal(id); journalWritten = true;
    await deps.setup(id);
    Object.assign(report, await deps.verify(id));
  } catch { report.status = 'failed'; report.failure = 'fixture_or_verification_failed'; }
  finally {
    if (id) {
      try {
        await deps.deleteAccount(id);
        if (await deps.verifyDeleted(id) !== true) throw new Error('cleanup_unconfirmed');
        if (journalWritten) await deps.clearJournal();
        report.cleanup = true;
      } catch { report.status = 'failed'; report.cleanup = false; report.failure = 'cleanup_requires_attention'; }
    }
  }
  return report;
}

async function main() {
  if (process.argv.length > 2) throw new Error('Run this verifier without command arguments; credentials belong only in private environment configuration.');
  const env = { ...parseEnv(readFileSync('.env.local', 'utf8')), ...process.env };
  const validation = validateNvidiaLiveEnvironment(env);
  if (!validation.ok) { for (const issue of validation.issues) console.error(issue); process.exitCode = 1; return; }
  const journal = '.e2e-state-nvidia-fixture.json';
  if (existsSync(journal)) throw new Error('A prior NVIDIA fixture cleanup journal needs review before another run.');
  await import('../tests/register.mjs');
  const [{ createNvidiaProvider }, { getAccountedAi }, { understandDecision }, { reserveAiRequest }, { POLICY_VERSION }] = await Promise.all([
    import('../src/lib/services/ai/nvidia.ts'), import('../src/lib/services/ai/accounting.ts'),
    import('../src/lib/services/decision-intake.ts'), import('../src/lib/services/ai/privacy.ts'), import('../src/lib/legal/config.ts'),
  ]);
  const provider = createNvidiaProvider(env);
  if (!provider) throw new Error('The NVIDIA route could not be configured.');
  const timedFetch = (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(20000)]) });
  const settings = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: timedFetch } };
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, settings);
  const own = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, settings);
  const credentials = { email: `nudge-nvidia-${randomUUID()}@example.com`, password: randomBytes(32).toString('base64url') };
  const requireResult = result => { if (result.error) throw new Error('backend_operation_failed'); return result.data; };
  const report = await withDisposableNvidiaFixture({
    hasJournal: () => existsSync(journal),
    createAccount: async () => requireResult(await admin.auth.admin.createUser({ ...credentials, email_confirm: true,
      user_metadata: { full_name: 'Synthetic NVIDIA verification' } })).user?.id,
    writeJournal: id => writeFileSync(journal, JSON.stringify({ projectRef: env.NUDGE_E2E_TARGET_PROJECT_REF, createdByThisRun: [id] }) + '\n', { mode: 0o600, flag: 'wx' }),
    setup: async id => {
      const signed = requireResult(await own.auth.signInWithPassword(credentials));
      if (signed.user?.id !== id) throw new Error('identity_mismatch');
      requireResult(await own.rpc('accept_legal_terms', { p_version: POLICY_VERSION, p_age_eligible: true }));
      requireResult(await own.rpc('set_ai_enabled', { p_enabled: true }));
    },
    verify: async id => {
      const bind = async action => {
        const bound = await getAccountedAi(own, id, action, { provider, ledger: admin, env });
        if (!bound) throw new Error('accounted_provider_unavailable');
        return bound;
      };
      return evaluateNvidiaOperations({
        interpret: async text => understandDecision(own, id, text, undefined, await bind('interpret')),
        extract: async text => {
          if (!await reserveAiRequest(own, 'extract')) throw new Error('quota_unavailable');
          return (await bind('extract')).extractMemories(text, { signal: AbortSignal.timeout(10000) });
        },
        recap: async input => {
          if (!await reserveAiRequest(own, 'recap')) throw new Error('quota_unavailable');
          return (await bind('recap')).summarizeMonth(input, { signal: AbortSignal.timeout(10000) });
        },
        readUsage: async () => requireResult(await own.rpc('export_my_ai_usage')),
        readCounts: async () => {
          const counts = {};
          for (const table of ['decisions', 'ai_memories']) {
            const result = await own.from(table).select('id', { count: 'exact', head: true }).eq('user_id', id);
            requireResult(result); counts[table] = result.count;
          }
          return counts;
        },
      });
    },
    deleteAccount: async id => {
      await own.auth.signOut().catch(() => {});
      requireResult(await admin.auth.admin.deleteUser(id, false));
    },
    verifyDeleted: async id => {
      const user = await admin.auth.admin.getUserById(id);
      if (user.error?.status !== 404 || user.data?.user) return false;
      const profile = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('id', id);
      return !profile.error && profile.count === 0;
    },
    clearJournal: () => unlinkSync(journal),
  });
  const output = resolve(env.NUDGE_NVIDIA_LIVE_REPORT_PATH ?? '.local/evidence/audit-2026-10-26/completion/nvidia-live.json');
  if (!output.startsWith(resolve('.local') + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Live report must remain inside private workspace evidence.');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ checkedAtUtc: new Date().toISOString(), projectRef: env.NUDGE_E2E_TARGET_PROJECT_REF, ...report }, null, 2) + '\n');
  console.log(`NVIDIA bounded live pipeline: ${report.status}; disposable cleanup ${report.cleanup ? 'verified' : 'unconfirmed'}.`);
  console.log('No raw model text, credentials, memory suggestions or recap text were retained. Human quality review remains required.');
  if (report.status !== 'passed' || !report.cleanup) process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(() => { console.error('NVIDIA live verification could not start or finish. Review private configuration and any cleanup journal locally; raw diagnostics were withheld.'); process.exitCode = 1; });
