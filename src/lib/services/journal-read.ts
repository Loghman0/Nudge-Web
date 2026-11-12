import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { DecisionCategory, DecisionStatus } from "@/lib/types";
import { isDecisionCategory, isRequestId } from "./comparison-input";
import { assessCriteria, parseCriteria } from "./comparison-criteria";
import { restoreComparisonSnapshot, type ComparisonEvidenceSnapshot } from "./comparison-snapshot";
import type { Json } from "@/lib/types/database";

export interface JournalQuery { limit: number; offset: number; query: string; category?: DecisionCategory; status?: DecisionStatus }
const statuses: DecisionStatus[] = ["open", "decided", "reflected", "abandoned"];
export function parseJournalQuery(params: URLSearchParams): JournalQuery | null {
  const allowed = new Set(["limit", "offset", "q", "category", "status"]);
  if ([...params.keys()].some(key => !allowed.has(key) || params.getAll(key).length !== 1)) return null;
  const limit = params.get("limit") ?? "20", offset = params.get("offset") ?? "0", query = params.get("q") ?? "";
  if (!/^\d{1,2}$/.test(limit) || Number(limit) < 1 || Number(limit) > 50 || !/^\d{1,6}$/.test(offset) || Number(offset) > 100000 || query.length > 120) return null;
  const category = params.get("category"), status = params.get("status");
  if (category !== null && !isDecisionCategory(category)) return null;
  if (status !== null && !statuses.includes(status as DecisionStatus)) return null;
  return { limit: Number(limit), offset: Number(offset), query: query.trim(), ...(category ? { category: category as DecisionCategory } : {}), ...(status ? { status: status as DecisionStatus } : {}) };
}
/** Stable live pagination; nextOffset follows actual rows when the server has a lower row cap. */
export async function readJournal(db: SupabaseClient<Database>, userId: string, query: JournalQuery) {
  let request = db.from("decisions").select("id,question,category,status,created_at,decided_at,selected_option_id,reflection_due_at,reminder_enabled", { count: "exact" }).eq("user_id", userId);
  if (query.query) request = request.ilike("question", `%${query.query.replace(/[\\%_]/g, "\\$&")}%`);
  if (query.category) request = request.eq("category", query.category);
  if (query.status) request = request.eq("status", query.status);
  const { data, error, count } = await request.order("created_at", { ascending: false }).order("id", { ascending: true }).range(query.offset, query.offset + query.limit - 1);
  if (error || data === null || count === null || (!data.length && query.offset < count)) throw new Error("Couldn't load the journal.");
  return { decisions: data, pagination: { offset: query.offset, limit: query.limit, total: count, nextOffset: query.offset + data.length < count ? query.offset + data.length : null }, consistency: "live" as const };
}
export async function readJournalDecision(db: SupabaseClient<Database>, userId: string, id: string) {
  if (!isRequestId(id)) return { invalid: true as const };
  const { data, error } = await db.from("decisions")
    .select("id,question,category,status,created_at,decided_at,selected_option_id,comparison_revision,context,expected_outcome,reflection_due_at,reminder_enabled,decision_options!decision_options_decision_id_fkey(id,label,rank,score,score_breakdown),decision_reflections(rating,would_repeat,has_regrets,would_recommend,would_choose_again,notes)")
    .eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) throw new Error("Couldn't load this decision.");
  if (!data) return { invalid: false as const, decision: null };
  const context = data.context && typeof data.context === "object" && !Array.isArray(data.context) ? data.context as Record<string, unknown> : {};
  const options = [...data.decision_options].sort((a,b) => (a.rank ?? 99) - (b.rank ?? 99));
  const parsed = parseCriteria(context, options.map(option => option.label));
  const assessment = !parsed.error && parsed.value?.comparisonBasis === "criteria" && parsed.value.criteriaConfirmed
    ? assessCriteria(parsed.value.criteria!, options.map(option => option.label)) : undefined;
  const evidence = await db.rpc("read_my_comparison_evidence", { p_decision_id: id });
  const snapshot = evidence.error || parsed.error ? null : restoreComparisonSnapshot(evidence.data?.find(row => row.comparison_revision === data.comparison_revision), {
    decisionId: id, revision: data.comparison_revision, context,
    options: options.map(option => ({ label: option.label, score: option.score ?? .5, breakdown: option.score_breakdown as Record<string, number> })), criteriaAssessment: assessment,
  });
  // Keep explicit recorded context; derived confidence and ranking claims must
  // come only from the validated saved explanation, never an old context flag.
  const recordedKeys = ["domain", "goal", "optionDetails", "meaningConfirmed", "mood", "budget", "company", "comparisonBasis", "criteria", "criteriaConfirmed", "criteriaVersion"];
  const recordedContext = Object.fromEntries(recordedKeys.filter(key => Object.hasOwn(context, key)).map(key => [key, context[key]])) as Json;
  const saved_explanation: { state: "saved"; revision: number; snapshot: ComparisonEvidenceSnapshot } | { state: "unavailable"; revision: number } = snapshot
    ? { state: "saved", revision: data.comparison_revision, snapshot } : { state: "unavailable", revision: data.comparison_revision };
  return { invalid: false as const, decision: { ...data, context: recordedContext, saved_explanation,
    decision_options: options.map(option => ({ ...option, score: snapshot ? option.score : null, score_breakdown: snapshot ? option.score_breakdown : null })) } };
}
