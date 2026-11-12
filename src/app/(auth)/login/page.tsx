"use client";

import Link from "next/link";
import { AuthReturnField, AuthSwitchLink } from "@/components/legal/auth-return-field";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { signInWithEmail, type AuthState } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { GoogleButton } from "@/components/ui/google-button";
import { AuthDivider, AuthField, AuthNotice } from "../auth-fields";

function UrlError() {
  const params = useSearchParams();
  const messages: Record<string, string> = {
    oauth: "Google sign-in could not start. Please try again.",
    auth: "That sign-in link is invalid or has expired.",
  };
  const code = params.get("error");
  if (params.get("deleted") === "1") return <AuthNotice message="Your account was deleted." />;
  return code && Object.hasOwn(messages, code) ? <AuthNotice error={messages[code]} /> : null;
}

export default function LoginPage() {
  const [state, action, pending] = useActionState<AuthState, FormData>(signInWithEmail, {});
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-base text-ink-muted">Pick up where you left off.</p>
      </div>
      <Suspense fallback={null}><UrlError /></Suspense>
      <GoogleButton label="Sign in with Google" />
      <AuthDivider />
      <form action={action} className="space-y-5" aria-busy={pending}>
        <AuthReturnField />
        <AuthField label="Email" name="email" type="email" placeholder="you@example.com" required autoComplete="email" />
        <AuthField label="Password" name="password" type="password" required autoComplete="current-password" />
        <div className="flex justify-end"><Link href="/reset-password" className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline">Forgot password?</Link></div>
        <AuthNotice {...state} />
        <Button type="submit" disabled={pending} className="h-12 w-full rounded-xl text-base">{pending ? "Signing in…" : "Sign in"}</Button>
      </form>
      <p className="pt-1 text-center text-sm text-ink-muted">New to Nudge? <AuthSwitchLink href="/signup">Create an account</AuthSwitchLink></p>
    </div>
  );
}
