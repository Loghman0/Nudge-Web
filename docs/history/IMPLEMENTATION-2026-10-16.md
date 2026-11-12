# Decision meaning and Discover expansion

Historical batch: the current criteria extension is described in
`IMPLEMENTATION-2026-10-18.md`. This batch's verified archive is retained as
`release/nudge-source-2026-10-16.zip`; its checksum remains in the matching
meaning/topic verification record.

Implementation started 16 October 2026; final verification continued 18 October.
This extends the earlier reliability pass in `IMPLEMENTATION-2026-10-15.md`.

## Behavior

- Comparisons first review what the user means. A setting/domain, goal, alternatives
  and optional definitions/details can describe a game, project, hobby or everyday
  situation without adding a new fixed database category for every subject.
- Optional AI extracts a draft interpretation and a clarification question. It
  must not invent alternatives, definitions, factual claims or recommendations.
  Extracted alternatives, setting, goal and unfamiliar terms must occur in the
  supplied text; unstated setting/goal suggestions are left blank. Users edit and confirm
  the draft before a comparison is ranked or saved.
- AI interpretation uses the existing optional consent/current-terms gate, a
  durable ten-per-hour allowance, the shared global quota and an abortable deadline.
  AI off, unavailable, malformed output and quota exhaustion retain a manual path.
  Interpretation itself writes no preference or memory.
- Natural-language questions no longer silently receive a generic category starter
  list. If alternatives or the setting are missing, the user supplies them.
- Preferences/history for a named setting are separated from other settings.
  Choosing and reflecting on the same label in two different games/projects creates
  different learned identities. Corrections, alias handling and forgetting respect
  that boundary, while forgotten aliases within the setting remain suppressed.
  Ordinary legacy choices map to the explicit “Everyday life” setting.
- When no relevant journal evidence supports an option, the UI shows insufficient
  evidence, with no score bars, numerical fit claims or leading-option badge.
  Users can still record their own choice and later reflect on it.
- Setting, goal and user-supplied option details survive reload and copying.
  The goal/details are journal context; they are not a factual verification system
  or a rules engine for whether an option can achieve that goal.
- Discover has a “Change topic” control alongside direct topic selection.
  Changing topic reads another eligible queue without answering/skipping the
  current question, learning a dislike or increasing daily progress. The current
  question remains available. Failures preserve it and allow retry.
- There are 42 additional curated questions, 36 answer-dependent branches and six
  new selectable topics: Games, Outdoors, Reading, Making & repair, Community,
  and Sport & play. This brings the topic selector to 24 topics.
- Fresh scoring reasons now survive the float32 precision of PostgreSQL REAL.
  The scoring-run identity still prevents reasons from another revision attaching
  merely because scores happen to match.
- Missing history is described as “no recorded outcome”; it no longer claims the
  person has never tried an activity. Focus moves to the meaning-review step when
  clarification is needed.

## Database

`00009_decision_meaning_and_topics.sql` was applied to the authorized existing
unlaunched Supabase project. It adds bounded meaning metadata validation, scoped
learning wrappers, scoped correction/forgetting guards, interpretation quotas and
the read-only topic-switch RPC. Existing public learning/reflection signatures
remain compatible; private implementations are not callable by authenticated
clients or anonymous users.

The live bank grew from 912 to 954 questions and from 108 to 144 branches. Before
application, all 42 IDs/prompts were checked for collisions. A private ignored
snapshot was saved. The immediate post-upgrade comparison found no removed or
changed existing rows across profiles, decisions, options, reflections, question
answers, knowledge, checks, preferences and forgotten-key records. The existing
six decisions and 73 question answers remained. Eight hosted catalog checks passed.

For matching installations, use `sql/02_UPDATE_EXISTING.sql` and then
`sql/03_VERIFY_DATABASE.sql`. Fresh empty installations use the guarded fresh
setup through migration 00009. Never replay the baseline over a journal.
Version markers are used by the upgrade script. This project's SQL Editor rollout
does not reconcile the Supabase CLI migration history.

The new bank is authored in `data/discover-expansion.txt` and generated with:

~~~sh
node scripts/build-discover-expansion.mjs
node scripts/build-release-sql.mjs
node scripts/build-setup.mjs
npm run sql:check
~~~

Migrations 00001–00008 were not edited for this batch.
Once 00009 is applied, future bank additions need another additive migration.
Do not edit/replay an already applied migration to publish more questions.

## Verification and limits

The final results are in
`audit-2026-10-15/meaning-topics-verification.json`. Evidence includes local
regressions, production build, authenticated browser and hosted API checks,
database preservation results, screenshots and the release ZIP checksum.
The audit directory is retained under its original start date.

The full local suite passed 207 tests in 47 suites with no skips. A final focused
run passed 39 tests after the interpretation-grounding, focus and wording
adjustments. Typecheck, production build and generated SQL checks passed on the
pinned Node 24.19.0 runtime.

Both authenticated Chrome scenarios passed (47.0 seconds), including topic
switching and return to the still-unanswered original question. All three public
Chrome scenarios passed (22.4 seconds). Thirteen grouped hosted workflow checks
passed, and both disposable accounts were cleaned up.

The 18 October data comparison still has the same original profiles, decisions,
options, reflections and question answers. The intervening changes to existing
memory rows are confidence/decay timestamps and projected preference strengths,
consistent with the pre-existing confidence-decay job. No existing rows were
removed; only the 42 questions and 36 branches were added. The immediate
post-migration preservation record and the later current-state comparison are
saved separately.

The authenticated harness uses two newly created disposable accounts against the
authorized project and the local production app, with AI/enrichment disabled.
It tests interpretation/review, persisted context, an unseen setting with no
evidence, same-label scoped choice/reflection/correction, and topic switching that
preserves progress and the original question. Cleanup is limited to accounts and
synthetic rows created by that run.

AI wire/schema, consent, quota, fallback and model-routing regressions use mocked
responses. No live model quality benchmark or paid AI evaluation is claimed.
The Next app and Edge worker have not been deployed by this task.

Nudge can accept user-defined terminology and settings, but cannot guarantee
correct factual answers about every possible subject. This batch deliberately
asks for clarification and abstains where its evidence is insufficient. It does
not add live source retrieval, verification of game/version-specific mechanics,
product specifications or other external facts. Future factual guidance needs
relevant authoritative sources, citations and its own evaluation before it can be
presented as verified. Existing sensitive-decision boundaries remain.
