import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { AuthField, AuthNotice } from '../src/app/(auth)/auth-fields';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { safeReturnPath } from '../src/lib/auth/return-path';
import { signupFoundationPath } from '../src/lib/auth/foundation-path';
import { authRedirectOrigin } from '../src/lib/auth/redirect-origin';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://nudge.test/login' });
for (const [name, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator }))
  Object.defineProperty(globalThis, name, { value, configurable: true });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
async function mount(children: React.ReactNode) {
  const { createRoot } = await import('react-dom/client'); const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(children));
}
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); });

describe('accessible authentication fields', () => {
  it('reveals a password only on request, without submitting or losing the entered value', async () => {
    await mount(createElement('form', {}, createElement(AuthField, { label: 'Password', name: 'password', type: 'password', hint: 'At least 8 characters', autoComplete: 'new-password' })));
    const input = document.querySelector('input')!; const button = document.querySelector('button')!;
    assert.equal(input.type, 'password'); assert.equal(button.type, 'button'); assert.equal(input.autocomplete, 'new-password');
    assert.equal(document.querySelector('label')!.htmlFor, input.id); assert.equal(button.getAttribute('aria-controls'), input.id);
    assert.equal(document.getElementById(input.getAttribute('aria-describedby')!)!.textContent, 'At least 8 characters');
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'a-private-password'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    await act(async () => button.click());
    assert.equal(input.type, 'text'); assert.equal(input.value, 'a-private-password'); assert.equal(button.getAttribute('aria-pressed'), 'true');
    await act(async () => button.click()); assert.equal(input.type, 'password'); assert.equal(input.value, 'a-private-password');
    await act(async () => document.querySelector('form')!.reset()); assert.equal(input.value, 'a-private-password');
  });
  it('announces and focuses failed and successful responses without exposing hidden placeholders', async () => {
    await mount(createElement(AuthNotice, {})); assert.equal(document.body.textContent, '');
    await act(async () => root!.render(createElement(AuthNotice, { error: 'Email or password is incorrect.' })));
    assert.equal(document.activeElement, document.querySelector('[role=alert]'));
    await act(async () => root!.render(createElement(AuthNotice, { message: 'Check your inbox.' })));
    assert.equal(document.querySelector('[role=alert]'), null); assert.equal(document.activeElement, document.querySelector('[role=status]'));
  });
});

describe('authentication does not invent legal acceptance', () => {
  it('creates email credentials and starts OAuth without recording eligibility or consent', async () => {
    const calls: { operation: string; input: any }[] = [];
    const db = { auth: {
      signUp: async (input: unknown) => { calls.push({ operation: 'signup', input }); return { error: null }; },
      signInWithOAuth: async (input: unknown) => { calls.push({ operation: 'oauth', input }); return { data: { url: 'https://provider.invalid/authorize' }, error: null }; },
    }, rpc: () => { throw new Error('Authentication must not record legal acceptance.'); }, from: () => { throw new Error('Authentication must not update the profile.'); } };
    const source = readFileSync(new URL('../src/app/auth/actions.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const modules: Record<string, unknown> = { 'next/cache': { revalidatePath: () => {} }, 'next/navigation': { redirect: (url: string) => { throw new Error(`redirect:${url}`); } }, '@/lib/auth/return-path': { safeReturnPath }, '@/lib/auth/foundation-path': { signupFoundationPath }, '@/lib/supabase/server': { createClient: async () => db } };
    const exports: Record<string, any> = {}; const nativeRequire = createRequire(import.meta.url);
    modules['next/headers']={headers:async()=>new Headers()};
    modules['@/lib/auth/redirect-origin']={authRedirectOrigin};
    vm.runInNewContext(compiled, { exports, require: (name: string) => modules[name] ?? nativeRequire(name), process: { env: { NEXT_PUBLIC_SITE_URL: 'https://nudge.test' } } });
    const form = new FormData(); form.set('email', 'fixture@example.invalid'); form.set('password', 'fixture-password');
    assert.ok((await exports.signUpWithEmail({}, form)).message);
    await assert.rejects(() => exports.signInWithGoogle(new FormData()), /redirect:https:\/\/provider.invalid\/authorize/);
    assert.deepEqual(calls.map(call => call.operation), ['signup', 'oauth']);
    assert.deepEqual(Object.keys(calls[0].input.options.data), ['full_name']);
    assert.doesNotMatch(JSON.stringify(calls), /age_eligible|terms_version|ai_consent/);
  });
});

describe('email delivery failures', () => {
  it('refuses disabled demo email signup before creating a client or contacting the provider', async () => {
    const source = readFileSync(new URL('../src/app/auth/actions.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const modules: Record<string, unknown> = {
      'next/cache': {}, 'next/navigation': {}, 'next/headers': {},
      '@/lib/auth/redirect-origin': {}, '@/lib/auth/return-path': {}, '@/lib/auth/foundation-path': {},
      '@/lib/supabase/server': { createClient: () => { throw new Error('Disabled signup must not create a client.'); } },
    };
    const exports: Record<string, any> = {};
    vm.runInNewContext(compiled, { exports, require: (name: string) => {
      assert.ok(name in modules, name); return modules[name];
    }, process: { env: { NEXT_PUBLIC_EMAIL_SIGNUP_ENABLED: 'false' } } });
    assert.equal((await exports.signUpWithEmail({}, new FormData())).error, 'Create your demo account with Google.');
  });
  it('explains sender restrictions and throttling without blaming the address or exposing provider details', async () => {
    let code = 'email_address_not_authorized';
    const failed = async () => ({ error: { code, message: 'private provider details' } });
    const source = readFileSync(new URL('../src/app/auth/actions.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const modules: Record<string, unknown> = {
      'next/cache': {}, 'next/navigation': {}, 'next/headers': { headers: async () => new Headers() },
      '@/lib/auth/redirect-origin': { authRedirectOrigin }, '@/lib/auth/return-path': { safeReturnPath },
      '@/lib/auth/foundation-path': { signupFoundationPath },
      '@/lib/supabase/server': { createClient: async () => ({ auth: { signUp: failed, resetPasswordForEmail: failed } }) },
    };
    const exports: Record<string, any> = {};
    vm.runInNewContext(compiled, { exports, require: (name: string) => {
      assert.ok(name in modules, name); return modules[name];
    }, process: { env: { NEXT_PUBLIC_SITE_URL: 'https://nudge.test' } } });
    const form = new FormData(); form.set('email', 'fixture@example.invalid'); form.set('password', 'fixture-password');
    const cases = [
      ['email_address_not_authorized', /temporarily limited.*Google/, /temporarily unavailable/],
      ['over_email_send_rate_limit', /busy.*later.*Google/, /Too many email requests.*later/],
      ['unexpected_failure', /Try again or continue with Google/, /Try again later/],
    ] as const;
    for (const [failure, signupMessage, resetMessage] of cases) {
      code = failure;
      const signup = await exports.signUpWithEmail({}, form), reset = await exports.requestPasswordReset({}, form);
      assert.match(signup.error, signupMessage); assert.match(reset.error, resetMessage);
      assert.doesNotMatch(JSON.stringify([signup, reset]), /different email|Check the address|private provider details/);
      assert.equal(signup.message, undefined); assert.equal(reset.message, undefined);
    }
  });
});
