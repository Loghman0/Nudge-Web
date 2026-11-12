import { act, createElement } from 'react';
import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { Root } from 'react-dom/client';
import { MemoryInspector, MemoryLibrary } from '../src/app/(app)/profile/memory-inspector';
import { RemovablePreference } from '../src/app/(app)/profile/profile-client';
import type { MemoryPage } from '../src/lib/services/profile-memories';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://nudge.test/profile' });
for (const [name, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator }))
  Object.defineProperty(globalThis, name, { value, configurable: true });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); });
async function render(element: React.ReactNode) {
  if (!root) { const { createRoot } = await import('react-dom/client'); const container = document.createElement('div'); document.body.append(container); root = createRoot(container); }
  await act(async () => root!.render(element));
}
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent === name)!;

it('removes erased beliefs on refreshed props and resets the old inspector on a memory generation change', async () => {
  const node = { id: 'belief', key: 'food.tea', value: 'Tea', category_slug: 'food', polarity: 'like', confidence: .8, source: 'explicit', evidence_count: 1, last_reinforced_at: null };
  await render(createElement(MemoryInspector, { nodes: [node], memoryGeneration: 1 }));
  assert.match(document.body.textContent!, /Tea/);
  await render(createElement(MemoryInspector, { nodes: [], memoryGeneration: 1 }));
  assert.doesNotMatch(document.body.textContent!, /Tea/);
  await render(createElement(MemoryInspector, { nodes: [node], memoryGeneration: 1 }));
  await render(createElement(MemoryInspector, { nodes: [], memoryGeneration: 2 }));
  assert.doesNotMatch(document.body.textContent!, /Tea/);
  assert.match(document.body.textContent!, /No beliefs match/);
});

it('does not resurrect extracted memories when an old search completes after erase', async () => {
  const memory = { id: 'memory', content: 'Private old note', kind: 'fact', confidence: .8, created_at: '2026-10-28T00:00:00Z' };
  let finish!: (value: MemoryPage) => void;
  const load = () => new Promise<MemoryPage>(resolve => { finish = resolve; });
  await render(createElement(MemoryLibrary, { initial: [memory], initialHasMore: false, memoryGeneration: 1, load }));
  await act(async () => button('Refresh memories').click());
  await render(createElement(MemoryLibrary, { initial: [], initialHasMore: false, memoryGeneration: 2, load }));
  await act(async () => finish({ memories: [memory], hasMore: false }));
  assert.doesNotMatch(document.body.textContent!, /Private old note/);
  assert.match(document.body.textContent!, /No extracted memories yet/);
});

it('keeps a failed preference removal inline and permits retry', async () => {
  let attempts = 0;
  await render(createElement(RemovablePreference, { id: 'preference', label: 'Tea', liked: true, removeAction: async () => {
    if (++attempts === 1) throw new Error('private transport details');
    return {};
  } }));
  const forget = document.querySelector<HTMLButtonElement>('button[aria-label="Forget Tea"]')!;
  await act(async () => forget.click());
  assert.match(document.querySelector('[role="alert"]')!.textContent!, /Please try again/);
  assert.doesNotMatch(document.body.textContent!, /private transport/);
  assert.equal(forget.disabled, false);
  await act(async () => forget.click());
  assert.equal(attempts, 2);
  assert.equal(document.querySelector('[role="alert"]'), null);
});
