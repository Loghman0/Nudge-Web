/**
 * Versioned, deterministic engine configuration.
 *
 * Weights live in `decision_engine_configs` (one active row per category,
 * enforced by a partial unique index). Ranking loads the category row if one
 * exists, otherwise the 'default' row, otherwise compiled defaults — so the
 * engine keeps working even before migration 00007 has run.
 *
 * The resolved config (category, version, weights) is stored on every ranked
 * decision, which makes each historical score reproducible and auditable.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_WEIGHTS, type EngineWeights } from "./decision-engine";
import type { DecisionCategory } from "@/lib/types";

export interface ResolvedEngineConfig {
  /** The config row that was actually used ('default' when no category row exists). */
  configCategory: string;
  version: number;
  weights: EngineWeights;
}

const FALLBACK: ResolvedEngineConfig = {
  configCategory: "compiled-default",
  version: 0,
  weights: DEFAULT_WEIGHTS,
};

function sanitize(raw: unknown): EngineWeights | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  const preferenceMatch = Number(w.preferenceMatch);
  const historySuccess = Number(w.historySuccess);
  const novelty = Number(w.novelty);
  if (![preferenceMatch, historySuccess, novelty].every((n) => Number.isFinite(n) && n >= 0)) {
    return null;
  }
  const total = preferenceMatch + historySuccess + novelty;
  if (total <= 0) return null;
  // Normalize so scores stay in [0, 1] whatever an admin typed into the row.
  return {
    preferenceMatch: preferenceMatch / total,
    historySuccess: historySuccess / total,
    novelty: novelty / total,
  };
}

export async function loadEngineConfig(
  // Accept any client shape; only `.from()` is used.
  supabase: Pick<SupabaseClient, "from">,
  category: DecisionCategory
): Promise<ResolvedEngineConfig> {
  try {
    const { data } = await supabase
      .from("decision_engine_configs")
      .select("category, version, weights")
      .in("category", [category, "default"])
      .eq("is_active", true);

    const rows = (data ?? []) as { category: string; version: number; weights: unknown }[];
    const row = rows.find((r) => r.category === category) ?? rows.find((r) => r.category === "default");
    if (!row) return FALLBACK;
    const weights = sanitize(row.weights);
    if (!weights) return FALLBACK;
    return { configCategory: row.category, version: row.version, weights };
  } catch {
    return FALLBACK;
  }
}
