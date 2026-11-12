import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  KNOWLEDGE_CATEGORIES,
  categorySlugForKey,
  computeKnowledgeScore,
  toKeySegment,
  type ScoreNode,
} from "../src/lib/services/knowledge";
import { loadEngineConfig } from "../src/lib/services/engine-config";
import { DEFAULT_WEIGHTS } from "../src/lib/services/decision-engine";

function node(category: string, overrides: Partial<ScoreNode> = {}): ScoreNode {
  return {
    category_slug: category,
    confidence: 0.8,
    belief_score: 0.7,
    evidence_count: 3,
    last_reinforced_at: new Date().toISOString(),
    status: "active",
    ...overrides,
  };
}

describe("toKeySegment", () => {
  it("normalizes labels into valid key segments", () => {
    assert.equal(toKeySegment("Sushi Place!"), "sushi-place");
    assert.equal(toKeySegment("  Crème brûlée  "), "creme-brulee");
    assert.equal(toKeySegment("???"), "unknown");
  });
});

describe("categorySlugForKey", () => {
  it("maps preference namespaces to the ten score categories", () => {
    assert.equal(categorySlugForKey("cuisine.italian"), "food");
    assert.equal(categorySlugForKey("watch.thrillers"), "movies");
    assert.equal(categorySlugForKey("travel.beach"), "travel");
    assert.equal(categorySlugForKey("money.frugal"), "finance");
    assert.equal(categorySlugForKey("work.deep-focus"), "career");
    assert.equal(categorySlugForKey("social.small-groups"), "relationships");
    assert.equal(categorySlugForKey("fitness.morning-runs"), "health");
    assert.equal(categorySlugForKey("hobby.painting"), "hobbies");
    assert.equal(categorySlugForKey("brand.apple"), "shopping");
    // Anything unrecognized lands in lifestyle rather than being lost.
    assert.equal(categorySlugForKey("learned.that-omakase-place"), "lifestyle");
  });
});

describe("computeKnowledgeScore", () => {
  it("always returns all ten categories", () => {
    const score = computeKnowledgeScore([]);
    assert.equal(score.categories.length, KNOWLEDGE_CATEGORIES.length);
    assert.equal(score.overall, 0);
    for (const category of score.categories) assert.equal(category.score, 0);
  });

  it("scores a well-known category higher than an unknown one", () => {
    const nodes = Array.from({ length: 8 }, () => node("food"));
    const score = computeKnowledgeScore(nodes);
    const food = score.categories.find((c) => c.slug === "food")!;
    const travel = score.categories.find((c) => c.slug === "travel")!;
    assert.ok(food.score > 50, `expected confident food score, got ${food.score}`);
    assert.equal(travel.score, 0);
    assert.ok(score.overall > 0);
  });

  it("rewards more evidence with a higher score", () => {
    const few = computeKnowledgeScore([node("food")]);
    const many = computeKnowledgeScore(Array.from({ length: 10 }, () => node("food")));
    const foodFew = few.categories.find((c) => c.slug === "food")!.score;
    const foodMany = many.categories.find((c) => c.slug === "food")!.score;
    assert.ok(foodMany > foodFew);
  });

  it("fades stale beliefs and counts them", () => {
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
    const fresh = computeKnowledgeScore([node("food"), node("food")]);
    const stale = computeKnowledgeScore([
      node("food", { last_reinforced_at: old }),
      node("food", { last_reinforced_at: old }),
    ]);
    const freshScore = fresh.categories.find((c) => c.slug === "food")!;
    const staleScore = stale.categories.find((c) => c.slug === "food")!;
    assert.ok(staleScore.score < freshScore.score);
    assert.equal(staleScore.stale, 2);
  });

  it("ignores forgotten nodes and keeps scores in range", () => {
    const score = computeKnowledgeScore([
      node("food", { status: "forgotten" }),
      ...Array.from({ length: 20 }, () => node("food", { confidence: 0.98, belief_score: 1 })),
    ]);
    const food = score.categories.find((c) => c.slug === "food")!;
    assert.equal(food.nodes, 20); // the forgotten one is excluded
    assert.ok(food.score >= 0 && food.score <= 100);
  });
});

describe("loadEngineConfig", () => {
  type Row = { category: string; version: number; weights: unknown };

  function fakeClient(rows: Row[], fail = false) {
    return {
      from: () => ({
        select: () => ({
          in: () => ({
            eq: async () => {
              if (fail) throw new Error("db down");
              return { data: rows };
            },
          }),
        }),
      }),
    } as unknown as Parameters<typeof loadEngineConfig>[0];
  }

  it("prefers the category row over default and normalizes weights", async () => {
    const config = await loadEngineConfig(
      fakeClient([
        { category: "default", version: 3, weights: { preferenceMatch: 0.55, historySuccess: 0.3, novelty: 0.15 } },
        { category: "food", version: 2, weights: { preferenceMatch: 2, historySuccess: 1, novelty: 1 } },
      ]),
      "food"
    );
    assert.equal(config.configCategory, "food");
    assert.equal(config.version, 2);
    assert.ok(Math.abs(config.weights.preferenceMatch - 0.5) < 1e-9);
    const total = config.weights.preferenceMatch + config.weights.historySuccess + config.weights.novelty;
    assert.ok(Math.abs(total - 1) < 1e-9);
  });

  it("falls back to the default row when no category row exists", async () => {
    const config = await loadEngineConfig(
      fakeClient([{ category: "default", version: 5, weights: { preferenceMatch: 0.6, historySuccess: 0.25, novelty: 0.15 } }]),
      "travel"
    );
    assert.equal(config.configCategory, "default");
    assert.equal(config.version, 5);
  });

  it("falls back to compiled defaults on malformed weights or db errors", async () => {
    const malformed = await loadEngineConfig(
      fakeClient([{ category: "default", version: 1, weights: { preferenceMatch: "high" } }]),
      "food"
    );
    assert.deepEqual(malformed.weights, DEFAULT_WEIGHTS);

    const down = await loadEngineConfig(fakeClient([], true), "food");
    assert.deepEqual(down.weights, DEFAULT_WEIGHTS);
    assert.equal(down.version, 0);
  });
});
