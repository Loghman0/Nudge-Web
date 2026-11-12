import Link from "next/link";
import { ActionForm } from "@/components/app/action-form";
import { ArrowRight, UsersRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createDecisionCircle, joinDecisionCircle } from "./actions";
import { CopyInvite } from "./copy-invite";

export default async function GroupsPage({searchParams}:{searchParams:Promise<{invite?:string}>}) {
  const invite=(await searchParams).invite??"";
  const supabase = await createClient();
  const { data: circles,error } = await supabase
    .from("decision_groups")
    .select("id, name, created_at, invite_code")
    .order("created_at", { ascending: false });

  if(error)throw new Error("Could not load your circles. Please try again.");
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div><h1 className="text-2xl font-semibold tracking-tight">Decision circles</h1><p className="mt-1 text-sm text-ink-muted">Create a private space for the people whose choices you make together.</p></div>
      <Card className="border-accent/25 bg-accent-soft/20"><ActionForm action={createDecisionCircle} className="flex flex-col gap-3 sm:flex-row"><Input name="name" required maxLength={80} placeholder="e.g. Friday night crew" /><Button type="submit" className="shrink-0">Create circle</Button></ActionForm><p className="mt-3 text-xs text-ink-muted">Circles keep shared decisions separate from your personal memory. Open a circle to start a vote.</p></Card>
      <Card><ActionForm action={joinDecisionCircle} className="flex flex-col gap-3 sm:flex-row"><Input name="code" defaultValue={/^[a-f0-9]{18}$/i.test(invite)?invite:""} required placeholder="Paste an invitation code" /><Button type="submit" variant="secondary" className="shrink-0">Join circle</Button></ActionForm></Card>
      {circles?.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {circles.map((circle) => (
            <Card key={circle.id} className="flex flex-col">
              <UsersRound size={19} className="text-accent" />
              <h2 className="mt-4 font-medium">{circle.name}</h2>
              <p className="mt-1 flex-1 text-sm text-ink-muted">Your private decision circle</p>
              {circle.invite_code && (
                <div className="mt-4"><CopyInvite code={circle.invite_code} /></div>
              )}
              <Link href={`/groups/${circle.id}`}
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                Open circle <ArrowRight size={14} />
              </Link>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="text-center"><UsersRound size={22} className="mx-auto text-accent" /><p className="mt-3 text-sm text-ink-muted">Start a circle for a partner, family, or friends you decide with often.</p></Card>
      )}
    </div>
  );
}
