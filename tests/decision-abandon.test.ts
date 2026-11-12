import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/types/database";
import { abandonDecision } from "../src/lib/services/decision-abandon";
import { createAbandonPostHandler } from "../src/lib/api/v1/abandon-route";
import { createApiAuthenticator } from "../src/lib/api/v1/auth";

const decisionId = "00000000-0000-4000-8000-000000000001";
const endpoint = `https://nudge.test/api/v1/decisions/${decisionId}/abandon`;
const context = { params: Promise.resolve({ id: decisionId }) };
interface Options {
  status?: string; absent?: boolean; loadError?: boolean; postError?: boolean; postMissing?: boolean;
  postStatus?: string; noCommit?: boolean; raceChoice?: "decided" | "reflected";
  commitError?: boolean; throwCommit?: boolean; commitThenError?: boolean;
  user?: boolean; authFailure?: boolean; terms?: string; requireTerms?: boolean;
}
function fixture(options: Options = {}) {
  let reads = 0, cookies = 0;
  const state = { status: options.status ?? "open" };
  const filters: unknown[][] = [], tokens: (string | undefined)[] = [], tables: string[] = [];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const query = {
    select: () => query,
    eq: (...args: unknown[]) => { filters.push(args); return query; },
    maybeSingle: async () => {
      reads++;
      return { data: options.absent || reads > 1 && options.postMissing ? null : { ...state,
        ...(reads > 1 && options.postStatus ? { status: options.postStatus } : {}) },
        error: options.loadError || reads > 1 && options.postError ? { message: "Private database diagnostics" } : null };
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
      calls.push({ name, args });
      if (options.throwCommit) throw new Error("Private thrown diagnostics");
      if (options.raceChoice) state.status = options.raceChoice;
      if (!options.commitError && !options.noCommit && state.status === "open") state.status = "abandoned";
      return { data: null, error: options.commitError || options.commitThenError ? { message: "Private RPC diagnostics" } : null };
    },
  } as unknown as SupabaseClient<Database>;
  const authenticate = createApiAuthenticator({ cookieClient: async () => { cookies++; return client; }, bearerClient: () => client },
    { requireCurrentTerms: options.requireTerms ?? false, policyVersion: "current" });
  return { client, state, filters, tokens, tables, calls, post: createAbandonPostHandler({ authenticate }),
    get reads() { return reads; }, get cookies() { return cookies; } };
}
function request(raw: unknown = {}, headers: Record<string, string> = {}) {
  return new Request(endpoint, { method: "POST", headers: { origin: "https://nudge.test", "content-type": "application/json", ...headers }, body: JSON.stringify(raw) });
}
async function body(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  const value = await response.json(); assert.equal(value.apiVersion, "1");
  assert.doesNotMatch(JSON.stringify(value), /Private .*diagnostics/); return value;
}

describe("verified decision abandonment", () => {
  it("binds both reads to the verified owner and confirms the persisted state after the void RPC", async () => {
    const h = fixture();
    assert.deepEqual(await abandonDecision(h.client, "verified-owner", decisionId), { ok: true, abandoned: true, decisionId, status: "abandoned" });
    assert.deepEqual(h.filters, [["id", decisionId], ["user_id", "verified-owner"], ["id", decisionId], ["user_id", "verified-owner"]]);
    assert.deepEqual(h.calls, [{ name: "abandon_decision", args: { p_decision_id: decisionId } }]);
    assert.deepEqual(h.tables, ["decisions", "decisions"]);
  });

  it("acknowledges an already-abandoned owned state without issuing another write", async () => {
    const h = fixture({ status: "abandoned" });
    assert.deepEqual(await abandonDecision(h.client, "verified-owner", decisionId), { ok: true, abandoned: true, decisionId, status: "abandoned" });
    assert.equal(h.reads, 1); assert.equal(h.calls.length, 0);
  });

  it("rejects malformed resource IDs before reading or writing", async () => {
    for (const id of [undefined, null, {}, [], 12, "", "bad", "../another", decisionId + "extra"]) {
      const h = fixture(), result = await abandonDecision(h.client, "verified-owner", id);
      assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, "invalid_input");
      assert.equal(h.reads, 0); assert.equal(h.calls.length, 0);
    }
  });

  it("distinguishes absent or foreign decisions and closed choices without writing", async () => {
    for (const [options, code] of [[{ absent: true }, "not_found"], [{ status: "decided" }, "conflict"],
      [{ status: "reflected" }, "conflict"], [{ status: "unknown" }, "unavailable"]] as const) {
      const h = fixture(options), result = await abandonDecision(h.client, "verified-owner", decisionId);
      assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, code);
      assert.equal(h.calls.length, 0);
    }
  });

  it("reports a choice winning the atomic race instead of falsely reporting abandonment", async () => {
    for (const raceChoice of ["decided", "reflected"] as const) {
      const h = fixture({ raceChoice }), result = await abandonDecision(h.client, "verified-owner", decisionId);
      assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, "conflict");
      assert.equal(h.calls.length, 1); assert.equal(h.reads, 2); assert.equal(h.state.status, raceChoice);
    }
  });

  it("fails closed on silent no-ops, failed confirmation, exceptions and unknown database state", async () => {
    for (const options of [{ loadError: true }, { postError: true }, { postMissing: true }, { noCommit: true },
      { commitError: true }, { throwCommit: true }, { postStatus: "unknown" }]) {
      const h = fixture(options), result = await abandonDecision(h.client, "verified-owner", decisionId);
      assert.equal(result.ok, false); if (!result.ok) { assert.equal(result.code, "unavailable"); assert.doesNotMatch(result.message, /Private/); }
    }
  });

  it("does not call an uncertain save successful; explicit replay can establish the recorded abandoned state", async () => {
    const h = fixture({ commitThenError: true });
    const uncertain = await abandonDecision(h.client, "verified-owner", decisionId);
    assert.equal(uncertain.ok, false); if (!uncertain.ok) assert.equal(uncertain.code, "unavailable");
    assert.equal(h.state.status, "abandoned");
    assert.deepEqual(await abandonDecision(h.client, "verified-owner", decisionId), { ok: true, abandoned: true, decisionId, status: "abandoned" });
    assert.equal(h.calls.length, 1);
  });
});

describe("native abandonment write contract", () => {
  it("returns the URL-bound persisted result and private versioned headers", async () => {
    const h = fixture(), response = await h.post(request(), context);
    assert.equal(response.status, 200);
    assert.deepEqual((await body(response)).data, { abandoned: true, decisionId, status: "abandoned" });
    assert.equal(h.cookies, 1);
  });

  it("requires same-origin cookie writes and verifies explicit native bearer credentials without cookie fallback", async () => {
    for (const origin of [null, "null", "https://elsewhere.test"]) {
      const h = fixture(), input = request();
      if (origin === null) input.headers.delete("origin"); else input.headers.set("origin", origin);
      const response = await h.post(input, context); assert.equal(response.status, 403); await body(response);
      assert.equal(h.cookies, 0); assert.equal(h.reads, 0);
    }
    const native = fixture(), input = request({}, { authorization: "Bearer native-token" }); input.headers.delete("origin");
    assert.equal((await native.post(input, context)).status, 200); assert.equal(native.cookies, 0); assert.deepEqual(native.tokens, ["native-token"]);
    for (const authorization of ["", "Bearer", "Bearer a b", "Basic wrong"]) {
      const h = fixture(), response = await h.post(request({}, { authorization }), context);
      assert.equal(response.status, 401); await body(response); assert.equal(h.cookies, 0); assert.equal(h.reads, 0);
    }
    const expired = fixture({ user: false }), response = await expired.post(request({}, { authorization: "Bearer expired" }), context);
    assert.equal(response.status, 401); assert.equal(expired.cookies, 0); assert.equal(expired.reads, 0);
  });

  it("enforces current terms and distinguishes unavailable authentication before any decision access", async () => {
    for (const [options, status, code] of [[{ requireTerms: true, terms: "old" }, 403, "needs_terms"],
      [{ user: false }, 401, "unauthenticated"], [{ authFailure: true }, 503, "unavailable"]] as const) {
      const h = fixture(options), response = await h.post(request(), context);
      assert.equal(response.status, status); assert.equal((await body(response)).error.code, code);
      assert.equal(h.reads, 0); assert.equal(h.calls.length, 0);
    }
  });

  it("accepts only an empty object and rejects attempts to supply identity or status", async () => {
    for (const raw of [null, [], 3, "", { decisionId }, { user_id: "someone-else" }, { status: "abandoned" }]) {
      const h = fixture(), response = await h.post(request(raw), context);
      assert.equal(response.status, 400); assert.equal((await body(response)).error.code, "invalid_input");
      assert.equal(h.reads, 0); assert.equal(h.calls.length, 0);
    }
    const h = fixture(), invalid = await h.post(request(), { params: Promise.resolve({ id: "invalid" }) });
    assert.equal(invalid.status, 400); await body(invalid); assert.equal(h.reads, 0);
  });

  it("bounds actual streamed UTF-8 bytes regardless of a misleading length header", async () => {
    const cases: [Request, number, string][] = [
      [new Request(endpoint, { method: "POST", headers: { origin: "https://nudge.test", "content-type": "application/json" }, body: "{" }), 400, "invalid_json"],
      [new Request(endpoint, { method: "POST", headers: { origin: "https://nudge.test", "content-type": "application/json" } }), 400, "invalid_json"],
      [request({}, { "content-type": "text/plain" }), 415, "unsupported_media_type"],
      [request({}, { "content-length": "1025" }), 413, "payload_too_large"],
      [request({ extra: "x".repeat(1025) }, { "content-length": "1" }), 413, "payload_too_large"],
      [request({ extra: "é".repeat(520) }), 413, "payload_too_large"],
    ];
    for (const [input, status, code] of cases) {
      const h = fixture(), response = await h.post(input, context);
      assert.equal(response.status, status); assert.equal((await body(response)).error.code, code);
      assert.equal(h.reads, 0); assert.equal(h.calls.length, 0);
    }
  });

  it("maps owned missing, concurrent choice and uncertain confirmation to distinct safe responses", async () => {
    for (const [options, status, code] of [[{ absent: true }, 404, "not_found"], [{ raceChoice: "decided" }, 409, "conflict"],
      [{ commitError: true }, 503, "unavailable"], [{ postError: true }, 503, "unavailable"]] as const) {
      const h = fixture(options), response = await h.post(request(), context);
      assert.equal(response.status, status); assert.equal((await body(response)).error.code, code);
    }
  });

  it("wires the production endpoint to write authentication", () => {
    const source = readFileSync(new URL("../src/app/api/v1/decisions/[id]/abandon/route.ts", import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const calls: unknown[][] = [], authenticate = () => "verified";
    const modules: Record<string, unknown> = {
      "@/lib/api/v1/server-auth": { serverApiAuthenticator: (...args: unknown[]) => { calls.push(args); return authenticate; } },
      "@/lib/api/v1/abandon-route": { createAbandonPostHandler: (dependencies: { authenticate: unknown }) => dependencies.authenticate },
    };
    const exports: Record<string, unknown> = {};
    vm.runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(Object.hasOwn(modules, name)); return modules[name]; } });
    assert.deepEqual(calls, [[]]); assert.equal(exports.POST, authenticate); assert.equal(exports.dynamic, "force-dynamic");
  });
});
