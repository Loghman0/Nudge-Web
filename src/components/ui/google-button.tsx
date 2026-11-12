"use client";
import { AuthReturnField } from "@/components/legal/auth-return-field";
import { signInWithGoogle } from "@/app/auth/actions";
import { useFormStatus } from "react-dom";

function GoogleSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-line bg-surface-raised text-base font-medium text-ink transition-colors hover:bg-surface-sunken disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
    <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.1 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6C12.3 13.2 17.7 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/>
      <path fill="#FBBC05" d="M10.4 28.7a14.5 14.5 0 0 1 0-9.4l-7.8-6a24 24 0 0 0 0 21.5l7.8-6.1z"/>
      <path fill="#34A853" d="M24 48c6.1 0 11.2-2 15-5.5l-7.5-5.8c-2.1 1.4-4.7 2.2-7.5 2.2-6.3 0-11.7-3.7-13.6-9.2l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/>
    </svg>
    {pending ? "Opening Google…" : label}
  </button>;
}

export function GoogleButton({ label, fallback = "/dashboard", foundation = false }: { label: string; fallback?: string; foundation?: boolean }) {
  return (
    <form action={signInWithGoogle}>
      <AuthReturnField fallback={fallback}/>
      {foundation && <input type="hidden" name="foundation" value="on"/>}
      <GoogleSubmit label={label} />
    </form>
  );
}
