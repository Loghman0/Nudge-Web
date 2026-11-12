import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { collectPages } from "../pagination";

/** Migration-aware without hiding a failed page or an incomplete export. */
export async function exportAiUsage(db: SupabaseClient<Database>) {
  const first = await db.rpc("export_my_ai_usage").range(0, 199);
  if (first.error?.code === "PGRST202")
    return { available: false as const, records: [] };
  if (first.error || first.data === null) throw new Error("Could not export AI usage.");
  const records = await collectPages((from, to) => from === 0 ? Promise.resolve(first) : db.rpc("export_my_ai_usage").range(from, to));
  return { available: true as const, records };
}
