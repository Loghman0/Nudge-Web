import type { MetadataRoute } from "next";
import { legalConfig } from "@/lib/legal/config";
export default function robots():MetadataRoute.Robots{
 const root=(process.env.NEXT_PUBLIC_SITE_URL??"http://localhost:3000").replace(/\/$/,"");
 return {rules:legalConfig.publicLaunch?{userAgent:"*",allow:["/","/privacy","/terms","/cookies","/support","/security","/accessibility"],disallow:["/dashboard","/ask","/discover","/history","/profile","/analytics","/groups","/notifications","/onboarding","/consent","/auth/","/api/","/login","/signup","/reset-password","/update-password"]}:{userAgent:"*",disallow:"/"},...(legalConfig.publicLaunch?{sitemap:root+"/sitemap.xml"}:{})};
}
