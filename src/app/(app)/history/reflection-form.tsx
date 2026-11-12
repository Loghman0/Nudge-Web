"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Check, Star } from "lucide-react";
import { submitReflection } from "./actions";
import { Button } from "@/components/ui/button";

function TriToggle({
  label, value, onChange,
}: { label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
      <span className="text-ink-muted">{label}</span>
      <div className="flex gap-1.5" role="group" aria-label={label}>
        {[true, false, null].map((v) => (
          <button
            key={String(v)}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={`min-h-11 rounded-full border px-3 py-1 text-xs transition-colors ${
              value === v ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-muted hover:text-ink"
            }`}
          >
            {v === null ? "Not sure" : v ? "Yes" : "No"}
          </button>
        ))}
      </div>
    </div>
  );
}

const RATING_LABELS = ["", "Poor", "Disappointing", "Okay", "Good", "Great"];

export function ReflectionForm({ decisionId, saveAction = submitReflection }: { decisionId: string; saveAction?: typeof submitReflection }) {
  const fieldId = useId();
  const [rating, setRating] = useState(0);
  const [wouldRepeat, setWouldRepeat] = useState<boolean | null>(null);
  const [hasRegrets, setHasRegrets] = useState<boolean | null>(null);
  const [wouldRecommend, setWouldRecommend] = useState<boolean | null>(null);
  const [wouldChooseAgain, setWouldChooseAgain] = useState<boolean | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);

  // The learning moment deserves acknowledgment: after saving, say what just
  // happened before the server-rendered "Reflected" state takes over.
  if (saved) {
    return (
      <p role="status" className="animate-rise mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent">
        <Check size={15} /> Saved. You can use this outcome next time.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-ink-muted">One rating is enough. Add details only if you want to.</p>
      <fieldset disabled={pending}>
        <legend className="mb-1 text-sm text-ink-muted">Rating out of 5 stars</legend>
        <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="relative flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg">
            <input type="radio" name={`${fieldId}-rating`} value={n} checked={rating === n}
              onChange={() => setRating(n)} className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label={`${n} star${n > 1 ? "s" : ""}`} />
            <span className="block rounded-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
              <Star aria-hidden size={24} className={n <= rating ? "fill-accent text-accent" : "text-line hover:text-ink-faint"} />
            </span>
          </label>
        ))}
        </div>
        <p className="mt-1 text-xs text-ink-muted" aria-live="polite">{rating ? `${rating} / 5 — ${RATING_LABELS[rating]}` : "1 = Poor · 3 = Okay · 5 = Great"}</p>
      </fieldset>
      <details className="rounded-xl border border-line p-3">
      <summary className="min-h-11 cursor-pointer py-3 text-sm text-ink-muted">Add details (optional)</summary>
      <fieldset disabled={pending} className="mt-3 space-y-3">
      <legend className="sr-only">Optional outcome details</legend>
      <TriToggle label="Would you choose it again?" value={wouldChooseAgain} onChange={setWouldChooseAgain} />
      <TriToggle label="Would you do this again?" value={wouldRepeat} onChange={setWouldRepeat} />
      <TriToggle label="Any regrets?" value={hasRegrets} onChange={setHasRegrets} />
      <TriToggle label="Would you recommend it?" value={wouldRecommend} onChange={setWouldRecommend} />
      <label htmlFor={`${fieldId}-notes`} className="block text-sm text-ink-muted">Reflection notes (optional)</label>
      <textarea
        id={`${fieldId}-notes`}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={500}
        placeholder="Anything worth remembering? (optional)"
        className="min-h-16 w-full rounded-xl border border-line bg-surface-raised p-3 text-sm placeholder:text-ink-faint focus:border-accent focus:outline-hidden focus:ring-2 focus:ring-accent/20"
      />
      <p className="text-xs text-ink-muted">Notes stay in your journal. Saving this reflection does not send them to AI.</p>
      </fieldset>
      </details>
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <Button
        variant="secondary"
        disabled={rating === 0 || pending}
        onClick={() => {
          if (inFlight.current || rating === 0) return;
          inFlight.current = true;
          startTransition(async () => {
            setError(null);
            try {
            const result = await saveAction({
              decisionId, rating, wouldRepeat, hasRegrets, wouldRecommend, wouldChooseAgain, notes,
            });
            if (result?.error) setError(result.error);
            else setSaved(true);
            } catch {setError("Couldn’t save that reflection. Please try again.");}
            finally { inFlight.current = false; }
          });
        }}
      >
        {pending ? "Saving…" : "Save reflection"}
      </Button>
    </div>
  );
}
