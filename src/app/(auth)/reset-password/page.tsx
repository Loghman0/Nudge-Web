"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset, type AuthState } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { AuthField, AuthNotice } from "../auth-fields";

export default function ResetPasswordPage() {
  const [state, action, pending] = useActionState<AuthState, FormData>(requestPasswordReset, {});
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-base text-ink-muted">We’ll email you a link to choose a new one.</p>
      </div>
      <form action={action} className="space-y-5" aria-busy={pending}>
        <AuthField label="Email" name="email" type="email" placeholder="you@example.com" required autoComplete="email" />
        <AuthNotice {...state} />
        <Button type="submit" disabled={pending} className="h-12 w-full rounded-xl text-base">{pending ? "Sending…" : "Send reset link"}</Button>
      </form>
      <p className="text-center text-sm"><Link href="/login" className="inline-flex min-h-11 items-center font-medium text-accent hover:underline">Back to sign in</Link></p>
    </div>
  );
}
