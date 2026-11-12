import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { isDecisionCategory, isRequestId } from "./comparison-input";
import { toKeySegment } from "./knowledge";

export interface DecisionChoiceInput { decisionId: string; optionId: string }
export type DecisionChoiceErrorCode = "invalid_input" | "not_found" | "invalid_option" | "conflict" | "unavailable";
export type DecisionChoiceResult =
  | { ok: true; decisionId: string; selectedOptionId: string; status: "decided" | "reflected" }
  | { ok: false; code: DecisionChoiceErrorCode; message: string };

export function parseDecisionChoice(raw: unknown): { value?: DecisionChoiceInput; error?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "Choose an option from this decision." };
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== "decisionId" && key !== "optionId") ||
      !isRequestId(input.decisionId) || !isRequestId(input.optionId))
    return { error: "Choose a valid option from this decision." };
  return { value: { decisionId: input.decisionId, optionId: input.optionId } };
}

/** Required choice/learning only. The caller supplies a verified identity; optional rewards stay outside this save. */
export async function chooseDecision(db: SupabaseClient<Database>, verifiedUserId: string, raw: unknown): Promise<DecisionChoiceResult> {
  const parsed = parseDecisionChoice(raw);
  if (!parsed.value) return { ok: false, code: "invalid_input", message: parsed.error! };
  const input = parsed.value;
  try {
    const { data: decision, error: loadError } = await db.from("decisions")
      .select("category, status, selected_option_id, decision_options!decision_options_decision_id_fkey(id, label)")
      .eq("id", input.decisionId).eq("user_id", verifiedUserId).maybeSingle();
    if (loadError) return unavailable();
    if (!decision) return notFound();
    const option = decision.decision_options.find(candidate => candidate.id === input.optionId);
    if (!option) return invalidOption();
    if (!isDecisionCategory(decision.category) || typeof option.label !== "string" || !option.label.trim()) return unavailable();
    if (decision.status !== "open" && !((decision.status === "decided" || decision.status === "reflected") && decision.selected_option_id === input.optionId))
      return conflict();

    const { error } = await db.rpc("commit_choice_and_learn", {
      p_decision_id: input.decisionId, p_option_id: input.optionId,
      p_key: `learned.${decision.category}.${toKeySegment(option.label)}`,
    });
    if (error) {
      // Only the known atomic rejections describe a caller conflict. Transport
      // errors can follow a committed save and must not be reported as success.
      if (error.code === "P0001" && error.message === "Decision not found") return notFound();
      if (error.code === "P0001" && error.message === "Invalid option") return invalidOption();
      if (error.code === "P0001" && error.message === "Decision is no longer open") return conflict();
      return unavailable();
    }
    // The RPC returns void. Acknowledge the persisted choice, without claiming
    // whether this particular attempt or an identical retry first committed it.
    const persisted = await db.from("decisions").select("status, selected_option_id")
      .eq("id", input.decisionId).eq("user_id", verifiedUserId).maybeSingle();
    if (persisted.error || !persisted.data) return unavailable();
    if (persisted.data.status !== "decided" && persisted.data.status !== "reflected") return unavailable();
    if (persisted.data.selected_option_id !== input.optionId) return conflict();
    return { ok: true, decisionId: input.decisionId, selectedOptionId: input.optionId, status: persisted.data.status };
  } catch {
    return unavailable();
  }
}

function notFound(): DecisionChoiceResult { return { ok: false, code: "not_found", message: "That decision could not be found." }; }
function invalidOption(): DecisionChoiceResult { return { ok: false, code: "invalid_option", message: "That option does not belong to this decision." }; }
function conflict(): DecisionChoiceResult { return { ok: false, code: "conflict", message: "This decision is no longer open for that choice. Reload it to see the saved choice." }; }
function unavailable(): DecisionChoiceResult { return { ok: false, code: "unavailable", message: "Couldn't confirm that choice. Reload the decision before retrying in case the save completed." }; }
