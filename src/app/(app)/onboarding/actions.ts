"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseOnboardingInput } from "@/lib/services/onboarding-input";

/** Only reviewed, explicit answers are learned here. No model call or extraction. */
export async function completeOnboarding(rawInput: unknown) {
  const parsed = parseOnboardingInput(rawInput);
  if (!parsed.value) throw new Error(parsed.error);
  const input = parsed.value;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: generation, error } = await db.rpc("complete_onboarding", {
    // Other basics are deliberately omitted: setup must not erase profile data.
    p_profile: { fullName: input.fullName },
    p_answers: input.answers.map(({ questionId, answer }) => ({ questionId, answer })),
    p_expected_generation: input.expectedGeneration,
  });
  if (error || generation == null) {
    if (error && /generation|memory changed/i.test(error.message)) throw new Error("Your memory changed. Reload the starter questions before saving.");
    throw new Error("Couldn't save your starter answers. Your draft is still here; please try again.");
  }
  redirect(input.next);
}
