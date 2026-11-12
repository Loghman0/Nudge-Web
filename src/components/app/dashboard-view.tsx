import Link from "next/link";
import { ArrowRight, BellRing, Compass, History, BarChart3, UsersRound, UserRound, Scale } from "lucide-react";

export interface DashboardViewProps {
  greeting: string;
  firstName: string;
  decisionCount: number;
  recentCount: number;
  tip: { text: string; a: string; b: string };
  reflection: { id: string; question: string } | null;
  decisions: { id: string; question: string; status: string; category: string | null }[];
  lastOutcome?: { id: string; question: string; chosen: string; rating: number; decidedAt: string | null } | null;
  outcomeUnavailable?: boolean;
}
const actions = [
  { href: "/discover", label: "Explore preferences", description: "Optional questions, with a topic you choose.", icon: Compass },
  { href: "/notifications", label: "Check-ins", description: "Return when you know how a choice turned out.", icon: BellRing },
  { href: "/analytics", label: "Life patterns", description: "Review the outcomes you have recorded.", icon: BarChart3 },
  { href: "/profile", label: "About you", description: "Inspect, correct or forget a preference.", icon: UserRound },
];

/** Only recorded outcomes are evidence. A new account has no invented history. */
export function DashboardView(data: DashboardViewProps) {
  const outcome = data.lastOutcome;
  const date = outcome?.decidedAt && Number.isFinite(Date.parse(outcome.decidedAt))
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(outcome.decidedAt)) : null;
  return <div className="dashboard-hindsight">
    <header className="dh-heading"><div><p className="dh-context">Today</p><h1>{data.greeting}, {data.firstName}.</h1><p>Pick now. Check once. Remember next time.</p></div><Link className="dh-button" href="/ask"><Scale size={18} aria-hidden />Compare options</Link></header>
    {data.reflection && <section className="dh-reflection" aria-labelledby="reflection-heading"><BellRing size={22} aria-hidden /><div><p className="dh-context">Ready to revisit</p><h2 id="reflection-heading">How did it turn out?</h2><p className="dh-question">{data.reflection.question}</p></div><Link className="dh-button dh-button-secondary" href={`/history?decision=${encodeURIComponent(data.reflection.id)}`}>Record a reflection<ArrowRight size={18} aria-hidden /></Link></section>}
    <div className="dh-workspace">
      <section className="dh-nudge" aria-labelledby="nudge-heading"><p className="dh-context">One everyday choice</p><h2 id="nudge-heading">Start with one choice.</h2><p>{data.tip.text}</p><div className="dh-options"><span>{data.tip.a}</span><span aria-hidden="true">or</span><span>{data.tip.b}</span></div><Link className="dh-button" href={`/ask?a=${encodeURIComponent(data.tip.a)}&b=${encodeURIComponent(data.tip.b)}`}>Compare these options<ArrowRight size={18} aria-hidden /></Link><p className="dh-note">You choose. Nudge helps you weigh the evidence.</p></section>
      <section className="dh-memory" aria-labelledby="memory-heading"><div className="dh-section-title"><h2 id="memory-heading">Last time…</h2><Link href="/history" className="dh-text-link">Journal<ArrowRight size={16} aria-hidden /></Link></div>
        {outcome ? <div className="dh-outcome"><p className="dh-question">{outcome.question}</p><p>You chose <strong>{outcome.chosen}</strong>{date && <> on <time dateTime={outcome.decidedAt!}>{date} (UTC)</time></>}.</p><p>Your outcome rating: <strong>{outcome.rating}/5</strong>.</p><p className="dh-note">One recorded outcome, not a prediction about your next choice.</p><Link className="dh-button dh-button-secondary" href={`/ask?copy=${encodeURIComponent(outcome.id)}`}>Decide again<ArrowRight size={18} aria-hidden /></Link><Link className="dh-text-link" href={`/history?decision=${encodeURIComponent(outcome.id)}`}>Read this outcome</Link></div>
        : <div className="dh-memory-empty"><p>{data.outcomeUnavailable ? "Your latest outcome could not be loaded. Open your journal or try again." : "No outcome to show yet. Choose an option, then return when you know how it went."}</p><Link href="/history" className="dh-text-link">Open your journal<ArrowRight size={16} aria-hidden /></Link></div>}
      </section>
    </div>
    <dl className="dh-summary dh-summary-compact" aria-label="Your activity"><div><dt>Decisions recorded</dt><dd className="dh-stat-value">{data.decisionCount}</dd><dd className="dh-stat-note">Comparisons in your journal, including unfinished choices.</dd></div><div><dt>Choices made this week</dt><dd className="dh-stat-value">{data.recentCount}</dd><dd className="dh-stat-note">In the last 7 days. Come back when you have something to learn.</dd></div></dl>
    <section className="dh-recent" aria-labelledby="recent-heading"><div className="dh-section-title"><h2 id="recent-heading">Recent decisions</h2><Link href="/history" className="dh-text-link">View history<ArrowRight size={16} aria-hidden /></Link></div>{data.decisions.length ? <ul className="dh-decision-list">{data.decisions.map(d => <li key={d.id}><Link href={`/history?decision=${encodeURIComponent(d.id)}`}><div><p>{d.question}</p><span className="dh-category">{d.category?.replace(/_/g, " ") ?? "Everyday choice"}</span></div><span className="dh-status">{d.status.replace(/_/g, " ")}</span><ArrowRight size={18} aria-hidden /></Link></li>)}</ul> : <div className="dh-empty"><History size={28} aria-hidden /><h3>Your next choice starts the story.</h3><p>Compare two options, choose one and come back to reflect. Your decision will appear here.</p><Link href="/ask" className="dh-button dh-button-secondary">Compare options</Link></div>}</section>
    <section className="dh-tools" aria-labelledby="tools-heading"><div className="dh-section-title"><h2 id="tools-heading">Keep exploring</h2></div><div className="dh-tool-list">{actions.map(action => <Link key={action.href} href={action.href}><action.icon size={22} aria-hidden /><div><h3>{action.label}</h3><p>{action.description}</p></div><ArrowRight size={18} aria-hidden /></Link>)}</div><details className="dh-score-help"><summary>More tools</summary><div className="flex flex-wrap gap-4"><Link href="/onboarding" className="dh-text-link">Optional starter questions</Link><Link href="/groups" className="dh-text-link"><UsersRound size={16} aria-hidden />Decision circles</Link></div></details></section>
  </div>;
}
