# Production rollout

For the current release, `LAUNCH.md` and `RELEASE-TESTING.md` are authoritative and supersede this older
batch rollout. The current generated existing-update SQL includes migrations through 00019.
The latest code/migration changes and remaining gates are in
`IMPLEMENTATION-2026-10-25-WORKFLOW.md` and
`IMPLEMENTATION-2026-10-25-FOUNDATION.md`. Historical numbered steps below predate
the current source and are not the current deployment sequence.

The latest update and migration 00004 are documented in `DISCOVER-UPDATE.md`.
Batch 2 (00003) is documented in `history/FEATURES-LEGACY-BATCH-2.md`.
Batch 1 historical details remain in `IMPLEMENTATION.md`.
Do not rely on the earlier uploaded audit's build or missing-migration claims.

1. Back up the database and rehearse on an isolated copy of the matching snapshot.
2. Inventory invalid cross-owner references and duplicated historical evidence.
   New writes are checked; this batch does not rewrite old evidence silently.
3. If 00001 and 00002 are already applied, apply 00003 then 00004 once each. If 00003
   is already applied, run only 00004. Matching original snapshot installations
   apply 00002 → 00003 → 00004. Fresh projects apply 00001 → 00002 → 00003 → 00004.
4. Deploy the updated app only after the new RPCs/columns exist. The previous
   app cannot keep writing to tables that the migration now protects.
5. Supply `.env.local`/deployment variables from your own configuration. Generate
   source downloads only with `npm run release:package`, then run the archive
   checker; the packaging allowlist includes `.env.example` only. Replace any still-active
   private credentials exposed in the previous archive outside this package.
6. If using push check-ins, set `CHECKINS_CRON_SECRET` in Edge secrets and the
   scheduler's `x-nudge-cron-secret` header; redeploy the function and verify its
   gateway authorization and VAPID settings.
7. Follow `DISCOVER-UPDATE.md` for Google branding and NVIDIA model/key setup.
   Verify a hosted login survives reload and token refresh. Run `npm run verify` and test the actual hosted signup/onboarding/choose/
   reflection/forget/export/circle flows. Verify scheduled job ACLs as anon,
   authenticated and service-role on the target installation.
8. Deploy the new service worker. Its activation removes old `nudge-*` caches.
   Verify a previously installed client updates and cannot reopen private pages
   offline. Users with an old worker still active need an online refresh/update.

## Rollback

Retain a backup and previous release before migrating. The migration restricts
legacy writes, so rolling back app code alone is not sufficient. Prefer a forward
fix. Do not restore broad RPC permissions or private response caching. Memory
erasure is intentionally irreversible within the app; a generic backfill must
never repopulate records after reset.

## Remaining operations work

Durable per-device push ledgers, database-enforced AI budgets and hosted
role/browser checks are implemented in the later batches. Deployment of the
current app/Edge worker, cron configuration, provider billing limits and real
push delivery still need operational verification. Short-window in-memory rate
limits remain per instance; they are separate from the shared database budgets.
PGlite tests do not emulate the Supabase gateway, cron, multiple live connections
or push providers. Use the current implementation reports for verified evidence
and `LAUNCH.md` for the remaining release gates.
