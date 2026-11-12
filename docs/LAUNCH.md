# Nudge public launch

The web demo is deployed at `https://projectnudge.vercel.app` with public notices and privacy controls. The existing database has migrations through `00019`. The public-launch configuration flag remains off because operator and retention details were deferred. This document describes the remaining public-launch configuration; it is not evidence that every feature or operational requirement has been validated.

## 1. Keep the correct SQL files

For your **existing Nudge project**, back up the database, then run:

1. `sql/02_UPDATE_EXISTING.sql`
2. `sql/03_VERIFY_DATABASE.sql` — read-only; every result should be true.

The update detects missing updates 00002–00019 and applies them in order inside a transaction. It never replays the baseline or deletes journal decisions/reflections. Migration 00006 intentionally removes orphan analytics that no longer have an attributable owner, repairs forgotten aliases and adds durable creation request identities. Migration 00007 adds durable push delivery. Migration 00008 removes the obsolete public signal overload that caused a hosted Discover ambiguity error. Migration 00010 adds server-enforced AI accounting; 00011 adds private saved comparison explanations/settings and purges them when memory privacy changes. Migration 00012 adds six contextual starter questions and honest neutral answers; 00013 requires explicit reviewed-memory confirmation, adds reviewed_at provenance and revokes the older automatic-memory-save RPC for clients. Migration 00014 returns obsolete memory reviews as HTTP 409 to avoid serialization retries. Back up, review and rehearse these changes on an isolated copy first. Re-running the generated update is tested as a no-op on the matching current schema. Unexpected older/incomplete schemas fail with a diagnostic instead of being reset. Source tests do not establish which migrations your hosted database currently has.

You may remove old **saved SQL-editor queries** after keeping these two files. Removing query tabs does not remove database objects. **Do not delete tables, schemas or migrations already applied to the database.** Do not run the fresh-setup file on this project.

`sql/01_FRESH_DATABASE.sql` is only for a new empty Supabase project. It includes the complete setup and rejects an existing Nudge schema. The source migration history stays in the package for audit and future development; it is not an additional SQL-editor step.

Regenerate standalone SQL after a source migration changes: `npm run sql:release` and `node scripts/build-setup.mjs`. Never edit an already-applied migration for a future release; add the next one instead.

Migrations `00015`–`00019` add self-discovery storage and catalog versions,
privacy controls, accepted criterion provenance and revised starter questions.
The generated scripts are checked against this complete source history.

## 2. Fill real deployment details

Copy `.env.example` privately and set the public Supabase URL/key and exact deployed HTTPS app URL. Set the **server-only** `SUPABASE_SERVICE_ROLE_KEY` for self-service account deletion. Never add `NEXT_PUBLIC_` to a private key. Restrict hosting dashboard access and rotate previously exposed private credentials.

Fill these values accurately:

| Variable | Required value |
| --- | --- |
| `NUDGE_OPERATOR_NAME` | Legal name of the person/entity operating Nudge |
| `NUDGE_OPERATOR_COUNTRY` | Operator jurisdiction |
| `NUDGE_OPERATOR_ADDRESS` | Valid public operator/contact postal address |
| `NUDGE_CONTACT_EMAIL` | Monitored support/privacy email |
| `NUDGE_HOSTING_PROVIDER` | Actual application host |
| `NUDGE_DATA_REGION` | Actual Supabase database region |
| `NUDGE_TRANSFER_SAFEGUARDS` | Verified description of applicable international-transfer arrangements |
| `NUDGE_BACKUP_RETENTION_DAYS` | Actual backup retention; `0` only if there are no backups |
| `NUDGE_LOG_RETENTION_DAYS` | Actual operational/security log retention |

If configuring AI, also fill `NUDGE_AI_VENDOR` and `NUDGE_AI_PRIVACY_URL`, check the provider's data processing/retention/training settings, and use replacement server-side keys. NVIDIA setup remains in `DISCOVER-UPDATE.md`. AI starts off per account; enabling it requires recorded current terms. The database caps AI feature jobs at 30 explanations per ten-minute bucket, five recaps/hour and ten extraction jobs/hour per user, with 1,000 accepted feature jobs/hour across the deployment. An extraction job or provider fallback can contain multiple model requests. Counters older than 48 hours are purged when later requests occur.

Signup now invites a short optional foundation before the first comparison, with
a visible exit to compare immediately. Starter answers are reviewed before save;
neutral or skipped answers never become a preference for one side. Setup makes no
AI request. Profile **Suggest memories** creates a temporary draft only. Durable
storage requires selection, editing if needed, and explicit review confirmation;
confirmation makes no additional provider request. Test this with AI off as well
as with verified optional AI configuration. See
`IMPLEMENTATION-2026-10-25-FOUNDATION.md` for the question rationale, migrations
and current evidence rather than relying on earlier first-decision-only reports.

Keep `NUDGE_PUBLIC_LAUNCH=false` while configuring. It disables indexing and treats notices as previews; it is **not** an access-control substitute for a private hosting preview. When ready, set it to `true`, run `npm run release:check`, rebuild and redeploy. Public mode requires operator settings and HTTPS, indexes only public pages, and asks signed-in users to accept the current terms before using the authenticated UI.

## 3. Complete service configuration

- Controlled-inbox signup confirmation and password-reset delivery passed on the deployed host on 7 November. The confirmation link established a new session; the recovery link opened the authenticated password form. Custom SMTP is still disabled in the hosted dashboard. Supabase's built-in sender restricts recipients to project-team addresses and currently allows two messages per hour across the project; a successful owner-alias check does not establish unrestricted signup. The owner chose Google signup for the demo, with `NEXT_PUBLIC_EMAIL_SIGNUP_ENABLED=false` in production. Configure a real SMTP sender before inviting arbitrary email signups, then set this flag to `true` and rebuild/redeploy. Keep email confirmation enabled, review abuse/rate limits and retest using a dedicated permitted inbox. See [Supabase SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp).
- Supabase's Site URL and exact deployed callback allowlist are configured. Real Google identity sign-in has passed on this host. Google branding approval remains separate; the account chooser may still display the Supabase domain. See [current OAuth evidence](GOOGLE-SIGN-IN.md).
- For push, configure VAPID and the authenticated Edge scheduler according to `PRODUCTION.md`; redeploy `send-checkins`. Verify requested notifications on supported real devices. Without push configuration, the UI clearly says push is unavailable; in-app check-ins need the database scheduler.
- Verify pg_cron jobs for confidence decay, verification queues and due reflections. Set reminders on isolated test decisions and check that prompts appear once, are dismissed after reflection, and do not survive history deletion.
- Enable HTTPS. Keep admin/provider keys server-side, limit project roles, confirm backups and a restore procedure, and monitor availability/auth/database errors without logging journal text or credentials.
- Check all deployment environment variables before build; public `NEXT_PUBLIC_` values are compiled into browser assets. Use a host supporting Next.js server actions, not a static-only upload of source files.

## 4. Legal and operational review

The new public routes are `/privacy`, `/terms`, `/cookies`, `/support`, `/security` and `/accessibility`. Notices describe the actual personal journal, shared circles, processor access, optional AI, storage, deletion and export controls. The app no longer claims that only the user can ever access data or that votes are end-to-end anonymous.

No advertising or analytics tracker is installed, so there is no artificial Accept-all tracking banner. Necessary login cookies and requested theme storage are explained. Future optional tracking needs a real refuse/withdraw choice before it runs.

Review the operator/entity, eligibility for young users, contract terms, processor agreements, retention, GDPR territorial applicability, EU/UK representation if applicable, KVKK applicability/registration and international-transfer requirements, and any additional rules in intended countries. The current English notices may need localized notices for particular markets. Check whether the scope/scale of profiling requires a DPIA. Maintain processes for rights requests, deletion from restored backups, security incidents, legally required notifications and support. These obligations cannot be completed by a code template or an environment flag.

Nudge is for users aged 16+ with guardian permission where required. It is an ordinary personal-choice journal, not a medical, legal, investment, credit, employment-selection or emergency service. Do not invite sensitive medical/financial/identity data or claim professional advice.

Confirm rights to the Nudge name and existing icons. Font licenses are included in `licenses/`; dependency notices are described in `THIRD_PARTY_NOTICES.md`. Do not invent a DPO, office address, certification or processor commitment merely to fill configuration.

Official baseline references used in preparing this implementation:
- EU transparency/privacy by default: https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/obligations_en
- Türkiye notice requirements: https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-
- Cookie/storage guidance: https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/
- Supabase user deletion/session behavior: https://supabase.com/docs/guides/auth/managing-user-data

## 5. Release validation

```sh
npm ci
npm run release:check
npm run verify
npm run sql:check
npm audit
npx playwright install chromium
npm run test:e2e:public
npm run test:e2e:auth
npm run release:package
npm run release:archive-check
```

Authenticated browser checks require three separate disposable fixtures with
current terms accepted: a comparison account with completed onboarding in
`NUDGE_E2E_EMAIL` / `NUDGE_E2E_PASSWORD` (or private `NUDGE_E2E_STORAGE_STATE`), an
onboarded empty-dashboard account in `NUDGE_DASHBOARD_TEST_EMAIL` /
`NUDGE_DASHBOARD_TEST_PASSWORD`, and a fresh account in
`NUDGE_FOUNDATION_TEST_EMAIL` / `NUDGE_FOUNDATION_TEST_PASSWORD`. The foundation
account must have no completed onboarding, answers, preferences or decisions.
Skipping its scenario is not a release pass. Do not commit credentials, session
state or private browser results. Tests create journal records and exercise
controls; ordinary browser tests stop at the account-deletion confirmation. If
using an alternate installed Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. The
supplied `NUDGE_BUNDLED_CHROMIUM=1` option is only for the optional Linux test browser.

After the SQL update, test current-term acceptance, AI off/on/withdrawal, two-member circle creation/join/vote/close/leave/delete and invitation rotation against the real deployed schema. PGlite role/RLS/transaction tests cover the new functions; they do not emulate PostgREST, independent simultaneous connections, OAuth verification, a push provider or operational legal duties. Production release also needs a real-device check, keyboard/accessibility review and provider-specific setup.

See `RELEASE-TESTING.md` for the actual checks run and remaining verification boundaries.

For the 15 October implementation batch, use `IMPLEMENTATION-2026-10-15.md`.
Migrate the database through 00014 before deploying the current app and redeploying
`send-checkins`. The new worker requires service-only delivery RPCs. Push uses
per-device delivery state, bounded leases/retries and a seven-day unread backlog;
a crash after provider acceptance but before acknowledgement can still duplicate
a send after lease recovery. The scheduler must run often enough to drain its
bounded batches. Verify actual device delivery and monitor job failures.

`npm run release:verify` runs the full release gate and refuses to substitute
skipped authenticated tests for dedicated account checks. The GitHub CI file
runs synthetic/public checks without production credentials; it does not deploy
or replace the hosted staging rehearsal. Branch protection and deployment gates
must be enabled in your actual repository/host.
