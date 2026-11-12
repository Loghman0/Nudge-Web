import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { isRequestId } from '../src/lib/services/comparison-input';
import * as discoverLoaders from '../src/lib/discover/loaders';

const createdId = '00000000-0000-4000-8000-000000000001';
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
interface Options { requiredError?: { code?: string; message: string }; requiredThrow?: boolean; missingAcknowledgement?: boolean; rewardThrow?: boolean; rewardError?: boolean; nextError?: boolean }
function harness(kind: 'groups' | 'discover', options: Options = {}) {
  const source = readFileSync(new URL(`../src/app/(app)/${kind}/actions.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls: { name: string; args: unknown }[] = [], paths: string[] = []; let authChecks = 0;
  const db = {
    auth: { getUser: async () => { authChecks++; return { data: { user: { id: 'verified-owner' } } }; } },
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args: plain(args ?? null) });
      if (['create_circle', 'create_circle_poll', 'answer_discover_question'].includes(name)) {
        if (options.requiredThrow) throw new Error('Private transport diagnostics');
        return { data: options.missingAcknowledgement || name === 'answer_discover_question' ? null : createdId, error: options.requiredError ?? null };
      }
      if (name === 'evaluate_achievements') {
        if (options.rewardThrow) throw new Error('Private reward diagnostics');
        return { data: null, error: options.rewardError ? { message: 'Private reward diagnostics' } : null };
      }
      if (name === 'discover_next_question') return { data: [], error: options.nextError ? { code: 'XX000', message: 'Private next-question diagnostics' } : null };
      if (name === 'question_progress') return { data: [{ answered_today: 1, total_answered: 2, total_questions: 5 }], error: null };
      throw new Error('Unexpected RPC: ' + name);
    },
  };
  const modules: Record<string, unknown> = {
    'next/cache': { revalidatePath: (path: string) => paths.push(path) },
    'next/navigation': { redirect: (path: string) => { throw new Error('Unexpected redirect: ' + path); } },
    '@/lib/supabase/server': { createClient: async () => db },
    '@/lib/services/comparison-input': { isRequestId },
    '@/lib/services/knowledge': { recordKnowledgeSignal: () => { throw new Error('Unexpected signal'); } },
    '@/lib/discover/types': { discoverTopic: (value: unknown) => value },
    '@/lib/discover/loaders': discoverLoaders,
  };
  const exports: Record<string, any> = {};
  vm.runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(Object.hasOwn(modules, name)); return modules[name]; }, console: { error: () => {} } });
  return { actions: exports, calls, paths, authChecks: () => authChecks };
}
function circleForm() { const form = new FormData(); form.set('name', 'Friday circle'); return form; }
function pollForm() { const form = new FormData(); form.set('question', 'Where should we meet?'); form.set('option_1', 'Library'); form.set('option_2', 'Cafe'); return form; }

describe('circle and poll required acknowledgements', () => {
  const actions = [
    { name: 'createDecisionCircle', rpc: 'create_circle', args: () => [circleForm()], path: '/groups' },
    { name: 'createPoll', rpc: 'create_circle_poll', args: () => [createdId, pollForm()], path: '/groups/' + createdId },
  ];
  it('keeps confirmed circle/poll creations acknowledged when optional rewards throw or return an error', async () => {
    for (const action of actions) for (const options of [{ rewardThrow: true }, { rewardError: true }]) {
      const h = harness('groups', options), result = await h.actions[action.name](...action.args());
      assert.deepEqual(plain(result), {}); assert.deepEqual(h.calls.map(call => call.name), [action.rpc, 'evaluate_achievements']); assert.deepEqual(h.paths, [action.path]);
    }
  });
  it('requires reload after uncertain creation outcomes without rewards or false success invalidations', async () => {
    for (const action of actions) for (const options of [{ requiredThrow: true }, { missingAcknowledgement: true }, { requiredError: { code: '', message: 'Private transport diagnostics' } },
      { requiredError: { code: '57014', message: 'You can own up to 20 circles' } }]) {
      const h = harness('groups', options), result = await h.actions[action.name](...action.args());
      assert.equal(result.reloadRequired, true); assert.match(result.error, /Reload|duplicate/); assert.doesNotMatch(result.error, /Private|20 circles/);
      assert.equal(h.calls.length, 1); assert.deepEqual(h.paths, []);
    }
  });
  it('preserves known database validation/state failures as retryable errors', async () => {
    for (const [action, message] of [[actions[0], 'You can own up to 20 circles'], [actions[1], 'Close an existing vote before opening another']] as const) {
      const h = harness('groups', { requiredError: { code: 'P0001', message } }), result = await h.actions[action.name](...action.args());
      assert.equal(result.error, message); assert.equal(result.reloadRequired, undefined); assert.equal(h.calls.length, 1); assert.deepEqual(h.paths, []);
    }
  });
  it('does not block deliberately repeated same-name circles or same-question polls after a separate successful submission', async () => {
    for (const action of actions) {
      const h = harness('groups'); assert.deepEqual(plain(await h.actions[action.name](...action.args())), {}); assert.deepEqual(plain(await h.actions[action.name](...action.args())), {});
      assert.equal(h.calls.filter(call => call.name === action.rpc).length, 2);
    }
  });
  it('rejects empty, duplicate or file-valued fields before the required RPC', async () => {
    const h = harness('groups'); const fileCircle = circleForm(); fileCircle.set('name', new Blob(['private']), 'note.txt');
    assert.ok((await h.actions.createDecisionCircle(fileCircle)).error);
    const badPoll = pollForm(); badPoll.set('option_2', ' library '); assert.match((await h.actions.createPoll(createdId, badPoll)).error, /distinct/);
    const filePoll = pollForm(); filePoll.set('option_2', new Blob(['private']), 'note.txt'); assert.ok((await h.actions.createPoll(createdId, filePoll)).error);
    assert.equal(h.calls.length, 0); assert.deepEqual(h.paths, []);
  });
});

describe('Discover required save and optional rewards', () => {
  it('advances the next-question state after a committed answer despite optional reward failures', async () => {
    for (const options of [{ rewardThrow: true }, { rewardError: true }]) {
      const h = harness('discover', options), result = await h.actions.answerQuestion(createdId, 'a', 'food');
      assert.deepEqual(plain(result), { next: null, answeredToday: 1, totalAnswered: 2, remaining: 3, topic: 'food' });
      assert.deepEqual(h.calls.map(call => call.name), ['answer_discover_question', 'evaluate_achievements', 'discover_next_question', 'question_progress']);
      assert.deepEqual(h.paths, ['/discover', '/profile']);
      assert.equal(h.authChecks(), 1, 'The saved answer and next question share one verified identity');
    }
  });
  it('keeps a required answer rejection visible and never evaluates rewards or returns a fake next state', async () => {
    const h = harness('discover', { requiredError: { code: 'P0001', message: 'Private validation diagnostics' } });
    await assert.rejects(() => h.actions.answerQuestion(createdId, 'a'), { message: "Couldn't save your answer. Try again." });
    assert.equal(h.calls.length, 1); assert.deepEqual(h.paths, []);
  });
  it('distinguishes a saved answer from an already-answered question when the required next-state read fails', async () => {
    const saved = harness('discover', { nextError: true, rewardThrow: true });
    await assert.rejects(() => saved.actions.answerQuestion(createdId, 'a'), /Your answer was saved\. Reload Discover/);
    const prior = harness('discover', { nextError: true, requiredError: { code: 'P0001', message: 'This question was already answered' } });
    await assert.rejects(() => prior.actions.answerQuestion(createdId, 'b'), /This question was already answered\. Reload Discover/);
  });
});
