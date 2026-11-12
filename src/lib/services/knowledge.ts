/**
 * Knowledge graph service layer.
 *
 * Every learning event in the product funnels through `recordKnowledgeSignal`,
 * which calls the `record_knowledge_signal` RPC from migration 00007. The RPC
 * atomically: upserts the node, accumulates support/opposition weight,
 * recomputes belief + confidence, appends an immutable evidence row, and
 * (via trigger) projects the node back into the legacy `preferences` table so
 * older screens keep working untouched.
 *
 * This module also owns the category taxonomy for the Knowledge Score:
 * Food, Movies, Shopping, Travel, Health, Career, Lifestyle, Relationships,
 * Finance, Hobbies — scored per category, not as one completion percentage.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreferencePolarity, DecisionCategory } from "@/lib/types";
import { CATEGORY_PREFIXES, knowledgeCategoryForDecision } from "./categories";

export type EvidenceKind =
  | "onboarding_answer"
  | "discover_answer"
  | "decision"
  | "reflection"
  | "confirmation"
  | "ai_extraction"
  | "manual";

export type SignalSource = "explicit" | "inferred" | "reflected" | "ai_extracted" | "imported";

export interface KnowledgeSignal {
  key: string;
  value?: string | null;
  categorySlug?: string | null;
  polarity: Exclude<PreferencePolarity, "neutral">;
  source: SignalSource;
  /** Evidence weight in (0, 1]. Stronger signals move belief further. */
  weight: number;
  kind: EvidenceKind;
  decisionId?: string | null;
  questionId?: string | null;
  /** True when the user directly confirmed this (resets the verification clock). */
  verified?: boolean;
  detail?: Record<string, unknown>;
  memoryGeneration?: number;
}

/** Normalize free text into a valid knowledge key segment. */
export function toKeySegment(text: string): string {
  const normalized = text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
  const segment = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!/[^\x00-\x7f]/.test(normalized) && segment.length <= 60) return segment || "unknown";
  // Retain distinct identities for Unicode and long labels while satisfying
  // the database's ASCII key grammar. Hash the full label, not its prefix.
  let hash = 14695981039346656037n;
  for (const char of normalized) hash = BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0)!)) * 1099511628211n);
  return `${segment.slice(0, 42) || "label"}-${hash.toString(16).padStart(16, "0")}`;
}

type Rpc = Pick<SupabaseClient, "rpc">;

/**
 * Write one immutable evidence event and recompute its node.
 * Returns the node id, or null (never throws — learning must not break UX).
 */
export async function recordKnowledgeSignal(
  supabase: Rpc,
  signal: KnowledgeSignal
): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc("record_knowledge_signal", {
      p_key: signal.key,
      p_value: signal.value ?? null,
      p_category_slug: signal.categorySlug ?? categorySlugForKey(signal.key),
      p_polarity: signal.polarity,
      p_source: signal.source,
      p_weight: Math.max(0.05, Math.min(1, signal.weight)),
      p_kind: signal.kind,
      p_source_decision_id: signal.decisionId ?? null,
      p_source_question_id: signal.questionId ?? null,
      p_verified: signal.verified ?? false,
      p_detail: signal.detail ?? {},
      p_expected_generation: signal.memoryGeneration ?? null,
    });
    if (error) {
      console.error("[knowledge] record_knowledge_signal failed", {
        code: /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(error.code ?? "") ? error.code : "unavailable",
      });
      return null;
    }
    return (data as string | null) ?? null;
  } catch {
    console.error("[knowledge] record_knowledge_signal transport failed");
    return null;
  }
}

export async function recordKnowledgeSignals(supabase: Rpc, signals: KnowledgeSignal[]) {
  // Sequential on purpose: signals for the same key must accumulate in order.
  for (const signal of signals) await recordKnowledgeSignal(supabase, signal);
}

// ---------- Knowledge Score taxonomy ---------------------------------------

export const KNOWLEDGE_CATEGORIES = [
  { slug: "food", label: "Food" },
  { slug: "movies", label: "Movies" },
  { slug: "shopping", label: "Shopping" },
  { slug: "travel", label: "Travel" },
  { slug: "health", label: "Health" },
  { slug: "career", label: "Career" },
  { slug: "lifestyle", label: "Lifestyle" },
  { slug: "relationships", label: "Relationships" },
  { slug: "finance", label: "Finance" },
  { slug: "hobbies", label: "Hobbies" },
] as const;

export type KnowledgeCategorySlug = (typeof KNOWLEDGE_CATEGORIES)[number]["slug"];

/** Map a preference-style key ('cuisine.italian') to a score category slug. */
export function categorySlugForKey(key: string): KnowledgeCategorySlug {
  const namespace = key.toLowerCase().split(".")[0];
  const categories: DecisionCategory[] = ["food", "entertainment", "shopping", "travel", "health", "career", "relationships", "finance", "hobbies", "lifestyle"];
  for (const category of categories) {
    if (CATEGORY_PREFIXES[category].includes(namespace)) return knowledgeCategoryForDecision(category) as KnowledgeCategorySlug;
  }
  return "lifestyle";
}

export interface CategoryScore {
  slug: KnowledgeCategorySlug;
  label: string;
  /** 0–100. How well Nudge knows this area of the user's life. */
  score: number;
  nodes: number;
  /** Nodes whose confidence has decayed / never been verified recently. */
  stale: number;
}

export interface KnowledgeScore {
  overall: number; // 0–100, mean of category scores
  categories: CategoryScore[];
}

export interface ScoreNode {
  category_slug: string;
  confidence: number;
  belief_score: number;
  evidence_count: number;
  last_reinforced_at: string | null;
  status?: string;
}

/**
 * Category-by-category Knowledge Score.
 *
 * A category earns points for (a) breadth — number of distinct beliefs, with
 * diminishing returns after ~8; (b) conviction — confidence-weighted belief
 * strength; (c) freshness — recently reinforced beliefs count fully, stale
 * ones fade. 100 means: many confident, recently-confirmed beliefs.
 */
export function computeKnowledgeScore(nodes: ScoreNode[]): KnowledgeScore {
  const now = Date.now();
  const byCategory = new Map<string, ScoreNode[]>();
  for (const node of nodes) {
    if (node.status && node.status !== "active") continue;
    const slug = (KNOWLEDGE_CATEGORIES.some((c) => c.slug === node.category_slug)
      ? node.category_slug
      : "lifestyle") as KnowledgeCategorySlug;
    const list = byCategory.get(slug) ?? [];
    list.push(node);
    byCategory.set(slug, list);
  }

  const categories: CategoryScore[] = KNOWLEDGE_CATEGORIES.map(({ slug, label }) => {
    const list = byCategory.get(slug) ?? [];
    if (list.length === 0) return { slug, label, score: 0, nodes: 0, stale: 0 };

    let quality = 0;
    let stale = 0;
    for (const node of list) {
      const days = node.last_reinforced_at
        ? (now - new Date(node.last_reinforced_at).getTime()) / 86_400_000
        : 365;
      const freshness = Math.exp(-Math.max(0, days - 30) / 120); // grace month, ~4-month fade
      if (freshness < 0.6) stale++;
      quality += node.confidence * Math.min(1, Math.abs(node.belief_score) + 0.35) * freshness;
    }

    const breadth = 1 - Math.exp(-list.length / 5); // ~8 beliefs ≈ 80% breadth
    const conviction = Math.min(1, quality / Math.max(1, list.length) / 0.75);
    const score = Math.round(100 * (0.45 * breadth + 0.55 * conviction * breadth ** 0.25));
    return { slug, label, score: Math.max(0, Math.min(100, score)), nodes: list.length, stale };
  });

  const overall = Math.round(categories.reduce((sum, c) => sum + c.score, 0) / categories.length);
  return { overall, categories };
}
