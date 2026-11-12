"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { generateMonthlyRecap } from "./actions";

const REASONS: Record<string, string> = {
  off: "Optional AI assistance is off. You can enable it in Profile if you want a recap.",
  unavailable: "AI recaps are unavailable on this deployment. Your journal and comparisons still work.",
  capacity: "The AI usage limit has been reached. Try again later; your journal is still available.",
  timed_out: "The recap took too long and was stopped. Try again later.",
  no_data: "Make a few more decisions first — the recap needs at least 3 from the last 30 days.",
  failed: "Couldn't load your recap just now. Check your connection and try again.",
  changed: "Your privacy or AI settings changed. The recap was discarded; review your settings before trying again.",
};

export function AiRecap() {
  const [text, setText] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const [sample, setSample] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card className="border-accent/25 bg-accent-soft/20">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <Sparkles size={17} className="text-accent" />
          <h2 className="text-sm font-medium">Your month, in plain words</h2>
        </div>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setNotice(null);
              setText(null);setSample(null);
              setOff(false);
              try {
              const result = await generateMonthlyRecap();
              if (result.text) {
                setText(result.text);
                setSample(result.sampled ? `Based on the latest ${result.sampleSize} decisions made in the last 30 days, not the whole month.` : `Based on ${result.sampleSize} decisions made in the last 30 days.`);
              } else { setNotice(REASONS[result.reason ?? "failed"]); setOff(result.reason === "off"); }
              } catch { setNotice(REASONS.failed); }
            })
          }
        >
          {pending ? "Reading your month…" : text ? "Refresh" : "Write my recap"}
        </Button>
      </div>
      {text && <p className="mt-4 text-sm leading-relaxed">{text}</p>}
      {sample && <p className="mt-2 text-xs text-ink-muted">{sample}</p>}
      {notice && <p role="status" className="mt-4 text-sm text-ink-muted">{notice}{off && <> <Link href="/profile" className="underline">Review AI settings</Link></>}</p>}
      {!text && !notice && !pending && (
        <p className="mt-3 text-xs text-ink-muted">
          Nudge computes the numbers from your history; AI only turns them into a short story. Nothing is sent anywhere until you press the button.
        </p>
      )}
    </Card>
  );
}
