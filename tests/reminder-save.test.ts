import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/types/database";
import { parseReminderInput, saveReminder } from "../src/lib/services/reminder-save";
import { createReminderPostHandler } from "../src/lib/api/v1/reminder-route";
import { createApiAuthenticator } from "../src/lib/api/v1/auth";
import { resolveLocalReminderTime } from "../src/lib/services/reminder-local-time";

const decisionId = "00000000-0000-4000-8000-000000000001";
const future = () => new Date(Date.now() + 86400000).toISOString();
const endpoint = `https://nudge.test/api/v1/decisions/${decisionId}/reminder`;
const context = { params: Promise.resolve({ id: decisionId }) };
interface Options {
  absent?: boolean; status?: string; loadError?: boolean; saveError?: { code: string; message: string }; throwSave?: boolean;
  postError?: boolean; postMissing?: boolean; postStatus?: string; postDue?: string | null; noCommit?: boolean;
  user?: boolean; authError?: boolean; terms?: string; requireTerms?: boolean;
}
function fixture(options: Options = {}) {
  let reads = 0, cookieClients = 0;
  const filters: unknown[][] = [], tokens: (string | undefined)[] = [], calls: { name: string; args: Record<string, unknown> }[] = [];
  const state = { status: options.status ?? "decided", reminder_enabled: true, reflection_due_at: null as string | null, reminder_version: 4 };
  const query = {
    select: () => query, eq: (...args: unknown[]) => { filters.push(args); return query; },
    maybeSingle: async () => {
      reads++;
      return { data: options.absent || (reads > 1 && options.postMissing) ? null : { ...state,
        ...(reads > 1 && options.postStatus ? { status: options.postStatus } : {}),
        ...(reads > 1 && options.postDue !== undefined ? { reflection_due_at: options.postDue } : {}) },
        error: options.loadError || (reads > 1 && options.postError) ? { message: "Private database diagnostics" } : null };
    },
  };
  const profile = { select: () => profile, eq: () => profile, maybeSingle: async () => ({ data: { terms_version: options.terms ?? "current" }, error: null }) };
  const db = {
    auth: { getUser: async (token?: string) => { tokens.push(token); return { data: { user: options.user === false ? null : { id: "verified-owner" } }, error: options.authError ? { status: 503 } : null }; } },
    from: (table: string) => { assert.ok(table === "decisions" || table === "profiles"); return table === "profiles" ? profile : query; },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args }); if (options.throwSave) throw new Error("Private thrown diagnostics");
      if (!options.saveError && !options.noCommit) { state.reminder_enabled = args.p_enabled as boolean; state.reflection_due_at = args.p_due_at as string | null; state.reminder_version++; }
      return { data: null, error: options.saveError ?? null };
    },
  } as unknown as SupabaseClient<Database>;
  const authenticate = createApiAuthenticator({ cookieClient: async () => { cookieClients++; return db; }, bearerClient: () => db },
    { requireCurrentTerms: options.requireTerms ?? false, policyVersion: "current" });
  return { db, calls, filters, tokens, state, post: createReminderPostHandler({ authenticate }), get reads() { return reads; }, get cookieClients() { return cookieClients; } };
}
function request(raw: unknown = { enabled: true, dueAt: future() }, headers: Record<string, string> = {}) {
  return new Request(endpoint, { method: "POST", headers: { origin: "https://nudge.test", "content-type": "application/json", ...headers }, body: JSON.stringify(raw) });
}
async function body(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("pragma"), "no-cache"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  const value = await response.json(); assert.equal(value.apiVersion, "1"); assert.doesNotMatch(JSON.stringify(value), /Private .*diagnostics/); return value;
}

describe("explicit reminder input and device-local time", () => {
  it("normalizes an explicit numeric timezone offset without interpreting a server-local wall clock", () => {
    const now = Date.parse("2026-10-25T10:00:00Z");
    assert.deepEqual(parseReminderInput({ decisionId, enabled: true, dueAt: "2026-10-26T15:30:00+04:00" }, now).value,
      { decisionId, enabled: true, dueAt: "2026-10-26T11:30:00.000Z" });
    assert.ok(parseReminderInput({ decisionId, enabled: true, dueAt: "2026-10-26T15:30:00" }, now).error);
  });
  it("rejects impossible dates, unbounded or malformed shapes and guessed boolean values", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    for (const raw of [null, [], {}, { decisionId, enabled: "false", dueAt: null }, { decisionId: "forged", enabled: false, dueAt: null },
      { decisionId, enabled: false, dueAt: null, user_id: "other" }, ...["2026-02-30T12:00:00Z", "2026-02-29T12:00:00Z", "2026-13-01T12:00:00Z",
        "2026-01-02T24:00:00Z", "2026-01-02T12:60:00Z", "2026-01-02T12:00:60Z", "2026-01-02T12:00:00+24:00", "tomorrow"].map(dueAt => ({ decisionId, enabled: true, dueAt }))])
      assert.ok(parseReminderInput(raw, now).error, JSON.stringify(raw));
  });
  it("enforces the future and 365-day window without rejecting the exact upper bound", () => {
    const now = Date.parse("2026-01-01T00:00:00Z"), year = 365 * 86400000;
    for (const delta of [-1, 0, year + 1]) assert.ok(parseReminderInput({ decisionId, enabled: true, dueAt: new Date(now + delta).toISOString() }, now).error);
    assert.ok(parseReminderInput({ decisionId, enabled: true, dueAt: new Date(now + year).toISOString() }, now).value);
    assert.ok(parseReminderInput({ decisionId, enabled: true, dueAt: "2028-02-29T12:00:00Z" }, Date.parse("2028-01-01T00:00:00Z")).value);
  });
  it("requires an explicit null time when disabling rather than silently ignoring contradictory input", () => {
    assert.deepEqual(parseReminderInput({ decisionId, enabled: false, dueAt: null }).value, { decisionId, enabled: false, dueAt: null });
    for (const dueAt of [undefined, future(), 0]) assert.ok(parseReminderInput({ decisionId, enabled: false, dueAt }).error);
  });
  it("rejects nonexistent and ambiguous device-local clock times while retaining unambiguous intent", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      assert.match(resolveLocalReminderTime("2026-03-08T02:30").error!, /does not exist/);
      assert.match(resolveLocalReminderTime("2026-11-01T01:30").error!, /happens twice/);
      assert.equal(resolveLocalReminderTime("2026-11-01T03:30").value, "2026-11-01T08:30:00.000Z");
      process.env.TZ = "UTC";
      assert.equal(resolveLocalReminderTime("2026-11-01T01:30").value, "2026-11-01T01:30:00.000Z");
      assert.ok(resolveLocalReminderTime("2026-02-30T10:00").error);
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
});

describe("owned required reminder save", () => {
  it("binds both reads to the verified owner and confirms canonical time plus the new database version", async () => {
    const h = fixture(), dueAt = future(), result = await saveReminder(h.db, "verified-owner", { decisionId, enabled: true, dueAt });
    assert.deepEqual(result, { ok: true, reminder: { decisionId, enabled: true, dueAt, reminderVersion: 5 } });
    assert.deepEqual(h.filters, [["id", decisionId], ["user_id", "verified-owner"], ["id", decisionId], ["user_id", "verified-owner"]]);
    assert.deepEqual(h.calls, [{ name: "schedule_reflection", args: { p_decision_id: decisionId, p_due_at: dueAt, p_enabled: true } }]);
  });
  it("preserves the existing version-advancing contract on identical retries and confirmed disable", async () => {
    const h = fixture(), input = { decisionId, enabled: false, dueAt: null };
    assert.deepEqual(await saveReminder(h.db, "verified-owner", input), { ok: true, reminder: { decisionId, enabled: false, dueAt: null, reminderVersion: 5 } });
    assert.deepEqual(await saveReminder(h.db, "verified-owner", input), { ok: true, reminder: { decisionId, enabled: false, dueAt: null, reminderVersion: 6 } });
    assert.equal(h.calls.length, 2, "The existing RPC is not an exactly-once retry ledger.");
  });
  it("rejects bad input before any data read and never schedules missing, foreign or non-decided decisions", async () => {
    const invalid = fixture(); assert.equal((await saveReminder(invalid.db, "verified-owner", { decisionId, enabled: "false", dueAt: null })).ok, false); assert.equal(invalid.reads, 0);
    for (const [options, code] of [[{ absent: true }, "not_found"], [{ status: "open" }, "conflict"], [{ status: "reflected" }, "conflict"], [{ status: "abandoned" }, "conflict"]] as const) {
      const h = fixture(options), result = await saveReminder(h.db, "verified-owner", { decisionId, enabled: false, dueAt: null });
      assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, code); assert.equal(h.calls.length, 0);
    }
  });
  it("maps only known database time/state rejections and hides all other diagnostics", async () => {
    for (const [message, expected] of [["Choose a future time within one year", "invalid_input"], ["This decision is not waiting for reflection", "conflict"], ["Private database diagnostics", "unavailable"]] as const) {
      const h = fixture({ saveError: { code: "P0001", message } }), result = await saveReminder(h.db, "verified-owner", { decisionId, enabled: false, dueAt: null });
      assert.equal(result.ok, false); if (!result.ok) { assert.equal(result.code, expected); assert.doesNotMatch(result.message, /Private/); }
    }
  });
  it("does not acknowledge uncertain completion, unadvanced versions or a competing schedule", async () => {
    for (const [options, expected] of [[{ loadError: true }, "unavailable"], [{ throwSave: true }, "unavailable"], [{ postError: true }, "unavailable"],
      [{ postMissing: true }, "unavailable"], [{ noCommit: true }, "unavailable"], [{ postStatus: "reflected" }, "conflict"], [{ postDue: new Date(Date.now()+2*86400000).toISOString() }, "conflict"]] as const) {
      const h = fixture(options), result = await saveReminder(h.db, "verified-owner", { decisionId, enabled: true, dueAt: future() });
      assert.equal(result.ok, false); if (!result.ok) { assert.equal(result.code, expected); assert.doesNotMatch(result.message, /Private/); }
    }
  });
});

describe("versioned reminder write contract", () => {
  it("returns a private versioned acknowledgement of only the path-bound owned reminder", async () => {
    const h = fixture(), dueAt = future(), response = await h.post(request({ enabled: true, dueAt }), context);
    assert.equal(response.status, 200); assert.deepEqual((await body(response)).data, { decisionId, enabled: true, dueAt, reminderVersion: 5 });
    assert.equal(h.cookieClients, 1); assert.equal(h.calls.length, 1);
  });
  it("requires same-origin cookie writes and supports explicit bearer sessions without cookie fallback", async () => {
    for (const origin of [null, "https://untrusted.test"]) {
      const h = fixture(), raw = request(); if (origin === null) raw.headers.delete("origin"); else raw.headers.set("origin", origin);
      const response = await h.post(raw, context); assert.equal(response.status, 403); await body(response); assert.equal(h.cookieClients, 0); assert.equal(h.calls.length, 0);
    }
    const h = fixture(), raw = request({ enabled: false, dueAt: null }, { authorization: "Bearer native-token" }); raw.headers.delete("origin");
    assert.equal((await h.post(raw, context)).status, 200); assert.equal(h.cookieClients, 0); assert.deepEqual(h.tokens, ["native-token"]);
    for (const authorization of ["", "Bearer", "Basic secret", "Bearer one two"]) {
      const invalid = fixture(), response = await invalid.post(request(undefined, { authorization }), context); assert.equal(response.status, 401); await body(response); assert.equal(invalid.cookieClients, 0); assert.equal(invalid.calls.length, 0);
    }
  });
  it("enforces current terms and distinguishes expired authentication from temporary Auth errors", async () => {
    for (const [options, status, code] of [[{ requireTerms: true, terms: "old" }, 403, "needs_terms"], [{ user: false }, 401, "unauthenticated"], [{ authError: true }, 503, "unavailable"]] as const) {
      const h = fixture(options), response = await h.post(request(), context); assert.equal(response.status, status); assert.equal((await body(response)).error.code, code); assert.equal(h.calls.length, 0);
    }
  });
  it("bounds actual UTF-8 bytes and rejects invalid JSON/media types before looking up a decision", async () => {
    for (const [raw, status, code] of [[new Request(endpoint, { method: "POST", headers: { origin: "https://nudge.test", "content-type": "application/json" }, body: "{" }), 400, "invalid_json"],
      [request(undefined, { "content-type": "text/plain" }), 415, "unsupported_media_type"], [request(undefined, { "content-length": "1025" }), 413, "payload_too_large"],
      [request({ enabled: true, dueAt: "é".repeat(520) }, { "content-length": "1" }), 413, "payload_too_large"]] as const) {
      const h = fixture(), response = await h.post(raw, context); assert.equal(response.status, status); assert.equal((await body(response)).error.code, code); assert.equal(h.reads, 0);
    }
  });
  it("rejects identity extensions, malformed values and invalid resource IDs without rebinding ownership", async () => {
    for (const raw of [null, [], {}, { enabled: false, dueAt: null, decisionId: "forged" }, { enabled: false, dueAt: null, user_id: "other" },
      { enabled: "false", dueAt: null }, { enabled: true, dueAt: "tomorrow" }]) {
      const h = fixture(), response = await h.post(request(raw), context); assert.equal(response.status, 400); assert.equal((await body(response)).error.code, "invalid_input"); assert.equal(h.reads, 0);
    }
    const h = fixture(), response = await h.post(request(), { params: Promise.resolve({ id: "invalid" }) }); assert.equal(response.status, 400); await body(response); assert.equal(h.reads, 0);
  });
  it("maps absent, changed and uncertain reminder outcomes consistently", async () => {
    for (const [options, status, code] of [[{ absent: true }, 404, "not_found"], [{ status: "reflected" }, 409, "conflict"], [{ postError: true }, 503, "unavailable"]] as const) {
      const h = fixture(options), response = await h.post(request(), context); assert.equal(response.status, status); assert.equal((await body(response)).error.code, code);
    }
  });
  it("wires the production reminder route to write authentication", () => {
    const source = readFileSync(new URL("../src/app/api/v1/decisions/[id]/reminder/route.ts", import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const calls: unknown[][] = [], authenticate = () => "verified", exports: Record<string, unknown> = {};
    const modules: Record<string, unknown> = { "@/lib/api/v1/server-auth": { serverApiAuthenticator: (...args: unknown[]) => { calls.push(args); return authenticate; } },
      "@/lib/api/v1/reminder-route": { createReminderPostHandler: (input: { authenticate: unknown }) => input.authenticate } };
    vm.runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(Object.hasOwn(modules, name)); return modules[name]; } });
    assert.deepEqual(calls, [[]]); assert.equal(exports.POST, authenticate); assert.equal(exports.dynamic, "force-dynamic");
  });
});
