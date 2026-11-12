import Link from "next/link";
import { LandingButton } from "./button";
import { HindsightDemo } from "./interactions";
export function Hero() {
  return <section className="lp-hero" id="landing-hero"><div className="lp-container lp-hero-grid">
    <div className="lp-hero-copy"><h1>A little curiosity.<br />A little more you.</h1><p>Explore what feels like you, one light question at a time. Bring what you learn into the choices that matter.</p><LandingButton asChild><Link href="/start">Find your first insight</Link></LandingButton><p className="lp-hero-note">Six questions. No account needed.</p></div>
    <div className="lp-hero-working"><HindsightDemo /></div>
  </div></section>;
}
