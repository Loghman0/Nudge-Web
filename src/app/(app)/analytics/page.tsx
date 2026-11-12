import { BarChart3, CalendarDays, CircleCheck, Flame, HeartCrack, ThumbsUp, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AiRecap } from "./ai-recap";
import { firstRelated } from "@/lib/services/relations";
import { Card } from "@/components/ui/card";
import { calendarDay } from "@/lib/services/calendar";


type DecisionRow = {
  id: string;
  question: string;
  category: string;
  status: string;
  created_at: string;
  context: Record<string, string> | null;
  decision_options: { id: string; label: string }[] | null;
  selected_option_id: string | null;
  decision_reflections: { rating: number | null; has_regrets: boolean | null } | { rating: number | null; has_regrets: boolean | null }[] | null;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const profile = await supabase.from("profiles").select("timezone").single();
  if (profile.error) throw new Error("Could not load your analytics timezone. Please try again.");
  const timezone = profile.data?.timezone ?? "UTC";
  const { data,error } = await supabase
    .from("decisions")
    .select("id, question, category, status, created_at, context, selected_option_id, decision_options!decision_options_decision_id_fkey(id, label), decision_reflections(rating, has_regrets)")
    .order("created_at", { ascending: false })
    .limit(250);
  if(error)throw new Error("Could not load analytics. Please try again.");
  const decisions = (data ?? []) as DecisionRow[];

  const withReflection = decisions
    .map((d) => ({ decision: d, reflection: firstRelated(d.decision_reflections) }))
    .filter((x) => x.reflection);
  const reflections = withReflection.map((x) => x.reflection!);
  const rated = reflections.filter((r) => r.rating !== null);
  const averageRating = rated.length
    ? (rated.reduce((sum, r) => sum + (r.rating ?? 0), 0) / rated.length).toFixed(1)
    : "—";
  const regretRate = reflections.length
    ? Math.round((reflections.filter((r) => r.has_regrets).length / reflections.length) * 100)
    : 0;

  const byCategory = Object.entries(decisions.reduce<Record<string, number>>((counts, d) => {
    counts[d.category] = (counts[d.category] ?? 0) + 1;
    return counts;
  }, {})).sort(([, a], [, b]) => b - a);
  const maxCategory = byCategory[0]?.[1] ?? 1;
  const recentDays = new Set(decisions.map((d) => calendarDay(d.created_at,timezone)?.date).filter(Boolean));

  // 12-week activity sparkline.
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const start = Date.now() - (12 - i) * 7 * 86_400_000;
    const end = start + 7 * 86_400_000;
    return decisions.filter((d) => {
      const t = new Date(d.created_at).getTime();
      return t >= start && t < end;
    }).length;
  });
  const maxWeek = Math.max(1, ...weeks);

  // Satisfaction by category (avg rating).
  const satisfaction = new Map<string, { sum: number; n: number }>();
  for (const { decision, reflection } of withReflection) {
    if (reflection!.rating == null) continue;
    const entry = satisfaction.get(decision.category) ?? { sum: 0, n: 0 };
    entry.sum += reflection!.rating;
    entry.n++;
    satisfaction.set(decision.category, entry);
  }
  const satisfactionRows = [...satisfaction.entries()]
    .map(([cat, { sum, n }]) => ({ cat, avg: sum / n, n }))
    .sort((a, b) => b.avg - a.avg);

  // Busiest weekday.
  const weekdayCounts = decisions.reduce<number[]>((acc, d) => {
    const day = calendarDay(d.created_at,timezone);
    if (day && day.weekday >= 0) acc[day.weekday]++;
    return acc;
  }, [0, 0, 0, 0, 0, 0, 0]);
  const busiestDay = weekdayCounts.some((c) => c > 0)
    ? WEEKDAYS[weekdayCounts.indexOf(Math.max(...weekdayCounts))]
    : null;

  const selectedLabel = (d: DecisionRow) =>
    d.decision_options?.find((o) => o.id === d.selected_option_id)?.label ?? null;

  const best = withReflection
    .filter((x) => (x.reflection!.rating ?? 0) >= 4)
    .slice(0, 3);
  const regretted = withReflection
    .filter((x) => x.reflection!.has_regrets || (x.reflection!.rating ?? 5) <= 2)
    .slice(0, 3);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Decisions, decoded.</h1>
        <p className="mt-2 text-ink-muted">Your patterns, biases, and history all in one place.</p>
      </header>

      <AiRecap />

      <div className="grid gap-4 sm:grid-cols-4">
        <Metric icon={BarChart3} label="Recent decisions (up to 250)" value={String(decisions.length)} />
        <Metric icon={CircleCheck} label="Average outcome" value={averageRating === "—" ? "No ratings" : `${averageRating} / 5`} />
        <Metric icon={HeartCrack} label="Regret rate" value={reflections.length ? `${regretRate}%` : "No reflections"} />
        <Metric icon={Flame} label="Active days" value={String(recentDays.size)} />
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <div><h2 className="font-medium">Decision activity</h2><p className="mt-1 text-sm text-ink-muted">Last 12 weeks{busiestDay ? ` · you decide most on ${busiestDay}s` : ""}</p></div>
          <TrendingUp size={19} className="text-accent" />
        </div>
        <div className="mt-6 flex h-24 items-end gap-1.5">
          {weeks.map((count, i) => (
            <div key={i} className="group relative flex-1">
              <div
                className="w-full rounded-t-md bg-accent/70 transition-colors group-hover:bg-accent"
                style={{ height: `${Math.max(4, (count / maxWeek) * 96)}px` }}
                title={`${count} decision${count === 1 ? "" : "s"}`}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-ink-faint"><span>12 weeks ago</span><span>This week</span></div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between"><h2 className="font-medium">Where you spend your decisions</h2><BarChart3 size={19} className="text-accent" /></div>
          {byCategory.length ? <div className="mt-5 space-y-4">{byCategory.map(([category, count]) => <div key={category}><div className="mb-1.5 flex justify-between text-sm"><span className="capitalize">{category}</span><span className="text-ink-muted">{count}</span></div><div className="h-2 overflow-hidden rounded-full bg-surface-sunken"><div className="h-full rounded-full bg-accent" style={{ width: `${(count / maxCategory) * 100}%` }} /></div></div>)}</div> : <p className="mt-5 text-sm text-ink-muted">Your patterns will appear after your first saved decision.</p>}
        </Card>

        <Card>
          <div className="flex items-center justify-between"><h2 className="font-medium">Satisfaction by category</h2><ThumbsUp size={19} className="text-accent" /></div>
          {satisfactionRows.length ? (
            <div className="mt-5 space-y-4">
              {satisfactionRows.map(({ cat, avg, n }) => (
                <div key={cat}>
                  <div className="mb-1.5 flex justify-between text-sm"><span className="capitalize">{cat}</span><span className="text-ink-muted">{avg.toFixed(1)} / 5 · {n} rated</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-sunken"><div className="h-full rounded-full bg-accent" style={{ width: `${(avg / 5) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          ) : <p className="mt-5 text-sm text-ink-muted">Rate a few outcomes to see which areas of life are going best.</p>}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-medium">Decisions that paid off</h2>
          {best.length ? (
            <ul className="mt-3 space-y-3">
              {best.map(({ decision, reflection }) => (
                <li key={decision.id} className="text-sm">
                  <p className="truncate">{decision.question}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{selectedLabel(decision) ?? "—"} · {"★".repeat(reflection!.rating ?? 0)}</p>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-ink-muted">Your 4–5 star choices will collect here.</p>}
        </Card>

        <Card>
          <h2 className="font-medium">Worth avoiding next time</h2>
          {regretted.length ? (
            <ul className="mt-3 space-y-3">
              {regretted.map(({ decision, reflection }) => (
                <li key={decision.id} className="text-sm">
                  <p className="truncate">{decision.question}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{selectedLabel(decision) ?? "—"} · {reflection!.has_regrets ? "regretted" : `${reflection!.rating}★`}</p>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-ink-muted">No regrets recorded — Nudge will flag repeat offenders here.</p>}
        </Card>
      </div>

      <Card>
        <div className="flex items-center gap-2"><CalendarDays size={17} className="text-accent" /><h2 className="font-medium">A note from your memory</h2></div>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{reflections.length < 3 ? "Complete a few reflections to unlock meaningful outcome insights. Nudge learns most from what happened after the choice." : regretRate > 35 ? "Regret is showing up often. Review your past outcomes and the reasons behind your next choice. Budget, mood and company are journal notes; they do not change the fit score." : "Your reflections are forming a useful decision memory. Keep closing the loop after meaningful choices."}</p>
      </Card>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof BarChart3; label: string; value: string }) {
  return <Card className="p-4"><Icon size={17} className="text-accent" /><p className="mt-4 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-ink-muted">{label}</p></Card>;
}
