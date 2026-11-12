import Link from "next/link";
import { Compass, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Branded 404 — dead ends should still point back into the loop. */
export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="font-display text-6xl font-semibold text-ink-faint">404</p>
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        This page isn&apos;t one of the options
      </h1>
      <p className="max-w-sm text-sm text-ink-muted">
        The page you&apos;re after doesn&apos;t exist or has moved. Your decision
        memory is exactly where you left it.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/dashboard">
          <Button><Scale size={14} /> Back to dashboard</Button>
        </Link>
        <Link href="/discover">
          <Button variant="secondary"><Compass size={14} /> Discover yourself</Button>
        </Link>
      </div>
    </div>
  );
}
