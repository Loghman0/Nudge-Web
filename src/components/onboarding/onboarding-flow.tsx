"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { completeOnboarding } from "@/app/(app)/onboarding/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/cozy";
import type { OnboardingQuestion } from "@/lib/types";

type Choice = "a" | "b" | "both" | "depends" | "neither" | "skip";
const neutralChoices: { value: Choice; label: string }[] = [
  { value: "both", label: "Both could fit" },
  { value: "depends", label: "It depends" },
  { value: "neither", label: "Neither fits" },
  { value: "skip", label: "Skip this question" },
];
const choiceLabel = (question: OnboardingQuestion, choice?: Choice) => choice === "a" ? question.option_a : choice === "b" ? question.option_b : neutralChoices.find(value => value.value === choice)?.label ?? "Not answered";

export function OnboardingFlow({ initialName, initialGeneration, questions, questionRationales = {}, returnTo = "/ask", completeAction = completeOnboarding }: {
  initialName: string;
  initialGeneration: number;
  questions: OnboardingQuestion[];
  questionRationales?: Record<string, string>;
  returnTo?: string;
  completeAction?: (input: unknown) => Promise<void>;
  /** Retained for existing callers; this foundation flow sends no free text to AI. */
  aiEnabled?: boolean;
}) {
  const fieldId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const inFlight = useRef(false);
  // A server refresh must not attach private drafts to a newer privacy generation.
  const expectedGeneration = useRef(initialGeneration);
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState(initialName);
  const [answers, setAnswers] = useState<Record<string, Choice>>({});
  const [editingFromReview, setEditingFromReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const total = questions.length + 2;
  const isWelcome = step === 0;
  const isReview = step === total - 1;
  const question = questions[step - 1];
  const selection = question ? answers[question.id] : undefined;
  const explicitAnswers = questions.filter(value => answers[value.id] === "a" || answers[value.id] === "b").length;
  useEffect(() => { heading.current?.focus(); }, [step]);

  function move(next: number) { if (!inFlight.current) { setStep(next); setError(null); } }
  function choose(value: Choice) { if (!inFlight.current && question) setAnswers(previous => ({ ...previous, [question.id]: value })); }
  function finish() {
    if (inFlight.current || saved || stale || !questions.length) return;
    if (fullName.length > 80) { setError("Keep your name within 80 characters, or leave it blank."); return; }
    const input = { fullName: fullName.trim(), country: "", language: "", age: "", occupation: "", about: "",
      expectedGeneration: expectedGeneration.current, next: returnTo,
      answers: questions.filter(value => answers[value.id] !== undefined).map(value => ({ questionId: value.id,
        answer: answers[value.id] === "a" ? "a" as const : answers[value.id] === "b" ? "b" as const : "skip" as const })) };
    inFlight.current = true; setError(null);
    startTransition(async () => {
      try { await completeAction(input); setSaved(true); }
      catch (err) {
        if (err instanceof Error && "digest" in err && String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT")) throw err;
        if(err instanceof Error && /memory changed/i.test(err.message)) { setStale(true);setError("Your memory changed. Reload the starter questions before saving. Your reviewed answers remain here until you reload.");return; }
        setError("Couldn't save your setup. Your answers are still here. Check your connection and try again.");
      } finally { inFlight.current = false; }
    });
  }

  return <div className="space-y-6">
    <div className="rounded-card border border-line bg-surface-raised p-4">
      <p className="text-sm text-ink-muted">This setup is optional. Answer only what fits. Nothing is saved until you review and save.</p>
      {pending ? <span aria-disabled="true" className="mt-2 inline-block text-sm text-ink-muted">Saving your setup…</span> : <Link href={returnTo} onClick={event => { if(inFlight.current)event.preventDefault(); }} className="mt-2 inline-block text-sm font-medium text-accent underline underline-offset-4">Compare a choice now</Link>}
    </div>
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs text-ink-muted"><span>{isWelcome ? "Getting started" : isReview ? "Review and save" : `Question ${step} of ${questions.length}`}</span><span>{step + 1} / {total}</span></div>
      <div role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={step + 1} aria-valuetext={isWelcome ? "Getting started" : isReview ? "Ready to review" : `Question ${step} of ${questions.length}`} className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
        <div className="h-full rounded-full bg-accent transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${((step + 1) / total) * 100}%` }} />
      </div>
    </div>

    {isWelcome ? <section className="space-y-5">
      <div><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight focus:outline-hidden">Start with a few everyday choices</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{questions.length ? `${questions.length} short questions give Nudge a starting point for your everyday preferences.` : "The starter questions are currently unavailable."} These answers describe a few situations, not your whole personality. You can change your mind.</p></div>
      <Field label="What should Nudge call you? (optional)" name="fullName" value={fullName} maxLength={80} autoComplete="given-name" placeholder="Your name" onChange={event => setFullName(event.target.value)} />
      {questions.length > 0 ? <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" disabled={pending} onClick={() => { setAnswers({}); setEditingFromReview(false); move(total - 1); }}>Skip the questions</Button>
        <Button disabled={pending} onClick={() => move(1)}>Start the questions</Button>
      </div> : <p role="status" className="text-sm text-ink-muted">You can compare a choice now and return when the questions are available. Your profile has not been marked complete.</p>}
    </section> : isReview ? <section className="space-y-5">
      <div><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight focus:outline-hidden">Check your starting point</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{explicitAnswers ? `${explicitAnswers} ${explicitAnswers === 1 ? "answer will be saved as an explicit everyday preference" : "answers will be saved as explicit everyday preferences"}.` : "No preference for either side will be saved."} Both, depends, neither and skipped questions never become a preference for one side.</p></div>
      <Field label="What should Nudge call you? (optional)" name="fullName" value={fullName} maxLength={80} autoComplete="given-name" placeholder="Your name" disabled={pending || saved} onChange={event => setFullName(event.target.value)} />
      <ol className="space-y-3">{questions.map((value, index) => <li key={value.id} className="rounded-card border border-line bg-surface-raised p-4">
        <p className="text-sm font-medium leading-relaxed">{value.prompt}</p>
        <p className="mt-2 flex items-start gap-2 text-sm text-ink-muted">{(answers[value.id] === "a" || answers[value.id] === "b") && <Check size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />}<span>{choiceLabel(value, answers[value.id])}{answers[value.id] !== "a" && answers[value.id] !== "b" ? " · no single preference saved" : ""}</span></p>
        <button type="button" disabled={pending || saved} onClick={() => { setEditingFromReview(true); move(index + 1); }} className="mt-2 min-h-10 text-sm font-medium text-accent underline underline-offset-4 disabled:opacity-50" aria-label={`Edit answer ${index + 1}`}>Edit answer</button>
      </li>)}</ol>
      <p className="text-xs leading-relaxed text-ink-muted">These are starting preferences, not verified facts or promises about future decisions. Saved answers can help everyday comparisons; other settings stay separate. Manage your learned memory in Profile.</p>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {stale && <a href={`/onboarding?next=${encodeURIComponent(returnTo)}`} className="inline-block min-h-10 text-sm font-medium text-accent underline underline-offset-4">Reload starter questions</a>}
      {saved && <p role="status" className="text-sm text-accent">Setup saved.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="ghost" disabled={pending || saved} onClick={() => { setEditingFromReview(false); move(Math.max(0, questions.length)); }}><ArrowLeft size={16} aria-hidden="true" /> Back</Button>
        <Button disabled={pending || saved || stale} onClick={finish}>{pending ? "Saving…" : saved ? "Saved" : stale ? "Reload before saving" : error ? "Try again" : "Save and compare"}</Button></div>
    </section> : <section className="space-y-5">
      <div><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold leading-snug tracking-tight focus:outline-hidden">{question.prompt}</h1>
        <div id={`${fieldId}-rationale`} className="mt-4 rounded-card border border-line bg-surface-raised p-4"><h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Why we ask</h2><p className="mt-1 text-sm leading-relaxed text-ink-muted">{questionRationales[question.id] ?? "This gives Nudge one small example of your everyday preferences. Your answer can change with the situation."}</p></div></div>
      <fieldset disabled={pending} aria-describedby={`${fieldId}-rationale ${fieldId}-neutral`} className="space-y-3">
        <legend className="mb-3 text-sm font-medium">Which fits you in this situation?</legend>
        <div className="grid gap-3 sm:grid-cols-2">{(["a", "b"] as const).map(side => <label key={side} className={`flex min-h-24 cursor-pointer items-start gap-3 rounded-card border p-4 text-sm font-medium leading-relaxed transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${selection === side ? "border-accent bg-accent-soft/30" : "border-line bg-surface-raised hover:border-accent"}`}>
          <input type="radio" name={`${fieldId}-choice`} value={side} checked={selection === side} onChange={() => choose(side)} className="mt-1 shrink-0 accent-accent" />{side === "a" ? question.option_a : question.option_b}
        </label>)}</div>
        <div className="grid gap-2 sm:grid-cols-2">{neutralChoices.map(value => <label key={value.value} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm ${selection === value.value ? "border-accent bg-accent-soft/30" : "border-line text-ink-muted"}`}>
          <input type="radio" name={`${fieldId}-choice`} value={value.value} checked={selection === value.value} onChange={() => choose(value.value)} className="shrink-0 accent-accent" />{value.label}
        </label>)}</div>
        <p id={`${fieldId}-neutral`} className="text-xs leading-relaxed text-ink-muted">Both, depends, neither and skip record no single preference. Nudge will not guess an answer for you.</p>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="ghost" disabled={pending} onClick={() => { if (editingFromReview) { setEditingFromReview(false); move(total - 1); } else move(step - 1); }}><ArrowLeft size={16} aria-hidden="true" />{editingFromReview ? "Back to review" : "Back"}</Button>
        <Button disabled={selection === undefined || pending} onClick={() => { const next = editingFromReview ? total - 1 : step + 1; setEditingFromReview(false); move(next); }}>{editingFromReview || step === questions.length ? "Review my answers" : "Next question"}</Button></div>
      {!editingFromReview && <button type="button" disabled={pending} onClick={() => move(total - 1)} className="min-h-10 text-sm text-ink-muted underline underline-offset-4">Review now and leave the rest unanswered</button>}
    </section>}
  </div>;
}
