import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { LegalLinks } from "@/components/legal/legal-links";
import { LandingButton } from "./button";
import { FaqAccordion, FeatureTabs, LandingShare, LearningRibbon } from "./interactions";
export function HowItWorks() {
  return <section id="how-it-works" className="lp-section lp-how"><div className="lp-container"><div className="lp-section-intro"><p className="lp-eyebrow">How it works</p><h2>Start with curiosity.<br />Find your patterns.</h2><p>No big decision needed. A small question is enough to start.</p></div><LearningRibbon /></div></section>;
}
export function Features() {
  return <section id="features" className="lp-section"><div className="lp-container"><div className="lp-section-intro"><h2>Know yourself.<br />Make room for choice.</h2><p>Explore a little each day, review what fits, and use it when a decision comes along.</p></div><FeatureTabs /></div></section>;
}
export function WhyNudge() {
  return <section className="lp-section lp-why"><div className="lp-container"><p className="lp-eyebrow">Why Nudge</p><h2>A good recommendation<br />needs your perspective.</h2><div className="lp-why-body"><p>A conversation can help you explore a choice. Nudge gives it a place to live: the options, your reasons, what you chose and how it went.</p><p>Next time, compare against those outcomes or your own measurements. You can inspect the evidence, correct it, or leave the choice open when there is no clear answer.</p></div><div className="lp-boundary"><h3>Your memory. Your control.</h3><p>Your journal stays separate from circles. Export, correct or delete your data, and choose whether to enable AI.</p><Link href="/privacy">Read the Privacy policy</Link></div></div></section>;
}
export function Pricing() {
  return <section id="pricing" className="lp-section lp-pricing"><div className="lp-container"><div className="lp-section-intro"><h2>Start with a<br />little curiosity.</h2><p>Free to use. Optional AI is subject to capacity and usage limits.</p></div><div className="lp-price-panel"><div className="lp-price-heading"><h3>Free</h3><p><span className="lp-price">$0</span><span className="lp-price-period">per month</span></p></div><ul><li>Daily questions and personal reflections</li><li>Comparisons and decision journal</li><li>Full data export</li></ul><LandingButton asChild><Link href="/start">Try six questions</Link></LandingButton></div></div></section>;
}
export function Faq() {
  return <section id="faq" className="lp-section"><div className="lp-container lp-faq-container"><div className="lp-section-intro"><h2>Common questions.</h2></div><FaqAccordion /></div></section>;
}
export function Footer() {
  return <footer className="lp-footer"><div className="lp-container"><div className="lp-footer-top"><div><Logo className="lp-wordmark" /><p>Know yourself, one question at a time.</p></div><LandingButton asChild><Link href="/start">Try six questions</Link></LandingButton></div><nav aria-label="Footer navigation" className="lp-footer-nav"><a href="#how-it-works">How it works</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a></nav><LegalLinks /><div className="lp-footer-bottom"><p>© {new Date().getFullYear()} Nudge.</p><LandingShare /></div></div></footer>;
}
