import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { ReminderControls } from "../src/app/(app)/history/reminder-controls";
import type { ReminderState } from "../src/lib/services/reminder-save";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://nudge.test/history" });
for (const [name, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator }))
  Object.defineProperty(globalThis, name, { value, configurable: true });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
const decisionId = "00000000-0000-4000-8000-000000000001";
const props = { decisionId, dueAt: null, enabled: true };
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === name)!;
async function render(overrides: Partial<Parameters<typeof ReminderControls>[0]> = {}) {
  if (!root) {
    const { createRoot } = await import("react-dom/client"); const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  }
  await act(async () => root!.render(createElement(ReminderControls, { ...props, ...overrides })));
}
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); });
function change(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

describe("reminder interaction serialization and recovery", () => {
  it("blocks immediate repeat clicks before rerender and disables editable time while saving", async () => {
    let calls = 0, finish!: (value: { error?: string }) => void;
    await render({ saveAction: async () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
    const tomorrow = button("Tomorrow"); await act(async () => { tomorrow.click(); tomorrow.click(); });
    assert.equal(calls, 1); assert.equal(document.querySelector<HTMLInputElement>("input")!.disabled, true);
    assert.equal(button("Turn off").disabled, true);
    await act(async () => finish({ error: "Retry this check-in." }));
    assert.match(document.body.textContent!, /Retry this check-in/); assert.equal(button("Tomorrow").disabled, false);
  });
  it("retains a custom draft after a failed save and applies the confirmed server state on retry", async () => {
    const tomorrow = new Date(Date.now() + 86400000); tomorrow.setSeconds(0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    const local = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth()+1)}-${pad(tomorrow.getDate())}T${pad(tomorrow.getHours())}:${pad(tomorrow.getMinutes())}`;
    const sent: unknown[][] = []; let fail = true;
    await render({ saveAction: async (...args) => { sent.push(args); if (fail) return { error: "Temporary failure" };
      return { reminder: { decisionId, enabled: true, dueAt: args[1], reminderVersion: 5 } }; } });
    await act(async () => change(local)); await act(async () => button("Set custom check-in").click());
    assert.equal(document.querySelector<HTMLInputElement>("input")!.value, local); assert.match(document.body.textContent!, /Temporary failure/);
    fail = false; await act(async () => button("Set custom check-in").click());
    assert.equal(sent.length, 2); assert.equal(sent[0][0], decisionId); assert.equal(sent[0][1], tomorrow.toISOString()); assert.deepEqual(sent[0], sent[1]);
    assert.match(document.body.textContent!, /Check-in scheduled/); assert.equal(document.querySelector<HTMLInputElement>("input")!.value, local);
  });
  it("refreshes visible stored state when server props change without erasing a custom draft", async () => {
    const saveAction = async () => ({}); await render({ saveAction });
    await act(async () => change("2026-11-01T12:00")); assert.match(document.body.textContent!, /Tomorrow by default/);
    await render({ enabled: false, dueAt: null, saveAction });
    assert.match(document.body.textContent!, /Reminders are off/); assert.equal(document.querySelector<HTMLInputElement>("input")!.value, "2026-11-01T12:00");
  });
});

describe("thin web reminder action", () => {
  function harness(options: { user?: boolean; error?: boolean } = {}) {
    const source = readFileSync(new URL("../src/app/(app)/history/reminder-actions.ts", import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const calls: unknown[][] = [], paths: string[] = [], db = { auth: { getUser: async () => ({ data: { user: options.user === false ? null : { id: "verified-owner" } } }) } };
    const reminder: ReminderState = { decisionId, enabled: false, dueAt: null, reminderVersion: 7 };
    const modules: Record<string, unknown> = { "next/cache": { revalidatePath: (path: string) => paths.push(path) }, "@/lib/supabase/server": { createClient: async () => db },
      "@/lib/services/reminder-save": { saveReminder: async (...args: unknown[]) => { calls.push(args); return options.error ? { ok: false, message: "Reload this decision." } : { ok: true, reminder }; } } };
    const exports: Record<string, any> = {};
    vm.runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(Object.hasOwn(modules, name)); return modules[name]; } });
    return { action: exports.scheduleReflection, calls, paths, db, reminder };
  }
  it("uses the shared service with verified ownership and revalidates only after confirmation", async () => {
    const h = harness(), result = await h.action(decisionId, null, false);
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0][0], h.db); assert.equal(h.calls[0][1], "verified-owner");
    assert.equal(JSON.stringify(h.calls[0][2]), JSON.stringify({ decisionId, dueAt: null, enabled: false }));
    assert.equal(result.reminder, h.reminder); assert.deepEqual(h.paths, ["/history", "/notifications", "/dashboard", "/ask"]);
  });
  it("does not save unauthenticated requests or claim success/cache invalidation after a required failure", async () => {
    const anonymous = harness({ user: false }); assert.match((await anonymous.action(decisionId, null, false)).error, /signed in/); assert.equal(anonymous.calls.length, 0); assert.deepEqual(anonymous.paths, []);
    const failed = harness({ error: true }); assert.equal((await failed.action(decisionId, null, false)).error, "Reload this decision."); assert.equal(failed.calls.length, 1); assert.deepEqual(failed.paths, []);
  });
});
