import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { DecideClient } from "../src/app/(app)/ask/decide-client";
import type { CompareContext, CompareResult } from "../src/app/(app)/ask/actions";
import { assessCriteria, type ComparisonCriterion } from "../src/lib/services/comparison-criteria";
import { draftUnderstanding } from "../src/lib/services/decision-understanding";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://nudge.test/ask" });
for (const [name, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator }))
  Object.defineProperty(globalThis, name, { value, configurable: true });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const originalFetch = globalThis.fetch;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); globalThis.fetch = originalFetch; });
async function mount(props: Parameters<typeof DecideClient>[0]) {
  globalThis.fetch = async () => Response.json({ generation: 0, suggestions: [] });
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(createElement(DecideClient, props)));
}
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === name)!;
const summary = (name: string) => [...document.querySelectorAll<HTMLElement>("summary")].find(value => value.textContent === name);
const rows = () => [...document.querySelectorAll<HTMLLegendElement>("legend")].filter(value => /^Criterion \d+$/.test(value.textContent ?? ""));
const reviewCheckbox = () => [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(value => value.parentElement?.textContent?.includes("I reviewed these values"))!;
const result: CompareResult = { decisionId: "fixture", title: "Walk or bus", category: "travel", confidence: "low", coldStart: true, status: "open", evidenceState: "insufficient", options: [
  { id: "walk", label: "Walk", score: .5, breakdown: {}, reasons: [], warning: false },
  { id: "bus", label: "Bus", score: .5, breakdown: {}, reasons: [], warning: false },
] };
type Actions = NonNullable<Parameters<typeof DecideClient>[0]["actions"]>;
const actions = (overrides: Partial<Actions> = {}): Actions => ({ compareOptions: async () => result, askNaturally: async () => result,
  refreshComparison: async () => result, chooseOption: async () => ({}), abandonDecision: async () => {}, explainDecision: async () => null, suggestOptions: async () => [], ...overrides });

describe("explicit mood priorities in the web comparison", () => {
  it("keeps the eight emotion choices optional journal context without changing history comparison inputs", async () => {
    const contexts: CompareContext[] = [];
    await mount({ initialOptions: ["Walk", "Bus"], actions: actions({ compareOptions: async (_options, _title, context) => {
      contexts.push(context ?? {}); return { ...result, error: "Fixture stopped before save" };
    } }) });
    await act(async () => summary("Add a journal note (optional)")!.click());
    const moodField = [...document.querySelectorAll<HTMLLegendElement>("legend")].find(value => value.textContent === "Current mood (optional)")!.parentElement!;
    assert.deepEqual([...moodField.querySelectorAll("button")].map(value => value.textContent), ["Happy", "Excited", "Calm", "Sad", "Angry", "Anxious", "Tired", "Mixed"]);
    await act(async () => button("Angry").click());
    assert.equal(contexts.length, 0); assert.equal(rows().length, 0); assert.equal(summary("Consider my current mood"), undefined);
    assert.match(moodField.textContent!, /Mood is journal context/);
    await act(async () => button("Compare 2 options").click());
    assert.equal(contexts[0].mood, "Angry"); assert.equal(contexts[0].comparisonBasis, "journal"); assert.equal(contexts[0].criteria, undefined);
    await act(async () => button("Angry").click()); await act(async () => button("Compare 2 options").click());
    assert.equal(contexts[1].mood, undefined);
  });

  it("requires each priority to be chosen, keeps its values unknown and resets confirmation when adding another", async () => {
    const contexts: CompareContext[] = [];
    await mount({ initialOptions: ["Walk", "Bus"], seed: { options: ["Walk", "Bus"], title: "", context: { comparisonBasis: "criteria", domain: "Everyday life", mood: "Tired" } },
      actions: actions({ compareOptions: async (_options, _title, context) => {
        contexts.push(context ?? {});
        return context?.meaningConfirmed ? { ...result, error: "Fixture stopped before save" }
          : { ...result, decisionId: "", clarification: draftUnderstanding("", ["Walk", "Bus"]) };
      } }) });
    const choices = summary("Consider my current mood")!;
    assert.equal((choices.parentElement as HTMLDetailsElement).open, false); assert.equal(rows().length, 0);
    await act(async () => choices.click()); assert.equal(rows().length, 0); assert.equal(contexts.length, 0);
    await act(async () => button("Add Effort needed").click());
    assert.equal(rows().length, 1); assert.equal(button("Add Effort needed").disabled, true); assert.equal(reviewCheckbox().checked, false);
    assert.equal(document.querySelector<HTMLInputElement>('input[placeholder="e.g. Time needed"]')!.value, "Effort needed");
    const unknowns = [...document.querySelectorAll<HTMLInputElement>('input[placeholder="Unknown"]')];
    assert.equal(unknowns.length, 2); assert.ok(unknowns.every(value => value.value === ""));
    await act(async () => reviewCheckbox().click()); assert.equal(reviewCheckbox().checked, true);
    await act(async () => summary("Add a journal note (optional)")!.click()); await act(async () => button("Angry").click());
    assert.equal(rows().length, 1); assert.equal(contexts.length, 0); assert.equal(reviewCheckbox().checked, true);
    await act(async () => button("Add Flexibility to change plans").click());
    assert.equal(rows().length, 2); assert.equal(reviewCheckbox().checked, false); assert.equal(contexts.length, 0);
    await act(async () => button("Compare 2 options").click());
    await act(async () => reviewCheckbox().click()); await act(async () => button("Compare options").click());
    const saved = contexts.at(-1)!; assert.equal(saved.criteriaConfirmed, true); assert.equal(saved.mood, "Angry");
    const criteria = saved.criteria as ComparisonCriterion[];
    assert.equal(criteria.length, 2); assert.deepEqual(criteria.map(value => value.label), ["Effort needed", "Flexibility to change plans"]);
    assert.deepEqual(criteria.map(value => value.direction), ["lower", "higher"]);
    for (const value of criteria) {
      assert.match(value.id, /^[0-9a-f-]{36}$/i); assert.equal(value.weight, 3); assert.equal(value.low, 0); assert.equal(value.high, 10); assert.equal(value.unit, "points");
      assert.deepEqual(value.values, { Walk: { value: null }, Bus: { value: null } }); assert.equal(value.discoverySuggestion, undefined);
    }
    assert.equal(assessCriteria(criteria, ["Walk", "Bus"]).outcome, "uncertain");
    assert.equal(assessCriteria(criteria, ["Walk", "Bus"]).leader, null);
  });

  it("retains a copied legacy mood verbatim and never adds priorities beyond the five-criterion limit", async () => {
    const existing: ComparisonCriterion[] = Array.from({ length: 5 }, (_, index) => ({ id: "existing-" + index, label: "Priority " + index,
      unit: "points", weight: 2, direction: "higher", low: 0, high: 10, values: { Walk: { value: null }, Bus: { value: null } } }));
    const contexts: CompareContext[] = [];
    await mount({ initialOptions: ["Walk", "Bus"], seed: { options: ["Walk", "Bus"], title: "", context: { comparisonBasis: "criteria", mood: "Relaxed", criteria: existing } },
      actions: actions({ compareOptions: async (_options, _title, context) => { contexts.push(context ?? {}); return { ...result, error: "Fixture stopped before save" }; } }) });
    await act(async () => summary("Add a journal note (optional)")!.click());
    assert.equal(button("Saved: Relaxed").getAttribute("aria-pressed"), "true"); assert.equal(summary("Consider my current mood"), undefined);
    await act(async () => button("Compare 2 options").click()); assert.equal(contexts[0].mood, "Relaxed");
    await act(async () => button("Tired").click()); await act(async () => summary("Consider my current mood")!.click());
    assert.equal(button("Add Effort needed").disabled, true); await act(async () => button("Add Effort needed").click()); assert.equal(rows().length, 5);
    assert.equal(document.querySelector<HTMLInputElement>('input[placeholder="e.g. Time needed"]')!.value, "Priority 0");
  });
});
