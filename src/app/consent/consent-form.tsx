"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { acceptTerms } from "./actions";
export function ConsentForm({next="/dashboard"}:{next?:string}){const [state,action,pending]=useActionState(acceptTerms,{});return <form action={action} className="mt-6 space-y-5">
  <input name="next" type="hidden" value={next}/>
  <label className="flex items-start gap-3 text-sm"><input name="age" type="checkbox" required className="mt-1"/><span>I am at least 16 and can agree to these terms, with guardian permission where required.</span></label>
  <label className="flex items-start gap-3 text-sm"><input name="terms" type="checkbox" required className="mt-1"/><span>I agree to the <Link href="/terms" target="_blank" className="underline">Terms of service</Link>. I have read the <Link href="/privacy" target="_blank" className="underline">Privacy policy</Link>.</span></label>
  <p className="text-xs text-ink-muted">Optional AI assistance stays off. You can decide whether to enable it later in Profile.</p>
  {state.error&&<p role="alert" className="text-sm text-red-600">{state.error}</p>}<Button disabled={pending}>{pending?"Saving…":"Agree and continue"}</Button>
</form>;}
