import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/types/database";
import { chooseDecision } from "../src/lib/services/decision-choice";
import { createChoicePostHandler } from "../src/lib/api/v1/choice-route";
import { createApiAuthenticator } from "../src/lib/api/v1/auth";

const decisionId = "00000000-0000-4000-8000-000000000001";
const optionId = "00000000-0000-4000-8000-000000000002";
const otherOptionId = "00000000-0000-4000-8000-000000000003";
const endpoint = `https://nudge.test/api/v1/decisions/${decisionId}/choice`;
const context = { params: Promise.resolve({ id: decisionId }) };

interface FixtureOptions {
  absent?: boolean; loadError?: boolean; missingOption?: boolean; status?: string; selected?: string | null;
  commitError?: { code: string; message: string }; throwCommit?: boolean;
  postReadError?: boolean; postReadMissing?: boolean; noCommit?: boolean; postSelected?: string; category?: string;
  user?: boolean; authFailure?: boolean; terms?: string; requireTerms?: boolean;
}
function fixture(options: FixtureOptions = {}) {
  let decisionReads = 0, cookieClients = 0;
  const filters: unknown[][] = [], tokens: (string | undefined)[] = [], tables: string[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const state = { status: options.status ?? "open", selected_option_id: options.selected ?? null };
  const query = {
    select: () => query,
    eq: (...args: unknown[]) => { filters.push(args); return query; },
    maybeSingle: async () => {
      decisionReads++;
      if (decisionReads === 1) return {
        data: options.absent ? null : { ...state, category: options.category ?? "food",
          decision_options: options.missingOption ? [] : [{ id: optionId, label: "Soup" }, { id: otherOptionId, label: "Pizza" }] },
        error: options.loadError ? { message: "Private database diagnostics" } : null,
      };
      return { data: options.postReadMissing ? null : { ...state, selected_option_id: options.postSelected ?? state.selected_option_id },
        error: options.postReadError ? { message: "Private confirmation diagnostics" } : null };
    },
  };
  const profile = { select: () => profile, eq: () => profile,
    maybeSingle: async () => ({ data: { terms_version: options.terms ?? "current" }, error: null }) };
  const client = {
    auth: { getUser: async (token?: string) => {
      tokens.push(token);
      return { data: { user: options.user === false ? null : { id: "verified-owner" } }, error: options.authFailure ? { status: 503 } : null };
    } },
    from: (table: string) => { tables.push(table); return table === "profiles" ? profile : query; },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (options.throwCommit) throw new Error("Private thrown diagnostics");
      if (!options.commitError && !options.noCommit && state.status === "open") {
        state.status = "decided"; state.selected_option_id = String(args.p_option_id);
      }
      return { data: null, error: options.commitError ?? null };
    },
  } as unknown as SupabaseClient<Database>;
  const authenticate = createApiAuthenticator({ cookieClient: async () => { cookieClients++; return client; }, bearerClient: () => client },
    { requireCurrentTerms: options.requireTerms ?? false, policyVersion: "current" });
  return { client, filters, rpcCalls, tokens, tables, post: createChoicePostHandler({ authenticate }),
    get reads() { return decisionReads; }, get cookies() { return cookieClients; } };
}
function request(raw: unknown = { optionId }, headers: Record<string, string> = {}) {
  return new Request(endpoint, { method: "POST", headers: { origin: "https://nudge.test", "content-type": "application/json", ...headers }, body: JSON.stringify(raw) });
}
async function read(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  const body = await response.json(); assert.equal(body.apiVersion, "1");
  assert.doesNotMatch(JSON.stringify(body), /Private .*diagnostics/);
  return body;
}

describe("shared atomic decision choice", () => {
  it("binds choice and learning to the verified owner's persisted option and confirms the saved state", async () => {
    const h = fixture(), result = await chooseDecision(h.client, "verified-owner", { decisionId, optionId });
    assert.deepEqual(result, { ok: true, decisionId, selectedOptionId: optionId, status: "decided" });
    assert.deepEqual(h.filters, [["id", decisionId], ["user_id", "verified-owner"], ["id", decisionId], ["user_id", "verified-owner"]]);
    assert.deepEqual(h.rpcCalls, [{ name: "commit_choice_and_learn", args: { p_decision_id: decisionId, p_option_id: optionId, p_key: "learned.food.soup" } }]);
  });

  it("acknowledges identical decided/reflected retries without claiming which request first committed", async () => {
    for (const status of ["decided", "reflected"] as const) {
      const h = fixture({ status, selected: optionId });
      assert.deepEqual(await chooseDecision(h.client, "verified-owner", { decisionId, optionId }), { ok: true, decisionId, selectedOptionId: optionId, status });
      assert.equal(h.rpcCalls.length, 1); assert.equal(h.rpcCalls[0].name, "commit_choice_and_learn");
    }
  });

  it("rejects malformed or caller-extended input before database access", async () => {
    for (const raw of [null, [], {}, { decisionId, optionId: "not-a-uuid" }, { decisionId: 42, optionId },
      { decisionId, optionId, user_id: "another-owner" }, { decisionId, optionId, p_key: "forged.learning" }]) {
      const h = fixture(), result = await chooseDecision(h.client, "verified-owner", raw);
      assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, "invalid_input");
      assert.equal(h.reads, 0); assert.equal(h.rpcCalls.length, 0);
    }
  });

  it("keeps missing/foreign decisions, invalid option binding and closed decisions distinct without writing", async () => {
    for (const [options, code] of [
      [{ absent: true }, "not_found"], [{ missingOption: true }, "invalid_option"],
      [{ status: "abandoned" }, "conflict"], [{ status: "decided", selected: otherOptionId }, "conflict"],
      [{ status: "reflected", selected: otherOptionId }, "conflict"],
    ] as const) {
      const h = fixture(options), result = await chooseDecision(h.client, "verified-owner", { decisionId, optionId });
      assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, code);
      assert.equal(h.rpcCalls.length, 0);
    }
  });

  it("preserves atomic race rejections and hides unrecognized database diagnostics", async () => {
    for (const [message, code] of [["Decision not found", "not_found"], ["Invalid option", "invalid_option"],
      ["Decision is no longer open", "conflict"], ["Private database diagnostics", "unavailable"]] as const) {
      const h = fixture({ commitError: { code: "P0001", message } });
      const result = await chooseDecision(h.client, "verified-owner", { decisionId, optionId });
      assert.equal(result.ok, false); if (!result.ok) { assert.equal(result.code, code); assert.doesNotMatch(result.message, /Private/); }
      assert.equal(h.rpcCalls.length, 1); assert.equal(h.reads, 1);
    }
    const h = fixture({ commitError: { code: "57014", message: "Decision not found" } });
    const result = await chooseDecision(h.client, "verified-owner", { decisionId, optionId });
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, "unavailable");
  });

  it("never claims success after an uncertain save or failed confirmation", async () => {
    for (const options of [{ loadError: true }, { throwCommit: true }, { postReadError: true }, { postReadMissing: true },
      { noCommit: true }, { noCommit: true, selected: optionId }, { category: "unknown" }]) {
      const h = fixture(options), result = await chooseDecision(h.client, "verified-owner", { decisionId, optionId });
      assert.equal(result.ok, false); if (!result.ok) { assert.equal(result.code, "unavailable"); assert.doesNotMatch(result.message, /Private/); }
    }
    const changed = fixture({ postSelected: otherOptionId });
    const result = await chooseDecision(changed.client, "verified-owner", { decisionId, optionId });
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, "conflict");
  });
});

describe("versioned choice write contract", () => {
  it("returns only the URL-bound persisted choice with private versioned headers", async () => {
    const h = fixture(), response = await h.post(request(), context);
    assert.equal(response.status, 200); assert.deepEqual((await read(response)).data, { decisionId, selectedOptionId: optionId, status: "decided" });
    assert.equal(h.cookies, 1); assert.equal(h.rpcCalls.length, 1);
  });

  it("requires same-origin cookie writes and gives explicit bearer credentials precedence", async () => {
    for (const origin of [null, "https://other.test", "null"]) {
      const h = fixture(), raw = request();
      if (origin === null) raw.headers.delete("origin"); else raw.headers.set("origin", origin);
      const response = await h.post(raw, context); assert.equal(response.status, 403); await read(response);
      assert.equal(h.cookies, 0); assert.equal(h.reads, 0);
    }
    const h = fixture(), native = request({ optionId }, { authorization: "Bearer native-token" }); native.headers.delete("origin");
    assert.equal((await h.post(native, context)).status, 200); assert.equal(h.cookies, 0); assert.deepEqual(h.tokens, ["native-token"]);
    for (const authorization of ["", "Bearer", "Basic secret", "Bearer a b"]) {
      const invalid = fixture(); const response = await invalid.post(request({ optionId }, { authorization }), context);
      assert.equal(response.status, 401); await read(response); assert.equal(invalid.cookies, 0); assert.equal(invalid.reads, 0);
    }
  });

  it("applies current terms and distinguishes expired sessions from Auth unavailability before saving", async () => {
    for (const [options, status, code] of [[{ requireTerms: true, terms: "old" }, 403, "needs_terms"],
      [{ user: false }, 401, "unauthenticated"], [{ authFailure: true }, 503, "unavailable"]] as const) {
      const h = fixture(options), response = await h.post(request(), context); assert.equal(response.status, status);
      assert.equal((await read(response)).error.code, code); assert.equal(h.rpcCalls.length, 0); assert.equal(h.reads, 0);
    }
  });

  it("rejects malformed, excessive and multibyte JSON bodies before loading any decision", async () => {
    const cases: [Request, number, string][] = [
      [new Request(endpoint, { method: "POST", headers: { origin: "https://nudge.test", "content-type": "application/json" }, body: "{" }), 400, "invalid_json"],
      [request({ optionId }, { "content-type": "text/plain" }), 415, "unsupported_media_type"],
      [request({ optionId }, { "content-length": "1025" }), 413, "payload_too_large"],
      [request({ optionId: "x".repeat(1025) }, { "content-length": "1" }), 413, "payload_too_large"],
      [request({ optionId: "é".repeat(520) }), 413, "payload_too_large"],
    ];
    for (const [raw, status, code] of cases) {
      const h = fixture(), response = await h.post(raw, context); assert.equal(response.status, status);
      assert.equal((await read(response)).error.code, code); assert.equal(h.reads, 0); assert.equal(h.rpcCalls.length, 0);
    }
  });

  it("rejects client identity fields and malformed resource/option IDs without rebinding ownership", async () => {
    for (const raw of [null, [], {}, { optionId: 17 }, { optionId, decisionId: "forged" }, { optionId, user_id: "another-owner" }, { optionId, extra: true }]) {
      const h = fixture(), response = await h.post(request(raw), context); assert.equal(response.status, 400);
      assert.equal((await read(response)).error.code, "invalid_input"); assert.equal(h.reads, 0);
    }
    const h = fixture(), response = await h.post(request(), { params: Promise.resolve({ id: "malformed" }) });
    assert.equal(response.status, 400); await read(response); assert.equal(h.reads, 0);
  });

  it("maps owned option, closed-choice, missing and uncertain outcomes without exposing diagnostics", async () => {
    for (const [options, status, code] of [[{ absent: true }, 404, "not_found"], [{ missingOption: true }, 400, "invalid_option"],
      [{ status: "decided", selected: otherOptionId }, 409, "conflict"], [{ postReadError: true }, 503, "unavailable"],
      [{ commitError: { code: "XX000", message: "Private database diagnostics" } }, 503, "unavailable"]] as const) {
      const h = fixture(options), response = await h.post(request(), context); assert.equal(response.status, status);
      assert.equal((await read(response)).error.code, code);
    }
  });

  it("wires the production route to default write authentication rather than read-only auth", () => {
    const source = readFileSync(new URL("../src/app/api/v1/decisions/[id]/choice/route.ts", import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const calls: unknown[][] = [], authenticator = () => "verified";
    const modules: Record<string, unknown> = {
      "@/lib/api/v1/server-auth": { serverApiAuthenticator: (...args: unknown[]) => { calls.push(args); return authenticator; } },
      "@/lib/api/v1/choice-route": { createChoicePostHandler: (dependencies: { authenticate: unknown }) => dependencies.authenticate },
    };
    const exports: Record<string, unknown> = {};
    vm.runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(Object.hasOwn(modules, name)); return modules[name]; } });
    assert.deepEqual(calls, [[]]); assert.equal(exports.POST, authenticator); assert.equal(exports.dynamic, "force-dynamic");
  });
});
