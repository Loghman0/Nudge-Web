import type { NextConfig } from "next";
import path from "node:path";

if(process.env.NUDGE_PUBLIC_LAUNCH==="true"){
 const missing=["NUDGE_OPERATOR_NAME","NUDGE_OPERATOR_COUNTRY","NUDGE_OPERATOR_ADDRESS","NUDGE_CONTACT_EMAIL","NUDGE_HOSTING_PROVIDER","NUDGE_DATA_REGION","NUDGE_TRANSFER_SAFEGUARDS","NUDGE_BACKUP_RETENTION_DAYS","NUDGE_LOG_RETENTION_DAYS","SUPABASE_SERVICE_ROLE_KEY"].filter(key=>!process.env[key]?.trim());
 if(missing.length)throw new Error(`Public launch requires configuration: ${missing.join(", ")}. See LAUNCH.md.`);
 if(!process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://"))throw new Error("Public launch requires an HTTPS site URL.");
}
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader:false,
  async headers(){
    const supabase=process.env.NEXT_PUBLIC_SUPABASE_URL??"https://example.supabase.co";
    const origin=new URL(supabase).origin,websocket=origin.replace(/^http/,"ws");
    const development=process.env.NODE_ENV!=="production";
    const csp=["default-src 'self'",`script-src 'self' 'unsafe-inline'${development?" 'unsafe-eval'":""}`,"style-src 'self' 'unsafe-inline'","img-src 'self' data: blob: https:","font-src 'self' data:",`connect-src 'self' ${origin} ${websocket}${development?" ws://localhost:3000 ws://127.0.0.1:3000":""}`,"object-src 'none'","base-uri 'self'","frame-ancestors 'none'",`form-action 'self' ${origin} https://accounts.google.com`].join("; ");
    const headers=[{key:"Content-Security-Policy",value:csp},{key:"X-Content-Type-Options",value:"nosniff"},{key:"X-Frame-Options",value:"DENY"},{key:"Referrer-Policy",value:"strict-origin-when-cross-origin"},{key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=()"}];
    if(process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://"))headers.push({key:"Strict-Transport-Security",value:"max-age=31536000"});
    return [{source:"/(.*)",headers},{source:"/(dashboard|onboarding|ask|history|profile|discover|analytics|groups|notifications|consent|login|signup|reset-password|update-password|auth|api)/:path*",headers:[{key:"X-Robots-Tag",value:"noindex, nofollow, noarchive"}]}];
  },
  // This repository can live beneath another Node workspace. Pin tracing to
  // Nudge itself so Next never walks a parent directory or picks its lockfile.
  outputFileTracingRoot: path.resolve(process.cwd()),
  // Hide Next.js's development toolbar (the "N" badge in the bottom-left).
  devIndicators: false,
  experimental: {
    // Client-side Router Cache: keep visited dynamic pages fresh for 30s so
    // back/forward and repeat navigation are instant instead of refetching.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
