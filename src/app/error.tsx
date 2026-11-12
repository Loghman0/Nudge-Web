"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Global error boundary. Before this existed, any uncaught server error
 * white-screened the app with Next's default overlay text — no brand, no
 * recovery path. Errors here are transient by nature (network blips, a
 * failed fetch), so the primary action is simply to try again.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[nudge] uncaught error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        That didn&apos;t go as planned
      </h1>
      <p className="max-w-sm text-sm text-ink-muted">
        Something went wrong on our side — your decisions and everything Nudge
        has learned are safe. Trying again usually fixes it.
      </p>
      <Button onClick={reset}>
        <RotateCcw size={14} /> Try again
      </Button>
      {error.digest && (
        <p className="text-[11px] text-ink-faint">Error reference: {error.digest}</p>
      )}
    </div>
  );
}
