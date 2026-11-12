import type { Metadata } from "next";
import localFont from "next/font/local";
import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import {
  HowItWorks, Features, WhyNudge, Pricing, Faq, Footer,
} from "@/components/landing/sections";
import { AskAnything, KnowledgeGraph } from "@/components/landing/showcase";
import "@/components/landing/hindsight.css";

const hindsight = localFont({src:"../fonts/BricolageGrotesque-latin.woff2",variable:"--font-hindsight",display:"swap",weight:"400 700",preload:true});
export const metadata:Metadata={
  title:{absolute:"Nudge | A little more you"},
  description:"Discover what feels like you through light daily questions. Try six without an account, then bring what you learn into your decisions.",
  openGraph:{title:"Nudge | A little more you",description:"Six light questions. A reflection grounded in your answers. No account needed to start.",url:"/"},
  twitter:{title:"Nudge | A little more you",description:"Explore your patterns, one light question at a time. Use what you learn when it is time to decide."},
};

export default function LandingPage() {
  return (
    <div className={`lp ${hindsight.variable}`} id="nudge-landing">
      <Navbar />
      <main id="landing-main" tabIndex={-1}>
        <Hero />
        <HowItWorks />
        <KnowledgeGraph />
        <AskAnything />
        <Features />
        <WhyNudge />
        <Pricing />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
