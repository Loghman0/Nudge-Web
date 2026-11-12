import { cn } from "@/lib/utils";
import Link from "next/link";

/** All surfaces use the same editable vector mark and wordmark. */
export function Brand({ className }: { className?: string }) {
  return <span className={cn("nudge-brand", className)}>
    <img src="/brand/nudge-mark.svg" width={36} height={36} alt="" aria-hidden="true" />
    <span>Nudge</span>
  </span>;
}

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return <Link href={href} aria-label="Nudge home" className={cn("nudge-logo", className)}><Brand /></Link>;
}
