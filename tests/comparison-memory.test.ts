import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/types/database";
import { loadComparisonMemory } from "../src/lib/services/comparison-memory";
import { domainScope } from "../src/lib/services/decision-domain";

type Row = Record<string, any>;
function decision(index: number, domain: string | undefined = "Game A", label = "Mining"): Row {
  return { id: String(index).padStart(4, "0"), user_id: "owner", category: "hobbies", question: "Next activity",
    context: domain === undefined ? {} : { domain }, status: "decided", selected_option_id: `option-${index}`,
    created_at: new Date(Date.UTC(2026, 9, 23) - index * 60_000).toISOString(), decided_at: "2026-10-22T12:00:00Z",
    decision_options: [{ id: `option-${index}`, label }], decision_reflections: [] };
}
function preference(index: number, domain = "Game A"): Row {
  return { id: String(index).padStart(4, "0"), user_id: "owner", key: `learned.hobbies.scope.${domainScope(domain)}.choice-${index}`,
    value: `Choice ${index}`, polarity: "like", strength: .8, source: "explicit", evidence_count: 1, preference_categories: { slug: "hobbies" } };
}
function tombstone(index: number, label: string, domain = "Game A"): Row {
  return { id: String(index).padStart(4, "0"), user_id: "owner", status: "forgotten", category_slug: "hobbies",
    key: `learned.hobbies.scope.${domainScope(domain)}.${label.toLowerCase()}`, value: label };
}
function harness({ decisions = [], preferences = [], forgotten = [], cap = 7, resetAt = null, errorTable, errorOffset = 0 }:
  { decisions?: Row[]; preferences?: Row[]; forgotten?: Row[]; cap?: number; resetAt?: string | null; errorTable?: string; errorOffset?: number } = {}) {
  const rows: Record<string, Row[]> = { decisions, preferences, knowledge_nodes: forgotten,
    profiles: [{ id: "owner", memory_reset_at: resetAt, memory_generation: 17 }] };
  const calls: { table: string; filters: unknown[][]; orders: unknown[][]; range?: number[] }[] = [];
  const db = { from(table: string) {
    const call: typeof calls[number] = { table, filters: [], orders: [] }; calls.push(call);
    const filters: ((row: Row) => boolean)[] = [];
    const chain = {
      select: (_: string) => chain,
      eq: (field: string, value: unknown) => { call.filters.push(["eq", field, value]); filters.push(row => row[field] === value); return chain; },
      gt: (field: string, value: string) => { call.filters.push(["gt", field, value]); filters.push(row => row[field] != null && row[field] > value); return chain; },
      in: (field: string, values: unknown[]) => { call.filters.push(["in", field, values]); filters.push(row => values.includes(row[field])); return chain; },
      order: (field: string, options: { ascending: boolean }) => { call.orders.push([field, options]); return chain; },
      single: async () => ({ data: rows[table].find(row => filters.every(filter => filter(row))), error: null }),
      range: async (from: number, to: number) => {
        call.range = [from, to];
        if (table === errorTable && from >= errorOffset) return { data: null, error: new Error("query failed") };
        const selected = rows[table].filter(row => filters.every(filter => filter(row))).sort((a, b) => {
          for (const [field, options] of call.orders as [string, { ascending: boolean }][]) {
            const difference = String(a[field]).localeCompare(String(b[field]));
            if (difference) return options.ascending ? difference : -difference;
          }
          return 0;
        });
        return { data: selected.slice(from, Math.min(to + 1, from + cap)), error: null };
      },
    };
    return chain;
  } } as unknown as SupabaseClient<Database>;
  return { db, calls };
}

describe("comparison evidence retrieval", () => {
  it("finds relevant history behind more than 80 newer decisions in another setting", async () => {
    const h = harness({ decisions: [...Array.from({ length: 90 }, (_, i) => decision(i, "Game B")), decision(90, "  GAME  A ")] });
    const result = await loadComparisonMemory(h.db, "owner", "hobbies", "Game A");
    assert.deepEqual(result.history.map(row => row.decision.id), ["0090"]);
    assert.equal(result.generation, 17);
    const pages = h.calls.filter(call => call.table === "decisions");
    assert.deepEqual(pages.map(call => call.range![0]), Array.from({ length: 14 }, (_, i) => i * 7));
    for (const call of pages) {
      assert.deepEqual(call.orders, [["created_at", { ascending: false }], ["id", { ascending: true }]]);
      assert.ok(call.filters.some(filter => filter[1] === "category" && filter[2] === "hobbies"));
    }
  });

  it("caps usable matching history at 80 without letting unrelated or forgotten choices consume it", async () => {
    const h = harness({ cap: 13, decisions: Array.from({ length: 240 }, (_, i) => decision(i, i % 3 === 0 ? "Game B" : "Game A", i % 3 === 1 ? "Forgotten" : "Keep")),
      forgotten: [tombstone(0, "Forgotten")] });
    const result = await loadComparisonMemory(h.db, "owner", "hobbies", "Game A");
    assert.equal(result.history.length, 80);
    assert.ok(result.history.every(row => row.selectedLabel === "Keep"));
    assert.equal(result.history[79].decision.id, "0239");
  });

  it("loads every preference and tombstone beyond small deployment row caps", async () => {
    const h = harness({ cap: 2, preferences: Array.from({ length: 7 }, (_, i) => preference(i)),
      forgotten: [tombstone(0, "First"), tombstone(1, "Second"), tombstone(2, "Mining")], decisions: [decision(0)] });
    const result = await loadComparisonMemory(h.db, "owner", "hobbies", "Game A");
    assert.equal(result.preferences.length, 7);
    assert.deepEqual(result.history, []);
    assert.deepEqual(h.calls.filter(call => call.table === "preferences").map(call => call.range![0]), [0, 2, 4, 6, 7]);
    assert.deepEqual(h.calls.filter(call => call.table === "knowledge_nodes").map(call => call.range![0]), [0, 2, 3]);
  });

  it("preserves legacy everyday evidence and keeps forgetting confined to its setting", async () => {
    const oldDecision = decision(1); oldDecision.context = {};
    const h = harness({ decisions: [decision(0), oldDecision], forgotten: [tombstone(0, "Mining", "Game B")],
      preferences: [preference(0), { ...preference(1), key: "hobby.mining" }, preference(2, "Game B")] });
    const game = await loadComparisonMemory(h.db, "owner", "hobbies", "Game A");
    assert.deepEqual(game.history.map(row => row.decision.id), ["0000"]);
    assert.deepEqual(game.preferences.map(row => row.id), ["0000"]);
    const everyday = await loadComparisonMemory(h.db, "owner", "hobbies", "Everyday life");
    assert.deepEqual(everyday.history.map(row => row.decision.id), ["0001"]);
    assert.deepEqual(everyday.preferences.map(row => row.id), ["0001"]);
  });

  it("enforces owner/category/status and the strict memory reset boundary on every query", async () => {
    const atReset = { ...decision(0), decided_at: "2026-10-22T10:00:00Z" };
    const h = harness({ cap: 1, resetAt: "2026-10-22T10:00:00Z", decisions: [atReset, { ...decision(1), decided_at: null },
      { ...decision(2), status: "open" }, { ...decision(3), user_id: "stranger" }, { ...decision(4), category: "food" }, decision(5)],
      preferences: [preference(0), { ...preference(1), user_id: "stranger" }],
      forgotten: [{ ...tombstone(0, "Mining"), user_id: "stranger" }, { ...tombstone(1, "Mining"), status: "active" }] });
    const result = await loadComparisonMemory(h.db, "owner", "hobbies", "Game A");
    assert.deepEqual(result.history.map(row => row.decision.id), ["0005"]);
    assert.equal(result.preferences.length, 1);
    for (const call of h.calls) assert.ok(call.filters.some(filter => filter[0] === "eq" && filter[1] === (call.table === "profiles" ? "id" : "user_id") && filter[2] === "owner"));
    assert.ok(h.calls.filter(call => call.table === "decisions").every(call => call.filters.some(filter => filter[0] === "gt" && filter[1] === "decided_at" && filter[2] === "2026-10-22T10:00:00Z")));
  });

  it("fails closed on later-page errors instead of scoring partially loaded memory", async () => {
    for (const table of ["preferences", "knowledge_nodes", "decisions"]) {
      const h = harness({ cap: 1, preferences: [preference(0), preference(1)], forgotten: [tombstone(0, "Other"), tombstone(1, "Mining")],
        decisions: [decision(0), decision(1)], errorTable: table, errorOffset: 1 });
      await assert.rejects(loadComparisonMemory(h.db, "owner", "hobbies", "Game A"));
    }
  });
});
