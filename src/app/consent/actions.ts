"use server";
import { safeReturnPath } from "@/lib/auth/return-path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { POLICY_VERSION } from "@/lib/legal/config";
export async function acceptTerms(_previous:{error?:string},form:FormData):Promise<{error?:string}>{
  if(form.get("terms")!=="on"||form.get("age")!=="on")return {error:"Confirm your eligibility and agreement to continue."};
  const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect("/login");
  const {error}=await db.rpc("accept_legal_terms",{p_version:POLICY_VERSION,p_age_eligible:true});
  if(error)return {error:"Couldn't save your agreement. Check that the public-launch database update has been applied, then try again."};
  revalidatePath("/","layout");redirect(safeReturnPath(form.get("next")));
}
