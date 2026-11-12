import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { AiAttemptAccounting, AiAttemptResult, AiProvider, AiRequestOptions } from "./provider";
import { getAi } from "./index";
import { readAiAccountingConfig, ratedCostMicros, type AiAccountingConfig, type AiModelPrice } from "./accounting-config";
import { POLICY_VERSION } from "@/lib/legal/config";

type UsageAction = "interpret" | "extract" | "recap";
type Ledger = Pick<SupabaseClient<Database>, "rpc">;

export function createAiAccounting(ledger: Ledger, userId: string, generation: number, action: UsageAction, config: AiAccountingConfig): AiAttemptAccounting {
  const prices = new Map<string, AiModelPrice>();
  return {
    async reserve(attempt) {
      const price = config.models.find(row => row.provider === attempt.provider && row.model === attempt.model);
      if (!price || !Number.isInteger(attempt.inputBytes) || attempt.inputBytes < 1 || attempt.inputBytes > price.maxInputBytes
        || !Number.isInteger(attempt.outputTokenLimit) || attempt.outputTokenLimit < 1 || attempt.outputTokenLimit > price.maxOutputTokens) return null;
      const quote = ratedCostMicros(attempt.inputBytes + 1024, attempt.outputTokenLimit, price);
      if (quote === null || quote > price.maxAttemptMicros) return null;
      const requestId = randomUUID();
      const { data, error } = await ledger.rpc("reserve_ai_usage_attempt", {
        p_user_id: userId, p_request_id: requestId, p_action: action, p_provider: attempt.provider, p_model: attempt.model,
        p_memory_generation: generation, p_max_cost_micros: price.maxAttemptMicros,
        p_user_daily_budget_micros: config.userDailyMicros, p_global_daily_budget_micros: config.globalDailyMicros,
      });
      if (error || data?.[0]?.reserved !== true) return null;
      prices.set(requestId, { ...price });
      return requestId;
    },
    async finish(requestId: string, result: AiAttemptResult) {
      const price = prices.get(requestId);
      if (!price || result.provider !== price.provider || result.model !== price.model) throw new Error("AI accounting could not be verified.");
      const usage = result.usage;
      const actualCost = !usage.costMayDiffer && usage.inputTokens !== null && usage.outputTokens !== null
        ? ratedCostMicros(usage.inputTokens, usage.outputTokens, price) : null;
      const { data, error } = await ledger.rpc("finish_ai_usage_attempt", {
        p_user_id: userId, p_request_id: requestId, p_outcome: result.status === "succeeded" ? "succeeded" : "failed",
        p_input_tokens: usage.inputTokens, p_output_tokens: usage.outputTokens, p_actual_cost_micros: actualCost,
      });
      if (error || data !== true) throw new Error("AI accounting could not be completed.");
      prices.delete(requestId);
    },
  };
}

/** Bind accounting once per verified request, before passing a provider to a service. */
export async function getAccountedAi(db: SupabaseClient<Database>, userId: string, action: UsageAction,
  dependencies: { provider?: AiProvider | null; ledger?: Ledger; env?: Record<string, string | undefined> } = {}): Promise<AiProvider | null> {
  const env = dependencies.env ?? process.env;
  // A free development endpoint policy must never become a public-launch
  // provider implicitly. Production requires its own operator configuration.
  if (env.NUDGE_AI_DEVELOPMENT_FREE === "true" && env.NUDGE_PUBLIC_LAUNCH === "true") return null;
  const config = readAiAccountingConfig(env);
  const provider = dependencies.provider === undefined ? getAi() : dependencies.provider;
  if (!config || !provider) return null;
  const readProfile = async () => db.from("profiles").select("ai_enabled,memory_generation,terms_version").eq("id", userId).single();
  const initial = await readProfile().catch(() => null);
  const profile = initial?.data;
  if (!initial || initial.error || profile?.ai_enabled !== true || !Number.isSafeInteger(profile.memory_generation)
    || profile.memory_generation < 0 || profile.terms_version !== POLICY_VERSION) return null;
  const capturedGeneration = profile.memory_generation;
  if (!dependencies.ledger && (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)) return null;
  const ledger = dependencies.ledger ?? createSupabaseClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([
      ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(5000),
    ]) }) },
  });
  const accounting = createAiAccounting(ledger, userId, capturedGeneration, action, config);
  const request = (options?: AiRequestOptions): AiRequestOptions => ({ ...options, accounting });
  async function execute<T>(operation: (options: AiRequestOptions) => Promise<T>, options?: AiRequestOptions): Promise<T> {
    // Wire accounting is finalized by the adapter before its result arrives.
    // Discard obsolete output without retrying the provider or undoing usage.
    const value = await operation(request(options));
    const current = await readProfile().catch(() => null);
    if (!current || current.error || current.data?.ai_enabled !== true || current.data.memory_generation !== capturedGeneration
      || current.data.terms_version !== POLICY_VERSION) {
      throw new Error("Your memory or AI consent changed. This AI response was discarded; start a new request if you still want to use AI.");
    }
    return value;
  }
  return { name: provider.name,
    understandDecision: (text, options) => execute(request => provider.understandDecision(text, request), options),
    parseQuestion: (text, options) => execute(request => provider.parseQuestion(text, request), options),
    extractPreferences: (text, options) => execute(request => provider.extractPreferences(text, request), options),
    extractMemories: (text, options) => execute(request => provider.extractMemories(text, request), options),
    explainRecommendation: (input, options) => execute(request => provider.explainRecommendation(input, request), options),
    summarizeMonth: (input, options) => execute(request => provider.summarizeMonth(input, request), options),
  };
}
