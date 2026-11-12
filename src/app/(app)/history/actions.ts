"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseReflectionInput, type ReflectionInput } from "@/lib/services/reflection-input";
import { saveReflection } from "@/lib/services/reflection-save";

export async function submitReflection(raw: ReflectionInput): Promise<{ error?: string }> {
  const parsed = parseReflectionInput(raw);
  if (!parsed.value) return { error: parsed.error };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const result = await saveReflection(supabase, user.id, parsed.value);
  if (!result.ok) return { error: result.message };
  // The required outcome has committed. Optional achievement checks are still
  // awaited, but their failure must never make a successful save look failed.
  try { await supabase.rpc("evaluate_achievements"); } catch { /* optional */ }

  revalidatePath("/history");
  revalidatePath("/dashboard");
  return {};
}

/** Let a lingering open question go without hurting the streak. */
export async function dismissDecision(decisionId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.rpc("abandon_decision", { p_decision_id: decisionId });
  revalidatePath("/history");
}
