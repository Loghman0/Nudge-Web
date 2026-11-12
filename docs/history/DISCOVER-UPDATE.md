# Discover and login reliability update

This describes the previous batch. Follow `LAUNCH.md` for the current SQL bundle
and the public launch controls in 00005.

## Apply in this order

1. If you have only run 00001 and 00002, run `supabase/migrations/00003_memory_decisions_reminders.sql` once.
2. Then run `supabase/migrations/00004_discover_reliability.sql` once.
3. Deploy the updated source. Keep your existing Supabase URL and public key.
4. Set `NEXT_PUBLIC_SITE_URL` to the exact HTTPS address of your deployed app and rebuild. Use the same host for login, callback and normal browsing.

If 00003 is already applied, run only 00004. Do not rerun an applied migration or the complete setup file. The generated complete setup file is for fresh databases only. Existing answers and evidence are preserved.

## Discover behavior

- The daily target remains one question. After **Keep exploring**, answers and skips advance continuously until **Pause for today** or the available questions run out.
- There are 126 new, hand-written scenario questions across 18 topics. Each topic has one starter, two first-level follow-ups and four second-level follow-ups: 108 answer-dependent connections in total.
- Only the branch matching your answer unlocks. A skip creates no preference and unlocks no branch. Locked questions are not counted as ready to explore.
- Direct follow-ups come next, with a note showing the previous choice that opened them. Otherwise the queue balances breadth using the topics with fewer answers; topic tabs filter both the new trees and the older bank.
- Follow-up choices add `contextualizes` links between actually chosen beliefs. The unchosen option is never recorded as a dislike.
- Duplicate submissions are safe. An answer already saved in another tab advances the queue; failed saves keep the question and show a retryable error. Missing RPCs produce a specific migration instruction.

## Quick checks

Dislikes are described as things you prefer to avoid. **Still true** confirms the existing polarity and resets its verification date. **Not anymore** marks the belief neutral, removing it from positive/negative recommendation scoring without inventing an opposite preference. **Forget this** excludes the belief from active memory. The card stays visible if saving fails and the next queued check appears after success.

Due checks are enqueued on a Discover visit as well as through the existing scheduled job. Neutral and forgotten entries are dismissed; every operation is restricted to the signed-in owner. Pattern confirmation also waits for a successful save before hiding its card.

## Why refresh could lose login

The old middleware created a new redirect response without the refreshed session cookies. The update preserves them on both normal responses and redirects, verifies identity with `getClaims`, and prevents caching authenticated responses. The OAuth callback now attaches the exchanged session cookies directly to its redirect. Browser and server use matching root-scoped, persistent, SameSite=Lax cookies; HTTPS site URLs enable Secure cookies.

This addresses the cookie defects found in source. The hosted project still needs a login → refresh → expiry/refresh check after deployment. Existing browser cookie restrictions and Supabase session-duration settings remain outside the code package. Cookie lifetime does not override server-side session expiration.

## Show Nudge on Google's sign-in screen

This name belongs to Google Auth Platform configuration, not a React label or SQL setting. The package cannot change your Google Cloud project.

1. Open the Google Cloud project whose OAuth client ID is configured in Supabase → Authentication → Providers → Google.
2. Go to **Google Auth Platform → Branding**. Set **App name** to **Nudge**; add your support email, homepage, privacy-policy URL and owned authorized domain as required by Google.
3. Complete Google's brand verification/publishing process where required. Google's documentation says verified branding lets the consent screen show your name and logo instead of the Supabase project ID. Google controls localization, so a Turkish screen can then show the name Nudge in its continuation text.
4. Keep the exact Supabase callback URL in the OAuth client's Authorized redirect URIs. Keep the deployed app origin in Authorized JavaScript origins, and the app's `/auth/callback` URL in Supabase's redirect allowlist.
5. If Google still displays the authentication host in a domain-specific prompt, Supabase's custom auth domain is the separate option for changing that host; it is not needed to set the application name.

Official setup: https://supabase.com/docs/guides/auth/social-login/auth-google
SSR guidance: https://supabase.com/docs/guides/auth/server-side/creating-a-client

## Enable the four NVIDIA models

The keys pasted into chat should be rotated. Add the replacement values to your hosting provider's **server environment variables**, or to a private local `.env.local`; never use `NEXT_PUBLIC_` for them. No private key is included in this package.

```dotenv
AI_PROVIDER=nvidia
NVIDIA_SUPER_API_KEY=<replacement key for Nemotron Super>
NVIDIA_ULTRA_API_KEY=<replacement key for Nemotron Ultra>
NVIDIA_GPT_OSS_API_KEY=<replacement key for GPT-OSS>
NVIDIA_GEMMA_API_KEY=<replacement key for Gemma>
NVIDIA_PARSING_MODEL=gpt_oss
NVIDIA_EXTRACTION_MODEL=gemma
NVIDIA_REASONING_MODEL=ultra
NVIDIA_SUMMARY_MODEL=super
```

A shared `NVIDIA_API_KEY` can be used instead; a per-model key takes precedence. Model settings accept the slot name above or its full model ID. Restart/redeploy after changing environment variables.

| Task | Default model ID |
| --- | --- |
| Parse decision questions | `openai/gpt-oss-20b` |
| Extract preferences and memories | `google/gemma-4-31b-it` |
| Explain ranked recommendations | `nvidia/nemotron-3-ultra-550b-a55b` |
| Summarize the month | `nvidia/nemotron-3-super-120b-a12b` |

All use NVIDIA's official `https://integrate.api.nvidia.com/v1` endpoint. Each call allows at most two configured models, with an eight-second timeout per attempt. Nemotron reasoning traces are disabled for these short language tasks; GPT-OSS has a larger token allowance. Empty answers, transport/provider errors and invalid structured JSON can trigger the fallback. Extracted values are validated and capped before persistence. Recommendations continue to use Nudge's deterministic scoring engine; AI writes do not override explicit corrections or forgetting. With no configured key, the app keeps its deterministic behavior.

Model availability and account quota still need a live check using your replacement keys. Mock provider tests verify routing and error handling without consuming your quota.

Official model pages:
- https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b
- https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b
- https://build.nvidia.com/openai/gpt-oss-20b
- https://build.nvidia.com/google/gemma-4-31b-it

## Verification

Regression coverage includes the reported finance question, two-level branching, skips, topic isolation, actual graph edges, queue ownership/retries/stale beliefs, continuous UI answers and retries, cookie-preserving redirects and OAuth exchange, and all four NVIDIA model routes with fallback/schema validation. SQL tests run the full migration chain using PGlite with auth roles; UI tests use React DOM in an isolated jsdom browser. These tests do not replace hosted Supabase, OAuth or real-provider verification.

Question-bank source: `data/discover-trees.txt`. Before first deployment, regenerate its migration section with `node scripts/build-discover-bank.mjs`, then the fresh setup with `node scripts/build-setup.mjs`. Once 00004 has been applied, add future question-bank editions in a new migration rather than modifying it.
