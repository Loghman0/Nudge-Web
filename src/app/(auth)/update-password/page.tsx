"use client";

import { useActionState } from "react";
import { updatePassword, type AuthState } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { AuthField, AuthNotice } from "../auth-fields";

export default function UpdatePasswordPage() {
  const [state, action, pending] = useActionState<AuthState, FormData>(updatePassword, {});
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="text-base text-ink-muted">Then you’re ready to return to Nudge.</p>
      </div>
      <form action={action} className="space-y-5" aria-busy={pending}>
        <AuthField label="New password" name="password" type="password" hint="At least 8 characters" required minLength={8} autoComplete="new-password" />
        <AuthNotice error={state.error} />
        <Button type="submit" disabled={pending} className="h-12 w-full rounded-xl text-base">{pending ? "Saving…" : "Save new password"}</Button>
      </form>
    </div>
  );
}
