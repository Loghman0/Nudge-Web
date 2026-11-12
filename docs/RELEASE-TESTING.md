# Deployed web demo verification — 7 November 2026

The self-discovery web demo is deployed at **https://projectnudge.vercel.app**, deployment `dpl_41hNvnxcQ6VgpfsofrfqS9GqYHJT`. Native mobile work has not started. The current database has migrations through `00019`; this finishing pass adds no migration. The public-launch configuration flag remains off while the previously deferred operator and retention configuration is unresolved. The deployed demo is publicly accessible; that flag is not access control.

## Changes in this pass

- Restored access to journal, check-ins, outcome patterns, circles and optional starter preferences from About you. Mobile Today now exposes check-ins in its header while retaining three primary tabs.
- Restored owner-scoped earlier-pattern review instead of passing an empty insight permanently. Manual corrections, contextual aliases and discovery evidence are excluded from this legacy inferred-like prompt; rejecting a pattern does not infer its opposite. Mutations invalidate the actual review route.
- Updated authenticated browser journeys for the current self-discovery UI and export v6. Added safe explicit deployed-origin support to the disposable runners; provider keys stay isolated from normal tests. Screenshots and reports stay under `.local/`.
- Verified confirmation and password-reset emails using an explicitly approved owner Gmail test alias. Signup confirmation established a new session on `/onboarding`; a fresh recovery link opened `/update-password`. No replacement password was submitted. Only the test messages were inspected; the exact newly created account was removed and its absence verified.
- Confirmed in the hosted dashboard that custom SMTP is disabled. The owner chose Google signup for the demo. Production sets `NEXT_PUBLIC_EMAIL_SIGNUP_ENABLED=false`: signup shows Google and its server action refuses email creation before contacting Supabase. Existing email login and recovery remain available. Restricted-sender and email-rate-limit errors now provide useful next steps without returning raw provider details.
- Checked real Google sign-in on the final deployment: the existing identity returned through the callback, refresh retained the session and loaded Today, and sign-out completed. This verifies an existing authorized identity, not a second brand-new Google registration. The signup page, public assets/policies and Search Console ownership proof also passed an 11-route HTTP smoke check.

## Evidence and interpretation

The final Google-signup deployment passed **8 authenticated browser scenarios**, followed by **3 discovery/reliability scenarios** and **4 public scenarios**, with no skips and cleanup verified. The preview is exercised within the discovery suite; an earlier public run also included it as a fifth scenario. The reliability journey intentionally runs in both disposable suites. Coverage includes preview/draft/save, daily questions and topic changes, reflection corrections, criteria provenance, arbitrary/Unicode labels, comparison resume/copy/back navigation, lost-response retry without duplicate creation, circles/voting/ties, journal/reflection/check-ins, exports, privacy reset and account deletion. Light/dark, keyboard, widths 320–1440 and axe checks passed on the exercised screens.

The final source suite passed **735 tests in 111 suites, with zero failures or skips**; 33 focused authentication/foundation checks also passed. The backend-only run passed **17 check groups**, including ownership, permissions, revisions, reviewed-memory privacy and durable AI-accounting contracts. AI calls were synthetic or off. Production build/TypeScript, generated SQL consistency and the production-dependency audit passed; the audit reported zero vulnerabilities. The source archive is allowlisted and inspected for private configuration.

Earlier failed runs are retained. One local run failed a criterion-retention assertion; checks were added before and immediately after Back, then the isolated journey and full live runs passed. No app-state repair is attributed to that unreproduced failure. Another live run matched a hidden duplicate label during navigation; selecting the visible main-page control resolved it. Neither failure was silently counted as a pass.

Local evidence: `.local/evidence/2026-11-07-web-finish/`, `.local/web-finish-*.log`. Final result and deployment details are recorded there. These private test artifacts do not ship in the source archive.

Live navigation samples from the final deployed origin: first visits to Decide/Journal/About you/Today were 705/961/898/88 ms; repeats were 103/89/134/103 ms. This small diagnostic includes automation overhead and is not a population benchmark or a before/after improvement claim.

## Reproducing deployed checks

Use the bundled/supported Node version, an installed Chromium and the existing private project configuration. The target must be explicitly authorized before creating fixtures:

```powershell
$env:NUDGE_ALLOW_HOSTED_DISPOSABLE_TESTS='1'
$env:NUDGE_E2E_TARGET_PROJECT_REF='awlaxvfnibugdqqqvkac'
$env:NUDGE_E2E_EXTERNAL='1'
$env:NUDGE_E2E_BASE_URL='https://projectnudge.vercel.app'
$env:NUDGE_E2E_AUTHORIZED_ORIGIN='https://projectnudge.vercel.app'
$env:NEXT_PUBLIC_EMAIL_SIGNUP_ENABLED='false'
$env:NUDGE_E2E_SCREENSHOT_DIR='.local/evidence/web-check'
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE='C:/Program Files/Google/Chrome/Application/chrome.exe'
node scripts/verify-hosted-disposable.mjs --browser --reliability
node scripts/verify-discovery-disposable.mjs
node scripts/run-e2e.mjs public
```

Run the browser commands sequentially because they share the Playwright artifact directory. External disposable runners require matching HTTPS origins without credentials, paths, queries or fragments. Omitting `NUDGE_E2E_EXTERNAL=1` uses an owned local production server. Do not remove an interrupted fixture recovery journal to get past its guard; use the matching cleanup path after checking its recorded project/account scope. The scripts only delete newly created disposable fixtures.

## Remaining service and research boundaries

Public email signup is intentionally deferred. Before enabling it, configure custom SMTP in Supabase, verify the sender, test delivery to an authorized inbox outside the project team, then set `NEXT_PUBLIC_EMAIL_SIGNUP_ENABLED=true` and rebuild/redeploy. The built-in sender restricts recipients and volume; see [Supabase's SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp). Google OAuth works, but brand verification is still pending and the chooser may show the Supabase domain. See [Google setup and evidence](GOOGLE-SIGN-IN.md).

The demo has no deployed AI provider keys. Real-device push delivery, independent psychological review, user-pilot metrics and publication of a large generated bank remain separate work. These checks validate the exercised web flows; they do not establish clinical validity, universal correctness or future provider availability. See [launch configuration](LAUNCH.md) for the owner's deferred operational details.

---

# Historical reliability verification — 28–29 October 2026

Current source: **678 tests passed with no skips**, TypeScript, production build and SQL consistency passed. **8 authenticated scenarios passed in both production and Turbopack development mode**, with **20 hosted check groups** and disposable cleanup verified for each run. The **4 public scenarios** also passed after the theme repair. Added coverage follows the criteria-copy link, returns through unfinished drafts, preserves Unicode/private/prototype-like labels and their details across React transport, corrects duplicate option names, loses a committed save response and verifies exactly one comparison after retry, then erases learned memory without stale UI and deletes fixture history. The final duplicate-name repair is covered by the source suite and final production browser pass; the development run preceded it.

See [the reliability report](IMPLEMENTATION-2026-10-28-RELIABILITY.md) and `.local/evidence/2026-10-28-reliability/`. Live NVIDIA verification is separate: five of six revised synthetic operations completed; one used the safe manual fallback and succeeded on an isolated retry. Do not describe this as perfect provider availability or verified semantic accuracy.

Set `NUDGE_E2E_SERVER_MODE=development` for the Turbopack browser pass. The default remains a production server. All normal browser fixtures keep AI off and provider keys isolated.

# Previous UI and navigation verification — 27 October 2026

Final results: **667 tests passed with no skips**, TypeScript and production build passed, SQL bundles are current, **7 authenticated browser scenarios** and **4 public browser scenarios** passed, and **20 hosted check groups** passed. All three final-run disposable accounts were removed. Light/dark, mobile, keyboard and axe checks passed on the tested screens. The source archive contains 364 inspected entries.

Final local click-to-content samples: Ask 753 ms, Journal 515 ms and Discover 1,082 ms on the first pass; repeat visits were 178 ms, 153 ms and 269 ms respectively. These six samples include automation overhead and background test load; they do not establish a universal latency guarantee or a before/after improvement percentage.

See [the current implementation report](IMPLEMENTATION-2026-10-27-UX.md) and local evidence in `.local/evidence/2026-10-27-ux/`. The final result manifest identifies the exact checks and package for this batch. Browser tests use the production build and dedicated disposable accounts; AI remains off in these fixtures. Public launch remains off.

All scripts are run from the project root. Browser artifacts now default to `.local/test-results/`. Historical evidence was moved under `.local/evidence/`; historical reports below describe their original source snapshots.

# Historical development completion — 26 October 2026

See [IMPLEMENTATION-2026-10-26-COMPLETION.md](history/IMPLEMENTATION-2026-10-26-COMPLETION.md)
for the shared comparison/reminder APIs, save/form fixes, current NVIDIA routing,
post-response consent checks and final evidence. The full source suite passed
658 tests without skips, TypeScript, Next.js 16.4.3 production build and SQL
consistency. The 136-case AI corpus is synthetic; it does not measure live model
accuracy. Final browser and packaging results are recorded in that report.

Final current-source results also include 20 hosted check groups, 6 authenticated
and 3 public Chromium scenarios. The original aggregate counts remain 2 profiles,
6 decisions and 0 AI memories after cleanup. The source archive has 341 inspected
entries. Live NVIDIA quality remains unverified because its private key is missing.

`npm run dev:check` permits manual development with optional AI unavailable and
requires public launch off. `npm run dev:check -- --require-ai` adds strict provider
and accounting configuration checks. Neither makes a provider call. Operator and
public hosting fields remain part of `release:check`, which was intentionally
deferred with the owner. NVIDIA setup is in
[NVIDIA-DEVELOPMENT.md](NVIDIA-DEVELOPMENT.md).

The sections below preserve historical results for their original source snapshots.

## Choice and Discover workflow batch — 25 October 2026

The current source includes the shared choice service/API, optional reward
failure isolation and honest Discover pattern correction. No migration beyond
00014 is required. See
[IMPLEMENTATION-2026-10-25-WORKFLOW.md](history/IMPLEMENTATION-2026-10-25-WORKFLOW.md)
for current verification. The foundation results below describe the preceding
source snapshot; its tested features remain in the full regression suite.

Current integrated results: **443 automated tests**, TypeScript, production build
and SQL consistency passed. All **20 hosted checks** and **4 authenticated browser
scenarios** passed, including real choice API bearer isolation/retries and
Discover neutral corrections. Three disposable accounts were removed and the
original aggregate database counts were verified. Public browser and archive
results are recorded in the workflow report.

## Foundation and reviewed-memory batch — 25 October 2026

The current source targets migrations **00012–00014**, on top of the prior schema
through 00011. See
[IMPLEMENTATION-2026-10-25-FOUNDATION.md](history/IMPLEMENTATION-2026-10-25-FOUNDATION.md)
for exact question wording, neutral-answer semantics, the explicit AI draft/review
flow, migration requirements and the final integration status table.

The final full suite passed **413 tests**, with no failures or skips. TypeScript,
the production build and generated SQL checks passed. Migrations 00012–00014 are
applied to the authorized unlaunched project, including the hosted conflict-code
repair. All **20 hosted checks** and **4 authenticated browser scenarios** passed;
all three disposable fixtures were removed, leaving the original 2 profiles,
6 decisions and 0 AI memories. Public browser and final archive results are
recorded in the implementation report. Hosted memory checks used synthetic
statements and made no provider calls.

Authenticated release checks now require three distinct disposable accounts:
the normal comparison fixture, an onboarded empty-dashboard fixture, and a fresh
foundation fixture in `NUDGE_FOUNDATION_TEST_EMAIL` /
`NUDGE_FOUNDATION_TEST_PASSWORD`. The fresh account must have no onboarding,
answers, preferences or decisions. Its browser scenario checks no pre-review
writes, all six contextual questions, honest neutral answers, review edits and
mobile accessibility/overflow. Skips do not count as release verification.

Live configured-provider extraction, real-device push, production email/OAuth
and public deployment still need their own evidence. The web app and release
gates precede a native mobile implementation using shared protected services.

---

> Historical evidence below describes earlier snapshots. The comparison-context
> batch is recorded in [IMPLEMENTATION-2026-10-24-COMPARISONS.md](history/IMPLEMENTATION-2026-10-24-COMPARISONS.md).
> Earlier authenticated results do not verify the current source or migrations 00012–00014.

# Hindsight landing verification, 2026-10-13

Current landing update: `npm run verify` passed (typecheck, 110 tests, production build). Browser regression: 3 passed, 2 skipped because authenticated/deletion fixtures were deliberately not supplied for this landing-only task. Axe checks found zero violations in tested light/dark/mobile/desktop/menu states. Dependency audit recorded zero known advisories. Mobile/desktop Lighthouse LCP: 2.72s / 0.43s; CLS: 0 / 0; local interaction Event Timing maximum: 48ms (not field INP). Mobile LCP is 0.22s above the requested target. See `Nudge-Landing-Report.md` and `evidence/landing/` for details and measurements.

Authenticated app/API/auth/SQL source stays unchanged; a comparison verified 93 protected files. Root layout only disables two existing font preload hints; font families and app styles stay intact. No new SQL is required. The public checker remains blocked by the operator/deployment facts you chose to fill later, and public indexing remains disabled.

The earlier app-wide test evidence and its boundaries follow; authenticated scenarios below belong to that previous release and were not rerun in this landing-only change.

---

# Release testing and fixes

Verified with Node 24.19.0 and Next.js 15.5.27. The app was started locally with Turbopack and exercised in headless Chromium using disposable accounts against the supplied Supabase project. No other users' records were used as test fixtures. New SQL behavior was also tested in isolated PostgreSQL/PGlite databases with anonymous, authenticated and service roles.

## Results

- TypeScript: passed.
- Automated unit/SQL/interaction tests: 107 passed, none failed or skipped.
- Production build: passed.
- Dependency security audit: zero known vulnerabilities after updating the pinned Next.js patch, PostCSS (including Next's nested copy), image-processing dependencies and the Tailwind 4 build toolchain. The earlier lockfile reported 14 advisory entries. This is a registry advisory snapshot, not a guarantee that software has no vulnerabilities.
- Public browser scenario: passed. Homepage, public-link clipboard sharing, all six policy/support pages, light/dark theme controls and computed design tokens, mobile layout at 390px, unknown/prototype-named route returning 404, robots and generated social-preview image were exercised. The final browser run also verified that anonymous password-update requests redirect to login and prototype-named login error codes do not break rendering.
- Authenticated browser scenario: passed again after the middleware/dependency changes (2.2 minutes). Create a comparison, reload/resume it, choose an option, schedule a check-in, reflect, load analytics, export own data, edit profile details, inspect account deletion confirmation, visit check-ins, sign out/sign back in and delete the disposable account.
- Focused account-deletion browser regression on a fresh fixture: passed with no page errors. Verified the account ID before deletion and verified that protected pages return to sign-in after deletion.
- Additional local browser smoke: Discover topic selection, answering, follow-ups, skipping, continuous exploration, refresh persistence and each main app route passed.
- Existing-update SQL: tested on the current 00004 schema; retained its question count and learned preference. All read-only verification fields passed after the update. The final nine SQL regression tests also passed after the circle lock-order and legacy-owner repair changes. Re-running the update twice on the current schema preserved existing answers. Fresh setup rejects an existing database.
- Public configuration checker: intentionally reports the operator/contact/provider settings and HTTPS launch URL still missing. You selected **Fill them later**. This is a deployment blocker, not a functional test failure.

## Reproduced and fixed

1. **Discover failed to compile in Turbopack.** A type re-export in a `use server` module was accepted by the earlier production build but rejected in development. Types now live in their own module without that action-module re-export.
2. **Choosing a saved option failed.** `decision_options → decisions` had two possible relationships. The server query now explicitly identifies the `decision_id` foreign key; real PostgREST/browser testing confirmed the fix.
3. **Daily completion happened too early.** Onboarding answers and skips no longer complete the daily Discover target in 00005. Continuous exploration stays opted in until paused. Skips do not create beliefs or unlock branches.
4. **Deleted sessions could render an empty/error private page.** Authenticated layouts now check that the caller's profile still exists. Login verifies an existing identity before redirecting away, clearing deleted-user cookies even when an old access token's signature is still valid.
5. **A login form hydration mismatch occurred.** Destination fields no longer place a Suspense boundary inside server-action form markup. Their initial markup is stable, and the local return path is read after hydration.
6. **Shared destinations were lost during sign-in.** Login, signup links, OAuth callbacks and the terms flow preserve a validated local destination, including an invitation query. External return URLs are rejected.
7. **Writes could fail silently or leave partial circles/polls.** Circle writes use atomic SQL functions, validate membership and distinct options, serialize voting/closure, remove departing members' votes, and show actionable errors. Owners can rotate invite codes and delete circles. Missing legacy owner memberships are repaired, and circle/vote operations use a consistent group-then-poll lock order.
8. **Profile/history/check-in failures could appear to succeed or look like an empty account.** Failed reads/writes are surfaced for retry. Reflection errors remain visible. History deletion also removes its stale notification links in 00005.
9. **Optional AI was automatic and limits were only per process.** It now defaults off per account, requires an explicit opt-in/current terms, and uses database quotas across instances. Disabling it invalidates older extraction generations.
10. **Public notices and data controls were incomplete.** Added privacy, terms, cookies/storage, support, security and accessibility pages; links from landing/auth/app layouts; eligibility and terms records; expanded own-data export; verified self-account deletion; metadata/social sharing/robots/sitemap; security headers; font/runtime notices. Replaced absolute privacy and unlimited-capacity copy with statements matching the implementation.
11. **Push delivery accepted arbitrary endpoint URLs.** Saves and Edge delivery now restrict endpoints to supported browser push hosts. A failed subscription save unsubscribes the unusable local subscription.

12. **Password-update routing and error display needed another browser regression.** The middleware entry point now lives in `src/middleware.ts`, alongside `src/app`. Password-update requests participate in session refresh and require an authenticated session. The real anonymous redirect is covered by the browser test. Login error codes only read explicit entries, and circle member/poll failures no longer appear as empty data.
13. **The lockfile contained known vulnerable packages.** Patched Next.js, PostCSS and their dependencies; replaced the old Tailwind build dependency tree using the v4 PostCSS plugin and kept the existing theme via its explicit configuration import. Browser checks assert the card styling, theme colors and mobile layout.

## Verification boundaries

The supplied live project had the 00004 question/branch schema when inspected. The new 00005 consent, quota and circle functions require your SQL update; their permissions, ownership, transactions, retry behavior and deletion cascades passed PostgreSQL tests. Their final live PostgREST/device check is listed in `LAUNCH.md` after you run the update. No destructive schema reset or live migration was performed.

Real Google identity approval, production email delivery, NVIDIA generation using replacement keys, pg_cron/Edge scheduling and browser push delivery were not verified end to end here. No replacement AI keys, production mail inbox or configured push delivery were supplied. Mock tests cover NVIDIA model routing, fallback and structured output validation. Browser checks do not constitute a formal accessibility audit, legal certification or production load/latency benchmark.

The CSS toolchain requires Chrome 111+, Firefox 128+ or Safari 16.4+. The policies need your real operator details, contracts, regions, retention periods and transfer safeguards, plus review for the countries you serve. `NUDGE_PUBLIC_LAUNCH=true` and `npm run release:check` are configuration controls; they cannot establish those legal facts themselves.

Use `LAUNCH.md` as the current rollout guide. For this existing project, run only `02_UPDATE_EXISTING.sql`, then read-only `03_VERIFY_DATABASE.sql`; leave database tables intact.
