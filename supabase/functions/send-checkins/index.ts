/**
 * Scheduled check-in delivery.
 *
 * Deploy:  supabase functions deploy send-checkins
 * Secrets: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
 * Schedule (Supabase Dashboard → Edge Functions → Cron): every hour, `0 * * * *`
 *
 * Two jobs, in order:
 *  1. enqueue — create reflection_prompt rows for decisions made >24h ago
 *  2. claim a durable per-device batch and acknowledge each provider attempt
 *
 * Step 1 alone is enough for in-app check-ins. Step 2 is what puts them on
 * the lock screen; it no-ops cleanly when VAPID keys aren't set.
 * Leases recover worker crashes. A provider success followed by a crash before
 * the database ACK can duplicate a send; Web Push is not exactly-once.
 * Retry claims include unread backlog up to seven days old, not only one hour.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@example.com";
const pushEnabled = Boolean(VAPID_PUBLIC && VAPID_PRIVATE);

if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC!, VAPID_PRIVATE!);
}

Deno.serve(async (request) => {
  // Gateway JWT validation alone would allow an ordinary user's token to
  // invoke this service-role job. Require a separate scheduler secret.
  const cronSecret = Deno.env.get("CHECKINS_CRON_SECRET");
  if (!cronSecret || cronSecret.length < 32) {
    return Response.json({ ok: false, error: "Scheduler authorization is not configured" }, { status: 503 });
  }
  if (request.method !== "POST" || request.headers.get("x-nudge-cron-secret") !== cronSecret) {
    return Response.json({ ok: false, error: "Not authorized" }, { status: 401 });
  }
  try {
  // 1. Create the due check-ins.
  const { data: enqueued, error: enqueueError } = await supabase
    .rpc("enqueue_due_reflection_prompts");

  if (enqueueError) {
    return Response.json({ ok: false, stage: "enqueue", error: enqueueError.message }, { status: 500 });
  }

  if (!pushEnabled) {
    return Response.json({ ok: true, enqueued, pushed: 0, note: "VAPID keys not set; in-app only" });
  }

  const { data: pending, error: claimError } = await supabase.rpc("claim_push_deliveries", { p_limit: 25 });
  if (claimError || !Array.isArray(pending)) return Response.json({ ok:false,stage:"claim",error:"Could not claim push deliveries" },{status:500});
  let pushed=0, retried=0, cleaned=0, failed=0, acknowledgementsFailed=0;
  type Delivery = {delivery_id:string;claim_token:string;subscription_id:string;endpoint:string;p256dh:string;auth:string;title:string;body:string|null};
  async function deliver(item:Delivery) {
    let outcome="failed", status:number|null=null;
    let valid=false;
    try {
      const url=new URL(item.endpoint);
      valid=item.endpoint.length<=2048 && url.protocol==="https:" && !url.username && !url.password && (!url.port||url.port==="443") &&
        (url.hostname==="fcm.googleapis.com"||url.hostname==="web.push.apple.com"||url.hostname.endsWith(".push.services.mozilla.com")||url.hostname.endsWith(".notify.windows.com"));
    } catch { /* Invalid endpoints are terminal and never fetched. */ }
    if(valid) {
      try {
        await webpush.sendNotification({endpoint:item.endpoint,keys:{p256dh:item.p256dh,auth:item.auth}},
          JSON.stringify({title:item.title,body:item.body??"",url:"/notifications"}),{TTL:3600,timeout:10000});
        outcome="delivered";pushed++;
      } catch(error) {
        const code=(error as {statusCode?:number}).statusCode;
        status=typeof code==="number"&&Number.isInteger(code)?code:null;
        outcome=status===404||status===410?"gone":"retry";
      }
    } else failed++;
    // ACK is lease-token fenced. A failed ACK is observable and is recovered
    // after lease expiry; do not immediately resend a provider-accepted push.
    try {
      const result=await supabase.rpc("finish_push_delivery",{p_delivery_id:item.delivery_id,p_claim_token:item.claim_token,p_outcome:outcome,p_status:status});
      if(result.error||result.data!==true)acknowledgementsFailed++;
      else if(outcome==="gone")cleaned++;
      else if(outcome==="retry")retried++;
    } catch { acknowledgementsFailed++; }
  }
  // Five in flight keeps a 25-item batch within its five-minute claim lease
  // even when every provider attempt reaches the ten-second socket timeout.
  for(let offset=0;offset<pending.length;offset+=5) await Promise.all(pending.slice(offset,offset+5).map(deliver));
  return Response.json({ok:acknowledgementsFailed===0,enqueued,claimed:pending.length,pushed,retried,cleaned,failed,acknowledgementsFailed,
    ...(acknowledgementsFailed?{stage:"ack",error:"Some delivery acknowledgements failed; leases will recover"}:{})},
    {status:acknowledgementsFailed?503:200});
  } catch {
    return Response.json({ok:false,stage:"worker",error:"Check-in job failed; durable leases will recover"},{status:503});
  }
});
