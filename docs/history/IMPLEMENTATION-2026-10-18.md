# Explicit criteria for unfamiliar comparisons

This extends the reviewed meanings and Discover topic switching described in
`IMPLEMENTATION-2026-10-16.md`.

## Behavior

- Users choose personal history or their own measurable criteria. Criteria scores
  use only their confirmed values, ranges, direction and importance. Personal
  preferences and history do not contribute to those scores.
- Up to five criteria support two to eight alternatives. A criterion has a name,
  unit, lower/upper range, whether higher or lower is better, and importance 1–5.
  Each option can have a numeric value, source link and evidence/version note.
- A blank measurement is unknown. It contributes the full possible range to the
  weighted result. A measured zero remains zero. Values outside the supplied
  range are rejected rather than silently clipped or treated as missing.
- A leader is shown only when its lowest possible score exceeds every other
  option's highest possible score. Complete ties and overlapping incomplete
  results abstain from a leader. Input order cannot break a tie.
- The formula scales each value between its supplied bounds, reverses it when
  lower is better, and averages using the supplied importance. Missing values
  contribute a normalized interval of 0–1. Scores describe fit to these inputs,
  not a probability of success.
- Users explicitly confirm the inputs. Editing criteria, options or meaning
  clears that confirmation. Failed saves preserve the draft. Copies restore
  values and sources but require a fresh confirmation.
- Saved comparisons retain algorithm version 1 and their exact criteria/source
  snapshot. Reload/recalculation use that snapshot. An added option starts with
  unknown measurements; it receives no invented facts. Copy/edit creates a new
  comparison. Existing ownership, memory-generation, revision and retry guards
  remain in use.
- Refreshing preserves an extra-option draft typed while recalculation is
  pending. A successful addition clears only the matching submitted draft,
  retaining a different draft typed during that request.
- Resume and copy use distinct client state identities. Following a copy link
  from the same saved comparison now opens its editable draft rather than
  retaining the previous result screen.
- Results show criterion contributions, uncertainty ranges, weighted coverage,
  source links and notes. AI explanations are disabled for criteria results.
  Random highlights have equal chances and are labeled as random.

## Database and provenance

No migration was added or applied in this batch. The bounded, allowlisted input
snapshot fits the existing decision context JSON and atomic create/rerank RPCs
through migration 00009. Tests verify snapshot round trips, request replay,
cross-account denial and stale-revision rejection on that schema. The application
validates persisted criteria before rendering or recalculating; malformed inputs
fail closed. The database's general JSON context field is not an external-fact
validation boundary.

Source links are optional user-provided HTTPS references. They are not fetched,
read or verified. Notes can identify a game/version, date, rule set, evidence or
assumption. There is no automatic factual retrieval or guarantee that a person's
inputs or ranges are true. This provides an auditable calculation from explicit
inputs, while the earlier optional AI layer continues to interpret and clarify
language without fabricating factual answers.

## Verification

The full suite passed 219 tests in 49 suites with no skips or failures. The final
focused run passed 20 tests. Typecheck, production build and generated SQL
consistency checks passed on Node 24.19.0.

Both authenticated Chrome scenarios passed (1.0 minute, rounded Playwright
report), including a delayed real server response to verify draft preservation,
reload, unknown measurements, copy/edit, source export and actual account
deletion. All three public Chrome scenarios passed (15.9 seconds). Thirteen
grouped hosted checks passed and both disposable accounts were cleaned up; no
private fixture recovery journal remains.

Browser testing caught and fixed server/client serialization of criteria,
refresh erasing a newly typed option, and copy navigation retaining result
state. Failed-run evidence is retained separately from the final passing run.
The desktop comparison and mobile comparison/editor screenshots were visually
inspected; mobile overflow assertions passed. Screenshots disable finite
animations so partially revealed cards do not distort the evidence.

Verification results and the source archive checksum are recorded in
`audit-2026-10-15/criteria-verification.json`. The audit folder keeps its original
start date. The prior verified source archive is retained as
`release/nudge-source-2026-10-16.zip`, with its original checksum in the historical
meaning/topic verification record.

No app or Edge worker deployment is performed by this batch. Browser checks run
the local production build against the authorized existing unlaunched Supabase
project using disposable test-created accounts. AI and enrichment are disabled
for those checks; they do not establish live model quality or factual accuracy.
