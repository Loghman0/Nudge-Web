import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nvidiaDevelopmentSettings } from '../scripts/configure-nvidia-development.mjs';
import { readAiAccountingConfig } from '../src/lib/services/ai/accounting-config';

describe('explicit NVIDIA prototype configuration', () => {
  it('requires NVIDIA credentials and cannot mistake another vendor key for NVIDIA access', () => {
    for (const env of [{}, { AI_API_KEY: 'gsk-private-other-vendor' }, { NVIDIA_API_KEY: 'your-key-here' }, { NVIDIA_LIGHTNING_API_KEY: 'one-slot-only' }]) {
      assert.throws(() => nvidiaDevelopmentSettings(env), /Add NVIDIA_API_KEY/);
    }
  });
  it('leaves public deployment blocked and never returns or changes supplied credentials', () => {
    const env = { NVIDIA_API_KEY: 'private-test-key', SUPABASE_SERVICE_ROLE_KEY: 'private-admin-key' };
    const before = { ...env }, settings = nvidiaDevelopmentSettings(env);
    assert.deepEqual(env, before); assert.equal(settings.NUDGE_PUBLIC_LAUNCH, 'false');
    assert.equal(settings.NUDGE_AI_DEVELOPMENT_FREE, 'true');
    assert.doesNotMatch(JSON.stringify(settings), /private-test-key|private-admin-key/);
    assert.throws(() => nvidiaDevelopmentSettings({ ...env, NUDGE_PUBLIC_LAUNCH: 'true' }), /public launch off/);
  });
  it('uses only the two current prototype models with zero token prices and bounded unresolved attempts', () => {
    const settings = nvidiaDevelopmentSettings({ NVIDIA_LIGHTNING_API_KEY: 'lightning-key', NVIDIA_GEMMA_API_KEY: 'gemma-key' });
    const config = readAiAccountingConfig(settings)!;
    assert.ok(config); assert.equal(settings.NVIDIA_ENABLED_MODELS, 'lightning,gemma');
    assert.deepEqual(config.models.map(model => model.provider), ['nvidia:lightning', 'nvidia:gemma']);
    assert.ok(config.models.every(model => model.inputMicrosPerMillion === 0 && model.outputMicrosPerMillion === 0 && model.maxAttemptMicros === 1));
    assert.equal(config.userDailyMicros, 100); assert.equal(config.globalDailyMicros, 1000);
  });
});
