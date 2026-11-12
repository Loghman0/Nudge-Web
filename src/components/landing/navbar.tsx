"use client";
import Link from "next/link";
import { Brand, Logo } from "@/components/ui/logo";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ListIcon } from "@phosphor-icons/react/dist/csr/List";
import { MoonIcon } from "@phosphor-icons/react/dist/csr/Moon";
import { SunIcon } from "@phosphor-icons/react/dist/csr/Sun";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { landingNav } from "./data";
import { LandingButton } from "./button";

export function Navbar() {
  const [active, setActive] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  useEffect(() => {
    setMounted(true);
    const hero = document.getElementById("landing-hero");
    const heroObserver = new IntersectionObserver(([entry]) => { setScrolled(!entry.isIntersecting); if (entry.isIntersecting) setActive(""); }, { threshold: 0.1 });
    if (hero) heroObserver.observe(hero);
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: "-72px 0px -55% 0px", threshold: 0 });
    landingNav.forEach(item => { const section = document.getElementById(item.id); if (section) observer.observe(section); });
    return () => { heroObserver.disconnect(); observer.disconnect(); };
  }, []);
  const dark = mounted && resolvedTheme === "dark";
  const themeLabel = dark ? "Switch to light mode" : "Switch to dark mode";
  return <>
    <a href="#landing-main" className="lp-skip">Skip to content</a>
    <header className="lp-nav" data-scrolled={scrolled}>
      <div className="lp-nav-inner">
        <Logo className="lp-wordmark" />
        <nav className="lp-desktop-nav" aria-label="Main navigation">
          {landingNav.map(item => <a href={`#${item.id}`} key={item.id} aria-current={active === item.id ? "location" : undefined}>{item.label}</a>)}
        </nav>
        <div className="lp-nav-actions">
          <Tooltip.Provider delayDuration={500}><Tooltip.Root><Tooltip.Trigger asChild>
            <LandingButton variant="icon" disabled={!mounted} aria-label={themeLabel} onClick={() => setTheme(dark ? "light" : "dark")}>
              {dark ? <SunIcon size={20} weight="regular" aria-hidden /> : <MoonIcon size={20} weight="regular" aria-hidden />}
            </LandingButton>
          </Tooltip.Trigger><Tooltip.Content className="lp-tooltip" sideOffset={8}>{themeLabel}<Tooltip.Arrow /></Tooltip.Content></Tooltip.Root></Tooltip.Provider>
          <Link href="/login" className="lp-signin">Sign in</Link>
          <LandingButton asChild className="lp-nav-signup"><Link href="/signup">Create account</Link></LandingButton>
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild><LandingButton variant="icon" className="lp-menu-trigger" aria-label="Open menu"><ListIcon size={22} weight="regular" aria-hidden /></LandingButton></Dialog.Trigger>
            <Dialog.Portal container={mounted ? document.getElementById("nudge-landing") : undefined}><Dialog.Overlay className="lp-sheet-overlay" /><Dialog.Content className="lp-sheet" aria-describedby="landing-menu-description">
              <div className="lp-sheet-top"><Dialog.Title className="lp-wordmark"><Brand /></Dialog.Title><Dialog.Close asChild><LandingButton variant="icon" aria-label="Close menu"><XIcon size={22} weight="regular" aria-hidden /></LandingButton></Dialog.Close></div>
              <Dialog.Description id="landing-menu-description" className="lp-muted">Find your way around Nudge.</Dialog.Description>
              <nav aria-label="Mobile navigation">{landingNav.map(item => <Dialog.Close asChild key={item.id}><a href={`#${item.id}`} aria-current={active === item.id ? "location" : undefined}>{item.label}</a></Dialog.Close>)}</nav>
              <div className="lp-sheet-actions"><LandingButton asChild><Link href="/signup">Create account</Link></LandingButton><LandingButton variant="secondary" asChild><Link href="/login">Sign in</Link></LandingButton></div>
            </Dialog.Content></Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
    </header>
  </>;
}
