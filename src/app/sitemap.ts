import type { MetadataRoute } from "next";
import { legalConfig } from "@/lib/legal/config";
export default function sitemap():MetadataRoute.Sitemap{
 if(!legalConfig.publicLaunch)return [];
 const root=(process.env.NEXT_PUBLIC_SITE_URL??"http://localhost:3000").replace(/\/$/,"");
 return ["","/privacy","/terms","/cookies","/support","/security","/accessibility"].map(path=>({url:root+path,changeFrequency:path?"monthly":"weekly",priority:path?0.3:1}));
}
