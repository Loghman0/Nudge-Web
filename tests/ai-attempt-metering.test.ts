import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createOpenAiCompatibleProvider } from "../src/lib/services/ai/openai-compatible";
import { anthropicProvider } from "../src/lib/services/ai/anthropic";
import { createNvidiaProvider, NVIDIA_MODELS } from "../src/lib/services/ai/nvidia";
import { AiAccountingError, readAiUsage } from "../src/lib/services/ai/attempt-meter";
import type { AiAttemptAccounting, AiAttemptDescriptor, AiAttemptResult } from "../src/lib/services/ai/provider";

const originalFetch = globalThis.fetch;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
});

const compatible = () => createOpenAiCompatibleProvider({ name: "test", baseUrl: "https://test.invalid", apiKey: "private-key", model: "fixture-model", maxTokens: 700 });
const question = { category: "food", intent: "Dinner", constraints: {} };
const answer = (value: unknown, usage?: unknown) => Response.json({ choices: [{ message: { content: typeof value === "string" ? value : JSON.stringify(value) } }], ...(usage === undefined ? {} : { usage }) });

function recordedAccounting() {
  const reservations: AiAttemptDescriptor[] = [];
  const finished: { id: string; result: AiAttemptResult }[] = [];
  const accounting: AiAttemptAccounting = {
    async reserve(attempt) { reservations.push(attempt); return `attempt-${reservations.length}`; },
    async finish(id, result) { finished.push({ id, result }); },
  };
  return { accounting, reservations, finished };
}

describe("AI HTTP attempt accounting", () => {
  it("reserves before sending and records only bounded wire metadata and actual usage", async () => {
    const recorded = recordedAccounting();
    let actualInputBytes = 0;
    globalThis.fetch = async (_url, options) => {
      assert.equal(recorded.reservations.length, 1);
      assert.equal(recorded.finished.length, 0);
      actualInputBytes = new TextEncoder().encode(String(options?.body)).byteLength;
      return answer(question, { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20 });
    };
    assert.equal((await compatible().parseQuestion("private input ☃", { accounting: recorded.accounting })).category, "food");
    assert.deepEqual(recorded.reservations, [{ provider: "test", model: "fixture-model", inputBytes: actualInputBytes, outputTokenLimit: 700 }]);
    assert.deepEqual(recorded.finished, [{ id: "attempt-1", result: {
      ...recorded.reservations[0], status: "succeeded", httpStatus: 200,
      usage: { inputTokens: 13, outputTokens: 7, totalTokens: 20 },
    } }]);
    assert.doesNotMatch(JSON.stringify(recorded.finished), /private input|private-key|Dinner|messages|content/);
  });

  it("leaves absent usage unknown and preserves genuine zero token counts", async () => {
    const recorded = recordedAccounting();
    globalThis.fetch = async () => answer(question);
    await compatible().parseQuestion("Dinner", { accounting: recorded.accounting });
    assert.deepEqual(recorded.finished[0].result.usage, { inputTokens: null, outputTokens: null, totalTokens: null });
    assert.deepEqual(readAiUsage({ usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }, "openai"), { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    assert.deepEqual(readAiUsage({ usage: { prompt_tokens: -1, completion_tokens: "2", total_tokens: Number.MAX_SAFE_INTEGER + 1 } }, "openai"), { inputTokens: null, outputTokens: null, totalTokens: null });
    assert.deepEqual(readAiUsage({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 1000 } }, "openai"), { inputTokens: 10, outputTokens: 5, totalTokens: 1000, costMayDiffer: true });
    assert.deepEqual(readAiUsage({ usage: { prompt_tokens: 10, completion_tokens: 5 } }, "openai"), { inputTokens: 10, outputTokens: 5, totalTokens: null });
  });

  it("keeps provider extensions from changing the billed model or requesting extra completions", async () => {
    const recorded = recordedAccounting();
    globalThis.fetch = async (_url, options) => {
      const payload = JSON.parse(String(options?.body));
      assert.equal(payload.model, recorded.reservations[0].model);
      assert.equal(payload.model, "fixture-model");
      assert.equal(payload.max_tokens, recorded.reservations[0].outputTokenLimit);
      assert.equal(payload.max_tokens, 700);
      assert.equal(payload.n, undefined, "omit n to use the single completion default across compatible providers");
      assert.equal(payload.max_completion_tokens, undefined);
      assert.equal(payload.stream, false);
      assert.equal(payload.messages[1].content, "Dinner");
      assert.deepEqual(payload.chat_template_kwargs, { enable_thinking: false });
      return answer(question);
    };
    await createOpenAiCompatibleProvider({ name: "test", baseUrl: "https://test.invalid", apiKey: "private-key", model: "fixture-model", maxTokens: 700,
      extraBody: { model: "unpriced-model", n: 9, max_tokens: 9000, max_completion_tokens: 9000, stream: true, messages: [], chat_template_kwargs: { enable_thinking: false } },
    }).parseQuestion("Dinner", { accounting: recorded.accounting });
    assert.equal(recorded.finished.length, 1);
  });

  it("records a billed HTTP success before malformed language content is rejected", async () => {
    for (const content of ["invalid json", "", "<think>private response</think>"]) {
      const recorded = recordedAccounting();
      globalThis.fetch = async () => answer(content, { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 });
      await assert.rejects(compatible().parseQuestion("Dinner", { accounting: recorded.accounting }));
      assert.equal(recorded.finished.length, 1);
      assert.equal(recorded.finished[0].result.status, "succeeded");
      assert.equal(recorded.finished[0].result.usage.totalTokens, 14);
    }
  });

  it("records HTTP failures and supplied usage without response bodies", async () => {
    const recorded = recordedAccounting();
    globalThis.fetch = async () => Response.json({ error: "private vendor details", usage: { prompt_tokens: 2, completion_tokens: 0, total_tokens: 2 } }, { status: 429 });
    await assert.rejects(compatible().parseQuestion("private question", { accounting: recorded.accounting }), /429/);
    assert.equal(recorded.finished[0].result.status, "failed");
    assert.equal(recorded.finished[0].result.httpStatus, 429);
    assert.equal(recorded.finished[0].result.usage.totalTokens, 2);
    assert.doesNotMatch(JSON.stringify(recorded.finished), /private/);
  });

  it("finalizes malformed HTTP JSON and network failures with unknown usage", async () => {
    for (const failure of ["json", "network"]) {
      const recorded = recordedAccounting();
      globalThis.fetch = async () => {
        if (failure === "network") throw new Error("private network error details");
        return new Response("private malformed JSON", { status: 200 });
      };
      await assert.rejects(compatible().parseQuestion("Dinner", { accounting: recorded.accounting }));
      assert.equal(recorded.finished.length, 1);
      assert.equal(recorded.finished[0].result.status, "failed");
      assert.equal(recorded.finished[0].result.httpStatus, failure === "json" ? 200 : null);
      assert.deepEqual(recorded.finished[0].result.usage, { inputTokens: null, outputTokens: null, totalTokens: null });
      assert.doesNotMatch(JSON.stringify(recorded.finished), /private/);
    }
  });

  it("meters Anthropic usage before answer validation", async () => {
    process.env.ANTHROPIC_API_KEY = "private-key";
    const recorded = recordedAccounting();
    globalThis.fetch = async () => Response.json({ content: [], usage: { input_tokens: 9, output_tokens: 4 } });
    await assert.rejects(anthropicProvider.parseQuestion("Dinner", { accounting: recorded.accounting }));
    assert.equal(recorded.reservations[0].provider, "anthropic");
    assert.equal(recorded.reservations[0].model, "claude-sonnet-4-6");
    assert.equal(recorded.reservations[0].outputTokenLimit, 600);
    assert.deepEqual(recorded.finished[0].result.usage, { inputTokens: 9, outputTokens: 4, totalTokens: 13 });
    assert.equal(recorded.finished[0].result.status, "succeeded");
    assert.deepEqual(readAiUsage({ usage: { input_tokens: 9, output_tokens: 4, cache_creation_input_tokens: 12, cache_read_input_tokens: 3 } }, "anthropic"), { inputTokens: 24, outputTokens: 4, totalTokens: 28, costMayDiffer: true });
  });

  it("denies requests before sending when reservation is refused or unavailable", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return answer(question); };
    for (const fail of [false, true]) {
      const accounting: AiAttemptAccounting = {
        async reserve() { if (fail) throw new Error("private database details"); return null; },
        async finish() { assert.fail("no reserved attempt to finish"); },
      };
      await assert.rejects(createNvidiaProvider({ NVIDIA_API_KEY: "test" })!.parseQuestion("Dinner", { accounting }), AiAccountingError);
    }
    assert.equal(calls, 0);
  });

  it("awaits completion accounting before returning a successful response", async () => {
    let releaseFinish!: () => void;
    let enteredFinish!: () => void;
    const finishEntered = new Promise<void>(resolve => { enteredFinish = resolve; });
    const finishGate = new Promise<void>(resolve => { releaseFinish = resolve; });
    let resolved = false;
    globalThis.fetch = async () => answer(question);
    const request = compatible().parseQuestion("Dinner", { accounting: {
      async reserve() { return "attempt-1"; },
      async finish() { enteredFinish(); await finishGate; },
    } }).then(value => { resolved = true; return value; });
    await finishEntered;
    assert.equal(resolved, false);
    releaseFinish();
    await request;
    assert.equal(resolved, true);
  });

  it("individually meters NVIDIA fallbacks, including malformed structured output", async () => {
    const recorded = recordedAccounting();
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      assert.equal(recorded.reservations.length, calls);
      assert.equal(recorded.finished.length, calls - 1);
      return answer(calls === 1 ? "malformed json" : question, { prompt_tokens: calls * 5, completion_tokens: 1, total_tokens: calls * 5 + 1 });
    };
    await createNvidiaProvider({ NVIDIA_API_KEY: "test" })!.parseQuestion("Dinner", { accounting: recorded.accounting });
    assert.deepEqual(recorded.reservations.map(item => item.model), [NVIDIA_MODELS.lightning, NVIDIA_MODELS.gemma]);
    assert.deepEqual(recorded.finished.map(item => item.result.usage.totalTokens), [6, 11]);
    assert.equal(calls, 2);
  });

  it("waits for failed-attempt finalization before starting a fallback", async () => {
    let calls = 0;
    let enteredFinish!: () => void;
    let releaseFinish!: () => void;
    const finishEntered = new Promise<void>(resolve => { enteredFinish = resolve; });
    const finishGate = new Promise<void>(resolve => { releaseFinish = resolve; });
    globalThis.fetch = async () => ++calls === 1 ? new Response("", { status: 500 }) : answer(question);
    const request = createNvidiaProvider({ NVIDIA_API_KEY: "test" })!.parseQuestion("Dinner", { accounting: {
      async reserve() { return `attempt-${calls + 1}`; },
      async finish() { if (calls === 1) { enteredFinish(); await finishGate; } },
    } });
    await finishEntered;
    assert.equal(calls, 1);
    releaseFinish();
    await request;
    assert.equal(calls, 2);
  });

  it("stops all fallback requests when finalization fails", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response("", { status: 500 }); };
    await assert.rejects(createNvidiaProvider({ NVIDIA_API_KEY: "test" })!.parseQuestion("Dinner", { accounting: {
      async reserve() { return "attempt-1"; },
      async finish() { throw new Error("private database details"); },
    } }), AiAccountingError);
    assert.equal(calls, 1);
  });

  it("records an aborted in-flight request and never retries it", async () => {
    const recorded = recordedAccounting();
    const controller = new AbortController();
    let calls = 0;
    let enteredFetch!: () => void;
    let didFinish!: () => void;
    const fetchEntered = new Promise<void>(resolve => { enteredFetch = resolve; });
    const finishCompleted = new Promise<void>(resolve => { didFinish = resolve; });
    const accounting: AiAttemptAccounting = { ...recorded.accounting, async finish(id, result) { await recorded.accounting.finish(id, result); didFinish(); } };
    globalThis.fetch = async (_url, options) => {
      calls++;
      enteredFetch();
      return new Promise<Response>((_resolve, reject) => options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true }));
    };
    const request = createNvidiaProvider({ NVIDIA_API_KEY: "test" })!.parseQuestion("Dinner", { accounting, signal: controller.signal });
    await fetchEntered;
    controller.abort();
    await assert.rejects(request, { name: "AbortError" });
    await finishCompleted;
    assert.equal(calls, 1);
    assert.equal(recorded.finished[0].result.status, "aborted");
    assert.equal(recorded.finished[0].result.httpStatus, null);
  });

  it("finalizes a reservation granted after cancellation without sending a request", async () => {
    const controller = new AbortController();
    let releaseReserve!: () => void;
    let reserveEntered!: () => void;
    let didFinish!: (result: AiAttemptResult) => void;
    const reserveGate = new Promise<void>(resolve => { releaseReserve = resolve; });
    const entered = new Promise<void>(resolve => { reserveEntered = resolve; });
    const finished = new Promise<AiAttemptResult>(resolve => { didFinish = resolve; });
    let calls = 0;
    globalThis.fetch = async () => { calls++; return answer(question); };
    const request = compatible().parseQuestion("Dinner", { signal: controller.signal, accounting: {
      async reserve() { reserveEntered(); await reserveGate; return "attempt-1"; },
      async finish(_id, result) { didFinish(result); },
    } });
    await entered;
    controller.abort();
    await assert.rejects(request, { name: "AbortError" });
    releaseReserve();
    assert.equal((await finished).status, "aborted");
    assert.equal(calls, 0);
  });
});
