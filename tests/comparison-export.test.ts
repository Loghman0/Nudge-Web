import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/types/database";
import { exportComparisonEvidence, exportComparisonSettings } from "../src/lib/services/comparison-export";
import { buildComparisonSnapshot } from "../src/lib/services/comparison-snapshot";
import { DEFAULT_WEIGHTS, rankCandidates } from "../src/lib/services/decision-engine";

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
function evidence(index: number) {
  const snapshot = buildComparisonSnapshot({ scoringRunId: id(index + 10), asOf: Date.parse("2026-10-24T12:00:00Z"),
    config: { configCategory: "default", version: 1, weights: DEFAULT_WEIGHTS },
    ranked: rankCandidates([{ label: "Soup", tags: [] }, { label: "Pizza", tags: [] }], [], []),
    preferences: [], history: [], confidence: "low", coldStart: true, evidenceState: "insufficient" });
  return { decision_id: id(index + 1000), comparison_revision: index % 3, scoring_run_id: snapshot.scoringRunId,
    memory_generation: 7, snapshot, created_at: "2026-10-24T12:00:00Z" };
}
function setting(index: number) {
  return { id: id(index + 2000), name: `Setting ${index}`, domain: `game ${index}`, category: "hobbies", goal: "Gather resources",
    aliases: [{ term: "Mining", meaning: "Gathering ore in this game" }], memory_generation: 7,
    created_at: "2026-10-24T12:00:00Z", updated_at: "2026-10-24T12:00:00Z" };
}
const db = (rpc: (name: string, args?: any) => PromiseLike<any>) => ({ rpc } as unknown as SupabaseClient<Database>);

describe("private saved comparison export", () => {
  it("follows actual RPC offsets through small row caps without applying a second range", async () => {
    const rows = Array.from({ length: 7 }, (_, index) => evidence(index)), offsets: number[] = [];
    const exported = await exportComparisonEvidence(db(async (name, args) => {
      assert.equal(name, "export_my_comparison_evidence"); offsets.push(args.p_offset);
      return { data: rows.slice(args.p_offset, args.p_offset + 3), error: null };
    }));
    assert.equal(exported.available, true);
    assert.deepEqual(exported.records.map(row => row.decision_id), rows.map(row => row.decision_id));
    assert.deepEqual(offsets, [0, 3, 6, 7]);
  });
  it("continues beyond the SQL function's 100-record page size", async () => {
    const rows = Array.from({ length: 205 }, (_, index) => evidence(index)), offsets: number[] = [];
    const exported = await exportComparisonEvidence(db(async (_, args) => {
      offsets.push(args.p_offset); return { data: rows.slice(args.p_offset, args.p_offset + 100), error: null };
    }));
    assert.equal(exported.records.length, 205);
    assert.deepEqual(offsets, [0, 100, 200, 205]);
  });
  it("labels only a missing first-call RPC unavailable and fails on later-page errors", async () => {
    assert.deepEqual(await exportComparisonEvidence(db(async () => ({ data: null, error: { code: "PGRST202" } }))), { available: false, records: [] });
    for (const code of ["PGRST202", "42501", "unavailable"]) {
      await assert.rejects(exportComparisonEvidence(db(async (_, args) => args.p_offset === 0
        ? { data: [evidence(0)], error: null } : { data: null, error: { code } })), /export dataset/);
    }
    await assert.rejects(exportComparisonEvidence(db(async () => ({ data: null, error: { code: "42501" } }))), /export saved comparison evidence/);
  });
  it("rejects unknown snapshot fields and mismatched run metadata rather than exporting source notes", async () => {
    for (const mutate of [
      (row: any) => { row.snapshot.notes = "PRIVATE SOURCE NOTES"; },
      (row: any) => { row.snapshot.options[0].reflectionNotes = "PRIVATE SOURCE NOTES"; },
      (row: any) => { row.scoring_run_id = id(999); },
      (row: any) => { row.memory_generation = -1; },
    ]) {
      const row = evidence(0); mutate(row);
      await assert.rejects(exportComparisonEvidence(db(async (_, args) => ({ data: args.p_offset === 0 ? [row] : [], error: null }))), /complete saved comparison evidence/);
    }
    const row = { ...evidence(0), unknown_source_notes: "PRIVATE SOURCE NOTES" };
    const exported = await exportComparisonEvidence(db(async (_, args) => ({ data: args.p_offset === 0 ? [row] : [], error: null })));
    assert.doesNotMatch(JSON.stringify(exported), /PRIVATE SOURCE NOTES|unknown_source_notes/);
  });
  it("exports all 20 settings from scalar JSON without a row-capped list call", async () => {
    const calls: string[] = [];
    const exported = await exportComparisonSettings(db(async name => {
      calls.push(name); return { data: { generation: 7, settings: Array.from({ length: 20 }, (_, index) => setting(index)) }, error: null };
    }));
    assert.deepEqual(calls, ["get_comparison_settings_state"]);
    assert.equal(exported.available, true); assert.equal(exported.generation, 7); assert.equal(exported.records.length, 20);
    assert.deepEqual(exported.records[19].aliases, [{ term: "Mining", meaning: "Gathering ore in this game" }]);
    assert.ok(!Object.hasOwn(exported.records[0], "generation"));
  });
  it("distinguishes missing settings migrations from malformed or failed complete exports", async () => {
    assert.deepEqual(await exportComparisonSettings(db(async () => ({ data: null, error: { code: "PGRST202" } }))), { available: false, generation: null, records: [] });
    for (const result of [
      { data: null, error: { code: "42501" } }, { data: null, error: null },
      { data: { generation: 8, settings: [setting(0)] }, error: null },
      { data: { generation: 7, settings: Array.from({ length: 21 }, (_, index) => setting(index)) }, error: null },
    ]) await assert.rejects(exportComparisonSettings(db(async () => result)), /export/);
  });
});

describe("shared account export version 6 route", () => {
  function route({ fail = false, signedIn = true } = {}) {
    const source = readFileSync(new URL("../src/app/api/export/route.ts", import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const evidenceResult = { available: true, records: [evidence(0)] };
    const settingsResult = { available: true, generation: 7, records: [setting(0)] };
    let derivativeCalls = 0;
    class TestNextResponse extends Response {
      static json(body: unknown, init: ResponseInit) { return new TestNextResponse(JSON.stringify(body), { ...init, headers: { ...init.headers, "content-type": "application/json" } }); }
    }
    const chain = { select: () => chain, eq: () => chain, single: async () => ({ data: { id: id(1), memory_generation: 7 }, error: null }) };
    const client = { auth: { getUser: async () => ({ data: { user: signedIn ? { id: id(1), email: "owner@example.invalid", identities: [] } : null } }) }, from: () => chain };
    const modules: Record<string, unknown> = {
      "next/server": { NextResponse: TestNextResponse }, "@/lib/supabase/server": { createClient: async () => client },
      "@/lib/services/pagination": { collectPages: async () => [] }, "@/lib/services/ai/export-usage": { exportAiUsage: async () => ({ available: true, records: [] }) },
      "@/lib/services/discovery": { exportDiscoveryData: async () => ({ answers: [], revisions: [], questions: [] }) },
      "@/lib/services/comparison-export": {
        exportComparisonEvidence: async () => { derivativeCalls++; if (fail) throw new Error("PRIVATE FAILURE DETAIL"); return evidenceResult; },
        exportComparisonSettings: async () => { derivativeCalls++; return settingsResult; },
      },
    };
    const sharedSource=readFileSync(new URL('../src/lib/services/account-export.ts',import.meta.url),'utf8');
    const sharedCompiled=ts.transpileModule(sharedSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const sharedExports:Record<string,unknown>={};
    const sharedImports:Record<string,string>={'./pagination':'@/lib/services/pagination','./ai/export-usage':'@/lib/services/ai/export-usage','./discovery':'@/lib/services/discovery','./comparison-export':'@/lib/services/comparison-export'};
    vm.runInNewContext(sharedCompiled,{exports:sharedExports,require:(name:string)=>modules[sharedImports[name]??name]});
    modules['@/lib/services/account-export']=sharedExports;
    const exports: Record<string, any> = {};
    vm.runInNewContext(compiled, { exports, require: (name: string) => modules[name] });
    return { get: () => exports.GET(), evidenceResult, settingsResult, get derivativeCalls() { return derivativeCalls; } };
  }
  it("preserves existing account fields and private attachment headers while adding the new datasets", async () => {
    const h = route(), response = await h.get(), payload = await response.json();
    assert.equal(response.status, 200); assert.equal(payload.export_version, 6);
    assert.deepEqual(payload.discovery,{answers:[],revisions:[],questions:[]});
    assert.deepEqual(payload.comparison_evidence, h.evidenceResult); assert.deepEqual(payload.comparison_settings, h.settingsResult);
    for (const field of ["account", "profile", "preferences", "decisions", "reflections", "memories", "question_answers", "knowledge_nodes", "knowledge_evidence", "ai_usage", "own_votes", "push_devices"]) assert.ok(Object.hasOwn(payload, field), field);
    assert.match(response.headers.get("cache-control")!, /private, no-store/);
    assert.match(response.headers.get("content-disposition")!, /attachment; filename="nudge-export-/);
  });
  it("fails the whole export on derivative errors and never loads derivatives for signed-out callers", async () => {
    const failed = await route({ fail: true }).get();
    assert.equal(failed.status, 500); assert.doesNotMatch(await failed.text(), /PRIVATE FAILURE DETAIL/);
    const signedOut = route({ signedIn: false }), response = await signedOut.get();
    assert.equal(response.status, 401); assert.equal(signedOut.derivativeCalls, 0);
  });
});
