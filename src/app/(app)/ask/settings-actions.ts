"use server";

import { createClient } from "@/lib/supabase/server";
import { decodeComparisonSettingsState, parseComparisonSetting, unavailableComparisonSettings,
  type ComparisonSettingsResponse, type ComparisonSettingsState } from "@/lib/services/comparison-settings";

export async function loadComparisonSettings(): Promise<ComparisonSettingsState> {
  try {
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return unavailableComparisonSettings;
    const { data, error } = await db.rpc("get_comparison_settings_state");
    return error ? unavailableComparisonSettings : decodeComparisonSettingsState(data) ?? unavailableComparisonSettings;
  } catch { return unavailableComparisonSettings; }
}

function failure(message: string): ComparisonSettingsResponse {
  if (/generation|stale|changed|reset/i.test(message)) return { stale: true, error: "Your memory changed. Saved settings and this editor were cleared. Reload settings before entering a new one." };
  if (/limit|maximum|20|duplicate|unique/i.test(message)) return { error: "Use a unique name within this setting, and keep at most 20 saved settings." };
  return { error: "Couldn't update saved settings. Your current comparison is still here. Try again." };
}

export async function saveComparisonSetting(raw: unknown): Promise<ComparisonSettingsResponse> {
  const parsed = parseComparisonSetting(raw);
  if (!parsed.value) return { error: parsed.error };
  try {
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return { error: "Sign in to save comparison settings." };
    const value = parsed.value;
    const { error } = await db.rpc("save_comparison_setting", { p_id: value.id, p_name: value.name, p_domain: value.domain,
      p_category: value.category, p_goal: value.goal, p_aliases: value.aliases.map(({term,meaning})=>({term,meaning})), p_generation: value.generation });
    if (error) return failure(error.message);
    // Return the current owner state directly. Route revalidation can remount
    // a comparison draft after New changes a resumed URL locally.
    return { state: await loadComparisonSettings() };
  } catch { return failure(""); }
}

export async function deleteComparisonSetting(id: string, generation: number): Promise<ComparisonSettingsResponse> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !Number.isSafeInteger(generation) || generation < 0) {
    return { error: "Reload saved settings before deleting." };
  }
  try {
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return { error: "Sign in to manage comparison settings." };
    const { error } = await db.rpc("delete_comparison_setting", { p_id: id, p_generation: generation });
    if (error) return failure(error.message);
    return { state: await loadComparisonSettings() };
  } catch { return failure(""); }
}
