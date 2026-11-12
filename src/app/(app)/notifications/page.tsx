import Link from "next/link";
import { ActionForm } from "@/components/app/action-form";
import { BellRing, CheckCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { markAllNotificationsRead, markNotificationRead } from "./actions";
import { PushToggle } from "@/components/app/push-toggle";

type Reminder = { id: string; title: string; body: string | null; payload: { decision_id?: string }; read_at: string | null; created_at: string };

export default async function NotificationsPage() {
  const supabase = await createClient();
  // The scheduled job already waits 24h after a decision before creating a
  // check-in; filtering again here by created_at hid every check-in for an
  // EXTRA day (and contradicted the push that had just been delivered).
  const { data,error } = await supabase.from("notifications").select("id, title, body, payload, read_at, created_at")
    .order("created_at", { ascending: false }).limit(50);
  if(error)throw new Error("Could not load check-ins. Please try again.");
  const reminders = (data ?? []) as Reminder[];
  const unread = reminders.filter((r) => !r.read_at).length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Check-ins</h1>
          <p className="mt-1 text-sm text-ink-muted">A little distance makes reflections more honest. Choose tomorrow, next week, or your own check-in time.</p>
          <div className="mt-3"><PushToggle vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} /></div>
        </div>
        {unread > 1 && (
          <ActionForm action={markAllNotificationsRead}>
            <button type="submit" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
              <CheckCheck size={15} /> Mark all read
            </button>
          </ActionForm>
        )}
      </div>
      {reminders.length ? <div className="space-y-3">{reminders.map((reminder) => <Card key={reminder.id} className={reminder.read_at ? "opacity-60" : "border-accent/25"}><div className="flex gap-3"><BellRing size={18} className="mt-0.5 shrink-0 text-accent" /><div className="min-w-0 flex-1"><p className="font-medium">{reminder.title}</p>{reminder.body && <p className="mt-1 text-sm text-ink-muted">{reminder.body}</p>}<div className="mt-4 flex gap-2">{reminder.payload?.decision_id && <Link href={`/history?decision=${reminder.payload.decision_id}`}><Button>Reflect now</Button></Link>}{!reminder.read_at && <ActionForm action={markNotificationRead.bind(null, reminder.id)}><Button type="submit" variant="ghost">Dismiss</Button></ActionForm>}</div></div></div></Card>)}</div> : <Card className="text-center"><BellRing size={22} className="mx-auto text-accent" /><p className="mt-3 text-sm text-ink-muted">No check-ins yet. Schedule one after choosing a decision.</p></Card>}
    </div>
  );
}
