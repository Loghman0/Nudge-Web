import { it } from 'node:test';
import assert from 'node:assert/strict';
import { recordKnowledgeSignal } from '../src/lib/services/knowledge';

it('keeps private evidence and raw transport diagnostics out of learning-error logs', async () => {
  const messages: unknown[][] = [], original = console.error;
  console.error = (...args: unknown[]) => { messages.push(args); };
  try {
    for (const mode of ['database', 'transport']) {
      const rpc = { rpc: async () => {
        if (mode === 'transport') throw new Error('private-token-and-journal-note');
        return { data: null, error: { code: '22023', message: 'private-token-and-journal-note', details: 'private-evidence' } };
      } } as unknown as Parameters<typeof recordKnowledgeSignal>[0];
      assert.equal(await recordKnowledgeSignal(rpc, { key: 'food.private', value: 'private-evidence', polarity: 'like', source: 'explicit', weight: .5, kind: 'manual' }), null);
    }
    assert.equal(messages.length, 2); assert.match(JSON.stringify(messages), /22023/);
    assert.doesNotMatch(JSON.stringify(messages), /private-token|private-evidence|journal-note/);
  } finally { console.error = original; }
});
