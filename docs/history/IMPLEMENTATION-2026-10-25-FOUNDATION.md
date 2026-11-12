# Nudge foundation setup and reviewed memories — 25 October 2026

This batch implements a short, optional foundation for everyday comparisons and
requires explicit review before AI-suggested memories become durable records.
It changes the default signup destination to foundation setup while keeping
“Compare a choice now” available. It supersedes the earlier default that sent
every new account directly to its first comparison. It does not make setup
mandatory or turn six answers into a complete model of a person.

Source migrations **00012–00014** are required before deploying this source.
Current verification is listed below; earlier implementation reports remain
historical evidence for their own snapshots.

## Foundation questions and answer policy

Migration `00012_foundation_questions.sql` adds six fixed questions marked
`foundationEdition=1`. Existing catalog rows, onboarding flags, saved answers and
journal records are retained. The page selects this edition explicitly rather
than depending on whichever questions happen to have the earliest sort order.

The six questions cover ordinary meal, leisure, break, learning, hobby and
shopping choices. Each names a situation and keeps the alternatives practical
within that situation. These are product-design starting points, not a validated
personality instrument. They avoid claiming a diet, ability, finances, risk
tolerance or social identity from one answer. They apply to **everyday life**;
they do not silently become preferences for an unrelated game, project or domain.

| Exact question | Alternatives | Why this question was selected / displayed rationale |
| --- | --- | --- |
| On an ordinary evening, when both are practical, which meal option usually appeals more? | Cook at home / Order in | This helps with similar everyday meal choices. It does not assume a diet, budget or cooking ability. |
| For a relaxed free hour at home, which would you usually rather do? | Read a book / Watch a film | This records a preference between these two leisure options, without guessing genres or interests. |
| For a short break, when both are available, which usually appeals more? | Quiet time alone / Chat with someone I know | This helps with similar break choices. It is not a personality label or a claim about your relationships. |
| When learning a non-urgent everyday skill, how would you usually prefer to start? | Try a small example / Follow a step-by-step guide | This records how you prefer to begin this kind of task, not your ability, education or occupation. |
| With an hour for a hobby, when both are practical, which would you usually pick? | Make something / Explore outdoors | This gives a starting point for similar hobby choices. It does not assume tools, mobility or experience. |
| When two everyday products meet your needs and cost the same, which approach usually appeals more? | Pick a familiar product / Try a new option | This applies to equally suitable, equally priced products. It does not infer your finances or risk tolerance. |

Each question has an unselected native radio group with six choices: its two
alternatives, **Both could fit**, **It depends**, **Neither fits**, and **Skip this
question**. Choosing a named alternative records only that positive preference;
it does not imply disliking the other side. The four neutral choices become the
canonical `skip` answer and produce no preference. Their distinct labels are
retained in the temporary review UI, not as separate database answer categories.
Questions left unanswered produce no answer row. Skipping all questions leads to
review with an empty answer list, not fabricated preferences.

The welcome screen asks only an optional name. It does not ask for demographic
details or free text for automatic extraction. “Why we ask,” progress, Back and
review editing are available. Nothing is saved until **Save and compare**.
The action submits only the optional name and reviewed answers, preserving other
existing profile fields. Saving is atomic, tied to the generation captured when
the form opened, and safe to retry with identical answers. A changed saved answer
or stale privacy generation requires reloading instead of silently attaching the
draft to newer memory. Saving onboarding makes no AI request.

Signup confirmations and signup Google continuation invite this foundation first.
A deliberate safe local destination is deferred until after setup or its visible
exit. New accounts with no decisions and unfinished setup are invited from Today;
existing journals remain accessible. Accounts that already completed onboarding
are not forced to answer the new edition. An unavailable catalog still offers
comparison access and does not mark setup complete.

## Explicit AI suggestion review

AI remains **off by default**. Optional AI still requires current terms, account
consent, a configured provider, verified price/budget settings, usage accounting
and quota acceptance before a provider request. Onboarding no longer imports or
sends its text for automatic extraction. Profile's explicit **Suggest memories**
action is the entry point for notes the user chooses to send.

The extraction service validates bounded text, captures the current memory
generation, and validates consent and current terms. It returns at most six
temporary `{kind, content}` suggestions only after rechecking generation and
consent following the provider response. It performs **no durable memory write**.
Provider confidence is not presented as a probability or copied into the user's
confirmation. The shared extraction prompts now request only explicitly stated
durable suggestions, preserve qualifications, and prohibit converting a temporary
event, quote, third-party statement or missing personal attribute into a user fact.

The review UI initially selects nothing. Users can change each statement's text
and type, choose only entries they want retained, and explicitly confirm their
review. Every edit or selection change resets the review checkbox. Discarding
suggestions, changing the source notes or turning AI off clears the draft without
saving. Failure preserves the notes/review when retry is appropriate; privacy
invalidation discards obsolete suggestions and asks for a fresh review. Neither
confirmation nor an identical confirmation retry makes another provider request.

## Reviewed-memory storage contract

Migration `00013_reviewed_memories.sql` adds
`save_reviewed_memories(p_request_id, p_memories, p_generation)`. The application
passes one to six selected, edited `{kind, content}` entries and a stable request
UUID. It passes no confidence, caller-supplied owner or source-decision identity.
The database locks the verified caller's profile and enforces generation, current
terms and AI consent in the same transaction as the insert. A privacy change
between the service check and database save returns SQLSTATE `PT409` (HTTP 409), which the
application treats as an invalidated review.

A private owner-scoped request ledger stores a SHA-256 digest of normalized
reviewed statements, the generation and inserted count. It stores no source notes
or provider output. The same request and intent returns the original count;
changed intent under that request is rejected. The UI keeps the UUID for an
unchanged retry and changes it when selected statements change. Generation
changes purge the ledger, and stale generation is rejected before replay so a
pre-reset request cannot restore erased memories. Account deletion cascades it.

New reviewed rows receive `reviewed_at`; legacy rows retain `NULL`. This records
explicit user confirmation, not independent factual verification. The legacy
nonnullable `ai_memories.confidence` field receives the internal compatibility
value `0.5`, which is **not a model estimate or probability of truth** and is not
shown as an accuracy claim. These statements stay separate from the graph and
preferences used for comparison ranking. The older `save_ai_memories` RPC remains
in migration history but its client and service-role execution privileges are
revoked; older automatic-extraction clients must upgrade.

### Hosted conflict-response repair

The first two hosted verification runs timed out on the intentional AI-off
denial. The verifier cleaned up all three disposable accounts after each run.
Supabase documents that custom SQLSTATE `40001` validation failures can trigger
unbounded PostgREST transaction retries. Migration `00014` replaces that semantic
conflict with `PT409` (HTTP 409), preserving the function's validation, owner lock,
data, retry ledger and permissions. The app recognizes the new conflict and
retains compatibility with the older response. Local upgrade tests verify that
existing reviewed rows, timestamps, ledger hashes and retry acknowledgements
survive the repair. No matching active requests remained in the hosted diagnostic;
no backends were terminated or project restart performed.

Reference: [Supabase conflict-code troubleshooting](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions).

## Verification status

| Check | Current status |
| --- | --- |
| Focused profile review, service/action wiring, AI boundary and existing accessibility/interaction checks | **46 passed**, no failures or skips |
| TypeScript after the reviewed-memory RPC type was integrated | **Passed** |
| Foundation SQL/UI/auth routing and reviewed-memory SQL focused results | 8 SQL + 10 UI + 16 action/routing + 12 reviewed-memory SQL tests passed |
| Full automated suite for final integrated source | 413/413 passed |
| Final production build | Passed |
| Generated SQL consistency and upgrade rehearsal through 00014 | Passed, including fresh setup, repeated upgrade verification and repair preservation |
| Current public/authenticated production-browser suite | 7/7 passed: 3 public + 4 authenticated, on the final production build |
| Hosted migrations 00012–00014 and disposable-account verification | Applied and verified: versions 12/13/14, all generated checks true, 20 hosted checks passed. Three disposable accounts cleaned; final original 2 profiles / 6 decisions / 0 AI memories preserved. |
| Final source archive and independent archive check | Passed: 305 safe source/test entries, no private configuration |
| Live AI extraction using configured provider/budgets | Not verified |
| Real-device push delivery | Not verified |
| Public deployment | Not performed |

The new foundation browser scenario requires a **third, fresh disposable test
account**, separate from the regular comparison account and empty-dashboard
account: `NUDGE_FOUNDATION_TEST_EMAIL` / `NUDGE_FOUNDATION_TEST_PASSWORD`. It must
have no completed onboarding, saved answers, preferences or decisions. Secrets
stay in private environment files. The scenario checks the six questions,
neutral-answer behavior, no pre-review writes, review editing, saved explicit
preferences, mobile overflow and axe findings in the tested states. Fixture
creation/cleanup and final results are recorded in
`audit-2026-10-25/foundation/hosted.json`. That run passed all 20 checks, including
the four authenticated browser scenarios, and removed all three fixtures.
`preserved-counts.json` confirms the original aggregate row counts and absence of
the cleanup journal. Mobile question/review screenshots were visually inspected.
The hosted review tests used synthetic statements and made zero model calls.
The public recheck's three scenarios passed, but Windows sandbox restrictions
prevented its normal test-server shutdown. Only the verified server and shell
created by that run were stopped; the runner then exited successfully. This was
test-process cleanup, not a public deployment or app-account change.

## Remaining release work

Fill and verify real operator, host, retention and provider
configuration before enabling public launch. OAuth/email delivery, live optional
AI and real-device push need their own deployment evidence. No claim is made that
this completes the whole web app or proves every possible comparison is correct.

Complete the web app and its release gates first. The subsequent mobile product
must provide a native interface with matching features and share the protected
backend/services; this batch does not introduce a WebView wrapper or start a
separate mobile implementation.
