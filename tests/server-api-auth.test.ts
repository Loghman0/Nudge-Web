import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createApiAuthenticator } from "../src/lib/api/v1/auth";

function compile(path: string, modules: Record<string, unknown>, extra = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(compiled, { exports, require: (name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency ${name}`); return modules[name];
  }, ...extra });
  return exports;
}
function wiring({ bearerValid = true, requireTerms = false, terms = "current" } = {}) {
  let cookieClients = 0;
  const created: unknown[][] = [], verifiedTokens: (string | undefined)[] = [], tables: string[] = [];
  const profile = { select: () => profile, eq: () => profile, maybeSingle: async () => ({ data: { terms_version: terms }, error: null }) };
  const client = (valid: boolean) => ({ auth: { getUser: async (token?: string) => {
    verifiedTokens.push(token); return { data: { user: valid ? { id: "verified-owner" } : null }, error: null };
  } }, from: (table: string) => { tables.push(table); return profile; } });
  const server = compile("../src/lib/api/v1/server-auth.ts", {
    "@supabase/supabase-js": { createClient: (...args: unknown[]) => { created.push(args); return client(bearerValid); } },
    "@/lib/supabase/server": { createClient: async () => { cookieClients++; return client(true); } },
    "@/lib/legal/config": { legalConfig: { publicLaunch: requireTerms }, POLICY_VERSION: "current" },
    "./auth": { createApiAuthenticator },
  }, { process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key", SUPABASE_SERVICE_ROLE_KEY: "PRIVATE-SERVICE-KEY-MUST-NOT-BE-USED" } } });
  function journal(path: string) {
    return compile(path, {
      "@/lib/api/v1/server-auth": server,
      // Capture and invoke the production route's exact authenticator. The
      // journal query/response behavior is covered by journal-api.test.ts.
      "@/lib/api/v1/journal-route": { createJournalGetHandler: (authenticate: unknown) => authenticate, createJournalDecisionGetHandler: (authenticate: unknown) => authenticate },
      "@/lib/api/v1/comparison-route": { createComparisonPostHandler: ({ authenticate }: { authenticate: unknown }) => authenticate },
    }).GET;
  }
  return { authenticate: server.serverApiAuthenticator, journal, created, verifiedTokens, tables, get cookieClients() { return cookieClients; } };
}

describe("production v1 server authentication wiring", () => {
  it("opts both journal GET routes into read-only cookie authentication without weakening default write authentication", async () => {
    for (const path of ["../src/app/api/v1/decisions/route.ts", "../src/app/api/v1/decisions/[id]/route.ts"]) {
      const h = wiring(), get = h.journal(path);
      assert.equal((await get(new Request("https://nudge.test/api/v1/decisions"))).ok, true);
      assert.equal(h.cookieClients, 1);
      const denied = await get(new Request("https://nudge.test/api/v1/decisions", { method: "POST", headers: { authorization: "Bearer native-token" } }));
      assert.equal(denied.ok, false); assert.equal(denied.status, 403); assert.equal(h.created.length, 0);
    }
    const defaultAuth = wiring(), authenticate = defaultAuth.authenticate();
    for (const method of ["GET", "POST"]) {
      const denied = await authenticate(new Request("https://nudge.test/api/v1/decisions", { method }));
      assert.equal(denied.ok, false); assert.equal(denied.status, 403);
    }
    assert.equal(defaultAuth.cookieClients, 0);
    assert.equal((await authenticate(new Request("https://nudge.test/api/v1/decisions", { method: "POST", headers: { origin: "https://nudge.test" } }))).ok, true);
  });
  it("uses only public-key isolated bearer clients and never falls back to cookies for bad bearer credentials", async () => {
    const h = wiring(), get = h.journal("../src/app/api/v1/decisions/route.ts");
    assert.equal((await get(new Request("https://nudge.test/api/v1/decisions", { headers: { authorization: "Bearer native-token" } }))).ok, true);
    assert.equal(h.cookieClients, 0); assert.deepEqual(h.verifiedTokens, ["native-token"]);
    assert.deepEqual(JSON.parse(JSON.stringify(h.created)), [["https://fixture.supabase.co", "public-anon-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: "Bearer native-token" } },
    }]]);
    assert.doesNotMatch(JSON.stringify(h.created), /PRIVATE-SERVICE/);
    const invalid = wiring({ bearerValid: false }), invalidGet = invalid.journal("../src/app/api/v1/decisions/[id]/route.ts");
    const denied = await invalidGet(new Request("https://nudge.test/api/v1/decisions", { headers: { authorization: "Bearer expired" } }));
    assert.equal(denied.ok, false); assert.equal(denied.status, 401); assert.equal(invalid.cookieClients, 0); assert.equal(invalid.created.length, 1);
    const malformed = wiring(), malformedGet = malformed.journal("../src/app/api/v1/decisions/route.ts");
    const rejected = await malformedGet(new Request("https://nudge.test/api/v1/decisions", { headers: { authorization: "Bearer a b" } }));
    assert.equal(rejected.status, 401); assert.equal(malformed.created.length, 0); assert.equal(malformed.cookieClients, 0);
  });
  it("carries the public-launch terms policy into production read authentication", async () => {
    const h = wiring({ requireTerms: true, terms: "old" }), get = h.journal("../src/app/api/v1/decisions/[id]/route.ts");
    const result = await get(new Request("https://nudge.test/api/v1/decisions", { headers: { authorization: "Bearer native-token" } }));
    assert.equal(result.ok, false); assert.equal(result.status, 403); assert.equal(result.code, "needs_terms");
    assert.deepEqual(h.tables, ["profiles"]); assert.equal(h.cookieClients, 0);
  });
});
