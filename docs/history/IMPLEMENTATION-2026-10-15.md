# Reliability and workflow implementation — 15 October 2026

This report records the first reliability pass. The subsequent comparison-meaning
and Discover expansion is documented in `IMPLEMENTATION-2026-10-16.md`.

This is the implementation follow-up to audit-2026-10-15/MASTER-PLAN.md. The audit
is a historical snapshot; this file describes subsequent code changes. It does
not claim that every external service has been verified. After explicit owner
approval, the existing unlaunched Supabase project was used for disposable tests
and updated through migration00008.

Final local verification and source packaging: 16 October 2026. The hosted
workflow run completed on 15 October 2026 UTC; its timestamp is retained in the
verification record.

## What changed

| Area | Behavior now implemented | Regression evidence |
|---|---|---|
| Preference identity | Whole-token/phrase matching preserves negation and meaningful variants; tea no longer matches steak/team/tea-free. Category guessing also uses word boundaries. Neutral evidence cannot become a positive taste reason. | regressions.test.ts, comparison-input.test.ts |
| Forgetting | New migration retires existing same-category label aliases, removes projections/checks, preserves suppression and invalidates old generations. Historical forgotten aliases are repaired. | privacy-boundaries.test.ts, database.test.ts |
| Account deletion | Owned analytics cascade; historical orphan analytics are removed during migration. Fresh deletion proof is verified against the requesting token's subject/session and authentication-method timestamps, rather than the account-wide last-sign-in time. | privacy-boundaries.test.ts, account-deletion-session.test.ts |
| Comparison retries | Client synchronous guards prevent repeated submits; stable request UUID + private owner-scoped SQL ledger returns the original comparison for the same raw intent. Changed intent conflicts; parent deletion cascades request records. Replays return persisted IDs/scores/status and preserve selected choice in the UI. | privacy-boundaries.test.ts, app-accessibility.test.ts |
| Input boundaries | Comparison options/title/context/category/request ID, refresh inputs, onboarding profile/answers and push subscriptions have runtime checks. Push saves use only allowed columns and verified ownership. Onboarding shows validation errors before submitting. | comparison-input.test.ts, serialized-inputs.test.ts |
| Decision scope | Explicit English crisis, urgent symptoms, treatment/dose changes, allergy exposure, essential-money risk and legal commitments receive support/professional guidance rather than rankings. The guard also applies when refreshing/adding an option. This conservative pattern guard does not recognize every unsafe request. | decision-scope.test.ts |
| AI adapters | Shared prompts/decoders validate Anthropic and compatible providers consistently. A shared AbortSignal deadline reaches requests and prevents canceled fallbacks; timers/listeners are cleaned. | ai-boundaries.test.ts, nvidia-ai.test.ts |
| Explanation grounding | Saved comparisons no longer send current global likes as historical scoring evidence. The prompt explicitly acknowledges absent personal evidence. A scoring-attempt marker prevents equal numeric scores from attaching another revision's reasons after retries or concurrent refreshes. Full revision evidence snapshots remain open. | comparison-evidence.test.ts, ai-boundaries.test.ts |
| Recaps | Query uses decision time, labels the latest-100 sample when applicable, handles query/transport failure, and distinguishes AI off, unavailable, quota, timeout and insufficient data. | provider and UI regression checks; hosted recap remains a staging gate |
| Analytics | Calendar day/weekday use the profile IANA timezone, with deterministic UTC fallback. Copy accurately says mood/budget/company are journal context rather than ranking constraints. | calendar.test.ts |
| Poll results | Closed polls distinguish no votes, multiple tied leaders and one unique winner. | app-accessibility.test.ts |
| Accessibility/recovery | Persistent input labels, selected chip announcements, native keyboard rating radios, relative-fit explanation and retryable suggestion errors. | app-accessibility.test.ts, existing feature UI tests; native radio arrows also checked in Chrome |
| Extracted memories | Search and deterministic owner-scoped paging reach beyond the former20 entries. Save/edit/cancel retains the latest successful baseline and failed drafts. Explicit optional notes intake is available after AI opt-in/current terms and uses consent/quota/deadline/generation guards. Notes are not hard eligibility constraints. | profile-memories.test.ts, app-accessibility.test.ts |
| Hosted Discover | The existing database retained an obsolete11-argument public signal function alongside the guarded12-argument function. This made answers fail with PostgreSQL42725. Migration00008 removes the obsolete overload without CASCADE. | legacy-signal-contract.test.ts; disposable hosted answer verification |
| Profile persistence | Saves require the returned owner-scoped row, display canonical saved values immediately, and keep controlled drafts after errors. The next edit/cancel uses the latest successful baseline. | app-accessibility.test.ts; authenticated browser regression |
| Hydration | Belief dates use an explicit locale and account timezone. Reminder dates start deterministically and then use the device zone. Server/browser locale differences no longer produce conflicting initial text. | calendar.test.ts, hydration regression in app-accessibility.test.ts |
| Push delivery | New service-only ledger records notification/device identity, five-minute lease/fencing token, bounded retries/backoff, expiry and cleanup. Worker sends25 per batch with at most5 concurrent10s attempts; seven-day unread backlog is recoverable. | push-delivery.test.ts, push-worker.test.ts, checkins-auth.test.ts |
| Database permissions | Explicit authenticated API/service-job allowlists replace inherited PUBLIC execution. Future migration-owner functions start closed. | privacy-boundaries.test.ts |
| Release workflow | Public/authenticated browser commands, portable origin, explicit production server, non-skippable credential preflight for auth release checks, read-only SQL consistency checks, CI and pinned Node version. | public browser run and SQL generation tests; CI itself requires a GitHub repository run |
| Packaging | Allowlisted ZIP creation rejects private env/state/nested archives/recognized secret formats, traversal, symlinks, duplicates and empty/malformed/corrupt archives. Independent final-byte inspection is mandatory. Explicit icon metadata uses the owned public icon. | release-archive.test.ts and generated archive checks |

## Database rollout and hosted verification

Migrations00006–00008 were applied to the existing unlaunched project after owner
approval. Both new private ledgers have RLS enabled. Read-only hosted checks
confirmed the version markers, restricted RPC permissions, analytics cascade and
absence of the obsolete Discover overload. Proof is saved in
audit-2026-10-15/hosted-database-verification.png.

Before applying the changes, the affected tables were saved in a private ignored
workspace snapshot; the original obsolete function definition was also exported.
Preflight found no orphan analytics, active forgotten aliases, preference rows or
pending checks to remove. The repair added one forgotten-key tombstone and
advanced one profile's memory generation. Existing journal decisions were retained.

For another installation, back up and rehearse on an isolated copy first:

1. Apply missing migrations through00008 in order. Existing matching installations
   can use sql/02_UPDATE_EXISTING.sql, then sql/03_VERIFY_DATABASE.sql. Fresh empty
   databases can use sql/01_FRESH_DATABASE.sql. Never replay the baseline on an
   existing journal.
2. Review migration00006_privacy_boundaries.sql: it intentionally deletes analytics
   rows whose owner was previously nulled. It preserves journal decisions,
   reflections and other users' linked analytics. It also retires aliases of
   concepts the user already forgot and closes RPC permissions.
3. Migration00007_push_delivery.sql adds the private per-device delivery ledger and
   service-only claim/acknowledge RPCs. Deploy the new send-checkins Edge worker
   only after these functions exist.
4. Deploy the app after the migrations: compare creation now requires
   create_comparison_once. Missing schema must be treated as a rollout failure,
   not worked around by restoring direct table writes.
5. Verify actual hosted RPC ACLs, roles, OAuth/SMTP, session AMR claims, schedules,
   VAPID/gateway/scheduler authorization and real-device delivery.
6. Migration00008 removes the pre-generation public signal overload found on the
   hosted project. It leaves the guarded function and existing journal data in
   place. Unexpected dependent objects stop the upgrade for review.

Migration files00001–00005 were not edited. The standalone fresh/update/setup SQL
was regenerated. The version-marker upgrade script is tested as a no-op when
already current; individual migrations are still applied once.

Privacy repair and cascades are intentional data changes. A code-only rollback
does not undo them. Prefer a compatible forward fix; retain backups privately and
replay erasures before making a restored database available. Do not re-enable
anonymous RPC execution or old direct writes as a rollback shortcut.

## Verification

Current raw test results are in audit-2026-10-15/implementation-tests.txt.
The original findings are tracked separately in
audit-2026-10-15/remediation-status.csv. Focused privacy, AI, UI, retry, push,
calendar and packaging regressions use synthetic data and mocked external
services. The final Node24.19.0 run passed all189 tests across45 suites, with no
failures or skips. Typecheck, generated SQL consistency and the production build
passed. The dependency audit reported zero advisories in the installed graph.

All3 public Chrome scenarios and both authenticated Chrome scenarios passed.
Public checks include icon metadata and the actual PNG response. Authenticated
checks use the live Supabase project with newly created disposable accounts and
the local production app; this is not evidence of a deployed app or worker.
Eleven hosted workflow checks passed, including analytics removal after actual
self-account deletion, and cleanup of both generated accounts was verified.

The preservation comparison confirms the original two profiles and four decisions
remain. Existing knowledge, verification-queue and preference rows are unchanged.
The approved repair added one forgotten-key tombstone and advanced one profile's
memory-generation counter (and its update timestamp).

The staging isolation suite covers project mismatch, fixture separation and
inherited-secret suppression. Authenticated/staging checks stop before making
requests when their configuration is absent. The final runtime, browser, hosted
and archive results are in audit-2026-10-15/implementation-verification.json.

Run:

~~~sh
npm run typecheck
npm test
npm run sql:check
npm run build
npm run test:e2e:public
npm run release:package
npm run release:archive-check
~~~

Use Node24.19.0 from .node-version. The machine default is Node24.14.0, so final
validation used an isolated workspace Node24.19.0 executable checked against
the official release SHA-256 manifest. The system installation was not changed.
CI clean install on the pinned supported version remains an additional check.

Public browser tests default to http://127.0.0.1:3117 and can use
PLAYWRIGHT_CHROMIUM_EXECUTABLE. Set NUDGE_E2E_SKIP_BUILD=1 only after a current build.
For an already running staging server set NUDGE_E2E_EXTERNAL=1 and
NUDGE_E2E_BASE_URL. Never use real user accounts for browser writes.

npm run test:e2e:auth requires dedicated NUDGE_E2E credentials/storage state and a
separate initially empty NUDGE_DASHBOARD_TEST account. Missing configuration fails
instead of treating skipped account tests as success. Deletion tests retain their
additional disposable-account ID/explicit-delete flag.

For a separate staging project, use
staging.env.example → private .env.staging.local and npm run test:e2e:staging.
The project-reference/URL guard prevents accidental target mismatch, rejects the
normal .env.local project as staging and refuses a service-role key in the
browser configuration. Key-shape checks do not authenticate the key.
The command builds/runs the local app against that project with AI/enrichment,
admin deletion keys, inherited storage state and destructive deletion disabled.
Staging credentials are never fabricated or copied from the normal project.

For this session, the owner explicitly authorized the existing unlaunched
database and approved the schema updates. The guarded
scripts/verify-hosted-disposable.mjs command creates two new confirmed test
accounts, exercises owned API workflows, and deletes only accounts created by
that run. Its private cleanup journal preserves returned IDs if cleanup fails.
It requires NUDGE_ALLOW_HOSTED_DISPOSABLE_TESTS=1 plus the exact authorized
NUDGE_E2E_TARGET_PROJECT_REF, with keys kept in local configuration. Add --browser
after a current build to run the authenticated scenarios. AI/enrichment calls
stay disabled. The browser deletion branch is bound to the generated account ID.
Host/API results are saved in audit-2026-10-15/hosted-disposable-verification.json.
The additional hosted findings and execution details are in
audit-2026-10-15/hosted-follow-up.md.

npm run release:verify also requires real operator/privacy/deployment facts and
an explicit authenticated fixture run. It is expected to fail until those release
inputs are supplied. The
public CI workflow contains synthetic public configuration only and does not
deploy. Configure real branch/deployment protection in the repository/host.

## Remaining boundaries

- New release packaging does not revoke private credentials from previously
  shared archives. Distribution/rotation status still needs owner verification.
- Hosted Auth/PostgREST and disposable test-account creation/cleanup were
  exercised with approval. Live email, OAuth, paid model, real push delivery and
  deployment remain unverified. This task has not deployed the Next app or Edge
  worker; the database schema update is complete.
- Web Push cannot guarantee exactly-once delivery if the worker crashes after
  provider acceptance but before database acknowledgement. Leases recover it
  with a possible repeat; tests cover this window. The scheduler must drain
  bounded batches sufficiently often and alert on job failures.
- Physical AI-call/token/monetary metering, paid-enrichment budgets, evidence
  snapshots for explanations, stronger CSP, full input validation, production
  observability, legal/provider facts and the full safety/model evaluation remain
  roadmap work. Existing logical AI quotas are preserved, not claimed to be
  monetary caps.
- Context/AI memories do not enforce allergy, health, financial or other hard
  suitability constraints. The UI now explains this boundary; do not market a
  preference scorer as professional advice.
- Automated public accessibility checks and component regressions do not establish
  full WCAG conformance or complete authenticated cross-browser/device coverage.
- Native mobile work follows stable public-web release and backend contracts.

This batch substantially improves existing workflows; it does not guarantee an
error-free product or declare all33 original findings closed.
