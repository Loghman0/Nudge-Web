import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { ReflectionForm } from "../src/app/(app)/history/reflection-form";
import { parseReflectionInput, type ReflectionInput } from "../src/lib/services/reflection-input";
import { saveReflection } from "../src/lib/services/reflection-save";

const decisionId = "00000000-0000-4000-8000-000000000001";

describe("honest quick reflection input", () => {
  it("preserves a rating without inventing optional answers", () => {
    assert.deepEqual(parseReflectionInput({ decisionId, rating: 4 }).value, {
      decisionId, rating: 4, wouldRepeat: null, hasRegrets: null,
      wouldRecommend: null, wouldChooseAgain: null, notes: "",
    });
    assert.ok(parseReflectionInput({ decisionId, wouldChooseAgain: true }).error);
  });
  it("rejects malformed, fractional and out-of-range answers rather than coercing them", () => {
    for (const input of [null, [], {}, { decisionId, rating: "4" }, { decisionId, rating: 3.6 },
      { decisionId, rating: 0 }, { decisionId, rating: 6 }, { decisionId, rating: NaN },
      { decisionId, rating: 4, hasRegrets: "false" }, { decisionId, rating: 4, notes: {} },
      { decisionId, rating: 4, notes: "x".repeat(501) }]) assert.ok(parseReflectionInput(input).error);
    assert.equal(parseReflectionInput({ decisionId, rating: 4, notes: "  Useful  " }).value?.notes, "Useful");
  });
});

function actionHarness(options: { user?: boolean; achievementFailure?: boolean; saveFailure?: boolean; selected?: boolean } = {}) {
  const calls: { name: string; params: unknown }[] = [];
  const filters: unknown[][] = [];
  const paths: string[] = [];
  let aiCalls = 0;
  let clients = 0;
  const query = {
    select: () => query,
    eq: (...args: unknown[]) => { filters.push(args); return query; },
    maybeSingle: async () => ({ data: { category: "food", selected_option_id: options.selected === false ? null : "option",
      decision_options: [{ id: "option", label: "Soup" }] }, error: null }),
  };
  const source = readFileSync(new URL("../src/app/(app)/history/actions.ts", import.meta.url), "utf8");
  const body = stripTypeScriptTypes(source).replace(/^import .+;$/gm, "").replaceAll("export async function", "async function");
  const context = vm.createContext({ parseReflectionInput, saveReflection, console,
    revalidatePath: (path: string) => paths.push(path),
    createClient: async () => {
      clients++;
      return {
        auth: { getUser: async () => ({ data: { user: options.user === false ? null : { id: "verified-owner" } } }) },
        from: () => query,
        rpc: async (name: string, params: unknown) => {
          calls.push({ name, params });
          if (name === "evaluate_achievements" && options.achievementFailure) throw new Error("Transient optional failure");
          return name === "submit_decision_reflection"
            ? { data: options.saveFailure ? null : [{ saved: true, memory_generation: 1 }], error: options.saveFailure ? { message: "conflict" } : null }
            : { data: null, error: null };
        },
      };
    },
    // Keep the former extraction dependencies instrumented so bringing AI back
    // into the real action fails this behavioral regression, even after consent.
    getAi: () => { aiCalls++; return { extractMemories: async () => [] }; },
    aiAllowed: async () => true, reserveAiRequest: async () => true,
    checkRateLimit: () => ({ allowed: true }), AI_LIMITS: { extract: { limit: 10, windowMs: 3600000 } },
    withAiDeadline: async (run: (signal: AbortSignal) => unknown) => run(new AbortController().signal),
  });
  vm.runInContext(body + "\nglobalThis.save = submitReflection;", context);
  return { save: context.save as (input: unknown) => Promise<{ error?: string }>, calls, filters, paths,
    get aiCalls() { return aiCalls; }, get clients() { return clients; } };
}

describe("reflection save boundaries", () => {
  it("saves substantial journal notes without any AI request and keeps verified ownership", async () => {
    const harness = actionHarness();
    const notes = "This outcome was useful. I want to remember these specific details next time.";
    assert.equal((await harness.save({ decisionId, rating: 4, notes, user_id: "forged" })).error, undefined);
    assert.equal(harness.aiCalls, 0);
    assert.deepEqual(harness.calls.map(call => call.name), ["submit_decision_reflection", "evaluate_achievements"]);
    assert.deepEqual(harness.filters, [["id", decisionId], ["user_id", "verified-owner"]]);
    assert.deepEqual(JSON.parse(JSON.stringify(harness.calls[0].params)), {
      p_decision_id: decisionId, p_rating: 4, p_would_repeat: null, p_has_regrets: null,
      p_would_recommend: null, p_would_choose_again: null, p_notes: notes, p_key: "learned.food.soup",
    });
    assert.deepEqual(harness.paths, ["/history", "/dashboard"]);
  });
  it("acknowledges a committed outcome even when optional achievements fail", async () => {
    const harness = actionHarness({ achievementFailure: true });
    assert.equal((await harness.save({ decisionId, rating: 3 })).error, undefined);
    assert.equal(harness.paths.length, 2);
  });
  it("does not save unauthenticated, malformed or unchosen decisions", async () => {
    const malformed = actionHarness();
    assert.ok((await malformed.save(null)).error); assert.equal(malformed.clients, 0);
    for (const options of [{ user: false }, { selected: false }]) {
      const harness = actionHarness(options);
      assert.ok((await harness.save({ decisionId, rating: 4 })).error);
      assert.equal(harness.calls.length, 0);
    }
  });
  it("keeps a conflicting save visible and does not report success", async () => {
    const harness = actionHarness({ saveFailure: true });
    assert.ok((await harness.save({ decisionId, rating: 4 })).error);
    assert.equal(harness.paths.length, 0);
    assert.equal(harness.calls.length, 1);
  });
});

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "https://nudge.test/history" });
for (const [name, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator }))
  Object.defineProperty(globalThis, name, { value, configurable: true });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); });
async function mount(saveAction: NonNullable<Parameters<typeof ReflectionForm>[0]["saveAction"]>) {
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(createElement(ReflectionForm, { decisionId, saveAction })));
}
const saveButton = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Save reflection") || button.textContent?.includes("Saving"))!;

describe("quick reflection interaction", () => {
  it("saves from the single rating question while optional details remain collapsed", async () => {
    const inputs: ReflectionInput[] = [];
    await mount(async input => { inputs.push(input); return {}; });
    assert.equal(document.querySelector("details")!.open, false);
    assert.equal(saveButton().disabled, true);
    await act(async () => document.querySelector<HTMLInputElement>('input[value="4"]')!.click());
    await act(async () => saveButton().click());
    assert.deepEqual(inputs, [{ decisionId, rating: 4, wouldRepeat: null, hasRegrets: null, wouldRecommend: null, wouldChooseAgain: null, notes: "" }]);
    assert.match(document.querySelector('[role="status"]')!.textContent!, /Saved/);
  });
  it("locks in-flight input, ignores double taps and preserves the rating after a failed request", async () => {
    let calls = 0; let finish!: (result: { error?: string }) => void;
    await mount(async () => { calls++; return new Promise(resolve => { finish = resolve; }); });
    await act(async () => document.querySelector<HTMLInputElement>('input[value="2"]')!.click());
    await act(async () => { saveButton().click(); saveButton().click(); });
    assert.equal(calls, 1);
    assert.ok([...document.querySelectorAll("fieldset")].every(fieldset => fieldset.disabled));
    await act(async () => finish({ error: "Connection lost. Try again." }));
    assert.match(document.querySelector('[role="alert"]')!.textContent!, /Connection lost/);
    assert.equal(document.querySelector<HTMLInputElement>('input[value="2"]')!.checked, true);
    assert.equal(saveButton().disabled, false);
    await act(async () => saveButton().click()); assert.equal(calls, 2);
    await act(async () => finish({}));
  });
});
