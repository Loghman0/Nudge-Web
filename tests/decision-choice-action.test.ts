import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const decisionId = '00000000-0000-4000-8000-000000000001';
const optionId = '00000000-0000-4000-8000-000000000002';
function harness(settings: { user?: boolean; choiceError?: boolean; achievement?: 'throw' | 'error' | 'readThrow' | 'readError' } = {}) {
  const saves: unknown[][] = [], paths: string[] = [];
  let achievementCalls = 0;
  const db = {
    auth: { getUser: async () => ({ data: { user: settings.user === false ? null : { id: 'verified-owner' } } }) },
    rpc: async (name: string) => {
      assert.equal(name, 'evaluate_achievements'); achievementCalls++;
      if (settings.achievement === 'throw') throw new Error('Private optional failure');
      return { data: ['second', 'first'], error: settings.achievement === 'error' ? { message: 'Private failure' } : null };
    },
    from: (table: string) => {
      assert.equal(table, 'achievements');
      return { select: () => ({ in: async () => {
        if (settings.achievement === 'readThrow') throw new Error('Private optional read failure');
        return { data: [{ slug: 'first', title: 'First', description: 'First award' }, { slug: 'second', title: 'Second', description: 'Second award' }],
          error: settings.achievement === 'readError' ? { message: 'Private read failure' } : null };
      } }) };
    },
  };
  const source = readFileSync(new URL('../src/app/(app)/ask/actions.ts', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('export async function chooseOption('), source.indexOf('/** Restore the persisted comparison'));
  const context = vm.createContext({
    createClient: async () => db,
    chooseDecision: async (...args: unknown[]) => {
      saves.push(args);
      return settings.choiceError ? { ok: false, message: 'Reload this changed comparison.' } : { ok: true, decisionId, selectedOptionId: optionId, status: 'decided' };
    },
    revalidatePath: (path: string) => paths.push(path),
  });
  vm.runInContext(stripTypeScriptTypes(block).replace('export async function', 'async function'), context);
  return { run: context.chooseOption as (decision: string, option: string) => Promise<{ error?: string; milestones?: unknown[] }>, db, saves, paths, achievementCalls: () => achievementCalls };
}

describe('web choice acknowledgement after required save', () => {
  it('passes only the verified owner and selected identities to the shared choice service', async () => {
    const h = harness(); const result = await h.run(decisionId, optionId);
    assert.equal(h.saves.length, 1); assert.equal(h.saves[0][0], h.db); assert.equal(h.saves[0][1], 'verified-owner');
    assert.equal(JSON.stringify(h.saves[0][2]), JSON.stringify({ decisionId, optionId }));
    assert.equal(result.error, undefined);
    assert.equal((result as { status?: string }).status, 'decided');
    assert.equal(JSON.stringify(result.milestones), JSON.stringify([{ title: 'Second', description: 'Second award' }, { title: 'First', description: 'First award' }]));
    assert.deepEqual(h.paths, ['/dashboard', '/history']);
  });
  it('keeps a successful choice acknowledged when optional milestone evaluation or reads fail', async () => {
    for (const achievement of ['throw', 'error', 'readThrow', 'readError'] as const) {
      const h = harness({ achievement }); const result = await h.run(decisionId, optionId);
      assert.equal(result.error, undefined); assert.equal(result.milestones?.length, 0);
      assert.equal(h.saves.length, 1); assert.equal(h.achievementCalls(), 1);
      assert.deepEqual(h.paths, ['/dashboard', '/history']);
      assert.ok(!JSON.stringify(result).includes('Private'));
    }
  });
  it('never evaluates milestones or claims success after unauthenticated or rejected choices', async () => {
    for (const settings of [{ user: false }, { choiceError: true }]) {
      const h = harness(settings); const result = await h.run(decisionId, optionId);
      assert.ok(result.error); assert.equal(h.achievementCalls(), 0); assert.deepEqual(h.paths, []);
      assert.equal(h.saves.length, settings.user === false ? 0 : 1);
    }
  });
});
