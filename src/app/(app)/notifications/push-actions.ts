"use server";

import { validPushEndpoint } from "@/lib/services/push-endpoint";
import { parsePushSubscription } from "@/lib/services/push-subscription-input";
import { createClient } from "@/lib/supabase/server";

export async function savePushSubscription(value:unknown) {
  const subscription=parsePushSubscription(value);
  if(!subscription)return {ok:false};
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id: user.id, ...subscription },
    { onConflict: "endpoint" }
  );
  return { ok: !error };
}

export async function removePushSubscription(endpoint: string) {
  if (!validPushEndpoint(endpoint)) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("push_subscriptions").delete()
    .eq("endpoint", endpoint).eq("user_id", user.id);
}
