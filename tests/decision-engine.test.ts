import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WEIGHTS,
  extractNamedOptions,
  hasNegativeHistory,
  rankCandidates,
  rankingConfidence,
  reinforcementDelta,
  type Candidate,
  type HistorySignal,
} from "../src/lib/services/decision-engine";
import type { DecisionReflection, Preference } from "../src/lib/types";

function pref(key: string, overrides: Partial<Preference> = {}): Preference {
  return {
    id: key, user_id: "u", key, value: key.split(".").pop() ?? null,
    polarity: "like", strength: 0.8, source: "explicit", evidence_count: 3,
    ...overrides,
  };
}

function signal(label: string, overrides: Partial<HistorySignal> = {}): HistorySignal {
  return {
    decision: { id: label, question: label, decided_at: new Date().toISOString() },
    selectedLabel: label,
    reflection: null,
    ...overrides,
  };
}

function reflection(overrides: Partial<DecisionReflection> = {}): DecisionReflection {
  return {
    decision_id: "d", rating: null, would_repeat: null, has_regrets: null,
    would_recommend: null, would_choose_again: null, notes: null,
    ...overrides,
  };
}

describe("extractNamedOptions", () => {
  it("parses a plain either/or", () => {
    assert.deepEqual(extractNamedOptions("pizza or sushi"), ["pizza", "sushi"]);
  });

  it("strips the question preamble", () => {
    assert.deepEqual(extractNamedOptions("Should I eat pizza or sushi tonight?"), ["pizza", "sushi"]);
  });

  it("handles vs and comma lists", () => {
    assert.deepEqual(extractNamedOptions("sushi, pizza or ramen tonight?"), ["sushi", "pizza", "ramen"]);
    assert.deepEqual(extractNamedOptions("iphone vs android"), ["iphone", "android"]);
  });

  it("returns nothing when no alternatives are named", () => {
    assert.deepEqual(extractNamedOptions("what should I eat tonight?"), []);
  });
});

describe("rankCandidates", () => {
  const candidates: Candidate[] = [
    { label: "sushi", tags: ["food.sushi"] },
    { label: "pizza", tags: ["food.pizza"] },
  ];

  it("prefers the option matching a strong liked preference", () => {
    const ranked = rankCandidates(candidates, [pref("food.sushi")], []);
    assert.equal(ranked[0].label, "sushi");
  });

  it("keeps every score inside [0, 1]", () => {
    const ranked = rankCandidates(candidates, [pref("food.sushi"), pref("food.pizza", { polarity: "dislike" })], []);
    for (const option of ranked) {
      assert.ok(option.score >= 0 && option.score <= 1, `score out of range: ${option.score}`);
    }
  });

  it("is deterministic for identical inputs", () => {
    const a = rankCandidates(candidates, [pref("food.sushi")], []);
    const b = rankCandidates(candidates, [pref("food.sushi")], []);
    assert.deepEqual(a, b);
  });

  it("responds to injected weights (configurable scoring)", () => {
    const prefs = [pref("food.sushi")];
    // Sushi was picked yesterday and rated poorly; pizza is unknown.
    const history = [signal("sushi", { reflection: reflection({ rating: 1 }) })];

    const preferenceHeavy = rankCandidates(candidates, prefs, history, {
      preferenceMatch: 1, historySuccess: 0, novelty: 0,
    });
    const historyHeavy = rankCandidates(candidates, prefs, history, {
      preferenceMatch: 0, historySuccess: 1, novelty: 0,
    });

    assert.equal(preferenceHeavy[0].label, "sushi", "preference-only weights should favor the liked option");
    assert.equal(historyHeavy[0].label, "pizza", "history-only weights should punish the badly-rated option");
  });

  it("default weights are normalized to 1", () => {
    const total = DEFAULT_WEIGHTS.preferenceMatch + DEFAULT_WEIGHTS.historySuccess + DEFAULT_WEIGHTS.novelty;
    assert.ok(Math.abs(total - 1) < 1e-9);
  });
});

describe("reinforcementDelta", () => {
  it("is positive for a great outcome", () => {
    const delta = reinforcementDelta(reflection({ rating: 5, would_repeat: true }));
    assert.ok(delta > 0);
  });

  it("is negative for a regretted outcome", () => {
    const delta = reinforcementDelta(reflection({ rating: 1, would_repeat: false, has_regrets: true }));
    assert.ok(delta < 0);
  });

  it("stays clamped to ±0.2", () => {
    const low = reinforcementDelta(reflection({ rating: 1, would_repeat: false, has_regrets: true }));
    const high = reinforcementDelta(reflection({ rating: 5, would_repeat: true }));
    assert.ok(low >= -0.2 && high <= 0.2);
  });
});

describe("guards and confidence", () => {
  it("flags options the user regretted before", () => {
    const history = [signal("sushi", { reflection: reflection({ has_regrets: true }) })];
    assert.equal(hasNegativeHistory("sushi", history), true);
    assert.equal(hasNegativeHistory("pizza", history), false);
  });

  it("reports low confidence for near ties", () => {
    const ranked = rankCandidates(
      [{ label: "a", tags: [] }, { label: "b", tags: [] }],
      [], []
    );
    assert.equal(rankingConfidence(ranked), "low");
  });
});
