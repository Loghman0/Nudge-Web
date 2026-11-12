#!/usr/bin/env node
/**
 * Generates a VAPID keypair for web push (lock-screen reminders).
 *
 * VAPID is not a service you sign up for — it's a locally generated
 * cryptographic keypair that identifies this app to the browser push
 * services run by Google, Mozilla, and Apple. Generate once, keep the
 * private key secret, and pushes work.
 */
import { createECDH } from "node:crypto";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();

const b64url = (buf) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const publicKey = b64url(ecdh.getPublicKey());   // 65-byte uncompressed EC point
const privateKey = b64url(ecdh.getPrivateKey()); // 32-byte scalar

console.log(`
VAPID keypair generated.

1) Add to .env.local (public key — safe to expose to the browser):

   NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}

2) Register BOTH keys with the Supabase edge function that sends pushes:

   supabase secrets set \\
     VAPID_PUBLIC_KEY=${publicKey} \\
     VAPID_PRIVATE_KEY=${privateKey} \\
     VAPID_SUBJECT=mailto:you@example.com

   (or paste them in Supabase Dashboard → Edge Functions → send-checkins → Secrets)

3) Restart \`npm run dev\` / redeploy. The toggle on the Check-ins page will
   replace the configuration notice.

Keep the private key out of git. If it ever leaks, run this script again —
existing subscriptions will re-register on next visit.
`);
