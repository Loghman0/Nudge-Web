import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { DecisionCategory, DecisionStatus, Preference } from "@/lib/types";
import { rankCandidates, rankingConfidence, tagsForNamedOption, type Candidate, type HistorySignal } from "./decision-engine";
import { preferencesForCategory } from "./categories";
import { isSameChoice } from "./similarity";
import { loadEngineConfig } from "./engine-config";
import { isRequestId, parseComparisonInput } from "./comparison-input";
import { guessDecisionCategory as guessCategory } from "./comparison-category";
import { decisionScopeError } from "./decision-scope";
import { buildComparisonSnapshot, parseComparisonSnapshot, restoreComparisonSnapshot, SAVED_EVIDENCE_UNAVAILABLE } from "./comparison-snapshot";
import { decodeComparisonSettingsState } from "./comparison-settings";
import type { DecisionMeaning, DecisionUnderstanding } from "./decision-understanding";
import { loadComparisonMemory as loadMemory } from "./comparison-memory";
import { assessCriteria, parseCriteria, criteriaForOptions, withoutDiscoveryReferences, type CriteriaContext, type CriteriaAssessment } from "./comparison-criteria";
import {resolveCriterionSources,CriterionSourceChanged,type CriterionSource} from './criterion-provenance';

export type ComparisonErrorCode = "invalid_input" | "needs_confirmation" | "forbidden" | "conflict" | "not_found" | "unavailable";
export interface CompareOption {
  id: string;
  label: string;
  score: number;
  breakdown: Record<string, number>;
  /** Why this scored what it scored — built from the user's own data. */
  reasons: string[];
  /** Regret guard: past reflections on this choice were negative. */
  warning: boolean;
}

export interface CompareResult {
  criteriaInput?: CriteriaContext;
  criteriaAssessment?: CriteriaAssessment;
  criterionSources?: CriterionSource[];
  clarification?: DecisionUnderstanding;
  meaning?: DecisionMeaning;
  evidenceState?: "personal_fit" | "insufficient";
  /** A saved explanation belongs to one scoring revision and never reads current memory. */
  evidenceSnapshotState?: "saved" | "unavailable";
  scoredAt?: string;
  decisionId: string;
  category: DecisionCategory;
  title: string;
  options: CompareOption[];
  confidence: "high" | "medium" | "low";
  /** True when Nudge has too little memory to be genuinely useful yet. */
  coldStart: boolean;
  status?: DecisionStatus;
  selectedOptionId?: string | null;
  revision?: number;
  /** Identifies the persisted scoring attempt, including after an idempotent replay. */
  scoringRunId?: string;
  reflectionDueAt?: string | null;
  reminderEnabled?: boolean;
  error?: string;
  errorCode?: ComparisonErrorCode;
  settingsInvalidated?: boolean;
}

export interface CompareContext extends DecisionMeaning, CriteriaContext {
  /** Transient privacy guard; never copied into the recorded journal context. */
  appliedSetting?: { id: string; generation: number };
  mood?: string;
  budget?: string;
  company?: string;
  category?: DecisionCategory;
  /** "What do you expect to happen?" — compared against the reflection later. */
  expectedOutcome?: string;
}


async function loadCriteriaGeneration(supabase: SupabaseClient<Database>, userId: string) {
  const profile = await supabase.from("profiles").select("memory_generation").eq("id", userId).single();
  if (profile.error || !profile.data) throw new Error("Could not load the comparison generation.");
  return { preferences: [] as Preference[], history: [] as HistorySignal[], generation: profile.data.memory_generation };
}


export async function createComparison(
  supabase: SupabaseClient<Database>, verifiedUserId: string,
  rawOptions: string[],
  title: string,
  context: CompareContext = {},
  requestId?: string,
  requestIntent?: import("@/lib/types/database").Json,
  clarify?: (text: string, labels: string[]) => Promise<DecisionUnderstanding>
): Promise<CompareResult> {
  const empty: CompareResult = {
    decisionId: "", category: "other", title: "", options: [],
    confidence: "low", coldStart: false,
  };

  const parsed = parseComparisonInput(rawOptions, title, context);
  if (parsed.options === undefined) return { ...empty, errorCode: "invalid_input", error: parsed.error };
  if (requestId !== undefined && !isRequestId(requestId)) return { ...empty, errorCode: "invalid_input", error: "The comparison request is invalid. Please try again." };
  const labels = parsed.options;
  title = parsed.title;
  context = parsed.context;
  const scopeError = decisionScopeError([title,...labels,context.domain??"",context.goal??"",...Object.values(context.optionDetails??{}),context.expectedOutcome??""].join(" "));
  if (scopeError) return { ...empty, errorCode: "forbidden", error: scopeError };
  const user = { id: verifiedUserId };

  if (context.appliedSetting) {
    const { data, error } = await supabase.rpc("get_comparison_settings_state");
    const state = error ? null : decodeComparisonSettingsState(data);
    const setting = state?.settings.find(candidate => candidate.id === context.appliedSetting!.id);
    if (!state?.available || state.generation !== context.appliedSetting.generation || !setting || setting.domain !== context.domain)
      return { ...empty, settingsInvalidated: true, errorCode: "conflict", error: "This saved setting changed or was removed. Review your setting and meanings again." };
  }

  if (!context.domain || context.meaningConfirmed !== true) {
    return clarify ? { ...empty, clarification: await clarify(title || labels.join(" or "), labels) }
      : { ...empty, errorCode: "needs_confirmation", error: "Confirm the setting and meaning before comparing." };
  }
  if (context.comparisonBasis === "criteria" && context.criteriaConfirmed !== true) return { ...empty, errorCode: "needs_confirmation", error: "Review and confirm the values and sources used for your criteria." };
  const category = context.category ?? guessCategory(labels);
  const decisionTitle = title.trim().slice(0, 120) || labels.join(" vs ").slice(0, 120);

  const [{ preferences, history, generation }, engineConfig] = await Promise.all([
    context.comparisonBasis === "criteria" ? loadCriteriaGeneration(supabase, user.id) : loadMemory(supabase, user.id, category, context.domain),
    loadEngineConfig(supabase, category),
  ]);

  const scopedPrefs = preferencesForCategory(preferences, category);
  if (context.appliedSetting && context.appliedSetting.generation !== generation)
    return { ...empty, settingsInvalidated: true, errorCode: "conflict", error: "Your memory changed. Review your setting and meanings again." };
  const asOf = Date.now();
  let criterionSources:CriterionSource[]=[];
  if(context.criteria?.some(c=>c.discoverySuggestion)){
    try{criterionSources=await resolveCriterionSources(supabase,context.criteria,{domain:context.domain,category},generation);}
    catch(error){if(error instanceof CriterionSourceChanged)return {...empty,errorCode:'conflict',error:error.message};throw error;}
  }

  const candidates: Candidate[] = labels.map((label) => ({
    label,
    tags: tagsForNamedOption(label, scopedPrefs),
  }));

  const criteriaAssessment = context.comparisonBasis === "criteria" ? assessCriteria(context.criteria!, labels) : null;
  const ranked = criteriaAssessment ? criteriaAssessment.options.map(o => ({label:o.label,tags:[],score:o.low,breakdown:{criteriaLow:o.low,criteriaHigh:o.high,coverage:o.coverage}})) : rankCandidates(candidates, scopedPrefs, history, engineConfig.weights, asOf);
  const hasEvidence = candidates.some(c=>c.tags.length>0 || history.some(h=>h.selectedLabel!=null && isSameChoice(h.selectedLabel,c.label)));
  const confidence = criteriaAssessment ? "low" : hasEvidence ? rankingConfidence(ranked) : "low";
  const coldStart = !criteriaAssessment && scopedPrefs.filter((p) => p.polarity !== "neutral").length < 3 && history.length === 0;

  const scoringRunId=crypto.randomUUID();
  const evidenceState = !criteriaAssessment && hasEvidence ? "personal_fit" : "insufficient";
  const storedContext = {
    ...(criteriaAssessment ? {comparisonBasis:"criteria", criteria:withoutDiscoveryReferences(context.criteria!).map(c=>({...c,values:Object.fromEntries(Object.entries(c.values).map(([label,cell])=>[label,{...cell}]))})),criteriaConfirmed:true,criteriaVersion:1,...(criterionSources.length?{discovery_criteria_used:true}:{})} : {comparisonBasis:"journal"}),
    domain:context.domain, goal:context.goal ?? "", optionDetails:context.optionDetails ?? {},
    meaningConfirmed:true, evidence_state:evidenceState,
    mood: context.mood ?? null, budget: context.budget ?? null, company: context.company ?? null,
    confidence, cold_start: coldStart, scored_at: new Date(asOf).toISOString(), scoring_run_id:scoringRunId, engine_version: 2,
    engine_config: { category: engineConfig.configCategory, version: engineConfig.version, weights: { ...engineConfig.weights } },
  };
  const snapshot = buildComparisonSnapshot({ scoringRunId, asOf, config: engineConfig, ranked, preferences: scopedPrefs, history, confidence, coldStart, evidenceState, criteriaAssessment,criterionSources });
  const { data: decisionId, error: decisionError } = await supabase.rpc("create_comparison_with_evidence", {
    p_request_id: requestId ?? crypto.randomUUID(),
    // Keep semantic source IDs only in the retractable private snapshot. The
    // retry ledger needs the user's explicit inputs, not their answer links.
    p_intent: criterionSources.length ? JSON.parse(JSON.stringify({options:labels,title,context:{...context,criteria:withoutDiscoveryReferences(context.criteria!)}})) : requestIntent ?? JSON.parse(JSON.stringify({ options: labels, title, context })),
    p_category: category, p_title: decisionTitle, p_context: storedContext,
    p_expected_outcome: context.expectedOutcome?.trim().slice(0, 300) || null,
    p_options: ranked.map(o => ({ label: o.label, score: o.score, breakdown: o.breakdown })), p_generation: generation,
    p_evidence: JSON.parse(JSON.stringify(snapshot)),
  });
  if (decisionError || !decisionId) return { ...empty, errorCode: comparisonWriteConflict(decisionError) ? "conflict" : "unavailable", error: "Couldn't save the comparison. Your memory may have changed; try again." };
  // An idempotent replay may return an earlier comparison after memory or
  // suggestions changed. Always return persisted option IDs/scores/status.
  const persisted = await loadSavedComparison(supabase, verifiedUserId, decisionId);
  if (!persisted) return { ...empty, errorCode: "unavailable", error: "Your comparison was saved. Open it from History to continue." };
  return persisted;
}


export async function loadSavedComparison(supabase: SupabaseClient<Database>, verifiedUserId: string, decisionId: string): Promise<CompareResult | null> {
  if (!isRequestId(decisionId)) return null;
  const user = { id: verifiedUserId };
  const { data: d, error } = await supabase.from("decisions")
    .select("id, question, category, context, status, selected_option_id, comparison_revision, reflection_due_at, reminder_enabled, decision_options!decision_options_decision_id_fkey(id, label, score, score_breakdown, rank)")
    .eq("id", decisionId).eq("user_id", user.id).maybeSingle();
  if (error || !d) return null;
  const context = d.context as Record<string, unknown>;
  const domain=typeof context.domain==="string" ? context.domain : undefined;
  const options = [...d.decision_options].sort((a,b) => (a.rank ?? 99)-(b.rank ?? 99));
  const criteriaInput = parseCriteria(context, options.map(o=>o.label));
  if (criteriaInput.error || (context.comparisonBasis === "criteria" && criteriaInput.value?.criteriaConfirmed !== true)) return null;
  const savedOptions = options.map(option => ({ label: option.label, score: option.score ?? 0.5, breakdown: option.score_breakdown as Record<string, number> }));
  const confirmedCriteriaAssessment = criteriaInput.value?.comparisonBasis === "criteria" ? assessCriteria(criteriaInput.value.criteria!, options.map(option => option.label)) : undefined;
  const { data: evidenceRows, error: evidenceError } = await supabase.rpc("read_my_comparison_evidence", { p_decision_id: decisionId });
  const snapshot = evidenceError ? null : restoreComparisonSnapshot(evidenceRows?.find(row => row.comparison_revision === d.comparison_revision), { decisionId: d.id, revision: d.comparison_revision, context, options: savedOptions, criteriaAssessment: confirmedCriteriaAssessment });
  const criteriaAssessment = snapshot ? confirmedCriteriaAssessment : undefined;
  return { decisionId: d.id, title: d.question, category: d.category, status: d.status,
    criteriaInput:criteriaInput.value, criteriaAssessment,criterionSources:snapshot?.criterionSources,
    meaning:{domain,goal:typeof context.goal==="string"?context.goal:undefined,
      optionDetails:context.optionDetails && typeof context.optionDetails==="object" && !Array.isArray(context.optionDetails)?context.optionDetails as Record<string,string>:undefined,
      meaningConfirmed:context.meaningConfirmed===true},
    evidenceState:snapshot?.evidenceState ?? "insufficient",
    evidenceSnapshotState:snapshot ? "saved" : "unavailable", scoredAt:snapshot?.scoredAt,
    selectedOptionId: d.selected_option_id, revision: d.comparison_revision,
    scoringRunId:typeof context.scoring_run_id==="string"?context.scoring_run_id:undefined,
    reflectionDueAt: d.reflection_due_at, reminderEnabled: d.reminder_enabled,
    confidence: snapshot?.confidence ?? "low",
    coldStart: snapshot?.coldStart ?? false,
    options: options.map(o => ({ id: o.id, label: o.label, score: o.score ?? 0.5,
      breakdown: o.score_breakdown as Record<string, number>, warning: snapshot?.options.find(option => option.label === o.label)?.warning ?? false,
      reasons: snapshot?.options.find(option => option.label === o.label)?.reasons ?? [SAVED_EVIDENCE_UNAVAILABLE] })),
  };
}

export async function refreshSavedComparison(supabase: SupabaseClient<Database>, verifiedUserId: string, decisionId: string, extraLabel?: string, expectedRevision?: number): Promise<CompareResult> {
  const empty: CompareResult = { decisionId, title: "", category: "other", options: [], confidence: "low", coldStart: false };
  if (!isRequestId(decisionId) || (extraLabel!==undefined && (typeof extraLabel!=="string" || extraLabel.length>80))
    || (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)))
    return {...empty,errorCode:"invalid_input",error:"The comparison or extra option is invalid."};
  const user = { id: verifiedUserId };
  const { data: d, error } = await supabase.from("decisions")
    .select("question, category, context, expected_outcome, comparison_revision, status, decision_options!decision_options_decision_id_fkey(id, label, rank)")
    .eq("id",decisionId).eq("user_id",user.id).maybeSingle();
  if (error) return { ...empty, errorCode: "unavailable", error: "Could not load this comparison. Please try again." };
  if (!d) return { ...empty, errorCode: "not_found", error: "This comparison could not be found." };
  if (d.status !== "open" || (expectedRevision !== undefined && expectedRevision !== d.comparison_revision))
    return { ...empty, errorCode: "conflict", error: "This comparison changed or is no longer open. Reload before refreshing." };
  const options = [...d.decision_options].sort((a,b) => (a.rank ?? 99)-(b.rank ?? 99));
  const extra = extraLabel?.trim().slice(0,80);
  if (extra) {
    if (options.length >= 8 || options.some(o => o.label.toLowerCase() === extra.toLowerCase())) return { ...empty, errorCode: "invalid_input", error: "Use up to eight distinct options." };
    options.push({ id: "", label: extra, rank: 99 });
  }
  const previousContext=d.context as Record<string,import("@/lib/types/database").Json>;
  const details=previousContext.optionDetails && typeof previousContext.optionDetails==="object" && !Array.isArray(previousContext.optionDetails)
    ? Object.values(previousContext.optionDetails).filter(value=>typeof value==="string") : [];
  const scopeError=decisionScopeError([d.question,...options.map(option=>option.label),previousContext.domain,previousContext.goal,...details,d.expected_outcome].filter(value=>typeof value==="string").join(" "));
  if (scopeError) return {...empty,errorCode:"forbidden",error:scopeError};
  const criteriaInput=parseCriteria(previousContext,options.map(o=>o.label));
  if(criteriaInput.error || (previousContext.comparisonBasis==="criteria" && !criteriaInput.value?.criteriaConfirmed)) return {...empty,errorCode:"conflict",error:"The saved criteria could not be validated. Copy and review the comparison before continuing."};
  const domain=typeof previousContext.domain==="string"?previousContext.domain:undefined;
  const { preferences, history, generation } = await (criteriaInput.value?.comparisonBasis === "criteria" ? loadCriteriaGeneration(supabase, user.id) : loadMemory(supabase,user.id,d.category,domain));
  let criterionSources:CriterionSource[]=[];
  if(previousContext.discovery_criteria_used===true){
    const {data:rows,error:sourceError}=await supabase.rpc('read_my_comparison_evidence',{p_decision_id:decisionId});
    const row=rows?.find(r=>r.comparison_revision===d.comparison_revision);
    const previous=sourceError?null:parseComparisonSnapshot(row?.snapshot);
    if(!previous?.criterionSources?.length||row?.memory_generation!==generation||previous.scoringRunId!==previousContext.scoring_run_id)return {...empty,errorCode:'conflict',error:'The answers behind your suggested criteria changed. Copy and review this comparison before recalculating.'};
    const referenced=criteriaInput.value!.criteria!.map(c=>{const source=previous.criterionSources!.find(s=>s.criterionId===c.id);return {...c,...(source?{discoverySuggestion:{id:source.suggestionId,generation:source.generation}}:{})};});
    try{criterionSources=await resolveCriterionSources(supabase,referenced,{domain:domain??'',category:d.category},generation);}
    catch(error){if(error instanceof CriterionSourceChanged)return {...empty,errorCode:'conflict',error:error.message};throw error;}
  }
  const prefs = preferencesForCategory(preferences,d.category);
  const config = await loadEngineConfig(supabase,d.category);
  const asOf = Date.now();
  const criteriaAssessment=criteriaInput.value?.comparisonBasis==="criteria" ? assessCriteria(criteriaInput.value.criteria!,options.map(o=>o.label)) : null;
  const ranked = criteriaAssessment ? criteriaAssessment.options.map(o=>({label:o.label,tags:[],score:o.low,breakdown:{criteriaLow:o.low,criteriaHigh:o.high,coverage:o.coverage}})) : rankCandidates(options.map(o => ({ label: o.label, tags: tagsForNamedOption(o.label,prefs) })),prefs,history,config.weights,asOf);
  const hasEvidence=ranked.some(c=>c.tags.length>0 || history.some(h=>h.selectedLabel!=null && isSameChoice(h.selectedLabel,c.label)));
  const confidence = hasEvidence ? rankingConfidence(ranked) : "low";
  const coldStart = prefs.filter(p => p.polarity !== "neutral").length < 3 && !history.length;
  const scoringRunId=crypto.randomUUID();
  const evidenceState = !criteriaAssessment && hasEvidence ? "personal_fit" : "insufficient";
  const context = { ...previousContext, ...(criteriaAssessment ? {criteria:criteriaForOptions(criteriaInput.value!.criteria!,options.map(o=>o.label)).map(c=>({...c,values:Object.fromEntries(Object.entries(c.values).map(([label,cell])=>[label,{...cell}]))})),criteriaVersion:1} : {}), evidence_state:evidenceState, confidence:criteriaAssessment?"low":confidence, cold_start: criteriaAssessment?false:coldStart,scoring_run_id:scoringRunId,
    scored_at: new Date(asOf).toISOString(), engine_version:2, engine_config: { category: config.configCategory, version: config.version, weights: { ...config.weights } } };
  const snapshot = buildComparisonSnapshot({ scoringRunId, asOf, config, ranked, preferences: prefs, history, confidence: criteriaAssessment ? "low" : confidence, coldStart: criteriaAssessment ? false : coldStart, evidenceState, criteriaAssessment,criterionSources });
  const { error: saveError } = await supabase.rpc("rerank_comparison_with_evidence", {
    p_decision_id:decisionId, p_revision:d.comparison_revision, p_generation:generation, p_context:context,
    p_options:ranked.map(o => ({ id:options.find(p => p.label===o.label)?.id || null, label:o.label, score:o.score, breakdown:o.breakdown })),
    p_evidence: JSON.parse(JSON.stringify(snapshot)),
  });
  if (saveError) return { ...empty, errorCode: comparisonWriteConflict(saveError) ? "conflict" : "unavailable", error: "Couldn't refresh. The comparison or your memory changed; reload and try again." };
  const result = await loadSavedComparison(supabase, verifiedUserId, decisionId);
  if (!result) return { ...empty, errorCode: "unavailable", error: "Saved; open the comparison from History to continue." };
  return result;
}


function comparisonWriteConflict(error: {code?: string; message?: string} | null): boolean {
  return error?.code === "P0001" && /memory changed|request.*different|different.*request|already.*different|comparison changed|no longer open|revision|retry does not match/i.test(error.message ?? "");
}
