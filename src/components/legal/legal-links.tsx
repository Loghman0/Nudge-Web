import Link from "next/link";
export function LegalLinks() {
  return <nav aria-label="Legal and support" className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-ink-muted">
    <Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/cookies">Cookies & storage</Link>
    <Link href="/support">Support</Link><Link href="/security">Security</Link><Link href="/accessibility">Accessibility</Link><a href="/third-party-notices.txt">Licenses</a>
  </nav>;
}
