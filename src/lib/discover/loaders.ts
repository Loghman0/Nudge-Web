import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { discoverTopic, type DiscoverTopic, type AnswerResult, type DailyQuestion, type VerificationItem } from "./types";

type DatabaseClient = SupabaseClient<Database>;

export function discoverFailure(error: { code?: string }, fallback: string) {
  if (["PGRST202", "42883", "42501"].includes(error.code ?? "")) {
    return "Discover needs a database update. Please try again later.";
  }
  console.error("[discover] Database request failed", { code: error.code });
  return fallback;
}

/** Internal loaders reuse the caller's verified, cookie-bound client. They are
 * not Server Actions; every public action verifies identity before calling. */
export async function readQuestionState(db: DatabaseClient, topic: DiscoverTopic | null = null): Promise<AnswerResult> {
  const selected = discoverTopic(topic);
  const [next, progress] = await Promise.all([
    db.rpc("discover_next_question", { p_topic: selected }),
    db.rpc("question_progress"),
  ]);
  if (next.error || progress.error) throw new Error(discoverFailure(next.error ?? progress.error!, "Couldn't load questions. Please reload."));
  const row = progress.data?.[0];
  return { next: (next.data?.[0] as DailyQuestion | undefined) ?? null,
    answeredToday: row?.answered_today ?? 0, totalAnswered: row?.total_answered ?? 0,
    remaining: Math.max(0, (row?.total_questions ?? 0) - (row?.total_answered ?? 0)), topic: selected };
}

export async function readVerifications(db: DatabaseClient, userId: string, limit = 3): Promise<VerificationItem[]> {
  const refreshed = await db.rpc("refresh_my_verifications");
  if (refreshed.error) throw new Error(discoverFailure(refreshed.error, "Couldn't load quick checks. Please reload."));
  const { data, error } = await db.from("knowledge_verification_queue")
    .select("id, node_id, prompt, knowledge_nodes!inner(key, value, status, polarity, metadata)")
    .eq("user_id", userId).eq("status", "pending")
    .eq("knowledge_nodes.status", "active").neq("knowledge_nodes.polarity", "neutral")
    .order("created_at", { ascending: true }).limit(Math.max(1, Math.min(10, limit)));
  if (error) throw new Error(discoverFailure(error, "Couldn't load quick checks. Please reload."));
  return (data ?? []).map(row => {
    const node = row.knowledge_nodes as unknown as { key: string; value: string | null; polarity: VerificationItem["polarity"]; metadata?: Record<string, unknown> };
    const domain = typeof node.metadata?.decision_domain === "string" ? node.metadata.decision_domain : null;
    return { id: row.id, nodeId: row.node_id, prompt: row.prompt, key: node.key, polarity: node.polarity,
      label: (node.value ?? node.key.split(".").pop() ?? "").replace(/-/g, " ") + (domain ? ` (${domain})` : "") };
  }).filter(item => item.label.length > 0);
}

/** Earlier inferred likes remain reviewable after questions moved to Today. */
export async function readEarlierPattern(db: DatabaseClient, userId: string): Promise<{prefKey:string;label:string;evidence:number}|null> {
  const {data,error}=await db.from('knowledge_nodes')
    .select('key,value,evidence_count,metadata').eq('user_id',userId)
    .eq('status','active').eq('polarity','like').in('source',['inferred','reflected'])
    .gte('evidence_count',2).order('evidence_count',{ascending:false}).order('key').limit(20);
  if(error)throw new Error(discoverFailure(error,"Couldn't load earlier patterns. Please reload."));
  const pattern=(data??[]).find(row=>{
    const metadata=row.metadata&&typeof row.metadata==='object'&&!Array.isArray(row.metadata)?row.metadata:{};
    return !/\.scope\./.test(row.key)&&!row.key.startsWith('discovery.')&&metadata.manual_polarity===undefined;
  });
  if(!pattern)return null;
  return {prefKey:pattern.key,label:pattern.value??pattern.key.split('.').pop()!.replace(/-/g,' '),evidence:pattern.evidence_count};
}
