"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowRight, Check, Lightbulb, Plus, RotateCcw,
  TriangleAlert, Trophy, X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReminderControls } from "../history/reminder-controls";
import { cn } from "@/lib/utils";
import type { DecisionCategory } from "@/lib/types";
import type { DecisionUnderstanding } from "@/lib/services/decision-understanding";
import { criteriaForOptions, type ComparisonCriterion } from "@/lib/services/comparison-criteria";
import { CriteriaEditor } from "./criteria-editor";
import { DiscoveryCriterionSuggestions } from '@/components/discovery/criterion-suggestions';
import { DISCOVERY_MOODS, discoveryMood, moodDecisionPriorities } from '@/lib/discovery/mood';
import { SavedSettings } from "./saved-settings";
import { applyComparisonAliases, comparisonDomainKey, comparisonOptionDetail, removeAppliedComparisonAliases, type ComparisonSettingsState, type SavedComparisonSetting } from "@/lib/services/comparison-settings";
import { loadComparisonSettings } from "./settings-actions";
import {
  abandonDecision, refreshComparisonTransport, askNaturally, chooseOption, compareOptionsTransport,
  explainDecision, suggestOptions,
  type CompareOption, type CompareResult, type Milestone, type ComparisonSeed,
} from "./actions";

const CATEGORY_KEYS: { value: DecisionCategory; label: string }[] = [
  { value: "food", label: "Food" },
  { value: "entertainment", label: "Watch / play" },
  { value: "travel", label: "Travel" },
  { value: "shopping", label: "Buying" },
  { value: "health", label: "Health" },
  { value: "career", label: "Career" },
  { value: "work", label: "Work" },
  { value: "finance", label: "Money" },
  { value: "relationships", label: "People" },
  { value: "hobbies", label: "Hobbies" },
  { value: "lifestyle", label: "Lifestyle" },
  { value: "other", label: "Other" },
];

const BUDGETS = ["Cheap", "Normal", "Treat"];
const COMPANY = ["Alone", "Partner", "Friends", "Family"];

const MAX_SLOTS = 8;

function Chip({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "min-h-12 rounded-full border px-3 py-2 text-sm transition-colors",
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-line text-ink-muted hover:border-accent/50 hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

const defaultActions = { abandonDecision, askNaturally, chooseOption, explainDecision, suggestOptions,
  compareOptions: async (options: string[], title: string, context: import("./actions").CompareContext = {}, requestId?: string): Promise<CompareResult> =>
    JSON.parse(await compareOptionsTransport(options, title, JSON.stringify(context), requestId)),
  refreshComparison: async (decisionId: string, extraLabel?: string): Promise<CompareResult> =>
    JSON.parse(await refreshComparisonTransport(decisionId, extraLabel)),
};

/** Keep user-keyed dictionaries out of React's server-component prop transport. */
export function SerializedDecideClient({ initialOptions, resultJson, seedJson, initialSettings }: {
  initialOptions: string[]; resultJson: string; seedJson: string; initialSettings: ComparisonSettingsState;
}) {
  return <DecideClient initialOptions={initialOptions} initialResult={JSON.parse(resultJson)} seed={JSON.parse(seedJson)} initialSettings={initialSettings} />;
}
export function DecideClient({ initialOptions, initialResult=null, seed=null, actions=defaultActions, initialSettings, settingsActions }: { initialOptions: string[]; initialResult?: CompareResult | null; seed?: ComparisonSeed | null; actions?: typeof defaultActions; initialSettings?: ComparisonSettingsState; settingsActions?: Parameters<typeof SavedSettings>[0]["actions"] }) {
  const fieldId = useId();
  const inFlight = useRef(false);
  const suggestionInFlight = useRef(false);
  const requestIntent = useRef<{ key: string; id: string } | null>(null);
  function requestIdFor(intent: unknown) {
    const key = JSON.stringify(intent);
    if (requestIntent.current?.key !== key) requestIntent.current = { key, id: crypto.randomUUID() };
    return requestIntent.current.id;
  }
  // ---- input state --------------------------------------------------------
  const [slots, setSlots] = useState<string[]>(() => {
    const seeded = initialOptions.filter(Boolean).slice(0, MAX_SLOTS);
    while (seeded.length < 2) seeded.push("");
    return seeded;
  });
  const [title, setTitle] = useState(seed?.title ?? "");
  const [naturalQuestion, setNaturalQuestion] = useState("");
  const [expectedOutcome, setExpectedOutcome] = useState(seed?.context.expectedOutcome ?? "");
  const [category, setCategory] = useState<DecisionCategory | null>(seed?.context.category ?? null);
  const [mood, setMood] = useState<string | null>(seed?.context.mood ?? null);
  const [budget, setBudget] = useState<string | null>(seed?.context.budget ?? null);
  const [company, setCompany] = useState<string | null>(seed?.context.company ?? null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<DecisionUnderstanding | null>(null);
  const [domain, setDomain] = useState(seed?.context.domain ?? "");
  const [goal, setGoal] = useState(seed?.context.goal ?? "");
  const [optionDetails, setOptionDetails] = useState<Record<string,string>>(seed?.context.optionDetails ?? {});
  const [basis,setBasis]=useState<"journal"|"criteria">(seed?.context.comparisonBasis??"journal");
  const [criteria,setCriteria]=useState<ComparisonCriterion[]>(seed?.context.criteria??[]);
  const [criteriaConfirmed,setCriteriaConfirmed]=useState(false);
  const [appliedSetting,setAppliedSetting]=useState<SavedComparisonSetting|null>(null);
  const [settingReviewed,setSettingReviewed]=useState(false);
  const [settingsPending,setSettingsPending]=useState(false);
  const appliedAliases=useRef<Record<string,string>>({});

  // ---- result state -------------------------------------------------------
  const [result, setResult] = useState<CompareResult | null>(initialResult);
  const [chosenId, setChosenId] = useState<string | null>(initialResult?.selectedOptionId ?? null);
  const [extra, setExtra] = useState("");

  const [milestones, setMilestones] = useState<Milestone[]>([]);

  const [pending, startTransition] = useTransition();
  const [suggesting, startSuggesting] = useTransition();
  const firstSlot = useRef<HTMLInputElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { firstSlot.current?.focus(); }, []);
  const reviewing = Boolean(review);
  useEffect(() => {
    if (!reviewing) return;
    reviewHeading.current?.focus({ preventScroll: true });
    reviewHeading.current?.scrollIntoView?.({ behavior: "instant", block: "start" });
  }, [reviewing]);

  // Move focus (and the screen reader) to the results the moment they land.
  useEffect(() => {
    if (result) resultHeading.current?.focus();
  }, [result]);

  const filled = slots.filter((s) => s.trim()).length;

  function updateSlot(index: number, value: string) {
    setSettingReviewed(false);
    setCriteriaConfirmed(false);
    if(!appliedSetting)setReview(null);
    setSlots((prev) => prev.map((slot, i) => (i === index ? value : slot)));
  }

  function showReview(draft: DecisionUnderstanding) {
    setReview(draft);
    setDomain(previous=>previous || draft.domain);
    setGoal(previous=>previous || draft.goal);
    if (!category) setCategory(draft.category);
  }

  function addSlot() {
    setSettingReviewed(false);
    setCriteriaConfirmed(false);
    setSlots((prev) => (prev.length >= MAX_SLOTS ? prev : [...prev, ""]));
  }

  function removeSlot(index: number) {
    setSettingReviewed(false);
    if(!appliedSetting)setReview(null);setCriteriaConfirmed(false);
    setSlots((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));
  }

  function compare() {
    if (inFlight.current || settingsPending || filled < 2) return;
    if (appliedSetting && !settingReviewed) { setError("Review this saved setting and its meanings, then confirm them for this comparison."); return; }
    if (review && !domain.trim()) { setError("Name the setting, or choose Everyday life, so Nudge does not assume what you mean."); return; }
    const context = {
      // The first step only asks for meaning. Criteria can still be incomplete
      // in a copied draft or after Back; keep them local until their editor opens.
      comparisonBasis:review ? basis : "journal",
      ...(review && basis==="criteria"?{criteria:criteriaForOptions(criteria,[...new Set(slots.map(s=>s.trim()).filter(Boolean))]),criteriaConfirmed,criteriaVersion:1 as const}:{}),
      mood: mood ?? undefined, budget: budget ?? undefined, company: company ?? undefined,
      category: category ?? undefined, expectedOutcome: expectedOutcome.trim() || undefined,
      domain:domain.trim() || undefined, goal:goal.trim() || undefined,
      meaningConfirmed:!!review,
      optionDetails:Object.fromEntries(slots.filter(s=>s.trim()).map(s=>[s.trim(),comparisonOptionDetail(optionDetails,s.trim())])),
      ...(appliedSetting?{appliedSetting:{id:appliedSetting.id,generation:appliedSetting.memory_generation}}:{}),
    };
    const requestId = requestIdFor(["compare", slots, title, context]);
    inFlight.current = true;
    setError(null);
    startTransition(async () => {
      try {
      if(appliedSetting){
        const current=await (settingsActions?.loadComparisonSettings??loadComparisonSettings)();
        if(!current.available){setError("Couldn't check this saved setting. Try again before comparing, or enter your meaning manually.");return;}
        const fresh=current.settings.find(value=>value.id===appliedSetting.id);
        if(current.generation!==appliedSetting.memory_generation||!fresh||fresh.domain!==appliedSetting.domain||fresh.updated_at!==appliedSetting.updated_at){
          clearAppliedSetting();setError("This saved setting changed or was cleared. Apply it again and review its meanings before comparing.");return;
        }
      }
      const response = await actions.compareOptions(slots, title, context, requestId);
      if(response.settingsInvalidated){clearAppliedSetting();setError(response.error??"This saved setting changed. Apply and review it again.");return;}
      if (response.error) { setError(response.error); return; }
      if (response.clarification) { showReview(response.clarification); return; }
      setResult(response);
      window.history.replaceState(null, "", `/ask?resume=${response.decisionId}`);
      setChosenId(response.selectedOptionId ?? null);
      } catch { setError("Couldn't save this decision. Please try again."); }
      finally { inFlight.current = false; }
    });
  }

  function askQuestion() {
    const question = naturalQuestion.trim();
    if (question.length < 3 || inFlight.current) return;
    const requestId = requestIdFor(["natural", question]);
    inFlight.current = true;
    setError(null);
    startTransition(async () => {
      try {
      const response = await actions.askNaturally(question, requestId);
      if (response.error) { setError(response.error); return; }
      if (response.clarification) {
        setAppliedSetting(null);setSettingReviewed(false);appliedAliases.current={};
        setCriteria([]);setCriteriaConfirmed(false);setBasis("journal");
        const labels=[...response.clarification.options]; while(labels.length<2)labels.push("");
        setSlots(labels);setTitle(question.slice(0,120));setOptionDetails({});
        setDomain(response.clarification.domain);setGoal(response.clarification.goal);
        setCategory(response.clarification.category);
        setReview(response.clarification);return;
      }
      setResult(response);
      window.history.replaceState(null, "", `/ask?resume=${response.decisionId}`);
      setChosenId(response.selectedOptionId ?? null);
      setNaturalQuestion("");
      } catch { setError("Couldn't save this decision. Please try again."); }
      finally { inFlight.current = false; }
    });
  }

  function fillSuggestions() {
    if (suggestionInFlight.current) return;
    suggestionInFlight.current = true;
    setError(null);
    startSuggesting(async () => {
      try {
      const suggestions = await actions.suggestOptions(category ?? "other");
      if (!suggestions.length) return;
      if(!appliedSetting)setReview(null);setCriteriaConfirmed(false);
      setSettingReviewed(false);
      setSlots((prev) => {
        const next = [...prev];
        let cursor = 0;
        for (let i = 0; i < next.length && cursor < suggestions.length; i++) {
          if (!next[i].trim()) next[i] = suggestions[cursor++];
        }
        while (next.length < 4 && cursor < suggestions.length) next.push(suggestions[cursor++]);
        return next;
      });
      } catch { setError("Couldn't load suggestions. Your options are still here. Please try again."); }
      finally { suggestionInFlight.current = false; }
    });
  }

  function reset() {
    requestIntent.current = null;
    window.history.replaceState(null, "", "/ask");
    setResult(null); setChosenId(null);
    setMilestones([]);
    setSlots(["", ""]); setTitle(""); setExtra("");
    setNaturalQuestion(""); setExpectedOutcome(""); setError(null);
    setReview(null);setDomain("");setGoal("");setOptionDetails({});
    setAppliedSetting(null);setSettingReviewed(false);appliedAliases.current={};
    setBasis("journal");setCriteria([]);setCriteriaConfirmed(false);
    setCategory(null); setMood(null); setBudget(null); setCompany(null);
    setTimeout(() => firstSlot.current?.focus(), 0);
  }

  function pick(option: CompareOption) {
    if (inFlight.current || !result) return;
    inFlight.current = true;
    setError(null);
    startTransition(async () => {
      try {
      const outcome = await actions.chooseOption(result.decisionId, option.id);
      if (outcome?.error) {
        setChosenId(null);
        setError(outcome.error);
        return;
      }
      setChosenId(option.id);
      setResult(prev => prev ? { ...prev, status: outcome.status ?? "decided", selectedOptionId: option.id } : prev);
      if (outcome.milestones?.length) setMilestones(outcome.milestones);
      } catch { setError("Couldn't save this decision. Please try again."); }
      finally { inFlight.current = false; }
    });
  }

  function refresh(extraLabel?: string) {
    if (!result || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const response = await actions.refreshComparison(result.decisionId,extraLabel);
        if(response.error){setError(response.error);return;}
        setResult(response);
        // A background recalculation must not erase an option typed while it
        // was pending. Clear only the submitted draft, if it is still current.
        setExtra(current=>extraLabel && current.trim()===extraLabel ? "" : current);
      } catch { setError("Couldn't refresh this comparison. Please try again."); }
      finally { inFlight.current = false; }
    });
  }
  function addExtraOption(){if(extra.trim())refresh(extra.trim());}

  function clearAppliedSetting() {
    const aliases=appliedAliases.current;
    setOptionDetails(previous=>removeAppliedComparisonAliases(previous,aliases));
    appliedAliases.current={};
    if(appliedSetting){
      setDomain(previous=>comparisonDomainKey(previous)===appliedSetting.domain?"":previous);
      setGoal(previous=>previous===appliedSetting.goal?"":previous);
    }
    setAppliedSetting(null);setSettingReviewed(false);setReview(null);setCriteriaConfirmed(false);
  }
  function applySetting(setting:SavedComparisonSetting) {
    const previousDetails=removeAppliedComparisonAliases(optionDetails,appliedAliases.current);
    const mapped=applyComparisonAliases(setting,slots,previousDetails);
    setOptionDetails(mapped.details);appliedAliases.current=mapped.applied;
    setDomain(setting.domain);setGoal(setting.goal);setCategory(setting.category);
    setAppliedSetting(setting);setSettingReviewed(false);setCriteriaConfirmed(false);setError(null);
    setReview({options:slots.map(value=>value.trim()).filter(Boolean),category:setting.category,domain:setting.domain,goal:setting.goal,source:"manual",unfamiliarTerms:[],
      question:"Review this saved setting and your current alternatives.",notice:"Saved meanings are your definitions. Check that they apply to this choice; existing details are kept for your review."});
  }
  function changeDomain(value:string) {
    if(appliedSetting&&comparisonDomainKey(value)!==appliedSetting.domain){
      const aliases=appliedAliases.current;
      setOptionDetails(previous=>removeAppliedComparisonAliases(previous,aliases));
      appliedAliases.current={};setAppliedSetting(null);
    }
    setDomain(value);setSettingReviewed(false);setCriteriaConfirmed(false);
  }

  // ------------------------------------------------------------------ RESULT
  if (result) {
    const chosen = result.options.find((o) => o.id === chosenId) ?? null;
    const top = result.options[0];
    const open = result.status === "open";
    const unavailableSnapshot=result.evidenceSnapshotState==="unavailable";
    const assessment=unavailableSnapshot?undefined:result.criteriaAssessment;
    const supported = !unavailableSnapshot && !assessment && result.evidenceState === "personal_fit";

    return (
      <div className="space-y-5">
        {/* Milestone toast — celebrates the exact moment something was earned. */}
        {milestones.length > 0 && (
          <div
            role="status"
            className="animate-toast pointer-events-none fixed inset-x-4 bottom-20 z-50 mx-auto max-w-sm rounded-2xl border border-accent/30 bg-surface-raised p-4 shadow-card md:bottom-8"
            onAnimationEnd={() => setMilestones([])}
          >
            <div className="flex items-start gap-3">
              <Trophy size={18} className="mt-0.5 shrink-0 text-accent" />
              <div>
                <p className="text-sm font-semibold">
                  {milestones.length === 1 ? "Milestone unlocked" : `${milestones.length} milestones unlocked`}
                  : {milestones.map((m) => m.title).join(" · ")}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">{milestones[0].description}</p>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 ref={resultHeading} tabIndex={-1} className="text-2xl font-semibold tracking-tight focus:outline-hidden">{result.title}</h1>
            <p aria-live="polite" className="mt-1 text-sm text-ink-muted">
              {chosen
                ? result.status === "reflected" ? "This choice already has a reflection. You can view it in your journal." : "Saved. Set a check-in below, or reflect whenever you’re ready."
                : assessment ? assessment.outcome==="winner" ? `${assessment.leader} leads using your confirmed criteria inputs.` : assessment.outcome==="tie" ? "Your criteria produce a tie." : "Unknown values or overlapping ranges prevent a clear leader."
                : !supported ? "There is not enough relevant evidence to favor an option."
                : result.confidence === "high"
                  ? "One option has a larger relative-fit score gap in your recorded evidence."
                  : result.confidence === "medium"
                    ? "The relative-fit scores are slightly apart. Review the evidence before choosing."
                    : "The relative-fit scores are close. Your priorities can help you choose."}
            </p>
          </div>
          <Button variant="ghost" onClick={reset} disabled={pending} className="shrink-0">
            <RotateCcw size={14} /> New
          </Button>
        </div>
        {result.meaning?.domain && <div className="space-y-2 rounded-2xl border border-line px-4 py-3">
          <p className="text-sm"><strong>Setting:</strong> {result.meaning.domain}</p>
          {result.meaning.goal && <p className="text-sm"><strong>Your goal:</strong> {result.meaning.goal}</p>}
          {Object.values(result.meaning.optionDetails??{}).some(Boolean) && <details><summary className="min-h-11 cursor-pointer py-3 text-sm text-ink-muted">Your definitions</summary>
            {Object.entries(result.meaning.optionDetails??{}).filter(([,detail])=>detail).map(([label,detail])=><p key={label} className="mb-2 whitespace-pre-wrap break-words text-sm"><strong>{label}:</strong> {detail}</p>)}
            <p className="text-xs text-ink-muted">These are your notes, not verified facts or scored eligibility rules.</p>
          </details>}
        </div>}
        {unavailableSnapshot && <p role="status" className="text-sm text-ink-muted">The saved evidence for this comparison is unavailable. Refresh an open comparison to assess it using the evidence available now.</p>}
        {!supported && !assessment && <Card className="space-y-3"><h2 className="text-base font-medium">Make this useful your way</h2><p className="text-sm text-ink-muted">Add facts you know to compare the options, or record your own choice and check how it turns out.</p>
          <Link className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-4" href={`/ask?copy=${result.decisionId}&basis=criteria`}>Add criteria to this comparison</Link>
        </Card>}
        {assessment && <div><h2 className="text-sm font-medium">Based on your criteria</h2><p className="mt-1 text-xs text-ink-muted">Uses your values and ranges. Missing facts stay unknown; source links are not verified.</p>
          <Link className="mt-2 inline-block text-sm text-accent hover:underline" href={`/ask?copy=${result.decisionId}`}>Copy and edit criteria</Link>
        </div>}

        {open && <div className="flex flex-wrap items-center gap-2"><Button variant="secondary" disabled={pending} onClick={()=>refresh()}>{assessment?"Recalculate saved criteria":"Refresh with current memory"}</Button><span className="text-xs text-ink-muted">All option scores update together.</span></div>}
        {result.status === "abandoned" && <p className="text-sm text-ink-muted">This comparison was abandoned. Copy it from History to decide again.</p>}
        {result.status === "decided" && <ReminderControls decisionId={result.decisionId} dueAt={result.reflectionDueAt} enabled={result.reminderEnabled} />}
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="space-y-3">
          {result.options.map((option, index) => {
            const measured=assessment?.options.find(o=>o.label===option.label);
            const isChosen = chosenId === option.id;
            const dimmed = chosenId != null && !isChosen;
            const percent = Math.round(option.score * 100);

            return (
              <Card
                key={option.id}
                className={cn(
                  "animate-rise relative overflow-hidden transition-all",
                  index === 0 && open && !chosenId && supported && "border-accent/40",
                  isChosen && "animate-pop border-accent",
                  dimmed && "opacity-45"
                )}
                style={{ animationDelay: `${Math.min(index, 5) * 70}ms` }}
              >
                {supported && <span
                  className="animate-grow-x absolute inset-y-0 left-0 bg-accent-soft/40"
                  style={{ width: `${percent}%` }}
                  aria-hidden
                />}
                <div className="relative">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {index === 0 && open && !chosenId && supported && result.confidence!=="low" && (
                          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                            Higher relative fit
                          </span>
                        )}
                        <h2 className="break-words text-lg font-medium">{option.label}</h2>
                        {assessment?.leader===option.label && <span className="rounded-full bg-accent-soft px-2 py-1 text-xs text-accent">Leads on your inputs</span>}
                        {!unavailableSnapshot && option.warning && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                            <TriangleAlert size={11} /> regretted before
                          </span>
                        )}
                      </div>
                      <ul className="mt-3 space-y-1">
                        {option.reasons.map((reason) => (
                          <li key={reason} className="flex gap-2 text-sm text-ink-muted">
                            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                            {reason}
                          </li>
                        ))}
                      </ul>
                      {measured && <div className="mt-3 space-y-2 text-xs text-ink-muted">{result.criteriaInput?.criteria?.map(c=>{const cell=c.values[option.label];return <p key={c.id} className="break-words"><strong>{c.label}:</strong> range {c.low}–{c.high}{c.unit?` ${c.unit}`:""}, importance {c.weight}/5{cell?.note?` · ${cell.note}`:""}{cell?.sourceUrl && <> · <a href={cell.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline">Source for {option.label}: {c.label} (unverified)</a></>}</p>;})}</div>}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-2xl font-semibold tabular-nums">{measured ? measured.coverage===1 ? Math.round(measured.low*100) : `${Math.floor(measured.low*100)}–${Math.ceil(measured.high*100)}` : supported ? percent : "—"}</div>
                      <div className="text-[10px] uppercase tracking-wide text-ink-faint">{measured ? "criteria fit / 100" : supported ? "relative fit / 100" : "insufficient evidence"}</div>
                      {measured && <p className="text-xs text-ink-muted">{Math.round(measured.coverage*100)}% of weight known</p>}
                    </div>
                  </div>

                  {open && !chosenId && (
                    <Button className="mt-4" onClick={() => pick(option)} disabled={pending}>
                      Choose this <ArrowRight size={14} />
                    </Button>
                  )}
                  {isChosen && (
                    <p className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent">
                      <Check size={15} /> Chosen
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        {open && !chosenId && (
          <>
            <Card>
              <label htmlFor={`${fieldId}-extra`} className="text-sm font-medium">Thought of another option?</label>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Input
                  id={`${fieldId}-extra`}
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExtraOption(); } }}
                  placeholder="Type it here"
                  maxLength={80}
                />
                <Button variant="secondary" onClick={addExtraOption} disabled={!extra.trim() || pending} className="shrink-0">
                  {assessment?"Add as unknown":"Score it"}
                </Button>
              </div>
            </Card>
          </>
        )}

        {chosen ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={reset}>Decide something else</Button>
            <Link href="/history"><Button variant="secondary">See history</Button></Link>
          </div>
        ) : open ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(async () => { try { await actions.abandonDecision(result.decisionId); reset(); } catch { setError("Couldn't abandon this comparison. Try again."); } })}
            className="text-xs text-ink-faint hover:text-ink-muted"
          >
            Never mind, drop this one
          </button>
        ) : null}

        {top && open && !chosenId && (
          <details className="text-sm text-ink-muted"><summary className="min-h-11 cursor-pointer py-3">How this comparison works</summary><p className="text-xs leading-relaxed">
            {assessment?"Criteria fit measures your supplied values against your supplied ranges and importance. It is not a probability of success or a verified factual answer.":`Relative fit compares these options against your recorded preferences and history. It is not a probability of a good outcome. You decide; your choice teaches Nudge.`}
          </p><p className="mt-2 text-xs leading-relaxed">Nudge has not verified game rules, technical claims or real-world outcomes.</p>
          {result.evidenceSnapshotState && !unavailableSnapshot && <p className="mt-2 text-xs leading-relaxed">These reasons were saved with this comparison{result.scoredAt && Number.isFinite(Date.parse(result.scoredAt)) ? ` on ${new Intl.DateTimeFormat("en",{year:"numeric",month:"short",day:"numeric",timeZone:"UTC"}).format(new Date(result.scoredAt))}` : ""}. Refreshing uses the evidence available now.</p>}
          {!!result.criterionSources?.length && <p className="mt-3 text-xs">{result.criterionSources.length} {result.criterionSources.length===1?'criterion came':'criteria came'} from reflections you chose to use. <Link href="/profile" className="text-accent underline">Review the supporting answers</Link></p>}
          {result.coldStart && <p className="mt-3 text-xs">Your journal will become more useful as you reflect. <Link href="/discover" className="text-accent underline">Discover your preferences</Link></p>}</details>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------- INPUT
  const labels = [...new Set(slots.map(value => value.trim()).filter(Boolean))];
  const moodPriorities = moodDecisionPriorities(discoveryMood(mood?.toLowerCase()));
  const optionsEditor = <Card className="space-y-4">
    {slots.map((slot, index) => <div key={index} className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <label htmlFor={`${fieldId}-option-${index}`} className="mb-2 block text-sm font-medium">Option {index + 1}</label>
        <Input id={`${fieldId}-option-${index}`} ref={index === 0 ? firstSlot : undefined}
          value={slot} onChange={event => updateSlot(index, event.target.value)}
          onKeyDown={event => { if (event.key === "Enter" && filled >= 2) { event.preventDefault(); compare(); } }}
          placeholder={index === 0 ? "First option" : index === 1 ? "Second option" : "Another option"} maxLength={80} />
      </div>
      {slots.length > 2 && <button type="button" onClick={() => removeSlot(index)} disabled={pending}
        aria-label={`Remove option ${index + 1}`} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-ink-muted hover:bg-surface-sunken"><X size={18} /></button>}
    </div>)}
    <div className="flex flex-wrap gap-2">
      <Button variant="ghost" onClick={addSlot} disabled={slots.length >= MAX_SLOTS || pending} className="min-h-11 px-3"><Plus size={16} /> Add option</Button>
      <Button variant="ghost" onClick={fillSuggestions} disabled={suggesting || pending} className="min-h-11 px-3"><Lightbulb size={16} /> {suggesting ? "Thinking…" : "Suggest options"}</Button>
    </div>
  </Card>;

  const basisEditor = <div className="space-y-3">
    <h2 className="text-sm font-medium">What should guide this choice?</h2>
    <div className="grid grid-cols-2 gap-2">
      <button type="button" aria-label="My personal history" aria-pressed={basis === "journal"} onClick={() => { setBasis("journal"); setCriteriaConfirmed(false); }}
        className={cn("rounded-2xl border p-4 text-left transition-colors", basis === "journal" ? "border-accent bg-accent-soft/30" : "border-line bg-surface-raised hover:border-accent/50")}>
        <span className="block text-sm font-medium">My personal history</span><span className="mt-1 block text-xs text-ink-muted">Past choices and preferences</span>
      </button>
      <button type="button" aria-label="My criteria and values" aria-pressed={basis === "criteria"} onClick={() => { setBasis("criteria"); setCriteriaConfirmed(false); }}
        className={cn("rounded-2xl border p-4 text-left transition-colors", basis === "criteria" ? "border-accent bg-accent-soft/30" : "border-line bg-surface-raised hover:border-accent/50")}>
        <span className="block text-sm font-medium">My criteria and values</span><span className="mt-1 block text-xs text-ink-muted">Compare facts or measurements I provide</span>
      </button>
    </div>
    {basis === "criteria" && moodPriorities.length > 0 && <details className="rounded-xl border border-line p-4">
      <summary className="min-h-12 cursor-pointer text-sm font-medium">Consider my current mood</summary>
      <p className="mt-2 text-xs text-ink-muted">Optional priorities. Review their scale and importance; leave unknown values blank.</p>
      <div className="mt-3 flex flex-wrap gap-2">{moodPriorities.map(priority => <Button key={priority.id} variant="secondary"
        disabled={pending || criteria.length >= 5 || criteria.some(criterion => criterion.label.toLowerCase() === priority.label.toLowerCase())}
        onClick={() => {
          setCriteria(current => current.length >= 5 || current.some(criterion => criterion.label.toLowerCase() === priority.label.toLowerCase()) ? current : [...current, {
            id: crypto.randomUUID(), label: priority.label, direction: priority.direction, weight: 3, low: 0, high: 10, unit: "points",
            values: Object.fromEntries(labels.map(label => [label, { value: null }])),
          }]);
          setCriteriaConfirmed(false);
        }}>Add {priority.label}</Button>)}</div>
    </details>}
    {basis === "criteria" && criteria.length<5 && <DiscoveryCriterionSuggestions domain={domain} category={category} onUse={(suggestion,generation)=>{const label=suggestion.label;setCriteria(current=>current.length>=5||current.some(c=>c.label.toLowerCase()===label.toLowerCase())?current:[...current,{id:crypto.randomUUID(),label,unit:'',weight:NaN,direction:'higher',low:NaN,high:NaN,values:{},discoverySuggestion:{id:suggestion.id,generation}}]);setCriteriaConfirmed(false);}}/>}
    {basis === "criteria" && <CriteriaEditor labels={labels} criteria={criteria} confirmed={criteriaConfirmed}
      onChange={value => { setCriteria(value); setCriteriaConfirmed(false); }} onConfirm={setCriteriaConfirmed} />}
  </div>;

  return <fieldset disabled={settingsPending} aria-busy={settingsPending} className="min-w-0 space-y-6 border-0 p-0 pb-6">
    {settingsPending && <p role="status" className="text-sm text-ink-muted">Updating saved settings…</p>}
    <ol aria-label="Comparison progress" className="flex items-center gap-3 text-xs text-ink-muted">
      <li aria-current={!review ? "step" : undefined} className={!review ? "font-semibold text-accent" : ""}>1 · Options</li>
      <li aria-hidden="true">/</li>
      <li aria-current={review ? "step" : undefined} className={review ? "font-semibold text-accent" : ""}>2 · Context</li>
      <li aria-hidden="true">/</li><li>3 · Compare</li>
    </ol>
    <header>
      <h1 ref={review ? reviewHeading : undefined} tabIndex={review ? -1 : undefined} className="text-3xl font-semibold tracking-tight focus:outline-hidden">
        {review ? "Add a little context" : "What are you deciding between?"}
      </h1>
      <p className="mt-2 text-base text-ink-muted">{review ? "Tell us where these options apply." : "Start with two options. We’ll take it one step at a time."}</p>
    </header>

    {!review ? optionsEditor : <>
      <details className="rounded-2xl border border-line bg-surface-raised">
        <summary className="min-h-11 cursor-pointer p-4 text-sm"><span className="font-medium">{labels.length ? labels.join(" or ") : "Add your options"}</span><span className="ml-3 text-ink-muted">Edit options</span></summary>
        <div className="px-3 pb-3">{optionsEditor}</div>
      </details>
      <Card className="space-y-5" aria-label="Review decision meaning">
        {review.source === "ai" && <p role="status" className="text-sm text-ink-muted">AI prepared this draft. Check the details below.</p>}
        <div>
          <label htmlFor={`${fieldId}-domain`} className="mb-2 block text-sm font-medium">Setting (required)</label>
          <Input id={`${fieldId}-domain`} value={domain} onChange={event => changeDomain(event.target.value)} maxLength={100} placeholder="A game and version, a project, or everyday life" />
          <Button variant="ghost" disabled={pending} onClick={() => changeDomain("Everyday life")} className="mt-1 min-h-11 px-2">Use Everyday life</Button>
        </div>
        <div>
          <label htmlFor={`${fieldId}-goal`} className="mb-2 block text-sm font-medium">What are you trying to achieve?</label>
          <Input id={`${fieldId}-goal`} value={goal} onChange={event => { setGoal(event.target.value); setSettingReviewed(false); setCriteriaConfirmed(false); }} maxLength={300} placeholder="Your goal and any information still needed" />
          <p className="mt-2 text-xs text-ink-muted">Optional. A short goal is enough.</p>
        </div>
        <details open={review.unfamiliarTerms.length > 0 || !!appliedSetting || undefined}>
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Explain your terms or add details</summary>
          <p className="mb-4 text-sm text-ink-muted">Names only you know are welcome. Tell Nudge what they mean here; leave unknown facts blank.</p>
          {review.unfamiliarTerms.length > 0 && <p className="mb-3 text-sm">Terms to clarify: {review.unfamiliarTerms.join(", ")}</p>}
          <div className="space-y-4">{slots.filter(value => value.trim()).map((label, index) => <div key={index}>
            <label htmlFor={`${fieldId}-meaning-${index}`} className="block text-sm font-medium">Meaning and known details: {label.trim()}</label>
            <textarea id={`${fieldId}-meaning-${index}`} className="mt-2 min-h-24 w-full rounded-xl border border-line bg-surface p-3 text-base" maxLength={500}
              value={comparisonOptionDetail(optionDetails, label.trim())}
              onChange={event => { setOptionDetails(previous => ({ ...previous, [label.trim()]: event.target.value })); setSettingReviewed(false); setCriteriaConfirmed(false); }}
              placeholder="What does this mean in your setting?" />
          </div>)}</div>
          <p className="mt-3 text-xs text-ink-muted">Your definitions are saved with this choice. They are not verified facts or measurements.</p>
        </details>
        {appliedSetting && <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={settingReviewed} onChange={event => setSettingReviewed(event.target.checked)} />I reviewed {appliedSetting.name}, its setting and the meanings for this comparison.</label>}
      </Card>
      {basisEditor}
    </>}

    {!review && basis === "criteria" && basisEditor}
    {error && <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Button onClick={compare} disabled={filled < 2 || pending} className="min-h-12 w-full sm:w-auto">
        {pending ? "Checking…" : review ? "Compare options" : `Compare ${filled || 2} options`}
        {!pending && <ArrowRight size={16} />}
      </Button>
      {review ? <Button variant="ghost" disabled={pending} onClick={() => { setReview(null); setError(null); setTimeout(() => firstSlot.current?.focus(), 0); }} className="min-h-11">Back to options</Button>
        : <p className="text-xs text-ink-muted">You’ll review the context before anything is saved.</p>}
    </div>

    {!review && <details className="rounded-2xl border border-line bg-surface-raised">
      <summary className="min-h-11 cursor-pointer p-4 text-sm font-medium">Prefer to write a question?</summary>
      <div className="space-y-3 px-4 pb-4">
        <label htmlFor={`${fieldId}-question`} className="block text-sm">Your decision question</label>
        <Input id={`${fieldId}-question`} value={naturalQuestion} onChange={event => setNaturalQuestion(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); askQuestion(); } }} placeholder="What should I eat tonight?" maxLength={1000} />
        <Button variant="secondary" onClick={askQuestion} disabled={naturalQuestion.trim().length < 3 || pending} className="min-h-11">{pending ? "Thinking…" : "Ask Nudge"}</Button>
        <p className="text-xs text-ink-muted">Include your options. You can edit the interpretation before comparing.</p>
      </div>
    </details>}

    <div className="space-y-2 border-t border-line pt-3">
      <SavedSettings initialState={initialSettings} domain={domain} category={category} goal={goal} onApply={applySetting} onInvalidated={clearAppliedSetting} onPendingChange={setSettingsPending} actions={settingsActions} />
      <details className="group">
        <summary className="min-h-11 cursor-pointer py-3 text-sm text-ink-muted">Add a journal note (optional)</summary>
        <Card className="space-y-4">
          <p className="text-xs text-ink-muted">Mood, budget, company and expected outcome are journal notes; they do not change the current scores. Decision type selects relevant history.</p>
          <div><label htmlFor={`${fieldId}-title`} className="mb-2 block text-sm font-medium">Call it something</label><Input id={`${fieldId}-title`} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Dinner tonight" maxLength={120} /></div>
          <div><label htmlFor={`${fieldId}-outcome`} className="mb-2 block text-sm font-medium">What do you expect to happen?</label><Input id={`${fieldId}-outcome`} value={expectedOutcome} onChange={event => setExpectedOutcome(event.target.value)} placeholder="e.g. A relaxed evening without overspending" maxLength={300} /></div>
          <div><p className="mb-2 text-sm font-medium">Type of decision</p><div className="flex flex-wrap gap-2">{CATEGORY_KEYS.map(item => <Chip key={item.value} active={category === item.value} onClick={() => { setCategory(category === item.value ? null : item.value); setSettingReviewed(false); }}>{item.label}</Chip>)}</div></div>
          <fieldset><legend className="mb-2 text-sm font-medium">Current mood (optional)</legend><div className="flex flex-wrap gap-2">{DISCOVERY_MOODS.map(item => <Chip key={item.id} active={mood === item.label || mood === item.id} onClick={() => setMood(mood === item.label || mood === item.id ? null : item.label)}>{item.label}</Chip>)}
            {!!mood && !DISCOVERY_MOODS.some(item => mood === item.label || mood === item.id) && <Chip active onClick={() => setMood(null)}>Saved: {mood}</Chip>}
          </div>{mood && <p className="mt-2 text-xs text-ink-muted">Mood is journal context. Choose which priorities matter before comparing.</p>}</fieldset>
          <div><p className="mb-2 text-sm font-medium">Budget</p><div className="flex flex-wrap gap-2">{BUDGETS.map(value => <Chip key={value} active={budget === value} onClick={() => setBudget(budget === value ? null : value)}>{value}</Chip>)}</div></div>
          <div><p className="mb-2 text-sm font-medium">Who’s with you</p><div className="flex flex-wrap gap-2">{COMPANY.map(value => <Chip key={value} active={company === value} onClick={() => setCompany(company === value ? null : value)}>{value}</Chip>)}</div></div>
        </Card>
      </details>
    </div>
  </fieldset>;
}
