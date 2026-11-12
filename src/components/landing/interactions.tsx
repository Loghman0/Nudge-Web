"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import * as Accordion from "@radix-ui/react-accordion";
import * as Tabs from "@radix-ui/react-tabs";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { ShareNetworkIcon } from "@phosphor-icons/react/dist/csr/ShareNetwork";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { LandingButton } from "./button";
import { landingMotion } from "./motion-tokens";
import { compareSample, hindsightOptions, memoryEdges, memoryNodes, type Reflection } from "./sample-model";
import { faqs, featureGroups } from "./data";

const nextPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
export function HindsightDemo() {
  const [reflection, setReflection] = useState<Reflection>(null);
  const [pending, setPending] = useState(false);
  const reduced = useReducedMotion();
  const options = hindsightOptions(reflection);
  async function reflect(value: Reflection) { if (pending) return; setPending(true); await nextPaint(); setReflection(value); setPending(false); }
  return <div className="lp-ledger" role="group" aria-label="Interactive hindsight sample">
    <div className="lp-ledger-top"><p className="lp-annotation">Local sample. Not saved.</p></div>
    <h2 className="lp-demo-title">What fits tonight?</h2>
    <ol className="lp-rankings" aria-label="Sample recommendations">
      {options.map((option, index) => <motion.li key={option.id} layout={reduced ? false : "position"} transition={landingMotion.spring} data-first={index === 0}>
        <span className="lp-rank" aria-hidden>{index + 1}</span><div><strong>{option.label}</strong><p>{option.evidence}</p></div>{index === 0 && <CheckIcon size={20} weight="regular" aria-label="Better sample fit" />}
      </motion.li>)}
    </ol>
    <div className="lp-reflection"><p>You tried the walk. How did it feel?</p><div className="lp-feedback">
      <LandingButton variant="secondary" disabled={pending} aria-pressed={reflection === "good"} onClick={() => reflect("good")}>Glad I went</LandingButton>
      <LandingButton variant="secondary" disabled={pending} aria-pressed={reflection === "bad"} onClick={() => reflect("bad")}>Not for me</LandingButton>
    </div></div>
    <p className="lp-demo-status" role="status">{pending ? "Updating sample memory…" : reflection === "good" ? "Reflection saved. Walking now fits better." : reflection === "bad" ? "Reflection saved. A film stays the better fit." : "Record a reflection. See the next recommendation change."}</p>
    <div className="lp-ledger-bottom"><div className="lp-time-track" role="group" aria-label="Choose, reflect, learn"><span data-active={!reflection} aria-current={!reflection ? "step" : undefined}>Choose</span><span data-active={pending} aria-current={pending ? "step" : undefined}>Reflect</span><span data-active={!!reflection} aria-current={reflection ? "step" : undefined}>Learn</span></div><LandingButton variant="icon" aria-label="Reset sample reflection" disabled={!reflection || pending} onClick={() => setReflection(null)}><ArrowCounterClockwiseIcon size={20} weight="regular" aria-hidden /></LandingButton></div>
  </div>;
}

export function LearningRibbon() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "end 45%"] });
  const scale = useTransform(scrollYProgress, [0, 1], [0.08, 1]);
  const reduced = useReducedMotion();
  const steps = [
    ["Explore", "Try six light questions before making an account. Skip any that do not feel like you."],
    ["Reflect", "See what your answers have in common. Check the sources, disagree, or change an answer."],
    ["Decide", "Bring relevant preferences into a comparison when you have a choice to make. You set what matters."],
  ];
  return <div className="lp-learning" ref={ref}><div className="lp-learning-line" aria-hidden><motion.span style={{ scaleX: reduced ? 1 : scale }} /></div><ol>{steps.map(([title, text]) => <li key={title}><h3>{title}</h3><p>{text}</p></li>)}</ol></div>;
}

export function MemoryGraph() {
  const [selected, setSelected] = useState<(typeof memoryNodes)[number]>(memoryNodes[0]);
  const id = useId();
  const reduced = useReducedMotion();
  return <div className="lp-memory-workspace"><div className="lp-graph" role="group" aria-label="Interactive sample memory graph">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>{memoryEdges.map(([a, b]) => <line key={`${a}-${b}`} x1={memoryNodes[a].x} y1={memoryNodes[a].y} x2={memoryNodes[b].x} y2={memoryNodes[b].y} vectorEffect="non-scaling-stroke" />)}</svg>
    {memoryNodes.map(node => <button type="button" key={node.id} className="lp-memory-node" data-core={node.id === "memory"} style={{ left: `${node.x}%`, top: `${node.y}%` }} aria-pressed={selected.id === node.id} aria-controls={id} onClick={() => setSelected(node)}>{node.label}</button>)}
  </div><motion.div className="lp-evidence" id={id} layout={reduced ? false : "position"} transition={landingMotion.spring}>
    <p className="lp-annotation">Sample evidence</p><h3>{selected.label}</h3><p role="status">{selected.evidence}</p><p className="lp-small">In your account, inspect a belief, correct it or forget it.</p>
  </motion.div></div>;
}

export function CompareDemo() {
  const [first, setFirst] = useState("Watch a film"), [second, setSecond] = useState("Walk in the park");
  const [error, setError] = useState("");
  const [result, setResult] = useState(() => compareSample(first, second));
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const firstRef = useRef<HTMLInputElement>(null), secondRef = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => { if (status !== "success") return; const timer = setTimeout(() => setStatus("idle"), 1600); return () => clearTimeout(timer); }, [status]);
  function validate() { const value = !first.trim() || !second.trim() ? "Enter both options, then compare." : first.trim().toLowerCase() === second.trim().toLowerCase() ? "Use two different options to compare." : ""; setError(value); return !value; }
  async function submit(event: FormEvent) { event.preventDefault(); if (!validate()) { setStatus("error"); (!first.trim() ? firstRef : secondRef).current?.focus(); return; } setStatus("pending"); await nextPaint(); setResult(compareSample(first.trim(), second.trim())); setStatus("success"); }
  return <div className="lp-compare-workspace"><form className="lp-compare-form" onSubmit={submit} noValidate aria-label="Compare sample options">
    <p className="lp-annotation" id={`${id}-help`}>Sample memory: enjoys time outdoors.</p>
    <label htmlFor={`${id}-first`}>First option</label><input ref={firstRef} id={`${id}-first`} name="option_a" value={first} onChange={event => { setFirst(event.target.value); setStatus("idle"); }} onBlur={validate} maxLength={80} autoComplete="off" required aria-invalid={!!error && !first.trim()} aria-describedby={`${id}-help ${id}-error`} />
    <label htmlFor={`${id}-second`}>Second option</label><input ref={secondRef} id={`${id}-second`} name="option_b" value={second} onChange={event => { setSecond(event.target.value); setStatus("idle"); }} onBlur={validate} maxLength={80} autoComplete="off" required aria-invalid={!!error && !second.trim()} aria-describedby={`${id}-help ${id}-error`} />
    <p id={`${id}-error`} className="lp-error" role="alert">{error}</p>
    <LandingButton variant="submit" status={status} type="submit"><span className="lp-button-label">{status === "pending" ? "Comparing…" : status === "success" ? "Compared" : "Compare options"}</span>{status === "success" && <CheckIcon size={18} weight="regular" aria-hidden />}</LandingButton>
    <p className="lp-small">A local sample, without an AI request or personal data.</p>
  </form><div className="lp-compare-result" role="status"><p className="lp-annotation">Sample recommendation</p><h3>{result.label ?? "No clear preference"}</h3><p>{result.reason}</p></div></div>;
}

export function FeatureTabs() {
  return <Tabs.Root defaultValue="discover" className="lp-feature-tabs"><Tabs.List className="lp-tab-list" aria-label="Nudge capabilities">{featureGroups.map(group => <Tabs.Trigger value={group.id} key={group.id} className="lp-button lp-button-segment">{group.label}</Tabs.Trigger>)}</Tabs.List>
    {featureGroups.map(group => <Tabs.Content key={group.id} value={group.id} className="lp-tab-panel"><h3>{group.title}</h3><dl>{group.items.map(([title, text]) => <div key={title}><dt>{title}</dt><dd>{text}</dd></div>)}</dl></Tabs.Content>)}
  </Tabs.Root>;
}

export function FaqAccordion() {
  return <Accordion.Root type="single" collapsible className="lp-faq-list">{faqs.map(([question, answer], index) => <Accordion.Item value={`question-${index}`} key={question} className="lp-faq-item"><Accordion.Header><Accordion.Trigger className="lp-faq-trigger">{question}<PlusIcon size={22} weight="regular" aria-hidden /></Accordion.Trigger></Accordion.Header><Accordion.Content forceMount className="lp-faq-answer"><div><p>{answer}</p></div></Accordion.Content></Accordion.Item>)}</Accordion.Root>;
}

export function LandingShare() {
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  async function share() { setStatus("pending"); setMessage(""); try { const url = new URL("/", window.location.origin).href; if (navigator.share) { await navigator.share({ title: "Nudge", text: "Remember your decisions. Make better ones.", url }); setMessage("Nudge link shared."); } else { await navigator.clipboard.writeText(url); setMessage("Nudge link copied."); } setStatus("success"); } catch (error) { if (error instanceof Error && error.name === "AbortError") { setStatus("idle"); return; } setStatus("error"); setMessage("Copy the app's address from your browser to share Nudge."); } }
  return <div className="lp-share"><LandingButton variant="quiet" status={status} onClick={share} aria-label="Share Nudge"><ShareNetworkIcon size={20} weight="regular" aria-hidden /><span>{status === "pending" ? "Sharing…" : status === "success" ? "Shared" : "Share Nudge"}</span></LandingButton><p role="status">{message}</p></div>;
}
