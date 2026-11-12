# Nudge shared backend and AI accounting — 24 October 2026

This follow-up implements the next backend slice after `IMPLEMENTATION-2026-10-24.md`. The web app remains the priority; native mobile feature parity follows the completed web release.

## Implemented

- Migration **00010** adds private AI attempt records and temporary anonymous daily liabilities. Server-only reservation/reconciliation RPCs enforce consent, current memory generation, per-account daily budgets and a global daily budget under PostgreSQL row locks.
- Every provider HTTP request, including a NVIDIA fallback, reserves before sending. Malformed answers still retain their reported token usage. Timeouts, missing/inconsistent usage, uncertain cache pricing and interrupted accounting keep their cost reservation. A reconciliation failure prevents fallback.
- Operator-supplied model/rate/size settings are validated. Unknown models, missing settings, oversized inputs and underquoted ceilings prevent paid requests. Costs are calculated from reported tokens at configured rates; this is a conservative application guard, not a guarantee about provider invoices. Provider-side caps remain necessary.
- All production interpretation, profile extraction, onboarding extraction and recap paths now bind their provider to verified-account accounting. There are no new model calls from reflection saves or comparison explanations.
- Account export version4 includes paginated owner-only AI usage. A pending migration is explicitly marked unavailable; other export errors fail the complete export. Privacy text describes the operational fields and opportunistic retention. No prompts, answers, API keys or raw provider errors are stored in the ledger.
- `reflection-save.ts` is shared by the existing web action and **POST /api/v1/decisions/[id]/reflection**. The endpoint supports verified cookie and bearer sessions, ownership/RLS, launch-mode terms, bounded JSON, no-store responses and stable errors. Identical retries return200/savedfalse; conflicting reflections return409.
- Native API work uncovered NextRequest's loopback hostname normalization. The fix recovers only an exact literal loopback Host with matching port; it continues to reject mismatched schemes, ports, public Host overrides and forwarded-header substitutions.

Configuration and contract details are in `AI-ACCOUNTING.md` and `API-V1.md`. No dependency was added.

## Database rollout

Migration00010 was applied to the owner-authorized existing project `awlaxvfnibugdqqqvkac` after the dashboard session was restored. Preflight showed version9 and no ledger. Postflight reports version10 and all generated database checks true. The 2 profiles and 6 decisions present before migration remained after it. The migration creates new structures; it does not rewrite journal records.

Evidence: `audit-2026-10-24/backend/migration-00010-verified.png` and the generated `sql/03_VERIFY_DATABASE.sql`. Fresh setup, incremental upgrade and rerun behavior are covered by database tests. The generated existing-upgrade script now includes00010.

## Verification

- **293 automated tests pass**, with no failures or skips, in `audit-2026-10-24/backend/unit-tests.log`.
- Production build and TypeScript validation pass, including the new API route (`backend/build.log`). SQL consistency checks pass.
- Ledger tests cover consent/generation, authenticated/anonymous denials, owner exports, reservation/idempotency, unknown liabilities, late reconciliation, overruns, rollover, retention, deletion and rollback. PGlite exercises queued concurrent callers on one connection; the production cross-connection guarantee relies on the explicit PostgreSQL row locks.
- Transport tests use synthetic responses and reported usage; no live model cost or quality benchmark is claimed.
- **Two authenticated production-browser tests passed**, including real API identical retry200, conflict409, cross-site403 and invalid-bearer401 responses. The main comparison, reflection, criteria, Discover, export, profile and account-deletion flows also passed (`backend/hosted-browser.log`).
- **Hosted ledger checks passed** for AI-off denial, service-only reservation, duplicate denial, unknown-cost liability, budget caps, owner isolation/export and reconciliation. They used synthetic records and made zero provider calls; their known cost was reconciled to zero. Disposable-account and analytics cleanup passed and the private recovery journal is absent (`backend/hosted.json`).
- **Three public production-browser tests passed**, covering public links, policy pages, keyboard controls, contrast/accessibility, themes, mobile layouts and reduced motion (`backend/public-browser.log`).

An initial browser run caught the loopback-origin rejection before deployment. The corrected test also accepts the committed Saved acknowledgement, then reloads to verify persisted Reflected state. These failure logs are retained for traceability.

## Remaining work

1. Set verified model rate/ceiling and daily budget values in the server environment. Optional AI in the updated app stays unavailable until these settings and the ledger are ready; deterministic flows remain usable. No guessed prices or budgets were installed.
2. Supply real operator/contact, HTTPS host, hosting/region, retention and AI vendor/privacy declarations. The public-launch configuration gate still fails; source changes and a database migration are not an app deployment.
3. Finish versioned contracts for the other core features, saved settings and immutable evidence snapshots. Add user review of extracted assertions before relying on them as evidence.
4. Evaluate the remaining AI features on reviewed ambiguous, mixed-language and adversarial cases. Instrument activation/completed-loop metrics only with matching collection choices/disclosures. Verify deployed auth/recovery, export/deletion, scheduling and real push delivery.
5. Complete the web beta and release gates, then build the native clients against shared services/API contracts and test them on actual devices.

The native app, public app deployment, live model quality evaluation, invoice reconciliation, real device push and store readiness are not claimed complete.
