import { safeReturnPath } from "@/lib/auth/return-path";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { POLICY_VERSION } from "@/lib/legal/config";
import { ConsentForm } from "./consent-form";
import { LegalLinks } from "@/components/legal/legal-links";
export default async function ConsentPage({searchParams}:{searchParams:Promise<{next?:string}>}){const next=safeReturnPath((await searchParams).next);const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect("/login");const {data}=await db.from("profiles").select("terms_version").eq("id",user.id).single();if(data?.terms_version===POLICY_VERSION)redirect(next);return <main className="mx-auto max-w-lg px-6 py-16"><h1 className="font-display text-3xl">Before you continue</h1><p className="mt-3 text-sm text-ink-muted">Review Nudge’s current terms and how your information is used.</p><ConsentForm next={next}/><footer className="mt-12"><LegalLinks/></footer></main>;}
