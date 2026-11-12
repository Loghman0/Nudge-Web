import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { toKeySegment } from "./knowledge";
import { parseReflectionInput } from "./reflection-input";

export type ReflectionSaveErrorCode = "invalid_input" | "not_found" | "not_chosen" | "conflict" | "unavailable";
export type ReflectionSaveResult =
  | { ok: true; saved: boolean }
  | { ok: false; code: ReflectionSaveErrorCode; message: string };

/** Shared by web actions and the native-ready API. Identity must be verified by the caller. */
export async function saveReflection(
  supabase: SupabaseClient<Database>, verifiedUserId: string, raw: unknown,
): Promise<ReflectionSaveResult> {
  const parsed = parseReflectionInput(raw);
  if (!parsed.value) return { ok: false, code: "invalid_input", message: parsed.error };
  const input = parsed.value;
  try {
    const { data: decision, error: loadError } = await supabase.from("decisions")
      .select("category, selected_option_id, decision_options!decision_options_decision_id_fkey(id, label)")
      .eq("id", input.decisionId).eq("user_id", verifiedUserId).maybeSingle();
    if (loadError) return unavailable();
    if (!decision) return { ok: false, code: "not_found", message: "That decision could not be found." };
    const selected = decision.decision_options.find(option => option.id === decision.selected_option_id);
    if (!selected) return { ok: false, code: "not_chosen", message: "Choose an option before reflecting on it." };
    const { data: result, error } = await supabase.rpc("submit_decision_reflection", {
      p_decision_id: input.decisionId, p_rating: input.rating,
      p_would_repeat: input.wouldRepeat, p_has_regrets: input.hasRegrets,
      p_would_recommend: input.wouldRecommend, p_would_choose_again: input.wouldChooseAgain,
      p_notes: input.notes || null, p_key: `learned.${decision.category}.${toKeySegment(selected.label)}`,
    });
    if (error) {
      // Only this known atomic-RPC rejection means a conflicting retry. Other
      // provider/database failures must remain retryable, without leaking details.
      if (error.code === "P0001" && error.message === "This decision already has a reflection")
        return { ok: false, code: "conflict", message: "This decision already has a different reflection." };
      if (error.code === "P0001" && ["Choose an option before reflecting", "Selected option is missing"].includes(error.message))
        return { ok: false, code: "not_chosen", message: "Choose an option before reflecting on it." };
      if (error.code === "P0001" && error.message === "Decision not found")
        return { ok: false, code: "not_found", message: "That decision could not be found." };
      return unavailable();
    }
    if (!result?.[0] || typeof result[0].saved !== "boolean") return unavailable();

    // Saving a reflection never sends its content to an AI provider.
    return { ok: true, saved: result[0].saved };
  } catch {
    return unavailable();
  }
}

function unavailable(): ReflectionSaveResult {
  return { ok: false, code: "unavailable", message: "Couldn't save that reflection. Please try again." };
}
