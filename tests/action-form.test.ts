import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { GuardedActionForm as ActionForm } from '../src/components/app/action-form';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://nudge.test/groups' });
for (const [name, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, FormData: dom.window.FormData }))
  Object.defineProperty(globalThis, name, { value, configurable: true });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
async function mount(action: Parameters<typeof ActionForm>[0]['action'], onSaved?: () => void) {
  const { createRoot } = await import('react-dom/client'); const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(createElement(ActionForm, { action, onSaved, children: createElement('div', {},
    createElement('input', { name: 'name', defaultValue: 'Friday circle' }), createElement('button', { type: 'submit' }, 'Create circle')) })));
}
function submit() { document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); }
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); });

describe('guarded app action forms', () => {
  it('blocks immediate repeat submits before pending rerender and captures inputs before disabling the fieldset', async () => {
    const names: unknown[] = []; let finish!: (value: { error?: string }) => void;
    await mount(async form => { names.push(form.get('name')); return new Promise(resolve => { finish = resolve; }); });
    await act(async () => { submit(); submit(); });
    assert.deepEqual(names, ['Friday circle']); assert.equal(document.querySelector('fieldset')!.disabled, true);
    await act(async () => finish({ error: 'Correct this input and retry.' }));
    assert.equal(document.querySelector('input')!.value, 'Friday circle'); assert.equal(document.querySelector('fieldset')!.disabled, false);
    assert.match(document.querySelector('[role=alert]')!.textContent!, /Correct this input/);
  });
  it('preserves a failed draft, allows a deliberate corrected retry and resets only after success', async () => {
    let calls = 0, refreshes = 0; const names: unknown[] = [];
    await mount(async form => { calls++; names.push(form.get('name')); return calls === 1 ? { error: 'Please correct this name.' } : {}; }, () => { refreshes++; });
    const input = document.querySelector('input')!; input.value = 'Edited circle';
    await act(async () => submit()); assert.equal(input.value, 'Edited circle'); assert.equal(refreshes, 0);
    await act(async () => submit()); assert.equal(calls, 2); assert.deepEqual(names, ['Edited circle', 'Edited circle']);
    assert.equal(input.value, 'Friday circle'); assert.equal(document.querySelector('[role=alert]'), null); assert.equal(refreshes, 1);
  });
  it('blocks another creation until reload after an explicitly uncertain outcome', async () => {
    let calls = 0; await mount(async () => { calls++; return { error: 'Reload Circles before retrying.', reloadRequired: true }; });
    await act(async () => submit()); await act(async () => submit());
    assert.equal(calls, 1); assert.equal(document.querySelector('fieldset')!.disabled, true);
    assert.equal(document.querySelector('input')!.value, 'Friday circle');
    assert.match(document.body.textContent!, /Reload to check saved changes/);
    assert.equal([...document.querySelectorAll('button')].find(button => button.textContent === 'Reload to check saved changes')!.type, 'button');
  });
  it('hides unexpected action diagnostics and requires checking the possibly saved state', async () => {
    let calls = 0; await mount(async () => { calls++; throw new Error('Private transport diagnostics'); });
    await act(async () => submit()); await act(async () => submit());
    assert.equal(calls, 1); assert.match(document.body.textContent!, /Reload before retrying in case it was saved/);
    assert.doesNotMatch(document.body.textContent!, /Private/); assert.equal(document.querySelector('fieldset')!.disabled, true);
  });
});
