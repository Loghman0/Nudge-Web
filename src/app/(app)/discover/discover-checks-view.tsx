"use client";

import { useRef, useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { DiscoverActions, VerificationItem } from "@/lib/discover/types";

export interface DiscoverInsight { prefKey: string; label: string; evidence: number }
export function DiscoverChecksView({ insight, verifications, actions }: {
  insight: DiscoverInsight | null; verifications: VerificationItem[];
  actions: Pick<DiscoverActions, "answerVerification" | "confirmInsight">;
}) {
  const [checks, setChecks] = useState(verifications);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const [insightDone, setInsightDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function verify(item: VerificationItem, answer: "still_true" | "not_anymore" | "forget") {
    if (pending || busy.current) return;
    busy.current = true;
    startTransition(async () => {
      setError(null);
      try {
        const result = await actions.answerVerification(item.id, answer);
        if (result.error) { setError(result.error); return; }
        setChecks((prev) => prev.filter((c) => c.id !== item.id));
      } catch { setError("Couldn't save that check. Please try again."); }
      finally { busy.current = false; }
    });
  }

  function confirm(confirmed: boolean) {
    if (!insight || pending || busy.current) return;
    busy.current = true;
    startTransition(async () => {
      setError(null);
      try {
        const result = await actions.confirmInsight(insight.prefKey, confirmed);
        if (result.error) { setError(result.error); return; }
        setInsightDone(true);
      } catch { setError("Couldn't save that pattern check. Please try again."); }
      finally { busy.current = false; }
    });
  }


  return <div className="space-y-5" aria-busy={pending}>
    {checks.length===0&&(!insight||insightDone)&&<p role="status" className="text-sm text-ink-muted">You’re up to date. Earlier preferences will appear here when there’s something to review.</p>}
    {pending && <p role="status" className="text-sm text-ink-muted">Saving your response…</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {/* Verification queue — beliefs whose confidence has gone stale */}
      {checks.slice(0, 1).map((item) => (
        <Card key={item.id} className="border-line">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            Quick check
          </p>
          <p className="mt-2 text-sm">
            Nudge remembers you {item.polarity === "dislike" ? "prefer to avoid" : "lean toward"}{" "}
            <span className="font-medium">{item.label}</span>. Does that still feel true?
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" disabled={pending} onClick={() => verify(item, "still_true")}>
              <Check size={14} /> Still true
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => verify(item, "not_anymore")}>
              <X size={14} /> Not anymore
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => verify(item, "forget")}>
              Forget this
            </Button>
          </div>
        </Card>
      ))}

      {/* Pattern confirmation — separate from the daily question */}
      {insight && !insightDone && (
        <Card className="border-accent/25 bg-accent-soft/20">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            Nudge noticed something
          </p>
          <p className="mt-2 text-sm">
            You seem to lean toward <span className="font-medium">{insight.label}</span>
            {insight.evidence > 1 && ` — it's come up ${insight.evidence} times`}. Right?
          </p>
          <p className="mt-2 text-xs text-ink-muted">Not really clears this inferred preference. It does not mean you prefer to avoid it.</p>
          <div className="mt-4 flex gap-2">
            <Button
              variant="secondary" disabled={pending}
              onClick={() => confirm(true)}
            >
              <Check size={14} /> That&apos;s right
            </Button>
            <Button
              variant="ghost" disabled={pending}
              onClick={() => confirm(false)}
            >
              <X size={14} /> Not really
            </Button>
          </div>
        </Card>
      )}
  </div>;
}
