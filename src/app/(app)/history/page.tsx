import Link from "next/link";
import { RotateCcw, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { DecisionCategory, DecisionStatus } from "@/lib/types";
import { ReminderControls } from "./reminder-controls";
import { ReflectionForm } from "./reflection-form";
import { dismissDecision } from "./actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";


// Every category the schema knows (migration 00007 added the last five) —
// a decision must never be unfilterable in its own history.
const CATEGORIES = [
  "food", "entertainment", "travel", "shopping", "lifestyle", "work",
  "social", "health", "career", "relationships", "finance", "hobbies", "other",
];
const STATUSES = ["open", "decided", "reflected", "abandoned"];
const PAGE_SIZE = 20;

function filterHref(params: { q?: string; category?: string; status?: string; page?: number }) {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.category) search.set("category", params.category);
  if (params.status) search.set("status", params.status);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const qs = search.toString();
  return qs ? `/history?${qs}` : "/history";
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; status?: string; page?: string; decision?: string }>;
}) {
  const { q, category, status, decision: targetDecision, page: pageParam } = await searchParams;
  const page = Math.max(1,Math.min(100000,Math.floor(Number(pageParam)||1)));
  const supabase = await createClient();

  let query = supabase
    .from("decisions")
    .select(
      "id, question, category, status, created_at, context, expected_outcome, reflection_due_at, reminder_enabled, selected_option_id, decision_options!decision_options_decision_id_fkey(id, label), decision_reflections(rating, notes)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (targetDecision) query = query.eq("id",targetDecision);
  if (q) query = query.ilike("question", `%${q}%`);
  if (category && CATEGORIES.includes(category as DecisionCategory))
    query = query.eq("category", category as DecisionCategory);
  if (status && STATUSES.includes(status as DecisionStatus))
    query = query.eq("status", status as DecisionStatus);

  const { data: decisions, count,error } = await query;
  if(error)throw new Error("Could not load your history. Please try again.");
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const hasFilters = Boolean(q || category || status);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Decision history.</h1>
        <p className="mt-2 text-ink-muted">Review what you chose, and tell Nudge how it went.</p>
      </header>

      {/* Search + filters (server-rendered, shareable URLs) */}
      <div className="space-y-3">
        <form action="/history" method="get" className="relative">
          <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint" />
          <Input name="q" defaultValue={q ?? ""} placeholder="Search your decisions…" className="pl-10" />
          {category && <input type="hidden" name="category" value={category} />}
          {status && <input type="hidden" name="status" value={status} />}
        </form>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <Link key={c} href={filterHref({ q, status, category: category === c ? undefined : c })}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs capitalize transition-colors",
                category === c ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-muted hover:text-ink"
              )}>
              {c}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUSES.map((s) => (
            <Link key={s} href={filterHref({ q, category, status: status === s ? undefined : s })}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs capitalize transition-colors",
                status === s ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-muted hover:text-ink"
              )}>
              {s}
            </Link>
          ))}
          {hasFilters && (
            <Link href="/history" className="ml-1 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink">
              <X size={12} /> Clear
            </Link>
          )}
        </div>
      </div>

      {!decisions?.length && (
        <Card className="text-center text-sm text-ink-muted">
          {hasFilters
            ? "No decisions match these filters."
            : "Nothing here yet. Your decisions will appear as soon as you ask Nudge something."}
        </Card>
      )}

      <div className="space-y-4">
        {decisions?.map((d) => {
          const opts = (d.decision_options ?? []) as { id: string; label: string }[];
          const selected = opts.find((o) => o.id === d.selected_option_id);
          const reflection = Array.isArray(d.decision_reflections)
            ? d.decision_reflections[0] : d.decision_reflections;
          const context = (d.context ?? {}) as Record<string, string>;
          const contextBits = [context.mood, context.budget && `Budget: ${context.budget}`, context.company && `With: ${context.company}`].filter(Boolean);
          return (
            <Card key={d.id} id={d.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium">{d.question}</p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {selected ? <>Chose <span className="text-ink">{selected.label}</span></> : d.status === "abandoned" ? "Let it go" : "No choice committed"}
                    {" · "}
                    {new Date(d.created_at).toLocaleDateString()}
                  </p>
                  {contextBits.length > 0 && (
                    <p className="mt-1 text-xs text-ink-faint">{contextBits.join(" · ")}</p>
                  )}
                </div>
                <span className="shrink-0 rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs capitalize text-ink-muted">
                  {d.category}
                </span>
              </div>

              {d.status === "decided" && selected && (
                <div className="mt-4 border-t border-line pt-4">
                  <p className="text-sm font-medium">How was your decision?</p>
                  {d.expected_outcome && (
                    <p className="mt-1 text-xs text-ink-muted">
                      You expected: <span className="italic">&ldquo;{d.expected_outcome}&rdquo;</span> — did it turn out that way?
                    </p>
                  )}
                  <ReflectionForm decisionId={d.id} />
                  <ReminderControls decisionId={d.id} dueAt={d.reflection_due_at} enabled={d.reminder_enabled} link={false} />
                </div>
              )}

              {reflection?.rating && (
                <div className="mt-3 text-sm text-ink-faint">
                  Reflected: {"★".repeat(reflection.rating)}{"☆".repeat(5 - reflection.rating)}
                  {reflection.notes && <p className="mt-1 italic text-ink-muted">“{reflection.notes}”</p>}
                </div>
              )}

              <div className="mt-3 flex gap-3 text-xs">
                <Link
                  href={`/ask?copy=${d.id}`}
                  className="inline-flex items-center gap-1 text-ink-muted hover:text-ink">
                  <RotateCcw size={12} /> Decide again
                </Link>
                {d.status === "open" && <Link href={`/ask?resume=${d.id}`} className="text-accent hover:underline">Resume comparison</Link>}
                {d.status === "open" && (
                  <form action={dismissDecision.bind(null, d.id)}>
                    <button type="submit" className="inline-flex items-center gap-1 text-ink-muted hover:text-ink">
                      <X size={12} /> Let it go
                    </button>
                  </form>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-muted">
          {page > 1 ? (
            <Link href={filterHref({ q, category, status, page: page - 1 })} className="hover:text-ink">← Newer</Link>
          ) : <span />}
          <span className="text-xs">Page {page} of {totalPages}</span>
          {page < totalPages ? (
            <Link href={filterHref({ q, category, status, page: page + 1 })} className="hover:text-ink">Older →</Link>
          ) : <span />}
        </div>
      )}
    </div>
  );
}
