import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nvidiaDevelopmentSettings } from '../scripts/configure-nvidia-development.mjs';
import { DEVELOPMENT_NVIDIA_MODELS } from '../scripts/check-development.mjs';
import { evaluateNvidiaOperations, validateNvidiaLiveEnvironment, withDisposableNvidiaFixture } from '../scripts/verify-nvidia-disposable.mjs';

const project = 'abcdefghijklmnpqrstu';
const base = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${project}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ['header', Buffer.from(JSON.stringify({ role: 'anon', ref: project })).toString('base64url'), 'signature'].join('.'),
  NEXT_PUBLIC_SITE_URL: 'http://localhost:3000', SUPABASE_SERVICE_ROLE_KEY: 'PRIVATE_ADMIN_SENTINEL',
  NVIDIA_API_KEY: 'PRIVATE_NVIDIA_SENTINEL', NUDGE_PUBLIC_LAUNCH: 'false',
  NUDGE_ALLOW_HOSTED_DISPOSABLE_TESTS: '1', NUDGE_ALLOW_LIVE_NVIDIA_TESTS: '1', NUDGE_E2E_TARGET_PROJECT_REF: project,
};
const ready = { ...base, ...nvidiaDevelopmentSettings(base) };
const guard = (env: Record<string, string | undefined>) => validateNvidiaLiveEnvironment(env, { nodeVersion: '24.19.0' });
const fixtureId = '10000000-0000-4000-8000-000000000001';
function fixture(overrides: Record<string, unknown> = {}) {
  const calls: { operation: string; id?: string }[] = [];
  const step = (operation: string, result?: unknown) => async (id?: string) => { calls.push({ operation, ...(id ? { id } : {}) }); return result; };
  return { calls, deps: {
    hasJournal: step('journal-check', false), createAccount: step('create', fixtureId),
    writeJournal: step('journal-write'), setup: step('setup'), verify: step('verify', { status: 'passed' }),
    deleteAccount: step('delete'), verifyDeleted: step('deleted-check', true), clearJournal: step('journal-clear'), ...overrides,
  } };
}
const usage = (action: string, slot: 'lightning' | 'gemma' = 'lightning') => ({
  action, provider: `nvidia:${slot}`, model: DEVELOPMENT_NVIDIA_MODELS[slot], status: 'settled',
  input_tokens: 10, output_tokens: 5, reserved_cost_micros: 1, actual_cost_micros: 0,
  request_id: 'PRIVATE_REQUEST_SENTINEL', unexpected: 'PRIVATE_RAW_SENTINEL',
});

describe('opt-in bounded live NVIDIA verification', () => {
  it('requires both opt-ins, exact target, current free routes, private accounting and development-only mode before writes', () => {
    const frozen = Object.freeze({ ...ready });
    assert.equal(guard(frozen).ok, true);
    for (const changes of [
      { NUDGE_ALLOW_LIVE_NVIDIA_TESTS: undefined }, { NUDGE_ALLOW_HOSTED_DISPOSABLE_TESTS: undefined },
      { NUDGE_E2E_TARGET_PROJECT_REF: 'different-project' }, { NEXT_PUBLIC_SUPABASE_URL: `https://${project}.supabase.co/path` },
      { AI_PROVIDER: 'groq' }, { NUDGE_PUBLIC_LAUNCH: 'true' }, { NUDGE_PUBLIC_LAUNCH: undefined },
      { NUDGE_AI_DEVELOPMENT_FREE: 'false' }, { NVIDIA_ENABLED_MODELS: 'lightning,gemma,super' },
      { NVIDIA_API_KEY: undefined }, { SUPABASE_SERVICE_ROLE_KEY: undefined }, { NUDGE_AI_MODEL_PRICES_JSON: undefined },
    ]) assert.equal(guard({ ...ready, ...changes }).ok, false, JSON.stringify(Object.keys(changes)));
    const paid = JSON.parse(ready.NUDGE_AI_MODEL_PRICES_JSON); paid[0].inputUsdPerMillion = '1';
    assert.equal(guard({ ...ready, NUDGE_AI_MODEL_PRICES_JSON: JSON.stringify(paid) }).ok, false);
    assert.doesNotMatch(JSON.stringify(guard({ ...ready, AI_PROVIDER: 'unknown' })), /PRIVATE_/);
    assert.deepEqual(frozen, ready);
  });
  it('refuses a previous journal without creating or deleting any account', async () => {
    const { calls, deps } = fixture({ hasJournal: async () => true });
    const report = await withDisposableNvidiaFixture(deps);
    assert.equal(report.status, 'failed'); assert.equal(report.cleanup, false); assert.equal(report.fixtureCreated, false);
    assert.deepEqual(calls, []);
  });
  it('journals the returned ID before setup, then verifies deletion before clearing that journal', async () => {
    const { calls, deps } = fixture();
    const report = await withDisposableNvidiaFixture(deps);
    assert.equal(report.status, 'passed'); assert.equal(report.cleanup, true);
    assert.deepEqual(calls.map(call => call.operation), ['journal-check', 'create', 'journal-write', 'setup', 'verify', 'delete', 'deleted-check', 'journal-clear']);
    assert.ok(calls.filter(call => call.id).every(call => call.id === fixtureId));
    assert.ok(!JSON.stringify(report).includes(fixtureId), 'The public report must not retain the fixture ID.');
  });
  it('still cleans up only its returned ID after setup/verification fails and hides raw failure diagnostics', async () => {
    for (const operation of ['setup', 'verify']) {
      const { calls, deps } = fixture({ [operation]: async () => { throw new Error('PRIVATE_BACKEND_SENTINEL'); } });
      const report = await withDisposableNvidiaFixture(deps);
      assert.equal(report.status, 'failed'); assert.equal(report.cleanup, true);
      assert.deepEqual(calls.filter(call => call.operation === 'delete').map(call => call.id), [fixtureId]);
      assert.ok(calls.some(call => call.operation === 'journal-clear'));
      assert.doesNotMatch(JSON.stringify(report), /PRIVATE_/);
    }
  });
  it('retains a cleanup journal after an uncertain delete and does not clear a journal it failed to create', async () => {
    const uncertain = fixture({ verifyDeleted: async () => false });
    const unconfirmed = await withDisposableNvidiaFixture(uncertain.deps);
    assert.equal(unconfirmed.cleanup, false); assert.equal(unconfirmed.status, 'failed');
    assert.ok(!uncertain.calls.some(call => call.operation === 'journal-clear'));
    const collision = fixture({ writeJournal: async () => { throw new Error('Concurrent exclusive journal creation'); } });
    const collided = await withDisposableNvidiaFixture(collision.deps);
    assert.equal(collided.status, 'failed'); assert.equal(collided.cleanup, true);
    assert.deepEqual(collision.calls.filter(call => call.operation === 'delete').map(call => call.id), [fixtureId]);
    assert.ok(!collision.calls.some(call => call.operation === 'journal-clear'));
    assert.ok(!collision.calls.some(call => call.operation === 'setup'));
  });
  it('cannot delete an invented fallback ID when account creation does not return a valid identity', async () => {
    const { calls, deps } = fixture({ createAccount: async () => 'invalid-return' });
    const report = await withDisposableNvidiaFixture(deps);
    assert.equal(report.fixtureCreated, false); assert.equal(report.cleanup, false);
    assert.ok(!calls.some(call => call.operation === 'delete' || call.operation === 'journal-write'));
  });
  it('runs exactly six bounded synthetic operations and exports only allowlisted counts/usage with human review still required', async () => {
    const calls: string[] = [];
    const report = await evaluateNvidiaOperations({
      interpret: async () => { calls.push('interpret'); return { source: 'ai', options: ['Copper task', 'Willow task'], domain: '', question: 'PRIVATE_GENERATED_SENTINEL' }; },
      extract: async () => { calls.push('extract'); return [{ kind: 'habit', content: 'PRIVATE_MEMORY_SENTINEL', confidence: 0.8 }]; },
      recap: async () => { calls.push('recap'); return 'PRIVATE_RECAP_SENTINEL'; },
      readUsage: async () => [...Array.from({ length: 4 }, () => usage('interpret')), usage('extract', 'gemma'), usage('recap', 'gemma')],
      readCounts: async () => ({ decisions: 0, ai_memories: 0 }), now: () => 100,
    });
    assert.deepEqual(calls, ['interpret', 'interpret', 'interpret', 'interpret', 'extract', 'recap']);
    assert.equal(report.status, 'passed'); assert.equal(report.operations.length, 6); assert.equal(report.attemptLimit, 12);
    assert.equal(report.semanticAccuracyMeasured, false); assert.equal(report.humanReviewRequired, true); assert.equal(report.noDurableContent, true);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_|question|content|request_id/);
  });
  it('reports fallback/unavailable results honestly, detects durable writes, and rejects excessive or foreign usage identities', async () => {
    const operations = {
      interpret: async () => ({ source: 'manual', options: [], domain: 'Invented setting' }),
      extract: async () => { throw new Error('PRIVATE_PROVIDER_SENTINEL'); }, recap: async () => '',
      readUsage: async () => [] as unknown[], readCounts: async () => ({ decisions: 0, ai_memories: 1 }), now: () => 100,
    };
    const report = await evaluateNvidiaOperations(operations);
    assert.equal(report.status, 'needs_review'); assert.equal(report.noDurableContent, false);
    assert.equal(report.operations.filter(row => row.status === 'pipeline_validated').length, 0);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_|Invented setting/);
    await assert.rejects(evaluateNvidiaOperations({ ...operations, readUsage: async () => Array.from({ length: 13 }, () => usage('interpret')) }), /usage_contract_failed/);
    await assert.rejects(evaluateNvidiaOperations({ ...operations, readUsage: async () => [{ ...usage('interpret'), model: 'PRIVATE_MODEL_SENTINEL' }] }), /usage_contract_failed/);
  });
});
