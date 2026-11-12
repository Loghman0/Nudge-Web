import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/types/database";
import { createApiAuthenticator, type ApiAuthOptions } from "../src/lib/api/v1/auth";
import { createReflectionPostHandler } from "../src/lib/api/v1/reflection-route";

const decisionId = "00000000-0000-4000-8000-000000000001";
const otherDecisionId = "00000000-0000-4000-8000-000000000002";
const endpoint = `https://nudge.test/api/v1/decisions/${decisionId}/reflection`;
const context = { params: Promise.resolve({ id: decisionId }) };

function fakeClient(options: {
  user?: boolean; authError?: { status?: number }; absent?: boolean; unchosen?: boolean;
  loadError?: boolean; saveError?: { code: string; message: string }; saved?: boolean; throwSave?: boolean;
  termsVersion?: string | null; absentProfile?: boolean; profileError?: boolean;
} = {}) {
  const authCalls: (string | undefined)[] = [];
  const filters: unknown[][] = [];
  const rpcCalls: { name: string; params: Record<string, unknown> }[] = [];
  const tables: string[] = [];
  let reads = 0;
  const query = {
    select: () => query,
    eq: (...args: unknown[]) => { filters.push(args); return query; },
    maybeSingle: async () => ({
      data: options.absent ? null : { category: "food", selected_option_id: options.unchosen ? null : "selected",
        decision_options: [{ id: "selected", label: "Soup" }] },
      error: options.loadError ? { message: "Private database diagnostics" } : null,
    }),
  };
  const profileQuery = {
    select: () => profileQuery,
    eq: (...args: unknown[]) => { filters.push(args); return profileQuery; },
    maybeSingle: async () => ({ data: options.absentProfile ? null : { terms_version: options.termsVersion ?? null },
      error: options.profileError ? { message: "Private profile diagnostics" } : null }),
  };
  const client = {
    auth: { getUser: async (token?: string) => {
      authCalls.push(token);
      return { data: { user: options.user === false ? null : { id: "verified-owner" } }, error: options.authError ?? null };
    } },
    from: (table: string) => { reads++; tables.push(table); return table === "profiles" ? profileQuery : query; },
    rpc: async (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      if (options.throwSave) throw new Error("Private database diagnostics");
      return { data: options.saveError ? null : [{ saved: options.saved ?? true, memory_generation: 7 }], error: options.saveError ?? null };
    },
  } as unknown as SupabaseClient<Database>;
  return { client, authCalls, filters, rpcCalls, tables, get reads() { return reads; } };
}

function setup(options: Parameters<typeof fakeClient>[0] = {}, authOptions?: ApiAuthOptions) {
  const fake = fakeClient(options);
  let cookieClients = 0;
  const bearerTokens: string[] = [];
  const authenticate = createApiAuthenticator({
    cookieClient: async () => { cookieClients++; return fake.client; },
    bearerClient: token => { bearerTokens.push(token); return fake.client; },
  }, authOptions);
  const post = createReflectionPostHandler({ authenticate });
  return { ...fake, authenticate, post, bearerTokens, get cookieClients() { return cookieClients; },
    get reads() { return fake.reads; } };
}
function jsonRequest(body: unknown = { rating: 4 }, extraHeaders: Record<string, string> = {}) {
  return new Request(endpoint, { method: "POST", headers: { origin: "https://nudge.test", "content-type": "application/json", ...extraHeaders }, body: JSON.stringify(body) });
}
async function result(post: ReturnType<typeof createReflectionPostHandler>, request = jsonRequest()) {
  const response = await post(request, context);
  const body = await response.json();
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(body.apiVersion, "1");
  return { response, body };
}

describe("verified v1 reflection authentication", () => {
  it("requires an exact browser Origin before touching cookie credentials", async () => {
    for (const origin of [null, "null", "https://other.test", "http://nudge.test", "https://nudge.test.evil.test"]) {
      const harness = setup();
      const request = jsonRequest();
      if (origin === null) request.headers.delete("origin"); else request.headers.set("origin", origin);
      const { response, body } = await result(harness.post, request);
      assert.equal(response.status, 403); assert.equal(body.error.code, "forbidden");
      assert.equal(harness.cookieClients, 0); assert.equal(harness.authCalls.length, 0);
    }
    const harness = setup();
    assert.equal((await result(harness.post)).response.status, 200);
    assert.equal(harness.cookieClients, 1); assert.deepEqual(harness.authCalls, [undefined]);
  });

  it("preserves the actual loopback origin after real NextRequest URL normalization", async () => {
    for (const host of ["127.0.0.1:3117", "127.0.0.2:3117", "[::1]:3117", "localhost:3117"]) {
      const request = new NextRequest(`http://${host}/api/v1/decisions/${decisionId}/reflection`, {
        method: "POST", headers: { host, origin: `http://${host}`, "content-type": "application/json" }, body: JSON.stringify({ rating: 4 }),
      });
      assert.equal(new URL(request.url).hostname, "localhost", "Next normalizes loopback aliases");
      assert.equal((await result(setup().post, request)).response.status, 200);
    }
  });

  it("keeps loopback Host, port and scheme exact and rejects forwarded/public-host overrides", async () => {
    const scenarios: Record<string, string>[] = [
      { host: "127.0.0.1:3117", origin: "http://localhost:3117" },
      { host: "127.0.0.1:3117", origin: "https://127.0.0.1:3117" },
      { host: "127.0.0.1:3117", origin: "http://127.0.0.1:3118" },
      { host: "127.0.0.1:3118", origin: "http://127.0.0.1:3118" },
      { host: "other.test:3117", origin: "http://other.test:3117" },
      { host: "127.0.0.1:3117,other.test", origin: "http://127.0.0.1:3117" },
      { host: "localhost:3117", origin: "https://untrusted.test", "x-forwarded-host": "untrusted.test", "x-forwarded-proto": "https", forwarded: "host=untrusted.test;proto=https" },
      { host: "127.0.0.1:3117", origin: "http://localhost:3117", "x-forwarded-host": "localhost:3117" },
    ];
    for (const headers of scenarios) {
      const request = new NextRequest(`http://127.0.0.1:3117/api/v1/decisions/${decisionId}/reflection`, {
        method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ rating: 4 }),
      });
      const harness = setup();
      assert.equal((await result(harness.post, request)).response.status, 403);
      assert.equal(harness.cookieClients, 0);
    }
    const publicTarget = jsonRequest({}, { host: "other.test", origin: "https://other.test", "x-forwarded-host": "other.test" });
    assert.equal((await result(setup().post, publicTarget)).response.status, 403);
  });

  it("verifies bearer tokens directly and never falls back to cookies", async () => {
    const native = setup();
    const request = jsonRequest({ rating: 4 }, { authorization: "Bearer native-access-token" });
    request.headers.delete("origin");
    assert.equal((await result(native.post, request)).response.status, 200);
    assert.deepEqual(native.bearerTokens, ["native-access-token"]);
    assert.deepEqual(native.authCalls, ["native-access-token"]);
    assert.equal(native.cookieClients, 0);

    const expired = setup({ user: false, authError: { status: 401 } });
    const failed = await result(expired.post, jsonRequest({ rating: 4 }, { authorization: "Bearer expired-token" }));
    assert.equal(failed.response.status, 401); assert.equal(failed.body.error.code, "unauthenticated");
    assert.equal(expired.cookieClients, 0); assert.equal(expired.reads, 0);
    for (const authorization of ["", "Basic password", "Bearer", "Bearer a b", "Bearer a,Bearer b"]) {
      const malformed = setup();
      assert.equal((await result(malformed.post, jsonRequest({ rating: 4 }, { authorization }))).response.status, 401);
      assert.equal(malformed.cookieClients, 0); assert.equal(malformed.bearerTokens.length, 0);
    }
  });

  it("distinguishes missing/deleted accounts from temporary Auth failures", async () => {
    assert.equal((await result(setup({ user: false }).post)).response.status, 401);
    const failed = await result(setup({ user: false, authError: { status: 503 } }).post);
    assert.equal(failed.response.status, 503); assert.equal(failed.body.error.code, "unavailable");
  });

  it("wires the real route to an isolated public-key bearer client with its Authorization header", async () => {
    const source = readFileSync(new URL("../src/app/api/v1/decisions/[id]/reflection/route.ts", import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const fake = fakeClient({ termsVersion: "current-policy" });
    const created: unknown[][] = [];
    const modules: Record<string, unknown> = {
      "@supabase/supabase-js": { createClient: (...args: unknown[]) => { created.push(args); return fake.client; } },
      "@/lib/supabase/server": { createClient: () => { throw new Error("Bearer requests must not read cookies"); } },
      "@/lib/api/v1/auth": { createApiAuthenticator },
      "@/lib/api/v1/reflection-route": { createReflectionPostHandler },
      "@/lib/legal/config": { legalConfig: { publicLaunch: true }, POLICY_VERSION: "current-policy" },
    };
    const exports: Record<string, any> = {};
    vm.runInNewContext(compiled, { exports, require: (name: string) => modules[name],
      process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key" } } });
    const response = await exports.POST(jsonRequest({ rating: 4 }, { authorization: "Bearer native-token" }), context);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(JSON.stringify(created)), [["https://fixture.supabase.co", "public-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: "Bearer native-token" } },
    }]]);
    assert.deepEqual(fake.authCalls, ["native-token"]);
    assert.deepEqual(fake.tables, ["profiles", "decisions"]);
  });
});

describe("public-launch API terms parity", () => {
  const required = { requireCurrentTerms: true, policyVersion: "current-policy" };
  it("skips terms lookups when public launch is disabled", async () => {
    const harness = setup({ termsVersion: "outdated-policy", profileError: true }, { ...required, requireCurrentTerms: false });
    assert.equal((await result(harness.post)).response.status, 200);
    assert.deepEqual(harness.tables, ["decisions"]);
  });

  it("requires current terms for cookie and bearer writes and scopes the profile to verified identity", async () => {
    for (const authorization of [undefined, "Bearer native-token"]) {
      const harness = setup({ termsVersion: "current-policy" }, required);
      const request = jsonRequest({ rating: 4, user_id: "forged-owner" }, authorization ? { authorization } : {});
      assert.equal((await result(harness.post, request)).response.status, 200);
      assert.deepEqual(harness.tables, ["profiles", "decisions"]);
      assert.deepEqual(harness.filters, [["id", "verified-owner"], ["id", decisionId], ["user_id", "verified-owner"]]);
    }
  });

  it("returns needs_terms for stale, null and missing profiles without writing a reflection", async () => {
    for (const options of [{ termsVersion: "outdated-policy" }, { termsVersion: null }, { absentProfile: true }]) {
      const harness = setup(options, required);
      const actual = await result(harness.post);
      assert.equal(actual.response.status, 403); assert.equal(actual.body.error.code, "needs_terms");
      assert.deepEqual(harness.tables, ["profiles"]); assert.equal(harness.rpcCalls.length, 0);
    }
  });

  it("reports a failed profile lookup as retryable unavailability without leaking diagnostics", async () => {
    const harness = setup({ profileError: true }, required);
    const actual = await result(harness.post);
    assert.equal(actual.response.status, 503); assert.equal(actual.body.error.code, "unavailable");
    assert.doesNotMatch(JSON.stringify(actual.body), /Private profile diagnostics/);
    assert.equal(harness.rpcCalls.length, 0);
  });
});

describe("bounded v1 reflection contracts", () => {
  it("rejects invalid JSON, media types and oversized bytes before any decision lookup", async () => {
    const cases: [Request, number, string][] = [
      [new Request(endpoint, { method: "POST", headers: { origin: "https://nudge.test", "content-type": "application/json" }, body: "{" }), 400, "invalid_json"],
      [jsonRequest({ rating: 4 }, { "content-type": "text/plain" }), 415, "unsupported_media_type"],
      [jsonRequest({ rating: 4 }, { "content-length": "8193" }), 413, "payload_too_large"],
      [jsonRequest({ notes: "x".repeat(8193), rating: 4 }, { "content-length": "1" }), 413, "payload_too_large"],
      [jsonRequest({ notes: "é".repeat(4100), rating: 4 }), 413, "payload_too_large"],
    ];
    for (const [request, status, code] of cases) {
      const harness = setup();
      const actual = await result(harness.post, request);
      assert.equal(actual.response.status, status); assert.equal(actual.body.error.code, code);
      assert.equal(harness.reads, 0); assert.equal(harness.rpcCalls.length, 0);
    }
  });

  it("preserves the reflection validator and does not coerce or invent answers", async () => {
    for (const input of [null, [], "rating", {}, { rating: "4" }, { rating: 2.5 }, { rating: 6 },
      { rating: 4, notes: "x".repeat(501) }, { rating: 4, wouldRepeat: "false" }]) {
      const harness = setup();
      const actual = await result(harness.post, jsonRequest(input));
      assert.equal(actual.response.status, 400); assert.equal(actual.body.error.code, "invalid_input");
      assert.equal(harness.reads, 0);
    }
    const malformedId = setup();
    const response = await malformedId.post(jsonRequest(), { params: Promise.resolve({ id: "not-a-uuid" }) });
    assert.equal(response.status, 400); assert.equal(malformedId.reads, 0);
  });
});

describe("shared reflection ownership and atomic retry outcomes", () => {
  it("uses verified owner and URL identity while preserving unknown optional values", async () => {
    const harness = setup();
    const { response, body } = await result(harness.post, jsonRequest({ rating: 4, notes: "  A useful outcome  ",
      decisionId: otherDecisionId, user_id: "forged-owner" }));
    assert.equal(response.status, 200);
    assert.deepEqual(body.data, { decisionId, saved: true });
    assert.deepEqual(harness.filters, [["id", decisionId], ["user_id", "verified-owner"]]);
    assert.deepEqual(harness.rpcCalls, [{ name: "submit_decision_reflection", params: {
      p_decision_id: decisionId, p_rating: 4, p_would_repeat: null, p_has_regrets: null,
      p_would_recommend: null, p_would_choose_again: null, p_notes: "A useful outcome", p_key: "learned.food.soup",
    } }]);
  });

  it("acknowledges an identical retry and exposes a conflicting retry as HTTP 409", async () => {
    const retried = await result(setup({ saved: false }).post);
    assert.equal(retried.response.status, 200); assert.deepEqual(retried.body.data, { decisionId, saved: false });
    const conflicted = await result(setup({ saveError: { code: "P0001", message: "This decision already has a reflection" } }).post);
    assert.equal(conflicted.response.status, 409); assert.equal(conflicted.body.error.code, "conflict");
  });

  it("keeps absence, unchosen decisions and transient errors distinct without leaking diagnostics", async () => {
    const cases: [Parameters<typeof setup>[0], number, string][] = [
      [{ absent: true }, 404, "not_found"], [{ unchosen: true }, 409, "not_chosen"],
      [{ loadError: true }, 503, "unavailable"], [{ throwSave: true }, 503, "unavailable"],
      [{ saveError: { code: "57014", message: "Private database diagnostics" } }, 503, "unavailable"],
      [{ saveError: { code: "P0001", message: "Decision not found" } }, 404, "not_found"],
      [{ saveError: { code: "P0001", message: "Choose an option before reflecting" } }, 409, "not_chosen"],
    ];
    for (const [options, status, code] of cases) {
      const harness = setup(options);
      const actual = await result(harness.post);
      assert.equal(actual.response.status, status); assert.equal(actual.body.error.code, code);
      assert.doesNotMatch(JSON.stringify(actual.body), /Private database diagnostics/);
      if (options?.absent || options?.unchosen || options?.loadError) assert.equal(harness.rpcCalls.length, 0);
    }
  });
});
