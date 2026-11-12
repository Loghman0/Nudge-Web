# Nudge saved settings and comparison explanations — 24–25 October 2026

This batch follows `IMPLEMENTATION-2026-10-24-BACKEND.md`. The web app remains the
priority. Native clients with the same product behavior follow completion of the
web release and use the shared backend; this batch does not create a mobile app.

## Implemented

- Saved settings let users explicitly name a domain, decision type, goal and up
  to twelve term/meaning pairs. At most twenty settings belong to an account.
  Applying a setting requires a current owner read and review. Aliases match
  complete option labels, do not overwrite existing user details and do not merge
  unrelated domains or infer universal synonyms.
- Client and server guards bind applied settings to their captured identity and
  memory generation. Changed, deleted or privacy-purged settings are rejected;
  stale derived aliases are cleared while option labels remain editable. The
  transient setting marker is not persisted in journal context.
- Saving or deleting a setting returns fresh owner state without refreshing the
  comparison route. Browser testing found that route revalidation after opening a
  saved comparison and pressing New could remount the form and erase the draft;
  the unnecessary revalidation was removed and the same path is covered again.
- Migration **00011** adds private comparison explanation and setting tables.
  Atomic create/rerank RPCs bind an explanation to its owned decision revision,
  scoring-run ID, time, memory generation, engine configuration and persisted
  option labels/scores/breakdowns. Retry identities preserve the original saved
  explanation, including after it has been purged rather than recreating it.
- Saved explanations retain rendered deterministic reasons, warnings, scores and
  bounded source counts/IDs. They exclude raw source notes and preference records.
  They are **not a complete reproducible archive of all scoring inputs**. Reopening
  restores the validated saved revision without recalculating from current memory.
  Explicit refresh of an open comparison creates a new revision. Legacy, missing,
  invalid or privacy-purged explanations are displayed as unavailable, with
  unsupported derived scores hidden.
- Confirmed criteria comparisons continue to use supplied measurements/ranges and
  the conservative winner rule. They avoid personal preference/history retrieval;
  an unknown or overlapping range can prevent a leader. No external facts,
  unprovided measurements, provider prices or outcome certainty are invented.
- Every memory-generation change purges all saved settings and explanations in
  the same transaction. This covers memory erasure, forgetting, corrections,
  extracted-memory editing/deletion and AI setting changes. Generation-bound
  writes reject stale asynchronous attempts to recreate them. The decision journal
  remains until its history or account is deleted. Journal deletion cascades its
  saved explanations; separate preferences/settings remain. Account deletion
  cascades both new tables.
- Export version **5** adds owner-only comparison explanations and settings.
  Explanation reads paginate under stable unique ordering; setting state is a
  scalar JSON aggregate containing the entire capped set. A missing migration is
  identified as unavailable; other dataset failures prevent a misleading complete
  export. Exports remain live reads, so concurrent changes can affect the result.
- **GET /api/v1/decisions** provides owned journal summaries with bounded filters
  and live pagination. **GET /api/v1/decisions/[id]** returns recorded context,
  options, reflections and the matching saved explanation or an explicit
  unavailable state. Authentication verifies cookie or bearer sessions, preserves
  owner/RLS boundaries and enforces launch-mode terms. Responses are private and
  no-store. The existing reflection POST contract remains shared with the web.
- Privacy, profile controls, API documentation and rollout instructions describe
  these retention and availability boundaries.

No dependency was added. Optional AI remains off by default and subject to the
existing verified-price, budget, consent and usage-ledger requirements. This batch
adds no automatic model requests and installs no guessed budget or price values.

## Database rollout

**Migration 00011 applied and verified** on the authorized existing project
`awlaxvfnibugdqqqvkac`. The dashboard returned version 11 and all generated
read-only checks true. The original **2 profiles and 6 decisions** remained before
and after application. Proof: `audit-2026-10-24/comparison-context/migration-00011-verified.png`.
New app comparison writes need these atomic evidence RPCs before deployment.
Other existing installations should apply only missing migrations through
`sql/02_UPDATE_EXISTING.sql`, then run `sql/03_VERIFY_DATABASE.sql`. Old journal
rows are not backfilled with explanations; refreshing an open comparison explicitly
creates new evidence.

The migration creates new private structures and a profile-generation purge
trigger. It does not delete existing decisions or reflections. Generated fresh,
upgrade, verification and type artifacts are maintained by the integration task.

## Verification

| Check | Current status |
| --- | --- |
| Focused PostgreSQL/PGlite migration suite | 10/10 passed during development |
| Full automated suite | 354/354 passed on 25 October, including four new setting-action draft regression tests |
| TypeScript validation | Passed, including the draft fix |
| Production build | Passed after the draft fix |
| Generated SQL consistency and upgrade replay | Passed; all read-only verification checks true locally |
| Authenticated browser, settings and journal API | 3/3 passed, including the resumed comparison → New → edit/apply setting path |
| Public browser and privacy pages | 3/3 passed |
| Hosted migration 00011 verification | Passed, original 2 profiles / 6 decisions preserved |
| Hosted disposable comparison-context checks | 16 checks passed; final hosted report status passed |
| Disposable fixture cleanup | Both runs' created accounts removed; final cleanup verified and private fixture journal absent |
| Final read-only data count | Original 2 profiles / 6 decisions confirmed again after all disposable tests |
| Source archive | Rebuilt and independently checked: 292 safe entries, no private configuration |
| Public launch configuration | Fails on missing verified operator, host, retention, vendor and AI cost/budget settings; no deployment claimed |

The focused SQL suite covers anonymous/private-table denials, owner isolation,
atomic rollback on invalid evidence, exact revision/run binding, immutable retry
behavior, criteria-only provenance, legacy fallback, setting bounds, normalized
duplicate aliases, the twenty-setting cap, privacy purge/stale-write guards,
stable export pages and deletion cascades. PGlite uses one local connection;
production independent-connection serialization relies on the explicit PostgreSQL
profile row locks.

`scripts/verify-hosted-disposable.mjs --comparison-context` requires an explicitly
authorized target and hosted-write flag. It checks all migration 00011 RPCs and
anonymous read denial **before creating accounts**, then tests only accounts it
creates. It exercises owner/foreign settings and explanations, retries, revisions,
exports, memory-reset purges and stale-write rejection, with cleanup limited to
created account IDs. Its report belongs at
`audit-2026-10-24/comparison-context/hosted.json`. No provider call is part of that
synthetic comparison-context verification.

The first browser run exposed the setting-edit remount bug above and was
interrupted before its final report. Its two fixture identities were verified as
test accounts and removed, along with the recorded test analytics row. Recovery
is recorded in `audit-2026-10-24/comparison-context/interrupted-run-recovery.json`;
it is not counted as a completed browser run.

The complete hosted rerun passed on 25 October and saved `hosted.json` with
`cleanup:true`. It includes the synthetic AI accounting checks reconciled to
known zero cost; no model was called. Public and authenticated browser suites
cover **six distinct tests**. The saved-setting editor at 375px had no reported
axe WCAG A/AA violations or horizontal overflow. Browser evidence is under
`audit-2026-10-24/comparison-context/browser/`; automated logs and the combined
verification manifest are in the parent directory.

## Remaining work

1. Deploy and run the beta/release checks on the selected HTTPS host; source,
   local production-server and hosted database validation do not establish an
   app deployment.
2. Supply real operator/contact, HTTPS host, provider/region, retention and AI
   vendor/privacy declarations. Configure verified model prices, ceilings and
   budgets only when optional AI is intended to run.
3. Extend the remaining core features into versioned API contracts. Current
   journal reads/reflection writes do not establish full mobile feature parity.
4. Add explicit review of extracted assertions before treating them as evidence,
   evaluate remaining optional AI on reviewed ambiguous and adversarial cases,
   and verify deployed auth/recovery, export/deletion, scheduling and actual push.
5. Complete the web beta and release gates before implementing and verifying
   native clients on real devices.

Public deployment, live AI quality/cost benchmarking, real-device push, native
feature parity and store readiness are not claimed complete by this batch.
