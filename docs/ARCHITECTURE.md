# Nudge architecture

The product loop is decision → choice → outcome → reflection → learning.

- Next.js routes/components render the app and orchestrate authenticated actions.
- Ranking, similarity, category scoping, relation normalization, pagination,
  knowledge scoring and AI adapters live under `src/lib/services`.
- Supabase session adapters remain Next-specific; server actions still own some
  orchestration. A future mobile API should reuse services and protected RPCs,
  not copy server actions into a client.
- `supabase/migrations` is authoritative. PostgreSQL enforces owner references,
  canonical graph writes, memory generation checks, atomic choice/reflection/
  onboarding/discovery operations and membership-scoped group aggregates.

## Memory ownership

Knowledge nodes and immutable evidence feed a derived `preferences` projection.
Authenticated users can read their own graph but cannot edit the projection or
mutate graph tables directly. Public learning RPCs validate ownership and serialize
against reset using the profile lock. “Forget” records a suppression key, marks the
node forgotten, removes its projected preference and closes pending checks.

“Erase learned memory” clears graph/evidence, answers and extracted memories,
increments `memory_generation`, and sets `memory_reset_at`. Existing decisions
remain as a journal but pre-reset choices are excluded from ranking history.
Optional AI creates temporary suggestions only. Explicit reviewed-memory
confirmation supplies its captured generation; stale writes are discarded.

## Decision state

`commit_choice_and_learn` records a choice and mild evidence together. Identical
retries are no-ops. `submit_decision_reflection` stores the reflection, changes state,
and writes non-neutral outcome evidence in one transaction. An identical retry is
ignored; a conflicting edit is rejected pending revision-aware editing. Discovery
answers similarly record once; choosing one side no longer implies explicit dislike
of the other. Onboarding derives preference keys from the database question bank.

## Ranking

New learned keys include category; legacy graph category metadata is projected
into preferences. All ranking paths use shared category scoping. Neutral beliefs
contribute neutral evidence. Matching preserves Unicode, negation and meaningful
variants. A scoring timestamp can be passed to reproduce time-dependent behavior;
full immutable input snapshots and calibrated outcome probabilities are not yet
implemented. Context is journal information until structured candidate attributes
and constraint eligibility are added.

## Privacy and delivery

The service worker caches a neutral offline page and public icons only. Sensitive
routes use private/no-store responses. Circle members see aggregate vote counts and
their own vote through RLS/RPCs. Export datasets are paginated with explicit scope.
The check-in function requires a scheduler secret as well as configured gateway
validation. Migration 00007 provides per-device delivery leases, retry/backoff
and fenced acknowledgements; real device delivery still needs deployment testing.

See `IMPLEMENTATION.md` for verification and remaining work.


## Ordered features (migration 00003)

The profile now exposes recent evidence and explicit corrections. A manual polarity
in node metadata takes priority over later inferred signals; the user can change it
again, including through a verification check. Editing/deleting an extracted memory
and changing/forgetting a belief advance the memory generation to discard old jobs.
Neutral beliefs are not queued for yes/no verification.

`create_comparison` creates the decision and its options atomically.
`rerank_comparison` validates ownership, state, all retained option IDs, the eight-option
cap, the memory generation and an optimistic comparison revision. Resume reads saved
scores; Refresh and adding an option re-rank all options together. Copy pre-fills all
options/title/explicit context and creates nothing until the user compares again.

Decisions store reminder due time, opt-in state and version. Choosing defaults to
24 hours; users can schedule tomorrow, a week, a custom device-local time, or disable
it. Changing the schedule closes old notifications. The enqueue job creates at most
one notification per decision/reminder version. Reset disables retained-history
reminders, and explicit rescheduling can re-enable them. Push delivery leases and
per-device retry records are provided by migration 00007.

## Discover and session reliability (migration 00004)

Curated trees are stored in `questions.context` and a read-only `question_branches` table.
The owner-scoped queue RPC selects eligible children matching actual prior answers;
follow-ups have priority, and otherwise topic coverage balances the queue. Answers
are atomic and idempotent, and child/parent chosen beliefs can form contextual graph
edges. Quick checks are generated on visits as well as cron; outdated assumptions
become neutral instead of inverting automatically. Client transitions retain failed
controls and keep an opted-in exploration session open.

Supabase browser/server cookie scope matches. Middleware verifies claims and carries
refreshed cookies through redirects; OAuth exchange writes onto the redirect itself.
NVIDIA defaults to two current models by language task, with validated structured
extraction and at most one fallback per call. Additional/legacy routes require
explicit enablement. Private credentials remain server environment configuration.
See `DISCOVER-UPDATE.md` for rollout and external Google branding setup.

## Web workflow and foundation setup (25 October)

Signup defaults to the optional six-question foundation introduced by migration
00012. The page asks only an optional name, contextual everyday choices and a
review before saving. Both/depends/neither/skip produce the canonical skip answer
with no single preference; unanswered questions produce no row. A named side
records that positive choice only, with no inferred dislike of the other side.
The foundation edition is selected explicitly from the catalog. Historical
questions, answers and existing completed onboarding remain intact.

Users can leave setup to compare immediately without marking setup complete.
Safe deliberate local destinations are preserved through signup/setup. New empty
accounts are invited to setup from Today, while existing journals remain usable.
The server preserves other profile basics, captures the original privacy
generation, saves reviewed answers atomically and performs no AI extraction.
This replaces the previous first-decision-only signup default.

Today, Decide and Journal
are the mobile web navigation; optional tools stay reachable from Today.
Today renders the actual selected option, recorded rating and date of a past
outcome, with a copy link that requires fresh meaning/criteria confirmation.

`comparison-memory.ts` paginates owner-scoped evidence and applies the 80-result
history limit after category, setting, reset and forgetting checks. A missing
legacy evidence status is not enough to display a supported recommendation.
Comparison reasons are deterministic; the legacy explanation action is a no-op.
Reflection saves use the atomic RPC without AI extraction. Additional questions
and notes are optional and unanswered fields remain unknown. Explicit profile
suggestion extraction and other opt-in AI actions retain their consent guards;
durable Profile memories now require the review contract described below.

The earlier 24 October workflow batch required no new schema. The following backend and
comparison batches add the API, accounting and saved explanation contracts
described below. Native clients remain subsequent work and must reuse the backend
contracts while providing a native interface.

## Shared choice and Discover corrections

Core choices now use `decision-choice.ts` from both the web action and
`POST /api/v1/decisions/{id}/choice`. The service validates the verified owner's
stored decision/option, uses the existing atomic learning RPC, and confirms the
persisted selection before acknowledgement. It makes no AI or reward call.
Optional web milestone failures cannot invalidate a committed choice, and an
already-reflected retry retains its status. See `API-V1.md` for bounded payloads,
authentication, retries and error contracts.

Discover pattern confirmation reads eligible active graph nodes for the verified
owner. Confirmation retains the stored label/category and captured generation;
rejecting an inferred like uses neutral correction rather than inventing a
dislike. The optional card loader uses the same actual-source eligibility as the
action, avoiding legacy preference projection mismatches.

## Reviewed Profile memories (migrations 00013–00014)

Explicit Profile notes can be sent to an accounted provider only after consent,
current terms and quota checks. Extraction returns at most six temporary
generation-bound `{kind, content}` suggestions and performs no durable write.
Generation and consent are checked again after the provider returns. Prompts
request explicitly stated durable information only, preserve uncertainty and
reject inference from temporary events, quotes or third-party statements.

The user selects, edits and reviews statements before confirmation; none are
preselected. Edits reset confirmation, and discard, source-note edits, AI
withdrawal or privacy invalidation clear the draft. Confirmation makes no model
request. `save_reviewed_memories` locks the verified owner's profile and validates
current terms, consent and generation atomically with the insert. SQLSTATE PT409
(HTTP 409) invalidates the pending review if those checks change during the save.
Migration 00014 avoids the serialization retry behavior caused by the older code;
the app still recognizes that older response during an upgrade.

An owner-only private ledger stores the normalized payload's SHA-256 digest,
generation and inserted count. Identical request/intent replay returns the
original count; changed intent is rejected. Client request IDs remain stable for
unchanged retries. Generation changes purge request records; stale generations
are rejected before replay. Erasure and account deletion remove the appropriate
memory/ledger records. Old automatic `save_ai_memories` client execution is revoked.

`ai_memories.reviewed_at` records explicit confirmation and stays NULL for legacy
rows. It does not establish external factual verification. The internal legacy
confidence value 0.5 is a compatibility placeholder, not a truth probability.
Reviewed statements do not automatically become ranking preferences. See
`IMPLEMENTATION-2026-10-25-FOUNDATION.md` for the exact questions and verification
boundaries. Source schema and generated release files now target migration 00014.

## Follow-up shared backend and AI accounting

The next batch adds `reflection-save.ts`, shared by the web action and
`POST /api/v1/decisions/[id]/reflection`. Cookie requests enforce Origin; native
bearer tokens are verified with Auth and use user-scoped RLS. Launch-mode terms
requirements match the UI. The API has bounded input and versioned error/retry
semantics; it is the first slice, not the complete native API.

Migration 00010 provides private operational attempt records and anonymous daily
cost totals. Provider transports reserve before every HTTP attempt, including
fallbacks, and record usage before interpreting generated content. Unknown or
uncertain cost retains the reservation. Server-only RPCs serialize daily budget
checks, validate AI consent/generation and preserve aggregate liabilities across
account deletion. Owner-only exports paginate the short-lived records. These are
configured-rate cost calculations and conservative reservations, not invoices.
See `AI-ACCOUNTING.md` for required configuration and retention limitations.

## Saved comparison context and journal API

Migration 00011 keeps immutable rendered explanations in a private table. The
atomic `create_comparison_with_evidence` and `rerank_comparison_with_evidence`
RPCs bind each snapshot to the owned decision revision, scoring-run identity,
memory generation, timestamp, engine configuration and persisted option scores.
The snapshot contains deterministic reasons, score breakdowns, warnings and
bounded source counts/IDs. It excludes source notes and raw preference records;
it is not a complete reproducible input archive. Older clients retain their RPCs
but cannot manufacture a saved explanation retroactively on a retry.

Reopening a comparison reads its matching saved explanation without reranking
against today's memory. Legacy, purged or invalid explanations are marked
unavailable; stored numeric scores alone do not establish evidence. Refreshing an
open comparison explicitly creates a new revision with current evidence. Criteria
comparisons validate against confirmed recorded measurements and avoid personal
preference/history retrieval.

Saved settings contain an explicit name, domain, category, goal and up to twelve
term/meaning pairs, with at most twenty settings per account. Applying a setting
requires a current owner read and confirmation. Aliases match complete option
labels; settings do not merge domains or learn synonyms implicitly. Transient
setting identity/generation markers are checked before comparison and removed
from persisted journal context.

Every memory-generation change purges all saved explanations and settings for
that account in the same transaction. This includes erasure, forgetting, belief
correction, extracted-memory editing/deletion and AI setting changes. Profile
locks serialize these operations with snapshot/settings writes. A captured old
generation cannot recreate purged data. Journal records remain; deleting a
decision cascades its explanations, and deleting the account removes both tables.
Export version 5 includes owner-scoped explanation and setting records, with live
pagination and explicit availability when migration 00011 is absent.

`GET /api/v1/decisions` and `GET /api/v1/decisions/[id]` share the verified
cookie/bearer authentication boundary with the reflection endpoint. List reads
provide bounded filters, stable ordering and live pagination. Detail reads expose
recorded context and validated saved explanations, withholding unsupported derived
scores. These API responses are private/no-store. See `API-V1.md` for schemas and
the remaining native API boundary.

## Current shared workflow and AI response privacy

The current Next.js 16.4.3 request entry is `src/proxy.ts`, delegating the existing
session/cookie/redirect logic to `src/lib/supabase/middleware.ts`. Production uses
Webpack explicitly; type checking generates framework route types first.

`comparison-service.ts` owns confirmed comparison creation, saved restoration and
explicit refresh for the web adapters and versioned comparison POST endpoints.
It preserves the existing atomic request/revision/generation guards, immutable
explanations and uncertainty-aware criteria rules. Natural-language interpretation
remains a separate optional draft; a model does not supply measurements to the
confirmed criteria path.

`reminder-save.ts` is shared by the web reminder action and
`POST /api/v1/decisions/{id}/reminder`. It binds the verified owner, validates a
real future timestamp with an explicit offset, limits scheduling to 365 days and
confirms the persisted reminder state. Accepted schedules advance the existing
reminder version; identical HTTP retries are not advertised as exactly-once.

`getAccountedAi` captures current owner consent, terms and memory generation before
binding a provider. After each operation it reads that state again and discards
output if it changed or cannot be verified. Wire usage has already been finalized
before the response check, so discarding stale output does not erase an attempt
or trigger a provider retry. Requests already transmitted can finish after
withdrawal; their content is withheld. The free NVIDIA prototype policy is also
blocked in public-launch mode. See `NVIDIA-DEVELOPMENT.md` for current explicit
model routing and its separate development-only accounting configuration.
