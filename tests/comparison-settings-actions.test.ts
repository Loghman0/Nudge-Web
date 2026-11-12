import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { decodeComparisonSettingsState, parseComparisonSetting, unavailableComparisonSettings } from "../src/lib/services/comparison-settings";

const ownerId = "00000000-0000-4000-8000-000000000001";
const ownSettingId = "00000000-0000-4000-8000-000000000002";
const foreignSettingId = "00000000-0000-4000-8000-000000000003";
const foreignOwnerId = "00000000-0000-4000-8000-000000000004";
const originalAt = "2026-10-24T12:00:00Z", updatedAt = "2026-10-25T12:00:00Z";
const draft = { id: ownSettingId, name: "Resources", domain: "Synthetic game", category: "hobbies", goal: "Collect supplies",
  aliases: [{ term: "Mine", meaning: "Gather ore in this game" }], generation: 7 };
function harness({ signedIn = true, generation = 7 } = {}) {
  const rows: Record<string, any>[] = [
    { owner_id: ownerId, id: ownSettingId, name: "Original owner setting", domain: "synthetic game", category: "hobbies", goal: "Original goal", aliases: [], memory_generation: 7, created_at: originalAt, updated_at: originalAt },
    { owner_id: foreignOwnerId, id: foreignSettingId, name: "PRIVATE OTHER OWNER SETTING", domain: "private game", category: "hobbies", goal: "Private goal", aliases: [], memory_generation: 7, created_at: originalAt, updated_at: originalAt },
  ];
  const calls: { name: string; args?: Record<string, any> }[] = [], invalidations: string[] = [];
  let clients = 0, authChecks = 0;
  const client = {
    auth: { getUser: async () => { authChecks++; return { data: { user: signedIn ? { id: ownerId } : null }, error: null }; } },
    rpc: async (name: string, args?: Record<string, any>) => {
      calls.push({ name, args });
      if (name === "get_comparison_settings_state") return { data: { generation, settings: rows.filter(row => row.owner_id === ownerId).map(({ owner_id, ...row }) => row) }, error: null };
      assert.ok(name === "save_comparison_setting" || name === "delete_comparison_setting");
      if (args!.p_generation !== generation) return { data: null, error: { message: "Memory generation changed" } };
      const index = rows.findIndex(row => row.id === args!.p_id && row.owner_id === ownerId);
      if (index < 0) return { data: null, error: { message: "PRIVATE OTHER OWNER SETTING permission denied" } };
      if (name === "delete_comparison_setting") rows.splice(index, 1);
      else rows[index] = { ...rows[index], name: args!.p_name, domain: args!.p_domain, category: args!.p_category,
        goal: args!.p_goal, aliases: args!.p_aliases, updated_at: updatedAt };
      return { data: name === "save_comparison_setting" ? args!.p_id : null, error: null };
    },
  };
  const source = readFileSync(new URL("../src/app/(app)/ask/settings-actions.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const modules: Record<string, unknown> = {
    "@/lib/supabase/server": { createClient: async () => { clients++; return client; } },
    "@/lib/services/comparison-settings": { decodeComparisonSettingsState, parseComparisonSetting, unavailableComparisonSettings },
    "next/cache": { revalidatePath: (path: string) => { invalidations.push(path); throw new Error("A settings update must not refresh the comparison route"); } },
  };
  const exports: Record<string, any> = {};
  vm.runInNewContext(compiled, { exports, require: (name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency ${name}`); return modules[name];
  } });
  return { actions: exports, calls, invalidations, rows, get clients() { return clients; }, get authChecks() { return authChecks; } };
}

describe("comparison setting server-action draft preservation", () => {
  it("returns a freshly authenticated owner list after saving without route invalidation", async () => {
    const h = harness(), response = await h.actions.saveComparisonSetting(draft);
    assert.equal(response.error, undefined); assert.equal(response.state.available, true);
    assert.equal(response.state.generation, 7); assert.equal(response.state.settings.length, 1);
    const saved = response.state.settings[0];
    assert.equal(saved.id, ownSettingId); assert.equal(saved.name, draft.name); assert.equal(saved.domain, "synthetic game");
    assert.equal(saved.created_at, originalAt); assert.equal(saved.updated_at, updatedAt);
    assert.deepEqual(saved.aliases, draft.aliases);
    assert.doesNotMatch(JSON.stringify(response), /PRIVATE OTHER OWNER/);
    assert.deepEqual(h.calls.map(call => call.name), ["save_comparison_setting", "get_comparison_settings_state"]);
    assert.equal(h.clients, 2); assert.equal(h.authChecks, 2);
    assert.deepEqual(h.invalidations, []);
    assert.ok(!Object.hasOwn(h.calls[0].args!, "user_id"));
  });
  it("returns the freshly loaded remaining owner state after deleting without remounting the route", async () => {
    const h = harness(), response = await h.actions.deleteComparisonSetting(ownSettingId, 7);
    assert.equal(response.error, undefined); assert.equal(response.state.available, true);
    assert.equal(response.state.settings.length, 0);
    assert.equal(h.rows.length, 1); assert.equal(h.rows[0].id, foreignSettingId);
    assert.deepEqual(h.calls.map(call => call.name), ["delete_comparison_setting", "get_comparison_settings_state"]);
    assert.equal(h.authChecks, 2); assert.deepEqual(h.invalidations, []);
  });
  it("rejects stale or foreign changes without refreshing the route or returning another owner's data", async () => {
    const stale = harness({ generation: 8 }), staleResult = await stale.actions.saveComparisonSetting(draft);
    assert.equal(staleResult.stale, true); assert.equal(staleResult.state, undefined);
    assert.deepEqual(stale.calls.map(call => call.name), ["save_comparison_setting"]); assert.deepEqual(stale.invalidations, []);
    for (const operation of ["save", "delete"]) {
      const h = harness(), response = operation === "save"
        ? await h.actions.saveComparisonSetting({ ...draft, id: foreignSettingId })
        : await h.actions.deleteComparisonSetting(foreignSettingId, 7);
      assert.ok(response.error); assert.equal(response.state, undefined); assert.doesNotMatch(JSON.stringify(response), /PRIVATE OTHER OWNER|permission denied/);
      assert.equal(h.calls.length, 1); assert.equal(h.rows.length, 2); assert.deepEqual(h.invalidations, []);
    }
  });
  it("performs no RPC or route invalidation for signed-out or invalid requests", async () => {
    for (const operation of ["save", "delete"]) {
      const h = harness({ signedIn: false }), response = operation === "save"
        ? await h.actions.saveComparisonSetting(draft) : await h.actions.deleteComparisonSetting(ownSettingId, 7);
      assert.match(response.error, /Sign in/); assert.equal(h.calls.length, 0); assert.deepEqual(h.invalidations, []);
    }
    const invalid = harness();
    assert.ok((await invalid.actions.saveComparisonSetting({ ...draft, user_id: foreignOwnerId })).error);
    assert.ok((await invalid.actions.deleteComparisonSetting("bad", 7)).error);
    assert.equal(invalid.clients, 0); assert.deepEqual(invalid.invalidations, []);
  });
});
