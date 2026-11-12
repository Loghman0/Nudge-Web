"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { queryProfileMemories, type MemoryPage } from "@/lib/services/profile-memories";
import { extractProfileMemories, confirmProfileMemoryReview } from "@/lib/services/profile-memory-intake";
import { getAccountedAi } from "@/lib/services/ai/accounting";

export async function loadMemories(query = "", offset = 0): Promise<MemoryPage> {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { memories: [], hasMore: false, error: "Not signed in." };
  return queryProfileMemories(db, user.id, query, offset);
}

export async function addProfileNotes(text: string) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const result = await extractProfileMemories(db, user.id, text, await getAccountedAi(db, user.id, "extract"));
  return result;
}

export async function confirmProfileMemories(review: unknown) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const result = await confirmProfileMemoryReview(db, user.id, review);
  if (result.saved) { revalidatePath("/profile"); revalidatePath("/dashboard"); }
  return result;
}

export async function updateBasics(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {error:"Not signed in."};

  const str = (name: string, max: number) => {
    const v = String(formData.get(name) ?? "").trim().slice(0, max);
    return v || null;
  };

  const {data,error}=await supabase.from("profiles").update({
    full_name: str("full_name", 80),
    country: str("country", 60),
    language: str("language", 40),
    occupation: str("occupation", 80),
  }).eq("id", user.id).select("full_name,country,language,occupation").single();

  if(error||!data)return {error:"Couldn’t save your profile. Please try again."};
  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return {profile:data};
}

/** The user is always in control of what Nudge believes about them. */
export async function removePreference(preferenceId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: preference, error: loadError } = await supabase.from("preferences").select("key").eq("id", preferenceId).eq("user_id", user.id).maybeSingle();
  if (loadError || !preference) return { error: "That preference could not be found." };
  const { error } = await supabase.rpc("forget_knowledge_key", { p_key: preference.key });
  if (error) return { error: "Couldn't forget that preference. Try again." };
  revalidatePath("/profile");
  revalidatePath("/dashboard");
  revalidatePath("/discover");
  revalidatePath("/ask");
  return {};
}

/** Atomically reset canonical learning; retained old history no longer ranks. */
export async function eraseLearnedMemory() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase.rpc("erase_learned_memory");
  if (error) return { error: "Couldn't erase your learned memory. Nothing was changed. Try again." };
  revalidatePath("/profile");
  revalidatePath("/dashboard");
  revalidatePath("/discover");
  revalidatePath("/history");
  revalidatePath("/ask");
  revalidatePath("/analytics");
  return {};
}

/** Delete the full decision history (options + reflections cascade). */
export async function deleteDecisionHistory() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {error:"Not signed in."};
  const { error } = await supabase.from("decisions").delete().eq("user_id", user.id);
  if (error) return { error: "Couldn't delete your history. Try again." };
  revalidatePath("/profile");
  revalidatePath("/dashboard");
  revalidatePath("/history");
  return {};
}

/**
 * Guest → full account.
 *
 * An anonymous session already owns every row it created, so attaching an
 * email and password to that same user preserves the entire decision memory.
 * Nothing is copied or migrated — it's the same account, now recoverable.
 */
export async function upgradeGuestAccount(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || password.length < 8) {
    return { error: "Enter an email and a password of at least 8 characters." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  if (!user.is_anonymous) return { error: "This account already has an email." };

  const { error } = await supabase.auth.updateUser({ email, password });
  if (error) return { error: error.message };

  revalidatePath("/profile");
  return {
    ok: true,
    message: "Check your inbox to confirm the address. Your history is already safe on this account.",
  };
}

export async function correctBelief(nodeId: string, polarity: "like" | "dislike" | "neutral", note = "") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase.rpc("correct_knowledge_node", { p_node_id: nodeId, p_polarity: polarity, p_note: note.trim().slice(0,300) });
  if (error) return { error: "Couldn't correct that belief. Please try again." };
  for (const path of ["/profile","/dashboard","/ask","/discover"]) revalidatePath(path);
  return {};
}
export async function editMemory(memoryId: string, content: string, kind: string, remove = false) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase.rpc("edit_ai_memory", { p_memory_id: memoryId, p_content: content, p_kind: kind, p_delete: remove });
  if (error) return { error: "Couldn't update that memory. Please try again." };
  revalidatePath("/profile"); revalidatePath("/dashboard");
  return {};
}
export async function inspectEvidence(nodeId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", evidence: [] };
  const { data, error } = await supabase.from("knowledge_evidence")
    .select("id, kind, direction, weight, created_at, source_decision_id, detail")
    .eq("node_id",nodeId).eq("user_id",user.id).order("created_at",{ascending:false}).limit(20);
  if (error) return { error: "Couldn't load the evidence. Try again.", evidence: [] };
  return { evidence: data ?? [] };
}

export async function forgetBelief(nodeId: string) {
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return {error:"Not signed in."};
  const {data:node,error:loadError}=await supabase.from("knowledge_nodes").select("key").eq("id",nodeId).eq("user_id",user.id).maybeSingle();
  if(loadError||!node)return {error:"Belief not found."};
  const {error}=await supabase.rpc("forget_knowledge_key",{p_key:node.key});
  if(error)return {error:"Couldn't forget that belief. Try again."};
  for(const path of ["/profile","/dashboard","/discover","/ask"])revalidatePath(path);
  return {};
}

export async function searchMemory(query: string, offset=0) {
  const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
  if(!user)return {error:"Not signed in.",nodes:[]};
  const {data,error}=await supabase.rpc("search_beliefs",{p_search:query.slice(0,80),p_offset:Math.max(0,Math.floor(offset))});
  if(error)return {error:"Couldn't search memory. Please try again.",nodes:[]};
  return {nodes:data??[]};
}

export async function setAiPreference(enabled:boolean){
  const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)return {error:"Not signed in."};
  const {error}=await db.rpc("set_ai_enabled",{p_enabled:enabled});
  if(error)return {error:"Couldn't save your AI choice. Accept the current terms and make sure the public-launch database update is applied."};
  revalidatePath("/profile");return {};
}

/** Only the verified caller can delete their account; no client-supplied user ID. */
export async function deleteMyAccount(confirmation:string){
  if(confirmation!=="DELETE")return {error:"Type DELETE to confirm."};
  const db=await createClient();
  const {recentDeletionUser}=await import("@/lib/auth/recent-deletion-session");
  const user=await recentDeletionUser(db.auth);
  if(!user)return {error:"For account security, sign out and sign back in, then retry deletion within 10 minutes."};
  if(!process.env.SUPABASE_SERVICE_ROLE_KEY)return {error:"Account deletion is not configured. Contact support for deletion."};
  const {createClient:createAdmin}=await import("@supabase/supabase-js");
  const admin=createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {error}=await admin.auth.admin.deleteUser(user.id,false);
  if(error)return {error:"Couldn't delete your account. Contact support if this continues."};
  await db.auth.signOut({scope:"local"});
  revalidatePath("/","layout");
  const {redirect}=await import("next/navigation");redirect("/login?deleted=1");
}
