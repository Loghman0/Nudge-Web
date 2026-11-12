# Google sign-in configuration

## Branding review — 11 November 2026

Google Auth Platform saved the new [OAuth logo](../public/brand/nudge-google-oauth.png), which pairs the existing Nudge mark with the wordmark. The automatic recheck cleared the logo finding. The remaining finding is homepage ownership. Search Console shows verified ownership of `https://projectnudge.vercel.app/`, and the homepage, privacy policy, and verification file all returned HTTP 200. The verification file matched the expected content.

The Verification Center shows that branding is under review. After Google's decision, publish the approved branding if prompted and open the live Google chooser from both login and signup to confirm what visitors see. Keep the Supabase callback domain as configured.

## Latest deployed verification — 7 November 2026

The web finishing pass is deployed as `dpl_41hNvnxcQ6VgpfsofrfqS9GqYHJT`, aliased to `https://projectnudge.vercel.app`. With the owner's explicit preference, production sets `NEXT_PUBLIC_EMAIL_SIGNUP_ENABLED=false`. New-account signup offers Google; the email-signup server action also refuses a direct submission before contacting Supabase. Existing email-account login and recovery remain available. Re-enable email signup only after configuring custom SMTP and rebuilding/redeploying.

Real Google sign-in from the deployed signup page reached the existing account chooser and returned through the configured callback. Refresh retained the session and loaded Today; the test then signed out. No extra Google scopes or identity permissions were added, no account answers were changed, and no claim is made that a second brand-new Google identity was registered. Local evidence: `.local/evidence/2026-11-07-web-finish/google-signup-deployed.png` and `google-login-persisted.png`.

Before email signup was deferred, an approved owner Gmail alias received signup confirmation and reset messages. Confirmation opened a new authenticated account, and a fresh reset link opened the authenticated new-password form. No password replacement was submitted. The exact disposable email account was removed and its absence verified. The hosted SMTP toggle is disabled: the built-in sender's recipient and volume limits still apply. This check does not establish email signup for arbitrary visitors or support-group delivery. See [SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp) and [the current web verification](RELEASE-TESTING.md).

Google branding remains unapproved. The homepage proof file stays deployed, and the chooser still shows the Supabase callback domain. Historical configuration details follow.

---

Verified on 6 November 2026 for the existing Nudge Supabase project. Google and Supabase use two different callback destinations; registering only the app URL in Google is insufficient.

## Original local setup — 6 November 2026

- Google Cloud project: `nudge-502812`; existing web OAuth client named `Nudge`.
- Google authorized redirect URI: `https://awlaxvfnibugdqqqvkac.supabase.co/auth/v1/callback`.
- Google JavaScript origins: `http://localhost:3000` and `http://127.0.0.1:3000`.
- Supabase Site URL: `http://localhost:3000`.
- Supabase allowed app returns: `http://localhost:3000/auth/callback**` and `http://127.0.0.1:3000/auth/callback**`. These local path patterns also cover the encoded `next` query parameter. No wildcard external hosts are authorized.
- Google remains enabled in Supabase with the existing client ID and secret. Neither credential was rotated, displayed or added to application source. Nonce validation and email requirements remain enabled.

The Google client previously had no authorized redirect URI. Supabase also had no app redirect allowlist. Both settings are now saved. The Google callback URL above was checked against the actual failing request and the provider panel.

## Keeping local sessions on the same host

`localhost` and `127.0.0.1` have separate browser cookie scopes. Auth actions now preserve the initiating origin only when both addresses are the explicitly supported HTTP loopback hosts on the configured port and public launch is off. Arbitrary origins, ports, credentials and lookalike hostnames cannot change the return destination. Public or non-loopback deployments always use the configured site origin.

The callback handler also restores the permitted local Host because Next.js can normalize the request URL to `localhost`. This keeps the code-verifier cookie, exchanged session and dashboard redirect on the same host. Safe local `next` paths remain enforced.

## Deployment

Set `NEXT_PUBLIC_SITE_URL` and Supabase's Site URL to the final HTTPS app origin. Register its required `/auth/callback` return paths and query variants in Supabase, and the origin in Google. The Google redirect URI remains the Supabase callback unless the Supabase auth domain changes. Review local development entries before public rollout; do not replace them with wildcard public domains. Test the actual deployed URL before opening signup.

No paid Google service, additional Google API, new scope or public deployment was enabled by this repair.

## Google branding status — 7 November 2026

The OAuth **App name** is `Nudge`, separate from the client name. With explicit approval, the OAuth audience was published to Production on 7 November 2026. The homepage, privacy-policy and terms links are saved on `projectnudge.vercel.app`; the existing Nudge monogram was uploaded as the app logo. Brand verification has not been completed. Google currently shows the Supabase callback domain. Renaming that working callback URL would break authentication; it is not a label controlled by Nudge's frontend.

To display the Nudge name/logo publicly, configure the real website and policy links on a verified domain, complete Google's brand-verification process and publish the approved branding. The request to improve the sign-in label does not authorize inventing those URLs or enabling public launch before its separate release requirements are complete.

The `Nudge Support` Google Group was created on 7 November 2026 at `projectnudge-support@googlegroups.com` and selected as the OAuth **User support email**. Google confirmed that the branding changes were saved. The group has one owner/member; only the owner can view conversations and members, anyone can email it, joining is invitation-only, and the group is hidden from public search. These settings were explicitly approved and checked after creation. Email delivery has not been tested.

The existing Vercel project is `nudge` in `lowens-projects-0214d7d2`, serving `https://projectnudge.vercel.app`. Deployment `dpl_98ekSUff5yBi5sz8pWCPfmq2QaeE` was built successfully and promoted on 7 November 2026. All 727 automated tests passed. The public landing, starter questions, login, signup, policy/support routes, manifest and logo returned HTTP 200. Real Google login returned to the hosted dashboard; refreshing retained the session and loaded a daily question. This is deployment and authentication verification, not proof of every feature or new-user signup.

Supabase's Site URL is now `https://projectnudge.vercel.app` and the allowlist includes `https://projectnudge.vercel.app/auth/callback**`, including its encoded return-path query. Existing entries were preserved. Google saved the homepage, privacy and terms links on this host and accepted `projectnudge.vercel.app` as an authorized domain. The hosted demo has no AI keys configured and keeps the public-launch configuration flag off. Google's OAuth audience is In production; the account chooser still displays the Supabase domain until branding is approved.

Google's first branding check reported two issues: homepage ownership was not verified, and the logo did not uniquely identify the brand. The Search Console URL-prefix property was verified successfully under the OAuth project owner's account on 7 November 2026, after deploying `public/google35f6cc9c79fbbc3d.html`. The proof URL returned HTTP 200 with the exact expected content, and Search Console displayed ownership verified. Keep this file in future deployments. Google explicitly requires waiting 24 hours after ownership verification before retrying branding. The logo finding also needs resolution or additional review; do not claim that branding has been approved. Evidence is saved locally in `.local/google-homepage-ownership-verified.png` and `.local/google-brand-verification-issues.png`.

Emails in Google's account chooser belong to the visitor's own signed-in accounts. They are distinct from the app's public **User support email**. **Developer contact information** is used for Google's project notifications and is separate again.

See [Google's branding and support-email requirements](https://support.google.com/cloud/answer/15549049?hl=en) and [Google Group settings](https://support.google.com/groups/answer/2464926?hl=en).

## Verification

- 33 focused authentication tests passed, including origin spoofing rejection, signup/recovery destinations, safe return paths and OAuth cookie persistence.
- Production build and its TypeScript check passed.
- Real Google login from `http://127.0.0.1:3000/login` reached the account chooser, then returned to the authenticated dashboard on the same host. Reload retained the signed-in session.
- This browser check used an existing account. It does not claim a new-account creation, email-delivery or public-domain verification.
- Local evidence: `.local/oauth-regression-tests.log`, `.local/oauth-build.log`, `.local/google-oauth-callback-fixed.png`, `.local/supabase-oauth-return-urls-fixed.png`, `.local/google-login-success.png`. These files are excluded from the release archive.

References: [Supabase Google setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [Supabase return URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).
