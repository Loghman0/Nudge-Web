"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { BellRing, History, LayoutDashboard, LoaderCircle, Scale, UserRound, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationsBadge } from "./notifications-badge";

type NavItemDef = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: "notifications";
  mobileShort: string;
  /** The three core destinations stay in the mobile bar; optional tools are
      available from Today and Profile remains in the mobile header. */
  mobile?: boolean;
};

const NAV_DEFS: NavItemDef[] = [
  { href: "/dashboard", label: "Today", icon: LayoutDashboard, mobileShort: "Today", mobile: true },
  { href: "/profile", label: "About you", icon: UserRound, mobileShort: "About you", mobile: true },
  { href: "/ask", label: "Decide", icon: Scale, mobileShort: "Decide", mobile: true },
  { href: "/history", label: "Journal", icon: History, mobileShort: "Journal" },
  { href: "/notifications", label: "Check-ins", icon: BellRing, badge: "notifications", mobileShort: "Alerts" },
];

/** The current destination stays accurate until navigation commits. */
function NavigationPending({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return pending ? <span role="status" className="inline-flex items-center">
    <LoaderCircle aria-hidden="true" size={14} className="motion-safe:animate-spin" />
    <span className="sr-only">Opening {label}</span>
  </span> : null;
}

/** Sidebar links with instant active-state feedback. Prefetched by default. */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {NAV_DEFS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
              active
                ? "bg-surface-raised font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.05)]"
                : "text-ink-muted hover:bg-surface-raised hover:text-ink"
            )}
          >
            <item.icon size={16} className={active ? "text-accent" : undefined} />
            <span className="flex-1">{item.label}</span>
            <NavigationPending label={item.label} />
            {item.badge === "notifications" && <NotificationsBadge />}
          </Link>
        );
      })}
    </>
  );
}

/** Mobile bottom nav: three 44px+ touch targets, safe-area aware. */
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-line bg-surface/90 backdrop-blur-sm md:hidden"
    >
      {NAV_DEFS.filter((item) => item.mobile).map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px]",
              active ? "font-medium text-accent" : "text-ink-muted"
            )}
          >
            <span className="relative">
              <item.icon size={19} />
              {item.badge === "notifications" && (
                <span className="absolute -right-2 -top-1.5"><NotificationsBadge /></span>
              )}
            </span>
            {item.mobileShort}
            <span className="absolute right-3 top-2"><NavigationPending label={item.label} /></span>
          </Link>
        );
      })}
    </nav>
  );
}
