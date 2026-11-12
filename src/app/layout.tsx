import type { Metadata } from "next";
import { legalConfig } from "@/lib/legal/config";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme/theme-provider";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/app/service-worker";

/* Self-hosted fonts; one shared UI face across every route. */
const workspace = localFont({ src:"../fonts/BricolageGrotesque-latin.woff2",variable:"--font-workspace",display:"swap",weight:"400 700",preload:true });
const inter = localFont({
  src: [
    { path: "../fonts/Inter-var.woff2", style: "normal" },
    { path: "../fonts/Inter-italic-var.woff2", style: "italic" },
  ],
  variable: "--font-inter",
  display: "swap",
  preload: false,
});

const playfair = localFont({
  src: [
    { path: "../fonts/Playfair-var.woff2", style: "normal" },
    { path: "../fonts/Playfair-italic-var.woff2", style: "italic" },
  ],
  variable: "--font-display",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  icons:{icon:[{url:"/brand/nudge-mark.svg",type:"image/svg+xml"},{url:"/icon-32.png",sizes:"32x32",type:"image/png"}],shortcut:"/favicon.ico",apple:"/icon-192.png"},
  metadataBase:new URL(process.env.NEXT_PUBLIC_SITE_URL||"http://localhost:3000"),
  title:{default:"Nudge — A little more you.",template:"%s · Nudge"},
  robots:{index:legalConfig.publicLaunch,follow:legalConfig.publicLaunch},
  openGraph:{title:"Nudge",description:"Discover what feels like you. Bring what you learn into your decisions.",type:"website",url:"/",siteName:"Nudge"},
  twitter:{card:"summary_large_image",title:"Nudge",description:"Discover what feels like you. Bring what you learn into your decisions."},
  description:
    "Explore yourself through light questions and source-linked reflections, then use what you learn to make decisions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning className={`${workspace.variable} ${inter.variable} ${playfair.variable}`}>
      <body className="font-sans">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <ServiceWorkerRegistrar />
        </ThemeProvider>
      </body>
    </html>
  );
}
