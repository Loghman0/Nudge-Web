import Link from "next/link";
import { pollResult } from "@/lib/services/poll-result";
import { ActionForm } from "@/components/app/action-form";
import { notFound } from "next/navigation";
import { ArrowLeft, Crown, UsersRound, Vote } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { closePoll, createPoll, leaveCircle, votePoll, rotateCircleInvite, deleteCircle } from "../actions";
import { CopyInvite } from "../copy-invite";

type Member = { user_id: string; full_name: string; role: string; joined_at: string };
type PollRow = {
  id: string;
  question: string;
  status: string;
  created_by: string;
  created_at: string;
  group_poll_options: { id: string; label: string; sort_order: number }[];
  group_poll_votes: { option_id: string; user_id: string }[];
};

export default async function CircleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: circle, error: circleError }, { data: members, error: memberError }, { data: polls, error: pollError }, { data: aggregateVotes, error: voteCountError }] = await Promise.all([
    supabase.from("decision_groups").select("id, name, owner_id, invite_code").eq("id", id).maybeSingle(),
    supabase.rpc("circle_members", { gid: id }),
    supabase
      .from("group_polls")
      .select("id, question, status, created_by, created_at, group_poll_options(id, label, sort_order), group_poll_votes(option_id, user_id)")
      .eq("group_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.rpc("circle_vote_counts", { gid: id }),
  ]);

  if (circleError) throw new Error("Couldn't load this circle. Please try again.");
  if (!circle) notFound();
  if (memberError) throw new Error("Couldn't load the circle members. Please try again.");
  if (pollError) throw new Error("Couldn't load the circle votes. Please try again.");
  if (voteCountError) throw new Error("Couldn't load vote totals. Please try again.");
  const roster = (members ?? []) as Member[];
  const isOwner = circle.owner_id === user?.id;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/groups" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={14} /> All circles
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{circle.name}</h1>
            <p className="mt-1 text-sm text-ink-muted">
              {roster.length} member{roster.length === 1 ? "" : "s"} · only vote totals are shared; your selection is stored privately
            </p>
          </div>
          {circle.invite_code && <CopyInvite code={circle.invite_code} />}
        </div>
      </div>

      <Card>
        <div className="flex items-center gap-2"><UsersRound size={17} className="text-accent" /><h2 className="text-sm font-medium">Members</h2></div>
        <div className="mt-3 flex flex-wrap gap-2">
          {roster.map((m) => (
            <span key={m.user_id} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs">
              {m.role === "owner" && <Crown size={11} className="text-accent" />}
              {m.full_name}{m.user_id === user?.id ? " (you)" : ""}
            </span>
          ))}
        </div>
        {!isOwner && (
          <ActionForm action={leaveCircle.bind(null, circle.id)} className="mt-4">
            <button type="submit" className="text-xs text-ink-muted hover:text-red-500">Leave this circle</button>
          </ActionForm>
        )}
      </Card>

      {isOwner && <Card>
        <h2 className="font-medium">Circle controls</h2>
        <p className="mt-2 text-sm text-ink-muted">Refreshing the invite disables the old code. Deleting this circle removes its shared polls for everyone.</p>
        <ActionForm action={rotateCircleInvite.bind(null,circle.id)} className="mt-3"><Button variant="secondary">Refresh invitation code</Button></ActionForm>
        <ActionForm action={deleteCircle.bind(null,circle.id)} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="block space-y-1 text-xs text-ink-muted"><span className="block">Type DELETE to delete this circle</span><Input name="confirmation" placeholder="Type DELETE" required /></label>
          <Button variant="ghost" className="text-red-600">Delete circle</Button>
        </ActionForm>
      </Card>}

      <Card className="border-accent/25 bg-accent-soft/20">
        <div className="flex items-center gap-2"><Vote size={17} className="text-accent" /><h2 className="text-sm font-medium">Start a vote</h2></div>
        <ActionForm action={createPoll.bind(null, circle.id)} className="mt-3 space-y-2.5">
          <label className="block space-y-1 text-xs text-ink-muted"><span className="block">Vote question</span><Input name="question" required maxLength={200} placeholder="e.g. Where should we eat on Friday?" /></label>
          <div className="grid gap-2 sm:grid-cols-2">
            {[1,2,3,4].map(n => <label key={n} className="block space-y-1 text-xs text-ink-muted"><span className="block">Option {n}{n>2?' (optional)':''}</span><Input name={`option_${n}`} required={n<=2} maxLength={100} placeholder={`Option ${n}${n>2?' (optional)':''}`} /></label>)}
          </div>
          <Button type="submit">Open the vote</Button>
        </ActionForm>
      </Card>

      <div className="space-y-4">
        {(polls as PollRow[] | null)?.map((poll) => {
          const options = [...poll.group_poll_options].sort((a, b) => a.sort_order - b.sort_order);
          const votes = poll.group_poll_votes ?? [];
          const myVote = votes.find((v) => v.user_id === user?.id)?.option_id ?? null;
          const counts = new Map<string, number>((aggregateVotes ?? []).filter((v) => v.poll_id === poll.id).map((v) => [v.option_id, Number(v.votes)]));
          const totalVotes = [...counts.values()].reduce((sum, count) => sum + count, 0);
          const outcome = pollResult(options, counts);
          const open = poll.status === "open";
          return (
            <Card key={poll.id}>
              <div className="flex items-start justify-between gap-4">
                <p className="font-medium">{poll.question}</p>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs capitalize ${
                  open ? "bg-accent-soft text-accent" : "bg-surface-sunken text-ink-muted"
                }`}>{open ? "voting" : "closed"}</span>
              </div>
              <div className="mt-4 space-y-2">
                {options.map((o) => {
                  const n = counts.get(o.id) ?? 0;
                  const pct = totalVotes ? Math.round((n / totalVotes) * 100) : 0;
                  const isLeader = !open && outcome.winnerId === o.id;
                  return (
                    <ActionForm key={o.id} action={votePoll.bind(null, circle.id, poll.id, o.id)}>
                      <button
                        type="submit"
                        aria-pressed={myVote === o.id}
                        disabled={!open}
                        className={`relative w-full overflow-hidden rounded-xl border p-3 text-left text-sm transition-colors ${
                          myVote === o.id ? "border-accent" : "border-line"
                        } ${open ? "hover:border-accent" : "cursor-default"}`}
                      >
                        <span className="absolute inset-y-0 left-0 bg-accent-soft/60" style={{ width: `${pct}%` }} />
                        <span className="relative flex items-center justify-between">
                          <span className="font-medium">
                            {o.label}
                            {myVote === o.id && <span className="ml-2 text-xs text-accent">your vote</span>}
                            {isLeader && <span className="ml-2 text-xs text-accent">winner</span>}
                            {!open && outcome.tiedIds.includes(o.id) && <span className="ml-2 text-xs text-accent">tied</span>}
                          </span>
                          <span className="text-xs text-ink-muted">{n} · {pct}%</span>
                        </span>
                      </button>
                    </ActionForm>
                  );
                })}
              </div>
              {!open && <p className="mt-3 text-sm text-ink-muted">{!outcome.hasVotes ? 'Closed with no votes; there is no winner.' : outcome.tiedIds.length ? 'The vote ended in a tie; there is no single winner.' : 'The option with the most votes wins.'}</p>}
              <div className="mt-3 flex items-center justify-between text-xs text-ink-muted">
                <span>{totalVotes} of {roster.length} voted</span>
                {open && (poll.created_by === user?.id || isOwner) && (
                  <ActionForm action={closePoll.bind(null, circle.id, poll.id)}>
                    <button type="submit" className="hover:text-ink">Close &amp; show results</button>
                  </ActionForm>
                )}
              </div>
            </Card>
          );
        })}
        {!polls?.length && (
          <Card className="text-center text-sm text-ink-muted">
            No votes yet. Open the first one — “Where should we eat on Friday?” is a classic.
          </Card>
        )}
      </div>
    </div>
  );
}
