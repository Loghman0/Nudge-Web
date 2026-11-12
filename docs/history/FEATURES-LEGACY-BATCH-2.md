# Nudge — ordered features, batch 2

Historical batch 2 instructions. For the current release, follow `DISCOVER-UPDATE.md`
and apply missing migrations through 00004.

## Added in order

1. **Inspect and correct memory.** Profile shows belief source, confidence, last
   reinforcement and recent evidence, with links to the related decision. Users
   can search/paginate their beliefs, set Like/Avoid/Neutral, add a correction note, or forget the belief. Explicit
   correction takes priority over later inferred signals until changed again.
   Extracted facts/goals/habits/constraints can be edited or deleted individually.
   Ownership is enforced in PostgreSQL, and corrections invalidate older extraction
   jobs/comparison generations. Canonical evidence is retained for corrections.

2. **Resume and copy decisions.** History can reopen a persisted comparison with
   all option IDs/ranks/scores. New comparisons keep their saved ID in the URL so
   reloading restores them. Copy restores up to all eight options, the title,
   category, mood, budget, company and expected outcome; it writes nothing until
   Compare is clicked. Refresh uses current memory and recalculates every option
   together. Adding an option updates all saved ranks/confidence consistently.
   Atomic RPCs prevent empty partial comparisons, duplicate options, over-cap writes,
   cross-owner changes and lost updates from stale browser tabs.

3. **Flexible outcome check-ins.** After choosing, users can reflect now, choose
   tomorrow/in a week, set a custom date/time in their device timezone, or turn
   reminders off. The controls also appear in History. Scheduling a later time
   snoozes/closes previous prompts. The database creates one prompt per reminder
   version and closes pending prompts after reflection. Reset disables old-history
   reminders; a user can explicitly schedule one again. New choices default to
   24 hours. Legacy pending decisions older than 30 days start with reminders off.

The layout retains Nudge's existing calm styles; these controls are integrated into
Profile, Decide, History and Check-ins rather than added as unrelated screens.

## Apply only the next migration

You have already run 00001 and 00002. For this release, run **only**:

`supabase/migrations/00003_memory_decisions_reminders.sql`

Apply it once, then deploy the source from this package in the same maintenance
window. Do not rerun 00001 or 00002. Fresh projects apply all three in order.
The generated complete-setup file is for fresh databases only.

No hosted database, application deployment, credentials, or user's live reminders
were changed during development.

## Verification

- TypeScript checks passed.
- 74 tests passed: the previous 57 plus 17 feature regressions.
- Production build passed with placeholder public configuration and no private keys.
- PostgreSQL tests cover correction priority, evidence preservation, foreign-owner
  denial, neutral correction, individual memory edit/delete, stale extraction/scoring,
  atomic comparison creation, all eight saved options, re-ranking revision checks,
  default/custom/off reminders, snoozing, notification dedupe and reset behavior.
- Server-rendered UI tests cover all eight copy inputs, restored title/context,
  resume/refresh/choose controls, memory correction/evidence controls and reminder
  timezone/timing labels. No provider request was made.
- Full browser interaction/device QA, independent hosted-connection concurrency,
  OAuth, pg_cron and actual push delivery still require staging checks. The in-app
  check-in appears after a scheduled enqueue run, not precisely at the selected
  second. A past-time or more-than-one-year schedule is rejected.

## Next features and outstanding foundations

Next in order: structured context-aware decision templates/eligibility, editable
reflection revisions, and an evidence-based weekly review. Then previewed imports
and low-stakes decision experiments.

Actual budget/time/availability constraints are not scored yet; existing context
is journal information. Full immutable score-input snapshots, shared paid-call
quotas, provider-output schema validation, complete SQL aggregate analytics, and
per-device durable push delivery/retry leases remain on the roadmap. This batch
improves in-app reminder dedupe, not exactly-once delivery by a push provider.
