import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { AiProvider } from "./ai/provider";
import { aiAllowed, reserveAiRequest } from "./ai/privacy";
import { withAiDeadline } from "./ai/deadline";
import { decodeMemories } from "./ai/language-tasks";
import { POLICY_VERSION } from "@/lib/legal/config";
import { parseMemoryReview, type ProfileMemoryDraft } from "./profile-memory-review";

export interface ProfileMemoryDraftResult { draft?: ProfileMemoryDraft; error?: string; stale?: boolean }
export interface ProfileMemorySaveResult { saved?: number; error?: string; stale?: boolean }
async function currentReviewState(db: SupabaseClient<Database>, userId: string) {
  const { data, error } = await db.from("profiles").select("memory_generation,ai_enabled,terms_version").eq("id", userId).single();
  return error || !data || !Number.isSafeInteger(data.memory_generation) || data.memory_generation < 0 ? null : data;
}
const changedMemory = { stale: true, error: "Your memory or AI preference changed. Nothing was saved. Discard these suggestions and start a new review if you still want to use AI." };

/** AI creates a temporary draft only. The separate confirmation writes memory. */
export async function extractProfileMemories(db: SupabaseClient<Database>, userId: string, text: unknown, provider: AiProvider | null): Promise<ProfileMemoryDraftResult> {
  if (typeof text !== "string" || text.trim().length < 3 || text.length > 2000) return { error: "Enter 3 to 2,000 characters about a habit, goal, fact or constraint." };
  if (!provider) return { error: "AI assistance is unavailable on this deployment." };
  if (!await aiAllowed(db, userId)) return { error: "Enable optional AI assistance before sending these notes." };
  const profile = await currentReviewState(db, userId);
  if (!profile) return { error: "Couldn't verify your current memory. Please try again." };
  if (!profile.ai_enabled || profile.terms_version !== POLICY_VERSION) return { error: "Enable optional AI assistance and accept the current terms before sending these notes." };
  if (!await reserveAiRequest(db, "extract")) return { error: "AI extraction is unavailable or its usage limit has been reached. Please try again later." };
  try {
    const memories = decodeMemories(JSON.stringify(await withAiDeadline(signal => provider.extractMemories(text.trim(), { signal }), 6000))).filter(memory => memory.confidence >= 0.6);
    if (!memories.length) return { error: "No memory suggestions were found. Try a concrete habit, goal or constraint." };
    const current = await currentReviewState(db, userId);
    if (!current || !current.ai_enabled || current.terms_version !== POLICY_VERSION || current.memory_generation !== profile.memory_generation) return changedMemory;
    return { draft: { generation: profile.memory_generation, suggestions: memories.map(({ kind, content }) => ({ kind, content })) } };
  } catch { return { error: "Couldn't process these notes. Your text is still here; please try again." }; }
}

/** Save only edited/selected user-confirmed entries, with no provider request. */
export async function confirmProfileMemoryReview(db: SupabaseClient<Database>, userId: string, raw: unknown): Promise<ProfileMemorySaveResult> {
  const parsed = parseMemoryReview(raw);
  if (!parsed.value) return { error: parsed.error };
  const input = parsed.value;
  const current = await currentReviewState(db, userId);
  if (!current) return { error: "Couldn't verify your current memory. Your review is still here; please try again." };
  if (!current.ai_enabled || current.terms_version !== POLICY_VERSION || current.memory_generation !== input.generation) return changedMemory;
  try {
    const { data: saved, error } = await db.rpc("save_reviewed_memories", { p_request_id: input.requestId,
      p_memories: input.memories.map(({ kind, content }) => ({ kind, content })), p_generation: input.generation });
    // PT409 rejects obsolete reviews without triggering PostgREST's serialization
    // retry loop. Keep recognizing 40001 for older database deployments.
    if (error?.code === "PT409" || error?.code === "40001") return changedMemory;
    if (error) return { error: "Couldn't confirm these memories. Refresh Memories before retrying in case the save completed." };
    if (saved === 0) return changedMemory;
    if (saved !== input.memories.length) return { error: "The save could not be fully confirmed. Refresh Memories before retrying." };
    return { saved };
  } catch { return { error: "Couldn't confirm these memories. Refresh Memories before retrying in case the save completed." }; }
}
