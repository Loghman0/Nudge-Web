import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { LegalLinks } from "@/components/legal/legal-links";
export default function PublicLayout({children}:{children:React.ReactNode}) {
  return <div className="min-h-screen"><header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-7"><Logo/><Link href="/login" className="text-sm text-ink-muted">Sign in</Link></header><main id="main" className="mx-auto max-w-3xl px-6 pb-16">{children}</main><footer className="border-t border-line px-6 py-7"><LegalLinks/></footer></div>;
}
