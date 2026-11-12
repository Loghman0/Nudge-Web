# Nudge implementation — batch 1 (historical status)

The current feature batch is documented in `FEATURES.md`. The tests and remaining
work below describe batch 1 before migration 00003.

Completed 12 October 2026 from the uploaded Nudge source snapshot.

## Implemented

- **Private caching:** service worker caches only neutral offline HTML/public icons,
  removes legacy Nudge caches, and never intercepts export/API/RSC fetches. App
  responses and exports use private/no-store caching instructions.
- **Database permissions:** explicit RPC allowlist; global job execution restricted
  to service-role/cron; graph/projection, reflection, answer, achievement and derived
  profile mutations protected from direct authenticated table writes.
- **Owner references:** database triggers reject cross-owner decision provenance,
  reflection ownership, knowledge evidence/queue references and edge endpoints.
- **Canonical forgetting:** forget marks the node and records a persistent
  suppression key. Reset atomically erases graph/evidence/answers/AI memories and
  pending verification state. Old decision history remains a journal and is
  excluded from subsequent ranking history. Captured memory generations reject
  extraction writes started before reset; new AI writes must provide a generation.
- **Atomic learning:** choosing and learning happen together. Reflections, question
  answers and verification responses are transactional and idempotent for identical
  retries. Neutral feedback no longer generates a positive reflection signal.
  Conflicting reflection/question edits are rejected pending revision-aware editing.
- **Onboarding:** mandatory writes are transactional; preference keys come from the
  DB question bank, not client-supplied mappings. Completion is marked last. A fresh
  installation gets six onboarding questions if none were already selected.
- **Anonymous votes:** members receive aggregated totals and can read only their
  own individual vote. Outside members cannot request group totals.
- **Ranking:** category scoping is shared, learned categories retained, legacy graph
  categories projected into preferences, neutral beliefs do not bias scores, and
  negative counterfactual feedback is consistently penalized. Unicode and negation
  are preserved; unrelated/modifier-sensitive choices are not merged. New keys
  include decision category and disambiguate Unicode/long labels. Scoring supports
  a fixed timestamp. Late-option writes no longer return fake IDs after failure.
- **Analytics/export:** to-one reflections are normalized; the analytics cap is
  clearly labeled. Export tables are paginated under RLS, errors fail the export,
  and export scope/live consistency are explicit. More own account records are included.
- **Reliability:** rate-limit sweeps preserve each action's window. Provider and
  enrichment fetches have six-second abort deadlines. Anthropic supports the generic
  server-side AI key when explicitly selected. Check-in delivery requires a separate
  scheduler secret rather than trusting any user JWT.
- **UX:** failed forgetting/reset/verification/answers keep visible errors. Preference
  removal is discoverable on touch and keyboard focus. Copy calls scores relative
  fit rather than probabilities and describes context as journal information.
- **Setup:** authoritative baseline/hardening migrations, placeholder env example,
  updated rollout docs, Supabase config and generated fresh-only convenience SQL.

## Verification

- `npm run typecheck`: passed.
- `npm test`: 57 tests passed (27 original + 30 new).
- Production `npm run build`: passed with placeholder public Supabase configuration
  and no private keys.
- SQL migrations ran in isolated PGlite/PostgreSQL with pgcrypto and simulated
  Supabase auth roles. Tests exercise execution grants, RLS, owner guards, reset,
  delayed extraction, idempotent learning, rollback on failure, onboarding validation,
  anonymous vote totals, outsider restrictions and upgrade of existing learned/forgotten records.
- Service-worker tests cover private requests, legacy-cache cleanup and offline
  navigation. Check-in handler authorization is tested with stubbed Deno/provider
  boundaries. No hosted Supabase, actual push, pg_cron, OAuth or provider request was made.
- PGlite serializes calls: independent live-connection races and hosted gateway
  behavior still require staging tests. No browser/device visual QA was performed.
- The Next build's type-validation step passed; a standalone ESLint setup and Deno
  CLI typecheck are not yet configured.

## Install/rollout

1. Back up and rehearse against a matching database copy.
2. Existing installations matching the supplied snapshot apply only
   `supabase/migrations/00002_privacy_correctness.sql` **once**. Fresh installations
   apply `00001` then `00002`. SQL-editor convenience setup is fresh-only.
3. Deploy this source after the new database functions/columns exist. Use a maintenance
   window/drain old workers: the previous app's direct writes are intentionally blocked.
4. Supply your own deployment secrets; this source package excludes the uploaded
   `.env.local`, git history, node_modules and generated builds.
5. If using pushes, configure `CHECKINS_CRON_SECRET` (32+ characters) in Edge secrets
   and the scheduler's `x-nudge-cron-secret` header; redeploy that function. Keep its
   configured gateway authorization too.
6. Check an already-installed service worker updates, and smoke-test two accounts
   through onboarding → compare → choose → reflect → forget/reset → export → vote.

No deployment, live data migration, private-key rotation or account operation was
performed. Already-invalid owner references and historical duplicate evidence are
not silently rewritten; review those records in staging before release.

## Remaining roadmap

- **F10:** real budget/mood/time/availability/durable-constraint scoring. Context is
  now honestly labeled journal information until structured candidate attributes exist.
- **F11:** transactional comparison creation and late-option insertion, full rerank,
  persisted confidence/explanation updates and duplicate/count caps under concurrency.
- **F12/F14:** revision-aware edits and existing-evidence cleanup; old inferred
  dislikes remain until a separate provenance-aware review/migration.
- **F15/F16:** complete SQL aggregate analytics, timezone alignment, large export jobs
  and a transactionally consistent export snapshot. Current export is paginated live data.
- **F17:** per-subscription push delivery records, claim leases, retries and unique
  notification-enqueue constraints. Scheduler authorization is now enforced.
- **F18:** shared deployment-wide rate limits and provider-cost budgets. Current limits
  are still per process despite the window-sweep fix.
- **F19:** full provider-output shape validation, background extraction jobs and
  deduplicated extraction/explanation caches. Extraction still runs within its action.
- **F20/F25:** arbitrary older-schema upgrades, hosted CI/RLS/Edge checks, standalone
  lint, browser tests, operational metrics and staging concurrency tests.
- **F22:** full ranking input/version snapshots and calibrated uncertainty. Fixed-time
  scoring is supported, but full historical replay is not claimed.
- **F23/F24:** remaining state/circle/poll creation invariants, streak races on direct
  RPC use, broader accessibility and auth-flow/device QA.
- Later features: memory inspector, editable memories, contextual templates,
  adjustable outcome reminders, resume/duplicate decisions and weekly reviews.

The original improvement report describes the uploaded pre-change snapshot. This
status document records which parts have been implemented and which remain.
