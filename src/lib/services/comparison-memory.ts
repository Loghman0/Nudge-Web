import type { SupabaseClient } from "@supabase/supabase-js";
import type { DecisionCategory } from "@/lib/types";
import type { Database } from "@/lib/types/database";
import type { HistorySignal } from "./decision-engine";
import { knowledgeCategoryForDecision } from "./categories";
import { preferencesForDomain, sameDecisionDomain, sameKnowledgeDomain } from "./decision-domain";
import { collectPages } from "./pagination";
import { isSameChoice } from "./similarity";

const HISTORY_LIMIT = 80;
const PAGE_SIZE = 200;

/**
 * Fetch evidence for the verified owner. The history cap applies to usable
 * evidence in this setting, after reset/forgetting, not to unrelated decisions.
 * Follow actual page lengths because hosted PostgREST row caps can be smaller
 * than the requested page size. An empty page, not a short one, ends the scan.
 */
export async function loadComparisonMemory(
  supabase: SupabaseClient<Database>,
  userId: string,
  category: DecisionCategory,
  domain?: string
) {
  const profile = await supabase.from("profiles")
    .select("memory_reset_at, memory_generation").eq("id", userId).single();
  if (profile.error || !profile.data) throw new Error("Could not load decision memory.");

  const [preferenceRows, forgottenRows] = await Promise.all([
    collectPages((from, to) => supabase.from("preferences")
      .select("*, preference_categories(slug)").eq("user_id", userId)
      .order("id", { ascending: true }).range(from, to), PAGE_SIZE),
    collectPages((from, to) => supabase.from("knowledge_nodes")
      .select("key, value, category_slug").eq("user_id", userId).eq("status", "forgotten")
      .eq("category_slug", knowledgeCategoryForDecision(category))
      .order("id", { ascending: true }).range(from, to), PAGE_SIZE),
  ]);
  const preferences = preferencesForDomain(preferenceRows.filter(preference=>!preference.key.startsWith('discovery.')).map(preference => ({
    ...preference, category_slug: preference.preference_categories?.slug ?? null,
  })), domain);
  const forgotten = forgottenRows.filter(node => sameKnowledgeDomain(node.key, domain));
  const resetAt = profile.data.memory_reset_at;
  const history: HistorySignal[] = [];
  let offset = 0;
  while (history.length < HISTORY_LIMIT) {
    let query = supabase.from("decisions")
      .select("id, question, context, decided_at, selected_option_id, decision_options!decision_options_decision_id_fkey(id, label), decision_reflections(rating, would_repeat, has_regrets, would_recommend, would_choose_again, notes, decision_id)")
      .eq("user_id", userId).eq("category", category).in("status", ["decided", "reflected"])
      .order("created_at", { ascending: false }).order("id", { ascending: true });
    if (resetAt) query = query.gt("decided_at", resetAt);
    const page = await query.range(offset, offset + PAGE_SIZE - 1);
    if (page.error || page.data == null) throw new Error("Could not load decision memory. Please try again.");
    if (!page.data.length) break;
    offset += page.data.length;
    for (const decision of page.data) {
      if (!sameDecisionDomain(decision.context, domain)) continue;
      // Keep the reset boundary explicit even if an alternate transport omits
      // its query filter. Reset-era comparisons must never become evidence.
      if (resetAt && (!decision.decided_at || Date.parse(decision.decided_at) <= Date.parse(resetAt))) continue;
      const selected = decision.decision_options.find(option => option.id === decision.selected_option_id);
      if (!selected) continue;
      if (forgotten.some(node => isSameChoice(node.value ?? node.key.split(".").pop()!.replace(/-/g, " "), selected.label))) continue;
      const reflection = Array.isArray(decision.decision_reflections)
        ? decision.decision_reflections[0] ?? null : decision.decision_reflections ?? null;
      history.push({
        decision: { id: decision.id, question: decision.question, decided_at: decision.decided_at },
        selectedLabel: selected.label,
        reflection,
      });
      if (history.length === HISTORY_LIMIT) break;
    }
  }
  return { preferences, history, generation: profile.data.memory_generation };
}
