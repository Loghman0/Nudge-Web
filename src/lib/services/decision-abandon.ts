import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { isRequestId } from "./comparison-input";

export type DecisionAbandonErrorCode = "invalid_input" | "not_found" | "conflict" | "unavailable";
export type DecisionAbandonResult =
  | { ok: true; abandoned: true; decisionId: string; status: "abandoned" }
  | { ok: false; code: DecisionAbandonErrorCode; message: string };

/** The caller provides verified identity; the URL, never the JSON body, owns the decision ID. */
export async function abandonDecision(db: SupabaseClient<Database>, verifiedUserId: string, decisionId: unknown): Promise<DecisionAbandonResult> {
  if (!isRequestId(decisionId))
    return { ok: false, code: "invalid_input", message: "Choose a valid decision to set aside." };
  try {
    const owned = await db.from("decisions").select("status")
      .eq("id", decisionId).eq("user_id", verifiedUserId).maybeSingle();
    if (owned.error) return unavailable();
    if (!owned.data) return { ok: false, code: "not_found", message: "That decision could not be found." };
    // An identical retry can acknowledge an established owned state without
    // attributing the original write to this request or invoking another RPC.
    if (owned.data.status === "abandoned") return saved(decisionId);
    if (owned.data.status === "decided" || owned.data.status === "reflected") return conflict();
    if (owned.data.status !== "open") return unavailable();

    // The RPC atomically changes only an open decision belonging to auth.uid().
    // It returns void and may silently affect zero rows if a concurrent choice won.
    const result = await db.rpc("abandon_decision", { p_decision_id: decisionId });
    if (result.error) return unavailable();
    const persisted = await db.from("decisions").select("status")
      .eq("id", decisionId).eq("user_id", verifiedUserId).maybeSingle();
    if (persisted.error || !persisted.data) return unavailable();
    if (persisted.data.status === "abandoned") return saved(decisionId);
    if (persisted.data.status === "decided" || persisted.data.status === "reflected") return conflict();
    return unavailable();
  } catch {
    return unavailable();
  }
}

function saved(decisionId: string): DecisionAbandonResult { return { ok: true, abandoned: true, decisionId, status: "abandoned" }; }
function conflict(): DecisionAbandonResult {
  return { ok: false, code: "conflict", message: "This decision already has a saved choice. Reload it before continuing." };
}
function unavailable(): DecisionAbandonResult {
  return { ok: false, code: "unavailable", message: "Couldn't confirm this decision was set aside. Reload it before retrying in case the change saved." };
}
