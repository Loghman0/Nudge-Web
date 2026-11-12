import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { collectPages } from "./pagination";
import { decodeComparisonSettingsState } from "./comparison-settings";
import { parseComparisonSnapshot } from "./comparison-snapshot";
import { isRequestId } from "./comparison-input";

/** The RPC owns its OFFSET/LIMIT; adding .range would apply the offset twice. */
export async function exportComparisonEvidence(db: SupabaseClient<Database>) {
  const first = await db.rpc("export_my_comparison_evidence", { p_offset: 0 });
  if (first.error?.code === "PGRST202") return { available: false as const, records: [] };
  if (first.error || first.data === null) throw new Error("Could not export saved comparison evidence.");
  const rows = await collectPages(from => {
    // The SQL API bounds offsets to one million. Fail explicitly instead of
    // repeatedly exporting the final supported page beyond that boundary.
    if (from > 1_000_000) throw new Error("Could not export the complete comparison evidence dataset.");
    return from === 0 ? Promise.resolve(first) : db.rpc("export_my_comparison_evidence", { p_offset: from });
  });
  const records = rows.map(row => {
    const snapshot = parseComparisonSnapshot(row.snapshot);
    if (!snapshot || !isRequestId(row.decision_id) || !Number.isSafeInteger(row.comparison_revision) || row.comparison_revision < 0
      || !Number.isSafeInteger(row.memory_generation) || row.memory_generation < 0 || snapshot.scoringRunId !== row.scoring_run_id
      || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) {
      throw new Error("Could not export complete saved comparison evidence.");
    }
    // Keep the export contract explicit. Unknown database fields can never
    // turn this derivative dataset into a copy of private source notes.
    return { decision_id: row.decision_id, comparison_revision: row.comparison_revision,
      scoring_run_id: row.scoring_run_id, memory_generation: row.memory_generation, snapshot, created_at: row.created_at };
  });
  return { available: true as const, records };
}

/** A scalar JSON aggregate includes every saved setting despite row caps. */
export async function exportComparisonSettings(db: SupabaseClient<Database>) {
  const result = await db.rpc("get_comparison_settings_state");
  if (result.error?.code === "PGRST202") return { available: false as const, generation: null, records: [] };
  if (result.error || result.data === null) throw new Error("Could not export saved comparison settings.");
  const state = decodeComparisonSettingsState(result.data);
  if (!state) throw new Error("Could not export complete saved comparison settings.");
  const records = state.settings.map(setting => ({ id: setting.id, name: setting.name, domain: setting.domain,
    category: setting.category, goal: setting.goal, aliases: setting.aliases, memory_generation: setting.memory_generation,
    created_at: setting.created_at, updated_at: setting.updated_at }));
  return { available: true as const, generation: state.generation, records };
}
