"use client";

import Link from "next/link";
import { AuthReturnField, AuthSwitchLink } from "@/components/legal/auth-return-field";
import { useActionState } from "react";
import { signUpWithEmail, type AuthState } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { GoogleButton } from "@/components/ui/google-button";
import { AuthDivider, AuthField, AuthNotice } from "../auth-fields";

export default function SignupPage() {
  const [state, action, pending] = useActionState<AuthState, FormData>(signUpWithEmail, {});
  const emailSignupEnabled = process.env.NEXT_PUBLIC_EMAIL_SIGNUP_ENABLED !== "false";
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Create an account</h1>
        <p className="text-base text-ink-muted">{emailSignupEnabled ? "Keep your choices. Learn from what worked." : "Save your reflections with Google."}</p>
      </div>
      {state.message ? <><AuthNotice message={state.message} /><AuthSwitchLink href="/login">Back to sign in</AuthSwitchLink></> : <>
        <GoogleButton label="Continue with Google" fallback="/onboarding" foundation />
        {emailSignupEnabled && <>
        <AuthDivider />
        <form action={action} className="space-y-5" aria-busy={pending}>
          <AuthReturnField fallback="/onboarding" />
          <AuthField label="Email" name="email" type="email" placeholder="you@example.com" required autoComplete="email" />
          <AuthField label="Password" name="password" type="password" hint="At least 8 characters" required minLength={8} autoComplete="new-password" />
          <AuthNotice error={state.error} />
          <Button type="submit" disabled={pending} className="h-12 w-full rounded-xl text-base">{pending ? "Creating account…" : "Create account"}</Button>
        </form>
        </>}
        <p className="text-sm leading-relaxed text-ink-muted"><Link href="/terms" className="underline underline-offset-4">Terms</Link> and <Link href="/privacy" className="underline underline-offset-4">Privacy</Link>. AI assistance is optional and starts off.</p>
        <p className="pt-1 text-center text-sm text-ink-muted">Already have an account? <AuthSwitchLink href="/login">Sign in</AuthSwitchLink></p>
      </>}
    </div>
  );
}
