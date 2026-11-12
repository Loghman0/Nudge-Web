"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyInvite({ code }: { code: string }) {
  const [error,setError]=useState("");
  const [copied, setCopied] = useState(false);
  return (
    <span><button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { setError("Select and copy the invitation code manually."); }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg bg-surface-sunken px-3 py-2 font-mono text-xs text-ink-muted transition-colors hover:text-ink"
      title="Copy invite code"
    >
      {code}
      {copied ? <Check size={12} className="text-accent" /> : <Copy size={12} />}
    </button>{error&&<span role="status" className="ml-2 text-xs">{error}</span>}</span>
  );
}
