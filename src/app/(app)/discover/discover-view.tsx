"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { DiscoverChecksView } from "./discover-checks-view";
import { Flame, PartyPopper, Shuffle, SkipForward } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DISCOVER_TOPICS, type DiscoverActions, type AnswerResult, type VerificationItem } from "@/lib/discover/types";

interface Insight {
  prefKey: string;
  label: string;
  evidence: number;
}

interface Props {
  initial: AnswerResult;
  insight: Insight | null;
  /** Stale beliefs waiting for a "still true?" check. */
  verifications: VerificationItem[];
  /** How many questions the user wants to answer per day before it says "done". */
  dailyTarget: number;
  actions: DiscoverActions;
}

export function DiscoverView({ initial, insight, verifications, dailyTarget, actions }: Props) {
  const [state, setState] = useState<AnswerResult>(initial);
  const question = state.next;
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [keepGoing, setKeepGoing] = useState(false);
  const [justAnswered, setJustAnswered] = useState<"a" | "b" | "skip" | null>(null);
  const [changingTopic,setChangingTopic]=useState(false);
  function changeTopic() {
    if(pending||busy.current)return;
    busy.current=true;setChangingTopic(true);setError(null);
    startTransition(async()=>{
      try {
        const result=await actions.changeTopic(question?.context?.topic??state.topic??null);
        setState(result);setKeepGoing(true);
        window.history.replaceState(null,"",result.topic?`/discover?topic=${result.topic}`:"/discover");
      } catch(err){setError(err instanceof Error?err.message:"Couldn't change topics. Please try again.");}
      finally{busy.current=false;setChangingTopic(false);}
    });
  }

  const metTarget = state.answeredToday >= dailyTarget;
  const showQuestion = question && (!metTarget || keepGoing);

  function answer(choice: "a" | "b" | "skip") {
    if (!question || pending || busy.current) return;
    busy.current = true;
    setJustAnswered(choice);
    startTransition(async () => {
      setError(null);
      try {
      const result = await actions.answerQuestion(question.id, choice, state.topic);
      setState(result);
      setJustAnswered(null);

      } catch (err) { setError(err instanceof Error ? err.message : "Couldn't save your answer. Please try again."); setJustAnswered(null); }
      finally { busy.current = false; }
    });
  }

  return (
    <div className="space-y-5" aria-busy={pending}>
      {pending && <p role="status" className="text-xs text-ink-muted">{changingTopic?"Finding another topic…":"Saving your response…"}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {/* Progress line */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="inline-flex items-center gap-2 text-ink-muted">
          <Flame size={15} className={state.answeredToday > 0 ? "text-accent" : "text-ink-faint"} />
          {state.answeredToday === 0
            ? "Today's question is waiting"
            : `${state.answeredToday} answered today`}
        </span>
        <span className="text-xs text-ink-faint">
          {state.totalAnswered} explored · {state.remaining} ready to explore
        </span>
      </div>

      <nav aria-label="Discover topics" className="flex flex-wrap gap-2">
        <Link href="/discover" aria-current={!state.topic ? "page" : undefined} className={!state.topic ? "rounded-full bg-accent-soft px-3 py-1.5 text-sm font-medium" : "rounded-full border border-line px-3 py-1.5 text-sm"}>All topics</Link>
        {DISCOVER_TOPICS.map(([key, label]) => <Link key={key} href={`/discover?topic=${key}`} aria-current={state.topic === key ? "page" : undefined} className={state.topic === key ? "rounded-full bg-accent-soft px-3 py-1.5 text-sm font-medium" : "rounded-full border border-line px-3 py-1.5 text-sm"}>{label}</Link>)}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">{DISCOVER_TOPICS.find(([key])=>key===(question?.context?.topic??state.topic))?.[1]??"All topics"} · Your choices open related follow-ups.</p>
        <Button variant="secondary" disabled={pending} onClick={changeTopic}><Shuffle size={14}/> Change topic</Button>
      </div>
      <p className="text-xs text-ink-muted">Change topic without answering this question; it stays available for later. Neither changing topic nor skipping records a dislike.</p>
      {keepGoing && <Button variant="ghost" disabled={pending} onClick={() => setKeepGoing(false)}>Pause for today</Button>}

      {/* Today's question */}
      {showQuestion ? (
        <Card className="text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            {state.answeredToday === 0 ? "Today's question" : "One more"}
          </p>
          <h2 aria-live="polite" className="mt-3 text-xl font-medium">{question.prompt}</h2>
          {question.context?.connection && <p className="mt-2 text-sm text-ink-muted">{question.context.connection}</p>}

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {(["a", "b"] as const).map((side) => {
              const label = side === "a" ? question.option_a : question.option_b;
              return (
                <button
                  key={side}
                  type="button"
                  disabled={pending}
                  onClick={() => answer(side)}
                  aria-pressed={justAnswered === side}
                  className={`rounded-2xl border p-5 text-base font-medium transition-all hover:border-accent hover:bg-accent-soft/30 disabled:opacity-60 ${
                    justAnswered === side ? "animate-pop border-accent bg-accent-soft/40" : "border-line"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            disabled={pending}
            onClick={() => answer("skip")}
            className="mt-4 inline-flex items-center gap-1.5 text-xs text-ink-faint transition-colors hover:text-ink-muted disabled:opacity-50"
          >
            <SkipForward size={12} /> Neither / skip
          </button>
        </Card>
      ) : metTarget && question ? (
        <Card className="text-center">
          <PartyPopper size={22} className="mx-auto text-accent" />
          <h2 className="mt-3 text-lg font-medium">That&apos;s today&apos;s question done</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Come back tomorrow for the next one — or keep going if you&apos;re enjoying it.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={() => setKeepGoing(true)}>
              Keep exploring
            </Button>
            <Link href="/ask"><Button>Decide something</Button></Link>
          </div>
        </Card>
      ) : (
        <Card className="text-center">
          <PartyPopper size={22} className="mx-auto text-accent" />
          <h2 className="mt-3 text-lg font-medium">{state.topic ? "This topic is explored for now" : "You’ve explored every available question"}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {state.topic ? "Choose another topic to keep discovering." : "Nudge keeps learning from your decisions and quick checks."}
          </p>
          <Link href="/ask" className="mt-5 inline-block"><Button>Decide something</Button></Link>
        </Card>
      )}

      <DiscoverChecksView insight={insight} verifications={verifications} actions={actions} />
    </div>
  );
}
