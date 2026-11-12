import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { postFoundationPath } from "@/lib/auth/foundation-path";
import type { OnboardingQuestion } from "@/lib/types";

export default async function OnboardingPage({ searchParams }: {searchParams: Promise<{next?: string}>}) {
  const returnTo = postFoundationPath((await searchParams).next);
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile, error: profileError } = await db.from("profiles")
    .select("full_name,onboarded_at,memory_generation").eq("id", user.id).single();
  if (profileError || !profile) throw new Error("Could not load your profile. Please try again.");
  if (profile.onboarded_at) redirect(returnTo === "/ask" ? "/dashboard" : returnTo);
  const { data: questions, error } = await db.from("questions")
    .select("id,kind,prompt,option_a,option_b,maps_to_key_a,maps_to_key_b,sort_order,context")
    .eq("is_onboarding", true).eq("is_active", true).eq("context->>foundationEdition", "1")
    .order("sort_order").order("id").limit(6);
  // An unavailable catalog still lets users compare without pretending setup saved.
  const catalog = error || questions?.length !== 6 ? [] : questions;
  const rationales = Object.fromEntries(catalog.map(question => {
    const context = question.context && typeof question.context === "object" && !Array.isArray(question.context) ? question.context : {};
    return [question.id, typeof context.starterRationale === "string" ? context.starterRationale : "This answer gives Nudge a starting point for this situation only."];
  }));
  return <div className="mx-auto max-w-lg py-8"><OnboardingFlow initialName={profile.full_name ?? ""}
    initialGeneration={profile.memory_generation} questions={catalog as OnboardingQuestion[]}
    questionRationales={rationales} returnTo={returnTo}/></div>;
}
