"use client";

import { useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { upgradeGuestAccount } from "@/app/(app)/profile/actions";

/** Shown only to anonymous (guest) accounts. */
export function GuestUpgrade() {
  const [result, setResult] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card className="border-accent/25 bg-accent-soft/20">
      <div className="flex items-center gap-2">
        <ShieldCheck size={17} className="text-accent" />
        <h2 className="text-sm font-medium">Keep this account</h2>
      </div>
      <p className="mt-2 text-sm text-ink-muted">
        You&apos;re signed in as a guest. Add an email and password to keep your
        decisions, preferences and streak — nothing gets moved, this same
        account just becomes recoverable.
      </p>
      <form
        className="mt-4 space-y-2.5"
        action={(formData) =>
          startTransition(async () => setResult(await upgradeGuestAccount(formData)))
        }
      >
        <Input name="email" type="email" required placeholder="you@example.com" autoComplete="email" />
        <Input name="password" type="password" required minLength={8} placeholder="Password (8+ characters)" autoComplete="new-password" />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save my account"}
        </Button>
      </form>
      {result?.error && <p className="mt-3 text-sm text-red-500">{result.error}</p>}
      {result?.message && <p className="mt-3 text-sm text-accent">{result.message}</p>}
    </Card>
  );
}
