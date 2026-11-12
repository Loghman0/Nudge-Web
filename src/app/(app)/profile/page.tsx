import { getAi } from "@/lib/services/ai";
import Link from "next/link";
import { readAiAccountingConfig } from "@/lib/services/ai/accounting-config";
import { PrivacyControls,DeleteAccount } from "./privacy-controls";
import { POLICY_VERSION } from "@/lib/legal/config";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DiscoveryProfilePanel } from "@/components/discovery/profile-client";
import { journalDate } from "@/lib/services/calendar";
import { GuestUpgrade } from "@/components/app/guest-upgrade";
import { Award, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MemoryInspector, MemoryLibrary } from "./memory-inspector";
import { loadMemories } from "./actions";
import { DangerZone, EditableBasics, RemovablePreference } from "./profile-client";


export default async function ProfilePage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if(!user)redirect("/login");
  const isGuest = Boolean(user?.is_anonymous);

  const loaded = await Promise.all([
    supabase.from("profiles").select("*").single(),
    supabase.from("preferences").select("*").not("key", "like", "discovery.%").order("strength", { ascending: false }).limit(200),
    loadMemories(),
    supabase.from("user_achievements").select("achievement_slug, earned_at, achievements(title, description, icon)").order("earned_at", { ascending: false }),
    supabase.from("knowledge_nodes")
      .select("id, key, value, category_slug, polarity, confidence, belief_score, evidence_count, source, last_reinforced_at, status, metadata")
      .eq("status", "active").not("key", "like", "discovery.%").order("updated_at", { ascending: false }).order("id"),
  ] as const);

  if(loaded.some(result=>result.error))throw new Error("Could not load your profile data. Please try again.");
  const [{data:profile},{data:prefs},memoryPage,{data:achievements},{data:nodes}]=loaded;
  const likes = prefs?.filter((p) => p.polarity === "like" && !/^learned\.[a-z]+\.scope\./.test(p.key)) ?? [];
  const dislikes = prefs?.filter((p) => p.polarity === "dislike" && !/^learned\.[a-z]+\.scope\./.test(p.key)) ?? [];

  const pretty = (p: { value: string | null; key: string }) =>
    p.value ?? (p.key.split(".").pop() ?? p.key).replace(/-/g, " ");

  const timeline = [...(prefs ?? [])]
    .sort((a, b) => new Date(b.last_reinforced_at ?? b.created_at).getTime() - new Date(a.last_reinforced_at ?? a.created_at).getTime())
    .slice(0, 6);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">About you.</h1>
        <p className="mt-2 text-ink-muted">Manage your profile, data, and what Nudge knows about you.</p>
      </header>

      {isGuest && <GuestUpgrade />}



      <DiscoveryProfilePanel key={profile?.memory_generation} />
      <details className="space-y-5 rounded-2xl border border-line p-5"><summary className="min-h-11 cursor-pointer py-2 font-medium">Earlier decisions and memory</summary><a href="/discover/checks" className="inline-block min-h-11 py-3 text-sm text-accent underline">Review earlier preferences</a>
      <nav aria-label="Decision tools" className="grid gap-1 sm:grid-cols-2">
        {[
          ["/history", "Decision journal"], ["/notifications", "Outcome check-ins"],
          ["/analytics", "Outcome patterns"], ["/groups", "Decision circles"],
          ["/onboarding", "Starter preferences"],
        ].map(([href, label]) => <Link key={href} href={href} className="flex min-h-11 items-center rounded-lg px-3 py-2 text-sm text-accent underline underline-offset-4 hover:bg-surface-sunken">{label}</Link>)}
      </nav>

      <Card>
        <div className="flex items-center gap-2"><Award size={18} className="text-accent" /><h2 className="text-sm font-medium">Milestones</h2></div>
        {achievements?.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{achievements.map((entry) => {
          const achievement = Array.isArray(entry.achievements) ? entry.achievements[0] : entry.achievements;
          return <div key={entry.achievement_slug} className="rounded-xl border border-line bg-surface-sunken/40 p-3"><p className="text-sm font-medium">{achievement?.title ?? "Achievement"}</p><p className="mt-1 text-xs text-ink-muted">{achievement?.description}</p></div>;
        })}</div> : <p className="mt-2 text-sm text-ink-muted">Your milestones appear as Nudge gets to know you.</p>}
      </Card>

      <MemoryInspector nodes={(nodes ?? []).slice(0,20)} timeZone={profile?.timezone} memoryGeneration={profile?.memory_generation} />

      <Card>
        <h2 className="text-sm font-medium">Preference timeline</h2>
        {timeline.length ? <ul className="mt-3 divide-y divide-line">{timeline.map((preference) => <li key={preference.id} className="flex items-center justify-between gap-4 py-3 text-sm"><span className="capitalize">{pretty(preference)}</span><span className="shrink-0 text-xs text-ink-faint">Reinforced {journalDate(preference.last_reinforced_at ?? preference.created_at,profile?.timezone)}</span></li>)}</ul> : <p className="mt-2 text-sm text-ink-muted">Your evolving preferences will appear here.</p>}
      </Card>

      <Card>
        <h2 className="text-sm font-medium">Likes</h2>
        <p className="mt-1 text-xs text-ink-faint">Press × to forget a preference and stop using it in recommendations.</p>
        {likes.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {likes.map((p) => (
              <RemovablePreference key={p.id} id={p.id} label={pretty(p)} strength={p.strength} liked />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">Nothing learned yet — answer questions or reflect on decisions.</p>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-medium">Dislikes</h2>
        {dislikes.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {dislikes.map((p) => (
              <RemovablePreference key={p.id} id={p.id} label={pretty(p)} liked={false} />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">No dislikes recorded. Low-rated reflections will show up here.</p>
        )}
      </Card>

      <MemoryLibrary initial={memoryPage.memories} initialHasMore={memoryPage.hasMore} memoryGeneration={profile?.memory_generation} />

      </details>
      <details className="space-y-5 rounded-2xl border border-line p-5"><summary className="min-h-11 cursor-pointer py-2 font-medium">Account settings</summary>
      <Card>
        <EditableBasics profile={{
          full_name: profile?.full_name ?? null,
          country: profile?.country ?? null,
          language: profile?.language ?? null,
          occupation: profile?.occupation ?? null,
        }} />
      </Card>
      <Card><PrivacyControls aiAvailable={getAi()!==null && readAiAccountingConfig()!==null && !(process.env.NUDGE_AI_DEVELOPMENT_FREE==="true" && process.env.NUDGE_PUBLIC_LAUNCH==="true")} aiEnabled={profile?.ai_enabled??false} accepted={profile?.terms_version===POLICY_VERSION}/></Card>

      </details>
      <Card>
        <div className="flex items-center gap-2"><ShieldCheck size={18} className="text-accent" /><h2 className="text-sm font-medium">Your data, your rules</h2></div>
        <p className="mt-2 text-sm text-ink-muted">
          Your decision memory belongs to you. Export it any time, or make Nudge forget.
        </p>
        <div className="mt-4">
          <DangerZone />
          <DeleteAccount/>
        </div>
      </Card>
    </div>
  );
}


