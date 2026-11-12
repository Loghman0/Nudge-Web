import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

export const MEMORY_PAGE_SIZE = 20;
export type StoredMemory = Pick<Database["public"]["Tables"]["ai_memories"]["Row"], "id" | "content" | "kind" | "confidence" | "created_at">;
export type MemoryPage = { memories: StoredMemory[]; hasMore: boolean; error?: string };

/** Parameterized owner filter, literal search, and one extra row to establish Next. */
export async function queryProfileMemories(db: SupabaseClient<Database>, userId: string, query = "", offset = 0): Promise<MemoryPage> {
  if (typeof query !== "string" || query.length > 80 || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000)
    return { memories: [], hasMore: false, error: "Choose a valid memory search and page." };
  let request = db.from("ai_memories").select("id,content,kind,confidence,created_at").eq("user_id", userId);
  const search = query.trim();
  if (search) request = request.ilike("content", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
  const { data, error } = await request.order("created_at", { ascending: false }).order("id", { ascending: true }).range(offset, offset + MEMORY_PAGE_SIZE);
  if (error || !data) return { memories: [], hasMore: false, error: "Couldn't load your memories. Please try again." };
  return { memories: data.slice(0, MEMORY_PAGE_SIZE), hasMore: data.length > MEMORY_PAGE_SIZE };
}
