import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { AiProvider } from "./ai/provider";
import { reserveAiRequest } from "./ai/privacy";
import { withAiDeadline } from "./ai/deadline";
import { decodeUnderstanding } from "./ai/language-tasks";
import { checkRateLimit, AI_LIMITS } from "./rate-limit";
import { draftUnderstanding, groundUnderstanding } from "./decision-understanding";
import { POLICY_VERSION } from "@/lib/legal/config";

/** No model call without consent and quota; every failure leaves an editable manual path. */
export async function understandDecision(
  db: SupabaseClient<Database>, userId: string, text: string, options: string[] | undefined, provider: AiProvider | null
) {
  const draft = draftUnderstanding(text, options);
  if (!provider) return draft;
  const profile = await reviewState(db, userId);
  if (!profile || !profile.ai_enabled || profile.terms_version !== POLICY_VERSION) return draft;
  if (!checkRateLimit(userId,"interpret",AI_LIMITS.interpret.limit,AI_LIMITS.interpret.windowMs).allowed
    || !await reserveAiRequest(db,"interpret")) {
    return { ...draft, notice:"AI interpretation is at its limit or unavailable. You can still explain the setting and terms yourself." };
  }
  try {
    const input = options?.length ? JSON.stringify({ question:text, options }) : text;
    const interpreted = decodeUnderstanding(JSON.stringify(await withAiDeadline(signal=>provider.understandDecision(input,{signal}),6000)));
    const current = await reviewState(db, userId);
    if (!current || !current.ai_enabled || current.terms_version !== POLICY_VERSION || current.memory_generation !== profile.memory_generation) {
      return { ...draft, notice:"Your AI preference or memory changed. This AI draft was discarded; you can still explain the setting and terms yourself." };
    }
    const grounded = groundUnderstanding(interpreted, text, options);
    if (grounded.options.length < 2 && draft.options.length >= 2) {
      return { ...draft, notice:"AI could not preserve your alternatives reliably. Your original options are here; review the setting and terms to continue." };
    }
    return grounded;
  } catch {
    return { ...draft, notice:"AI could not interpret this reliably. Your text is intact; explain the setting and terms to continue." };
  }
}

async function reviewState(db: SupabaseClient<Database>, userId: string) {
  try {
    const { data, error } = await db.from("profiles").select("ai_enabled,memory_generation,terms_version").eq("id", userId).single();
    return error || !data || !Number.isSafeInteger(data.memory_generation) || data.memory_generation < 0 ? null : data;
  } catch { return null; }
}
