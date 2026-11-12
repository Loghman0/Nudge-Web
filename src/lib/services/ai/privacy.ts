import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
/** Unknown/missing consent stays off, including while a migration is pending. */
export async function aiAllowed(supabase:SupabaseClient<Database>,userId:string):Promise<boolean>{
  const {data,error}=await supabase.from("profiles").select("ai_enabled").eq("id",userId).single();
  return !error && data?.ai_enabled===true;
}

export async function reserveAiRequest(supabase:SupabaseClient<Database>,action:"extract"|"explain"|"recap"|"interpret"):Promise<boolean>{
  const {data,error}=await supabase.rpc("reserve_ai_request",{p_action:action});return !error && data===true;
}
