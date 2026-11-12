import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { policies } from "@/lib/legal/content";
import { legalConfig,operatorConfigured,POLICY_VERSION } from "@/lib/legal/config";
export function generateStaticParams(){return Object.keys(policies).map(policy=>({policy}));}
export async function generateMetadata({params}:{params:Promise<{policy:string}>}):Promise<Metadata>{const key=(await params).policy,p=Object.hasOwn(policies,key)?policies[key]:undefined;return {title:p?.title??"Nudge",description:p?.intro};}
export default async function PolicyPage({params}:{params:Promise<{policy:string}>}) {
  const key=(await params).policy,p=Object.hasOwn(policies,key)?policies[key]:undefined;if(!p)notFound();
  return <article className="space-y-7"><header><p className="text-xs text-ink-muted">Version {POLICY_VERSION}</p><h1 className="mt-3 font-display text-4xl font-semibold">{p.title}</h1><p className="mt-4 text-ink-muted">{p.intro}</p></header>
    {!operatorConfigured && <p role="status" className="rounded-xl border border-line bg-surface-sunken p-4 text-sm">Preview notice: public operator and contact details have not been configured yet.</p>}
    {p.sections.map(s=><section key={s.title} className="space-y-3"><h2 className="text-xl font-medium">{s.title}</h2>{s.paragraphs.map((paragraph,i)=><p key={i} className="text-sm leading-7 text-ink-muted">{paragraph}</p>)}</section>)}
    {legalConfig.email && <a className="inline-block text-sm font-medium underline underline-offset-4" href={`mailto:${legalConfig.email}`}>Contact Nudge</a>}
    {key==="privacy" && legalConfig.aiPrivacyUrl && /^https:\/\//.test(legalConfig.aiPrivacyUrl) && <p><a href={legalConfig.aiPrivacyUrl} rel="noopener noreferrer" className="text-sm underline">AI provider privacy information</a></p>}
  </article>;
}
