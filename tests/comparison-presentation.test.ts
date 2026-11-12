import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { DecideClient } from "../src/app/(app)/ask/decide-client";
import type { CompareResult } from "../src/app/(app)/ask/actions";

it("renders and refreshes deterministic evidence without requesting an AI explanation", async () => {
  const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>", { url: "https://nudge.test/ask" });
  for (const [name, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator }))
    Object.defineProperty(globalThis, name, { value, configurable: true });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const result: CompareResult = { decisionId: "decision", title: "Dinner", category: "food", confidence: "high", evidenceState: "personal_fit", coldStart: false, status: "open", options: [
    { id: "a", label: "Soup", score: .8, breakdown: {}, warning: false, reasons: ["You previously rated Soup 4 out of 5."] },
    { id: "b", label: "Pizza", score: .5, breakdown: {}, warning: false, reasons: ["No matching outcome recorded."] },
  ] };
  let explanations = 0, refreshes = 0;
  const root = createRoot(document.querySelector("main")!);
  try {
    await act(async () => root.render(createElement(DecideClient, { initialOptions: [], initialResult: result, actions: {
      compareOptions: async () => result, askNaturally: async () => result,
      refreshComparison: async () => { refreshes++; return result; },
      chooseOption: async () => ({}), abandonDecision: async () => {}, suggestOptions: async () => [],
      explainDecision: async () => { explanations++; return null; },
    } })));
    assert.match(document.body.textContent ?? "", /larger relative-fit score gap/);
    assert.match(document.body.textContent ?? "", /not a probability of a good outcome/);
    assert.match(document.body.textContent ?? "", /You previously rated Soup 4 out of 5/);
    assert.doesNotMatch(document.body.textContent ?? "", /In plain words|Roll the dice|Confident/);
    const refresh = [...document.querySelectorAll("button")].find(x => x.textContent?.includes("Refresh with current memory"))!;
    await act(async () => refresh.click());
    assert.equal(refreshes, 1);
    assert.equal(explanations, 0);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

it("does not show scores or favor an option when a legacy comparison has no evidence state", () => {
  const legacy: CompareResult = { decisionId: "legacy", title: "Old dinner", category: "food", confidence: "high", coldStart: false, status: "open", options: [
    { id: "a", label: "Soup", score: .9, breakdown: {}, warning: false, reasons: ["Saved relative fit score. Refresh to compare against your current memory."] },
    { id: "b", label: "Pizza", score: .5, breakdown: {}, warning: false, reasons: ["Saved relative fit score. Refresh to compare against your current memory."] },
  ] };
  const html = renderToStaticMarkup(createElement(DecideClient, { initialOptions: [], initialResult: legacy }));
  assert.match(html, /not enough relevant evidence/);
  assert.match(html, /insufficient evidence/);
  assert.match(html, /Refresh with current memory/);
  assert.doesNotMatch(html, /Higher relative fit|relative fit \/ 100|larger relative-fit score gap|animate-grow-x/);
});
