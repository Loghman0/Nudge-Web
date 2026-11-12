import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import type { Preference } from "../src/lib/types";
import { assessCriteria, parseCriteria, withoutDiscoveryReferences } from "../src/lib/services/comparison-criteria";
import { DEFAULT_WEIGHTS, rankCandidates, rankingConfidence, tagsForNamedOption, type HistorySignal } from "../src/lib/services/decision-engine";
import { buildComparisonSnapshot, parseComparisonSnapshot, restoreComparisonSnapshot, SAVED_EVIDENCE_UNAVAILABLE } from "../src/lib/services/comparison-snapshot";
import { parseComparisonInput, isRequestId } from "../src/lib/services/comparison-input";
import { preferencesForCategory } from "../src/lib/services/categories";
import { isSameChoice } from "../src/lib/services/similarity";
import { decisionScopeError } from "../src/lib/services/decision-scope";
import { decodeComparisonSettingsState } from "../src/lib/services/comparison-settings";

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const run = id(1), decisionId = id(2), at = Date.parse("2026-10-24T12:00:00Z");
const pref: Preference = { id: id(3), user_id: id(4), key: "food.soup", value: "soup", polarity: "like", strength: .8, source: "explicit", evidence_count: 1 };
const history = [{ decision: { id: id(5), question: "Private original question", decided_at: "2026-10-23T12:00:00Z" }, selectedLabel: "Soup",
  reflection: { rating: 1, has_regrets: true, notes: "PRIVATE REFLECTION NOTES MUST NOT BE COPIED" } }] as HistorySignal[];
const config = { configCategory: "default", version: 1, weights: { ...DEFAULT_WEIGHTS } };
const ranked = rankCandidates([{ label: "Soup", tags: [pref.key] }, { label: "Pizza", tags: [] }], [pref], history, config.weights, at);
function fixture() {
  const snapshot = buildComparisonSnapshot({ scoringRunId: run, asOf: at, config, ranked, preferences: [pref], history, confidence: "medium", coldStart: false, evidenceState: "personal_fit" });
  const context = { comparisonBasis: "journal", scoring_run_id: run, scored_at: snapshot.scoredAt, engine_version: 2,
    engine_config: snapshot.engineConfig, confidence: snapshot.confidence, cold_start: snapshot.coldStart, evidence_state: snapshot.evidenceState };
  const options = snapshot.options.map(option => ({ label: option.label, score: Math.fround(option.score), breakdown: { ...option.breakdown } }));
  const binding = { decisionId, revision: 2, context, options };
  const row = { decision_id: decisionId, comparison_revision: 2, scoring_run_id: run, memory_generation: 7, snapshot };
  return { snapshot, binding, row };
}

describe("saved comparison explanation snapshots", () => {
  it("saves reasons and regret evidence without retaining reflection notes or source questions", () => {
    const { snapshot } = fixture();
    assert.ok(parseComparisonSnapshot(snapshot));
    const soup = snapshot.options.find(option => option.label === "Soup")!;
    assert.equal(soup.warning, true);
    assert.ok(soup.reasons.some(reason => reason.includes("rated this 1/5")));
    assert.deepEqual(soup.sourceCounts, { preferences: 1, decisions: 1, reflections: 1 });
    assert.deepEqual(soup.sourceIds, { preferenceIds: [pref.id], decisionIds: [history[0].decision.id] });
    assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE REFLECTION|Private original question|has_regrets|selectedLabel/);
  });

  it("restores the same rendered evidence after numeric REAL rounding without consulting current memory", () => {
    const { snapshot, binding, row } = fixture();
    assert.notEqual(snapshot.options[0].score, binding.options[0].score);
    assert.deepEqual(restoreComparisonSnapshot(JSON.parse(JSON.stringify(row)), binding), snapshot);
    const serialized = JSON.stringify(snapshot);
    const changedPreferences = [{ ...pref, polarity: "dislike" as const, strength: .1 }];
    const changedHistory = [{ ...history[0], reflection: { ...history[0].reflection!, rating: 5, has_regrets: false } }];
    buildComparisonSnapshot({ scoringRunId: id(10), asOf: at + 86_400_000, config, ranked, preferences: changedPreferences, history: changedHistory, confidence: "low", coldStart: false, evidenceState: "personal_fit" });
    assert.equal(JSON.stringify(restoreComparisonSnapshot(row, binding)), serialized);
  });

  it("rejects changed runs, revisions, scores, labels, breakdowns and engine metadata", () => {
    const { row, binding } = fixture();
    const mutations: ((copy: typeof row) => void)[] = [
      copy => { copy.scoring_run_id = id(11); }, copy => { copy.comparison_revision++; }, copy => { copy.decision_id = id(12); },
      copy => { copy.snapshot.scoringRunId = id(13); }, copy => { copy.snapshot.scoredAt = "2026-10-25T12:00:00Z"; },
      copy => { copy.snapshot.options[0].label = "Different"; }, copy => { copy.snapshot.options[0].score = .01; },
      copy => { copy.snapshot.options[0].breakdown.novelty = .01; }, copy => { copy.snapshot.engineConfig.version++; },
      copy => { copy.snapshot.confidence = "high"; }, copy => { copy.snapshot.coldStart = true; },
    ];
    for (const mutate of mutations) {
      const copy = structuredClone(row); mutate(copy);
      assert.equal(restoreComparisonSnapshot(copy, binding), null);
    }
  });

  it("rejects raw-source fields, malformed reasons and unbounded identifiers", () => {
    for (const mutate of [
      (copy: any) => { copy.options[0].notes = "private"; },
      (copy: any) => { copy.sourceNotes = "private"; },
      (copy: any) => { copy.options[0].reasons = ["x".repeat(501)]; },
      (copy: any) => { copy.options[0].score = Number.NaN; },
      (copy: any) => { copy.options[0].sourceIds.decisionIds = Array.from({ length: 81 }, (_, i) => id(100 + i)); },
      (copy: any) => { copy.options[0].sourceIds.preferenceIds = ["raw-private-preference"]; },
      (copy: any) => { copy.options[0].sourceCounts.reflections = 2; },
    ]) {
      const copy = structuredClone(fixture().snapshot); mutate(copy);
      assert.equal(parseComparisonSnapshot(copy), null);
    }
  });

  it("bounds source identifiers while retaining the count of inputs used", () => {
    const preferences = Array.from({ length: 90 }, (_, index) => ({ ...pref, id: id(index + 100), key: `food.soup.${index}` }));
    const candidates = rankCandidates([{ label: "Soup", tags: preferences.map(p => p.key) }, { label: "Pizza", tags: [] }], preferences, [], config.weights, at);
    const snapshot = buildComparisonSnapshot({ scoringRunId: run, asOf: at, config, ranked: candidates, preferences, history: [], confidence: "medium", coldStart: false, evidenceState: "personal_fit" });
    const soup = snapshot.options.find(option => option.label === "Soup")!;
    assert.equal(soup.sourceCounts.preferences, 90);
    assert.equal(soup.sourceIds.preferenceIds.length, 80);
    assert.ok(parseComparisonSnapshot(snapshot));
  });

  it("uses confirmed criterion reasons and keeps personal history and regret out of criterion evidence", () => {
    const assessment = assessCriteria([{ id: "time", label: "Minutes", unit: "min", low: 0, high: 60, weight: 1, direction: "lower", values: { Soup: { value: 15 }, Pizza: { value: null } } }], ["Soup", "Pizza"]);
    assert.equal(assessment.outcome, "uncertain");
    const scored = assessment.options.map(option => ({ label: option.label, tags: [], score: option.low, breakdown: { criteriaLow: option.low, criteriaHigh: option.high, coverage: option.coverage } }));
    const snapshot = buildComparisonSnapshot({ scoringRunId: run, asOf: at, config, ranked: scored, preferences: [pref], history, confidence: "low", coldStart: false, evidenceState: "insufficient", criteriaAssessment: assessment });
    assert.ok(parseComparisonSnapshot(snapshot));
    for (const option of snapshot.options) {
      assert.equal(option.warning, false);
      assert.deepEqual(option.sourceCounts, { preferences: 0, decisions: 0, reflections: 0 });
      assert.deepEqual(option.reasons, assessment.options.find(candidate => candidate.label === option.label)!.reasons);
    }
    const context = { comparisonBasis: "criteria", scoring_run_id: run, scored_at: snapshot.scoredAt, engine_version: 2,
      engine_config: snapshot.engineConfig, confidence: snapshot.confidence, cold_start: snapshot.coldStart, evidence_state: snapshot.evidenceState };
    const binding = { decisionId, revision: 0, context, criteriaAssessment: assessment,
      options: snapshot.options.map(option => ({ label: option.label, score: Math.fround(option.score), breakdown: option.breakdown })) };
    const row = { decision_id: decisionId, comparison_revision: 0, scoring_run_id: run, snapshot };
    assert.ok(restoreComparisonSnapshot(row, binding));
    const changed = structuredClone(assessment); changed.options[0].low = .99;
    assert.equal(restoreComparisonSnapshot(row, { ...binding, criteriaAssessment: changed }), null);
    const changedReason = structuredClone(assessment); changedReason.options[0].reasons = ["Unrelated reason"];
    assert.equal(restoreComparisonSnapshot(row, { ...binding, criteriaAssessment: changedReason }), null);
  });
});

describe("saved comparison loader", () => {
  function harness(missing = false, criteria = false) {
    const { row, binding, snapshot } = fixture();
    let memoryLoads = 0;
    const source = readFileSync(new URL("../src/lib/services/comparison-service.ts", import.meta.url), "utf8");
    const start = source.indexOf("export async function loadSavedComparison(");
    const body = stripTypeScriptTypes(source.slice(start, source.indexOf("export async function refreshSavedComparison(", start))).replace("export async function", "async function");
    const context = criteria ? { ...binding.context, comparisonBasis: "criteria", criteriaConfirmed: true, criteriaVersion: 1,
      criteria: [{ id: "time", label: "Minutes", unit: "min", low: 0, high: 60, weight: 1, direction: "lower", values: { Soup: { value: 15 }, Pizza: { value: 30 } } }] } : binding.context;
    const d = { id: decisionId, question: "Dinner", category: "food", context, status: "open", selected_option_id: null,
      comparison_revision: binding.revision, reflection_due_at: null, reminder_enabled: false,
      decision_options: binding.options.map((option, i) => ({ id: id(i + 40), label: option.label, score: option.score, score_breakdown: option.breakdown, rank: i })) };
    const queries: string[] = [];
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: d, error: null }) };
    const sandbox = vm.createContext({ isRequestId, parseCriteria, assessCriteria, restoreComparisonSnapshot, SAVED_EVIDENCE_UNAVAILABLE,
      loadMemory: async () => { memoryLoads++; throw new Error("Saved comparisons must never read current memory"); },
      createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: id(4) } } }) },
        from: (table: string) => { queries.push(table); return chain; }, rpc: async (name: string) => { assert.equal(name, "read_my_comparison_evidence"); return { data: missing ? [] : [row], error: null }; } }) });
    vm.runInContext(body + "\nglobalThis.run=async (...args)=>loadSavedComparison(await createClient(), '00000000-0000-4000-8000-000000000004', ...args);", sandbox);
    return { run: () => sandbox.run(decisionId), get memoryLoads() { return memoryLoads; }, queries, snapshot };
  }
  it("restores original reasons and warnings with no current preference or history queries", async () => {
    const h = harness();
    const result = await h.run();
    assert.equal(result.evidenceSnapshotState, "saved");
    assert.equal(result.scoredAt, h.snapshot.scoredAt);
    for (const option of result.options) {
      const saved = h.snapshot.options.find(candidate => candidate.label === option.label)!;
      assert.deepEqual(option.reasons, saved.reasons);
      assert.equal(option.warning, saved.warning);
    }
    assert.equal(h.memoryLoads, 0);
    assert.deepEqual(h.queries, ["decisions"]);
  });
  it("marks missing/legacy snapshots unavailable and suppresses evidence claims and warnings", async () => {
    const h = harness(true), result = await h.run();
    assert.equal(result.evidenceSnapshotState, "unavailable");
    assert.equal(result.evidenceState, "insufficient");
    assert.equal(result.confidence, "low");
    assert.ok(result.options.every((option: any) => !option.warning && option.reasons[0] === SAVED_EVIDENCE_UNAVAILABLE));
    assert.equal(h.memoryLoads, 0);
  });
  it("does not revive a criterion winner from a missing explanation while retaining confirmed inputs for review", async () => {
    const h = harness(true, true), result = await h.run();
    assert.equal(result.criteriaInput.criteriaConfirmed, true);
    assert.equal(result.criteriaAssessment, undefined);
    assert.equal(result.evidenceSnapshotState, "unavailable");
    assert.equal(h.memoryLoads, 0);
  });
});

describe("atomic comparison explanation action", () => {
  async function create(criteria = false) {
    const source = readFileSync(new URL("../src/lib/services/comparison-service.ts", import.meta.url), "utf8");
    const start = source.indexOf("export async function createComparison(");
    const body = stripTypeScriptTypes(source.slice(start, source.indexOf("export async function loadSavedComparison(", start))).replace("export async function", "async function");
    const persisted = { decisionId, scoringRunId: id(90), options: [{ label: "Soup", score: .25, reasons: ["Original persisted explanation"], warning: false }] };
    const calls: { name: string; args: Record<string, any> }[] = [];
    let memoryLoads = 0, generationLoads = 0;
    const sandbox = vm.createContext({ crypto, parseComparisonInput, isRequestId, decisionScopeError, preferencesForCategory,
      rankCandidates, rankingConfidence, tagsForNamedOption, isSameChoice, assessCriteria, withoutDiscoveryReferences, buildComparisonSnapshot,
      guessCategory: () => "food", loadEngineConfig: async () => config, loadSavedComparison: async () => persisted,
      loadMemory: async () => { memoryLoads++; return { preferences: [pref], history, generation: 7 }; },
      loadCriteriaGeneration: async () => { generationLoads++; return { preferences: [], history: [], generation: 7 }; },
      createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: id(4) } } }) },
        rpc: async (name: string, args: Record<string, any>) => { calls.push({ name, args }); return { data: decisionId, error: null }; } }) });
    vm.runInContext(body + "\nglobalThis.run=async (...args)=>createComparison(await createClient(), '00000000-0000-4000-8000-000000000004', ...args);", sandbox);
    const context = { domain: "Everyday life", meaningConfirmed: true, category: "food", ...(criteria ? {
      comparisonBasis: "criteria", criteriaConfirmed: true, criteriaVersion: 1,
      criteria: [{ id: "time", label: "Minutes", unit: "min", low: 0, high: 60, weight: 1, direction: "lower", values: { Soup: { value: 15 }, Pizza: { value: null } } }],
    } : {}) };
    return { result: await sandbox.run(["Soup", "Pizza"], "Dinner", context, id(91)), calls, memoryLoads, generationLoads, persisted };
  }
  it("sends explanation and scores in the same save and returns an idempotent replay's existing evidence unchanged", async () => {
    const { result, persisted, calls, memoryLoads } = await create();
    assert.equal(result, persisted);
    assert.equal(memoryLoads, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "create_comparison_with_evidence");
    const { p_evidence: snapshot, p_context: context, p_options: options } = calls[0].args;
    assert.ok(parseComparisonSnapshot(snapshot));
    assert.equal(snapshot.scoringRunId, context.scoring_run_id);
    assert.equal(snapshot.scoredAt, context.scored_at);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.options.map((option: any) => ({ label: option.label, score: option.score, breakdown: option.breakdown })))), JSON.parse(JSON.stringify(options)));
    assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE REFLECTION/);
    assert.equal(result.options[0].reasons[0], "Original persisted explanation");
  });
  it("does not fetch personal memory for a confirmed criterion comparison", async () => {
    const { calls, memoryLoads, generationLoads } = await create(true);
    assert.equal(memoryLoads, 0);
    assert.equal(generationLoads, 1);
    const snapshot = parseComparisonSnapshot(calls[0].args.p_evidence)!;
    assert.ok(snapshot);
    assert.equal(snapshot.basis, "criteria");
    assert.ok(snapshot.options.every(option => !option.warning && option.sourceCounts.decisions === 0 && option.sourceCounts.preferences === 0));
    assert.equal(snapshot.options.find(option => option.label === "Pizza")!.breakdown.coverage, 0);
  });
});

describe("transient applied-setting privacy guard", () => {
  const settingId = id(2000);
  const setting = { id: settingId, name: "Dinner choices", domain: "everyday life", category: "food", goal: "Have dinner", aliases: [],
    memory_generation: 7, created_at: "2026-10-24T12:00:00Z", updated_at: "2026-10-24T12:00:00Z" };
  function harness({ state = { generation: 7, settings: [setting] } as any, error = null as any, memoryGeneration = 7, criteria = false } = {}) {
    const source = readFileSync(new URL("../src/lib/services/comparison-service.ts", import.meta.url), "utf8");
    const start = source.indexOf("export async function createComparison(");
    const body = stripTypeScriptTypes(source.slice(start, source.indexOf("export async function loadSavedComparison(", start))).replace("export async function", "async function");
    const calls = { memory: 0, generation: 0, ai: 0, writes: [] as Record<string, any>[], settings: 0 };
    const sandbox = vm.createContext({ crypto, parseComparisonInput, isRequestId, decisionScopeError, preferencesForCategory,
      rankCandidates, rankingConfidence, tagsForNamedOption, isSameChoice, assessCriteria, withoutDiscoveryReferences, buildComparisonSnapshot, decodeComparisonSettingsState,
      guessCategory: () => "food", loadEngineConfig: async () => config, loadSavedComparison: async () => ({ decisionId, options: [] }),
      loadMemory: async () => { calls.memory++; return { preferences: [pref], history, generation: memoryGeneration }; },
      loadCriteriaGeneration: async () => { calls.generation++; return { preferences: [], history: [], generation: memoryGeneration }; },
      getAccountedAi: async () => { calls.ai++; return null; }, understandDecision: async () => { calls.ai++; return {}; },
      createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: id(4) } } }) },
        rpc: async (name: string, args?: Record<string, any>) => {
          if (name === "get_comparison_settings_state") { calls.settings++; return { data: state, error }; }
          assert.equal(name, "create_comparison_with_evidence"); calls.writes.push(args!); return { data: decisionId, error: null };
        } }) });
    vm.runInContext(body + "\nglobalThis.run=async (...args)=>createComparison(await createClient(), '00000000-0000-4000-8000-000000000004', ...args);", sandbox);
    return { calls, run: (overrides = {}) => sandbox.run(["Soup", "Pizza"], "Dinner", {
      domain: "Everyday life", meaningConfirmed: true, category: "food", appliedSetting: { id: settingId, generation: 7 },
      ...(criteria ? { comparisonBasis: "criteria", criteriaConfirmed: true, criteriaVersion: 1,
        criteria: [{ id: "time", label: "Minutes", unit: "min", low: 0, high: 60, weight: 1, direction: "lower", values: { Soup: { value: 15 }, Pizza: { value: 30 } } }] } : {}),
      ...overrides,
    }, id(91)) };
  }
  it("rejects missing or foreign settings, read errors and malformed states before AI or memory work", async () => {
    for (const options of [
      { state: { generation: 7, settings: [] } },
      { state: { generation: 7, settings: [{ ...setting, id: id(2001) }] } },
      { state: null }, { error: { code: "42501" } },
    ]) {
      const h = harness(options), result = await h.run({ meaningConfirmed: false });
      assert.equal(result.settingsInvalidated, true); assert.match(result.error, /changed or was removed/);
      assert.equal(h.calls.settings, 1); assert.equal(h.calls.ai, 0); assert.equal(h.calls.memory, 0); assert.equal(h.calls.generation, 0); assert.equal(h.calls.writes.length, 0);
    }
  });
  it("rejects stale generation and mismatched domains before interpreting or scoring", async () => {
    for (const state of [
      { generation: 8, settings: [{ ...setting, memory_generation: 8 }] },
      { generation: 7, settings: [{ ...setting, domain: "another game" }] },
    ]) {
      const h = harness({ state }), result = await h.run({ meaningConfirmed: false });
      assert.equal(result.settingsInvalidated, true); assert.equal(h.calls.ai, 0); assert.equal(h.calls.memory, 0); assert.equal(h.calls.writes.length, 0);
    }
  });
  it("rejects privacy generation changes between preset validation and memory loading without writing", async () => {
    for (const criteria of [false, true]) {
      const h = harness({ memoryGeneration: 8, criteria }), result = await h.run();
      assert.equal(result.settingsInvalidated, true); assert.match(result.error, /memory changed/);
      assert.equal(h.calls.settings, 1); assert.equal(h.calls.memory, criteria ? 0 : 1); assert.equal(h.calls.generation, criteria ? 1 : 0);
      assert.equal(h.calls.ai, 0); assert.equal(h.calls.writes.length, 0);
    }
  });
  it("accepts the current owner setting but keeps its transient marker out of recorded context and saved explanation", async () => {
    const h = harness(), result = await h.run({ goal: "Have dinner", optionDetails: { Soup: "Homemade soup" } });
    assert.equal(result.decisionId, decisionId); assert.equal(h.calls.settings, 1); assert.equal(h.calls.writes.length, 1);
    const write = h.calls.writes[0];
    assert.equal(write.p_generation, 7); assert.equal(write.p_context.domain, "everyday life");
    assert.equal(write.p_context.goal, "Have dinner"); assert.equal(write.p_context.optionDetails.Soup, "Homemade soup");
    assert.ok(!Object.hasOwn(write.p_context, "appliedSetting")); assert.doesNotMatch(JSON.stringify(write.p_evidence), /appliedSetting|Dinner choices/);
    assert.equal(h.calls.ai, 0);
  });
});
