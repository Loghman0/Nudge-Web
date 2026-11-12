"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { saveReminder, type ReminderState } from "@/lib/services/reminder-save";
export async function scheduleReflection(decisionId: string, dueAt: string | null, enabled: boolean): Promise<{error?:string;reminder?:ReminderState}> {
  const supabase=await createClient();
  const { data:{user} }=await supabase.auth.getUser();
  if(!user)return {error:"Not signed in."};
  const result=await saveReminder(supabase,user.id,{decisionId,dueAt,enabled});
  if(!result.ok)return {error:result.message};
  for(const path of ["/history","/notifications","/dashboard","/ask"])revalidatePath(path);
  return {reminder:result.reminder};
}
