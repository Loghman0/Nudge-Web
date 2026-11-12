"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { chooseDecision } from "@/lib/services/decision-choice";
import { suggestCandidates } from "@/lib/services/enrichment";
import { getAccountedAi } from "@/lib/services/ai/accounting";
import type { DecisionCategory } from "@/lib/types";
import { isDecisionCategory, isRequestId } from "@/lib/services/comparison-input";
import { decisionScopeError } from "@/lib/services/decision-scope";
import { understandDecision } from "@/lib/services/decision-intake";
import { draftUnderstanding } from "@/lib/services/decision-understanding";
import { loadComparisonMemory as loadMemory } from "@/lib/services/comparison-memory";
import { parseCriteria } from "@/lib/services/comparison-criteria";
import { createComparison, loadSavedComparison, refreshSavedComparison, type CompareResult, type CompareContext } from "@/lib/services/comparison-service";
export type { CompareOption, CompareResult, CompareContext } from "@/lib/services/comparison-service";
/**
 * The core action. The user types short option labels into slots —
 * no sentences, no chat. Nudge scores each against their own memory.
 */
export async function compareOptions(rawOptions: string[], title: string, context: CompareContext = {}, requestId?: string, requestIntent?: import("@/lib/types/database").Json): Promise<CompareResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { decisionId: "", category: "other", title: "", options: [], confidence: "low", coldStart: false, error: "Not signed in." };
  return createComparison(supabase, user.id, rawOptions, title, context, requestId, requestIntent,
    // Typed alternatives already have explicit labels. Their context review
    // must not depend on an optional language provider being available.
    async (text, labels) => draftUnderstanding(text, labels));
}

/** User option labels are dictionary keys; React's object transport omits
 * __proto__. JSON preserves literal keys in both directions without merging them. */
export async function compareOptionsTransport(rawOptions: string[], title: string, contextJson: string, requestId?: string): Promise<string> {
  let context: CompareContext;
  try {
    if (typeof contextJson !== "string" || new TextEncoder().encode(contextJson).byteLength > 512 * 1024) throw new Error("Invalid context");
    context = JSON.parse(contextJson);
  } catch {
    return JSON.stringify({ decisionId:"",category:"other",title:"",options:[],confidence:"low",coldStart:false,errorCode:"invalid_input",error:"The comparison context is invalid. Please review it and try again." });
  }
  return JSON.stringify(await compareOptions(rawOptions, title, context, requestId));
}

export interface Milestone {
  title: string;
  description: string;
}

/** Lock in a choice. This is the moment memory is written. */
export async function chooseOption(
  decisionId: string,
  optionId: string
): Promise<{ error?: string; milestones?: Milestone[]; status?: "decided" | "reflected" }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const choice = await chooseDecision(supabase, user.id, { decisionId, optionId });
  if (!choice.ok) return { error: choice.message };

  // Note: the reflection check-in is deliberately NOT created here. The
  // scheduled job (enqueue_due_reflection_prompts) creates it once the
  // decision is 24h old, which places it inside the push window of the
  // send-checkins edge function. Creating it immediately both suppressed the
  // scheduled prompt (its de-dupe saw an existing row) and guaranteed the
  // push was skipped (the row was already 24h old when eligible).

  // The required choice has committed. Optional milestone failures must not
  // make the persisted choice look failed or invite an unnecessary retry.
  let milestones: Milestone[] = [];
  try {
    const { data: newSlugs, error: achievementError } = await supabase.rpc("evaluate_achievements");
    if (!achievementError && newSlugs?.length) {
      const { data: rows, error: readError } = await supabase.from("achievements")
        .select("slug, title, description").in("slug", newSlugs);
      if (!readError) {
        const bySlug = new Map((rows ?? []).map((r) => [r.slug, r]));
        milestones = newSlugs.map((slug) => bySlug.get(slug))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
          .map((r) => ({ title: r.title, description: r.description }));
      }
    }
  } catch { /* The choice is already saved. */ }

  revalidatePath("/dashboard");
  revalidatePath("/history");
  return { milestones, status: choice.status };
}

/** Restore the persisted comparison without silently changing its scores. */
export async function loadComparison(decisionId: string): Promise<CompareResult | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? loadSavedComparison(supabase, user.id, decisionId) : null;
}
export interface ComparisonSeed { options: string[]; title: string; context: CompareContext }
export async function loadComparisonSeed(decisionId: string): Promise<ComparisonSeed | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: d, error } = await supabase.from("decisions")
    .select("question, category, context, expected_outcome, decision_options!decision_options_decision_id_fkey(label, rank)")
    .eq("id", decisionId).eq("user_id", user.id).maybeSingle();
  if (error || !d) return null;
  const c = d.context as Record<string, unknown>;
  const criteriaInput=parseCriteria(c,d.decision_options.map(o=>o.label));
  if(criteriaInput.error)return null;
  return { options: [...d.decision_options].sort((a,b) => (a.rank ?? 99)-(b.rank ?? 99)).map(o => o.label), title: d.question,
    context: { ...criteriaInput.value, ...(criteriaInput.value?.comparisonBasis==="criteria"?{criteriaConfirmed:false}:{}), category: d.category, mood: typeof c.mood === "string" ? c.mood : undefined,
      domain:typeof c.domain==="string"?c.domain:undefined,goal:typeof c.goal==="string"?c.goal:undefined,
      optionDetails:c.optionDetails && typeof c.optionDetails==="object" && !Array.isArray(c.optionDetails)?c.optionDetails as Record<string,string>:undefined,
      budget: typeof c.budget === "string" ? c.budget : undefined,
      company: typeof c.company === "string" ? c.company : undefined, expectedOutcome: d.expected_outcome ?? undefined } };
}
/** Re-rank every option together; an optional new option is inserted atomically. */
export async function refreshComparison(decisionId: string, extraLabel?: string): Promise<CompareResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { decisionId, title: "", category: "other", options: [], confidence: "low", coldStart: false, error: "Not signed in." };
  const result = await refreshSavedComparison(supabase, user.id, decisionId, extraLabel);
  if (!result.error) revalidatePath("/history");
  return result;
}

export async function refreshComparisonTransport(decisionId: string, extraLabel?: string): Promise<string> {
  return JSON.stringify(await refreshComparison(decisionId, extraLabel));
}

/** Drop a comparison without choosing. */
export async function abandonDecision(decisionId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.rpc("abandon_decision", { p_decision_id: decisionId });
  if(error) throw new Error("Could not abandon comparison");
  revalidatePath("/history");
}

/**
 * "I'm out of ideas" — proposes option labels from the user's own memory,
 * enriched with real-world candidates when an enrichment key is configured.
 */
export async function suggestOptions(category: DecisionCategory): Promise<string[]> {
  if (!isDecisionCategory(category)) return [];
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const [{ data: profile }, memory] = await Promise.all([
    supabase.from("profiles").select("country").eq("id", user.id).maybeSingle(),
    loadMemory(supabase, user.id, category),
  ]);

  return suggestCandidates({
    category,
    preferences: memory.preferences,
    history: memory.history,
    region: profile?.country ?? null,
  });
}

/**
 * Natural-language ask: "What should I eat tonight?"
 *
 * Interpretation only: never silently fills an unfamiliar question with a
 * category's generic starter options or saves a guessed comparison.
 */
export async function askNaturally(rawQuestion: string, requestId?: string): Promise<CompareResult> {
  const question = typeof rawQuestion === "string" ? rawQuestion.trim() : "";
  const empty: CompareResult = {
    decisionId: "", category: "other", title: "", options: [],
    confidence: "low", coldStart: false,
  };
  if (question.length < 3 || question.length > 1000 || (requestId!==undefined && !isRequestId(requestId))) return { ...empty, error: "Enter a decision question of 3 to 1,000 characters." };
  const scopeError = decisionScopeError(question);
  if (scopeError) return { ...empty, error: scopeError };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ...empty, error: "Not signed in." };

  return { ...empty, clarification:await understandDecision(supabase,user.id,question,undefined,await getAccountedAi(supabase,user.id,"interpret")) };
}

/**
 * Compatibility for older clients. Comparisons already carry deterministic
 * reasons; generating a second explanation adds cost without new evidence.
 */
export async function explainDecision(_decisionId: string): Promise<string | null> {
  return null;
}
