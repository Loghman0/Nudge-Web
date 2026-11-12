import Link from "next/link";
import localFont from "next/font/local";
import "@/components/app/workspace.css";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { legalConfig,POLICY_VERSION } from "@/lib/legal/config";
import { LegalLinks } from "@/components/legal/legal-links";
import { BellRing } from "lucide-react";
import { NotificationsBadge } from "@/components/app/notifications-badge";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { NavLinks, MobileNav } from "@/components/app/nav-links";
import { TimezoneSync } from "@/components/app/timezone-sync";
import { signOut } from "@/app/auth/actions";

const workspaceFont = localFont({src:"../../fonts/BricolageGrotesque-latin.woff2",variable:"--font-workspace",display:"swap",weight:"400 700",preload:true});

// Public launch requires recorded terms before entering the authenticated UI.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const db=await createClient();
  const {data:identity,error}=legalConfig.publicLaunch
    ? await db.from("profiles").select("id,terms_version").maybeSingle()
    : await db.from("profiles").select("id").maybeSingle();
  if(error)throw new Error("Could not verify your account. Please try again.");
  if(!identity)redirect("/login");
  if(legalConfig.publicLaunch && (!("terms_version" in identity)||identity.terms_version!==POLICY_VERSION))
    redirect(`/consent?next=${encodeURIComponent((await headers()).get("x-nudge-return-to")??"/dashboard")}`);
  return (
    <div className={`nudge-workspace flex min-h-screen ${workspaceFont.variable}`}>
      <a
        href="#main"
        className="workspace-skip sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      <TimezoneSync />
      <aside className="hidden w-60 flex-col border-r border-line bg-surface-sunken/40 p-4 md:flex">
        <Logo href="/dashboard" className="workspace-wordmark px-2 py-2" />
        <nav aria-label="Main navigation" className="mt-6 flex flex-1 flex-col gap-1">
          <NavLinks />
        </nav>
        <form action={signOut}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink"
          >
            <span className="flex-1 text-left">Sign out</span>
          </button>
        </form>
      </aside>

      <div className="workspace-column flex flex-1 flex-col">
        <header className="workspace-header flex h-14 items-center justify-between border-b border-line px-5 md:justify-end">
          <Logo href="/dashboard" className="workspace-wordmark md:hidden" />
          <div className="flex items-center gap-1.5">
            {/* About you has a primary tab; check-ins stay one tap away too. */}
            <Link
              href="/notifications"
              aria-label="Check-ins"
              className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink md:hidden"
            >
              <BellRing size={18} aria-hidden />
              <span className="absolute right-0 top-0"><NotificationsBadge /></span>
            </Link>
            <ThemeToggle />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="flex-1 p-5 pb-24 md:p-8 md:pb-8">{children}</main>
        <footer className="px-5 pb-24 md:pb-6"><LegalLinks/></footer>
        <MobileNav />
      </div>
    </div>
  );
}
