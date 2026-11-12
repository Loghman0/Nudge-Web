import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { afterEach, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { DecideClient } from "../src/app/(app)/ask/decide-client";
import type { CompareResult } from "../src/app/(app)/ask/actions";
import { parseComparisonInput } from "../src/lib/services/comparison-input";
import { draftUnderstanding } from "../src/lib/services/decision-understanding";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://nudge.test/ask" });
for (const [name, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator }))
  Object.defineProperty(globalThis, name, { value, configurable: true });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); });
async function mount(props: Parameters<typeof DecideClient>[0]) {
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(createElement(DecideClient, props)));
}
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.includes(name))!;
function change(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}
function isDisclosed(element: Element): boolean {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (node.tagName === "DETAILS" && !(node as HTMLDetailsElement).open && !node.querySelector(":scope > summary")?.contains(element)) return false;
  }
  return true;
}
const result: CompareResult = { decisionId: "decision", title: "My private world", category: "other", confidence: "low", evidenceState: "insufficient", coldStart: true, status: "open", options: [
  { id: "a", label: "Blue room", score: .5, breakdown: {}, warning: false, reasons: ["No relevant evidence."] },
  { id: "b", label: "Moon run", score: .5, breakdown: {}, warning: false, reasons: ["No relevant evidence."] },
] };
type Actions = NonNullable<Parameters<typeof DecideClient>[0]["actions"]>;
const actions = (overrides: Partial<Actions> = {}): Actions => ({ compareOptions: async () => result, askNaturally: async () => result,
  refreshComparison: async () => result, chooseOption: async () => ({}), abandonDecision: async () => {}, explainDecision: async () => null, suggestOptions: async () => [], ...overrides });

it("starts with only the option fields and keeps optional work behind labeled disclosures", async () => {
  await mount({ initialOptions: [], actions: actions() });
  const visibleInputs = [...document.querySelectorAll<HTMLInputElement>("input, textarea")].filter(isDisclosed);
  assert.equal(visibleInputs.length, 2);
  assert.equal(document.querySelector('[aria-label="Review decision meaning"]'), null);
  assert.equal(document.querySelector('[aria-label="My criteria and values"]'), null);
  assert.equal(document.querySelector('[aria-current="step"]')?.textContent, "1 · Options");
  assert.ok(button("Compare 2 options").disabled);
  const question = [...document.querySelectorAll("summary")].find(value => value.textContent === "Prefer to write a question?")!;
  await act(async () => question.click());
  assert.ok(isDisclosed(document.querySelector('input[placeholder="What should I eat tonight?"]')!));
});

it("preserves private meanings through Back and requires context before a confirmed save", async () => {
  let reads = 0, writes = 0; let saved: unknown;
  const api = actions({ compareOptions: async (_slots, _title, context) => {
    if (!context?.meaningConfirmed) { reads++; return { ...result, decisionId: "", clarification: { options: ["Blue room", "Moon run"], category: "other", domain: "", goal: "", source: "manual", unfamiliarTerms: [], question: "What setting?", notice: "Review first." } }; }
    writes++; saved = context; return { ...result, meaning: context };
  } });
  await mount({ initialOptions: ["Blue room", "Moon run"], actions: api });
  await act(async () => button("Compare 2 options").click());
  assert.equal(reads, 1); assert.equal(writes, 0);
  assert.equal(document.querySelector('[aria-current="step"]')?.textContent, "2 · Context");
  assert.equal(document.querySelectorAll('[aria-label="Review decision meaning"] input').length, 2);
  assert.ok(!isDisclosed(document.querySelector('input[placeholder="First option"]')!));
  await act(async () => button("Compare options").click());
  assert.equal(writes, 0); assert.match(document.querySelector('[role="alert"]')!.textContent!, /Name the setting/);
  await act(async () => change(document.querySelector<HTMLInputElement>('input[placeholder^="A game and version"]')!, "Our invented weekend game"));
  const definitions = document.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => change(definitions, "Blue room is our quiet planning session."));
  await act(async () => button("Back to options").click());
  assert.equal(document.querySelector<HTMLInputElement>('input[placeholder="First option"]')!.value, "Blue room");
  await act(async () => button("Compare 2 options").click());
  assert.equal(document.querySelector<HTMLInputElement>('input[placeholder^="A game and version"]')!.value, "Our invented weekend game");
  assert.equal(document.querySelector<HTMLTextAreaElement>("textarea")!.value, "Blue room is our quiet planning session.");
  await act(async () => button("Compare options").click());
  assert.equal(writes, 1);
  assert.equal((saved as { meaningConfirmed: boolean }).meaningConfirmed, true);
  assert.equal((saved as { optionDetails: Record<string, string> }).optionDetails["Moon run"], "");
  assert.match(document.body.textContent!, /not enough relevant evidence/);
});

it("offers a useful next step when evidence is absent without fabricating a ranking", async () => {
  await mount({ initialOptions: [], initialResult: result, actions: actions() });
  const link = [...document.querySelectorAll("a")].find(value => value.textContent === "Add criteria to this comparison")!;
  assert.equal(link.getAttribute("href"), "/ask?copy=decision&basis=criteria");
  assert.equal(document.querySelectorAll(".animate-grow-x").length, 0);
  assert.ok(button("Choose this"));
  const explanation = [...document.querySelectorAll("summary")].find(value => value.textContent === "How this comparison works")!;
  assert.equal((explanation.parentElement as HTMLDetailsElement).open, false);
  assert.match(explanation.parentElement!.textContent!, /not a probability of a good outcome/);
});

it("keeps duplicate names editable and opens context after the duplicate is corrected", async () => {
  let writes=0;
  const api=actions({compareOptions:async(options,title,context)=>{
    const parsed=parseComparisonInput(options,title,context);
    if(parsed.options===undefined)return {...result,decisionId:"",error:parsed.error};
    if(!parsed.context.meaningConfirmed)return {...result,decisionId:"",clarification:draftUnderstanding(title,parsed.options)};
    writes++;return result;
  }});
  await mount({initialOptions:["Tea","tea","Coffee"],actions:api});
  await act(async()=>button("Compare 3 options").click());
  assert.match(document.querySelector('[role="alert"]')!.textContent!,/Each option needs a different name/);
  assert.equal(document.querySelector('[aria-current="step"]')?.textContent,"1 · Options");
  assert.equal(document.querySelector<HTMLInputElement>('input[placeholder="First option"]')!.value,"Tea");
  const second=document.querySelector<HTMLInputElement>('input[placeholder="Second option"]')!;
  assert.equal(second.value,"tea");
  assert.equal(writes,0);
  await act(async()=>change(second,"Water"));
  await act(async()=>button("Compare 3 options").click());
  assert.equal(document.querySelector('[role="alert"]'),null);
  assert.equal(document.querySelector('[aria-current="step"]')?.textContent,"2 · Context");
  assert.equal(second.value,"Water");
  assert.equal(writes,0);
});

it("opens the criteria editor for a copied journal and after Back even when criteria are incomplete", async () => {
  let writes = 0;
  const api = actions({ compareOptions: async (options, title, context) => {
    const parsed = parseComparisonInput(options, title, context);
    if (parsed.options === undefined) return { ...result, decisionId: "", error: parsed.error };
    if (!parsed.context.meaningConfirmed) return { ...result, decisionId: "", clarification: draftUnderstanding(title, options) };
    writes++; return result;
  } });
  await mount({ initialOptions: ["Blue room", "Moon run"], seed: { options: ["Blue room", "Moon run"], title: "My private world",
    context: { domain: "Our invented weekend game", comparisonBasis: "criteria", optionDetails: { "Blue room": "Quiet planning" } } }, actions: api });
  await act(async () => button("Compare 2 options").click());
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.ok(button("Add criterion"));
  assert.equal(writes, 0);
  await act(async () => button("Compare options").click());
  assert.equal(writes, 0);
  assert.match(document.querySelector('[role="alert"]')!.textContent!, /Add between one and five criteria/);
  await act(async () => button("Add criterion").click());
  const nameField=()=>document.querySelector<HTMLInputElement>('input[placeholder="e.g. Time needed"]')!;
  await act(async()=>change(nameField(),"Synthetic preparation time"));
  assert.equal(nameField().value,"Synthetic preparation time");
  await act(async () => button("Back to options").click());
  assert.equal(nameField().value,"Synthetic preparation time");
  await act(async () => button("Compare 2 options").click());
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.ok([...document.querySelectorAll('legend')].some(legend => legend.textContent === 'Criterion 1'));
  assert.equal(nameField().value,"Synthetic preparation time");
  assert.equal(document.querySelector<HTMLInputElement>('input[placeholder^="A game and version"]')!.value, "Our invented weekend game");
  assert.equal(writes, 0);
});
