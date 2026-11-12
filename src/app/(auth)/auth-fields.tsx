"use client";

import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";

/** Controlled fields retain a failed submission without persisting credentials. */
export function AuthField({ label, hint, type = "text", ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const [value, setValue] = useState("");
  const [revealed, setRevealed] = useState(false);
  const password = type === "password";
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <div className="relative">
        <Input {...props} id={id} type={password && revealed ? "text" : type} value={value} onChange={event => setValue(event.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} className={`h-12 text-base ${password ? "pr-14" : ""}`} />
        {password && <button type="button" onClick={() => setRevealed(current => !current)} aria-label={revealed ? "Hide password" : "Show password"} aria-pressed={revealed} aria-controls={id} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-xl text-ink-muted hover:text-ink">
          {revealed ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
        </button>}
      </div>
      {hint && <p id={`${id}-hint`} className="text-sm text-ink-muted">{hint}</p>}
    </div>
  );
}

export function AuthNotice({ error, message }: { error?: string; message?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error || message) ref.current?.focus(); }, [error, message]);
  if (!error && !message) return null;
  return <p ref={ref} tabIndex={-1} role={error ? "alert" : "status"} className={`rounded-xl border p-3 text-sm leading-relaxed ${error ? "border-red-500/40 text-red-700 dark:text-red-300" : "border-line text-ink"}`}>{error ?? message}</p>;
}

export function AuthDivider() {
  return <div className="flex items-center gap-3 text-xs text-ink-muted"><span className="h-px flex-1 bg-line" />or use email<span className="h-px flex-1 bg-line" /></div>;
}
