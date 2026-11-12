import localFont from "next/font/local";
import "@/components/app/workspace.css";
import { LegalLinks } from "@/components/legal/legal-links";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";

const workspaceFont = localFont({ src: "../../fonts/BricolageGrotesque-latin.woff2", variable: "--font-workspace", display: "swap", weight: "400 700", preload: true });

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`nudge-workspace flex min-h-[100dvh] flex-col ${workspaceFont.variable}`}>
      <a href="#auth-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-surface-raised focus:p-3">Skip to content</a>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <ThemeToggle />
      </header>
      <main id="auth-main" tabIndex={-1} className="flex flex-1 items-center justify-center px-5 py-8 sm:py-12">
        <div className="w-full max-w-[440px] rounded-3xl border border-line bg-surface-raised p-6 shadow-[0_8px_36px_rgb(37_51_72/0.04)] sm:p-9">{children}</div>
      </main>
      <footer className="px-5 pb-6 pt-6"><LegalLinks /></footer>
    </div>
  );
}
