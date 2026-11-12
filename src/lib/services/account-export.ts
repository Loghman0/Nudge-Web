import type {SupabaseClient,User} from '@supabase/supabase-js';
import type {Database} from '@/lib/types/database';
import {collectPages} from './pagination';
import {exportAiUsage} from './ai/export-usage';
import {exportComparisonEvidence,exportComparisonSettings} from './comparison-export';
import {exportDiscoveryData} from './discovery';

/** The same complete owner-scoped export for web and native transports. */
export async function buildAccountExport(supabase:SupabaseClient<Database>,user:User){
  const profile = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (profile.error || !profile.data) throw new Error("Could not export profile");
  // Each table is independently paginated under RLS. Stable unique ordering
  // is required; private votes/records belonging to other users are excluded.
  const [preferences, decisions, options, reflections, memories, answers, nodes, edges,
    evidence, achievements, notifications, verifications, forgotten, groups, memberships, votes, ownPolls, push, events] = await Promise.all([
    collectPages((a,b) => supabase.from("preferences").select("*").eq("user_id",user.id).order("id").range(a,b)),
    collectPages((a,b) => supabase.from("decisions").select("*").eq("user_id",user.id).order("id").range(a,b)),
    collectPages((a,b) => supabase.from("decision_options").select("*").order("id").range(a,b)),
    collectPages((a,b) => supabase.from("decision_reflections").select("*").eq("user_id",user.id).order("id").range(a,b)),
    collectPages((a,b) => supabase.from("ai_memories").select("*").eq("user_id",user.id).order("id").range(a,b)),
    collectPages((a,b) => supabase.from("question_answers").select("*").eq("user_id",user.id).order("id").range(a,b)),
    collectPages((a,b) => supabase.from("knowledge_nodes").select("*").eq("user_id",user.id).order("id").range(a,b)),
    collectPages((a,b) => supabase.from("knowledge_edges").select("*").eq("user_id",user.id).order("id").range(a,b)),
    collectPages((a,b) => supabase.from("knowledge_evidence").select("*").eq("user_id",user.id).order("id").range(a,b)),
    collectPages((a,b) => supabase.from("user_achievements").select("*").eq("user_id",user.id).order("achievement_slug").range(a,b)),
    collectPages((a,b) => supabase.from("notifications").select("*").eq("user_id",user.id).order("id").range(a,b)),
    collectPages((a,b) => supabase.from("knowledge_verification_queue").select("*").eq("user_id",user.id).order("id").range(a,b)),
    collectPages((a,b) => supabase.from("forgotten_knowledge_keys").select("*").eq("user_id",user.id).order("key").range(a,b)),
    collectPages((a,b) => supabase.from("decision_groups").select("*").eq("owner_id",user.id).order("id").range(a,b)),
    collectPages((a,b) => supabase.from("decision_group_members").select("*").eq("user_id",user.id).order("group_id").range(a,b)),
    collectPages((a,b) => supabase.from("group_poll_votes").select("*").eq("user_id",user.id).order("poll_id").range(a,b)),
    collectPages((a,b) => supabase.from("group_polls").select("*").eq("created_by",user.id).order("id").range(a,b)),
    collectPages((a,b) => supabase.from("push_subscriptions").select("endpoint,created_at").eq("user_id",user.id).order("endpoint").range(a,b)),
    collectPages((a,b) => supabase.from("analytics_events").select("*").eq("user_id",user.id).order("id").range(a,b)),
  ]);
  const [aiUsage, comparisonEvidence, comparisonSettings, discovery] = await Promise.all([
    exportAiUsage(supabase), exportComparisonEvidence(supabase), exportComparisonSettings(supabase),
    exportDiscoveryData(supabase),
  ]);
  const nativePush=await collectPages((a,b)=>supabase.from('native_push_devices').select('id,enabled,time_zone,quiet_start,quiet_end,enabled_at,updated_at,expires_at').eq('user_id',user.id).order('id').range(a,b));
  const byDecision = new Map<string, typeof options>();
  for (const option of options) {
    const list = byDecision.get(option.decision_id) ?? [];
    list.push(option); byDecision.set(option.decision_id,list);
  }
  const payload = {
    export_version: 6, exported_at: new Date().toISOString(), discovery,
    scope: "Decision memory, saved comparison explanations and settings, notifications, owned circles, own memberships and readable own votes. Excludes credentials and other users' private records.",
    consistency: "Paginated live data; concurrent edits can change the dataset during export.",
    account:{id:user.id,email:user.email,created_at:user.created_at,providers:user.identities?.map(i=>i.provider)??[]},
    profile: profile.data, preferences,
    decisions: decisions.map(d => ({ ...d, decision_options: byDecision.get(d.id) ?? [] })),
    reflections, memories, question_answers: answers, knowledge_nodes: nodes,
    knowledge_edges: edges, knowledge_evidence: evidence, achievements, notifications,
    knowledge_verifications: verifications, forgotten_knowledge_keys: forgotten,
    owned_circles: groups, circle_memberships: memberships, own_votes: votes, own_polls:ownPolls,push_devices:push,app_events:events,
    ai_usage: aiUsage,native_push_devices:nativePush,
    comparison_evidence: comparisonEvidence, comparison_settings: comparisonSettings,
  };
  return payload;
}
