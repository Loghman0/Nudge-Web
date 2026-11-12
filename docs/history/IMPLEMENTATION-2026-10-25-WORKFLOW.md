# Nudge choice acknowledgements and Discover corrections — 25 October 2026

This batch closes two correctness gaps in the web workflow and adds the next
shared API contract. It builds on the foundation/review work documented in
`IMPLEMENTATION-2026-10-25-FOUNDATION.md`. No migration or dependency is added;
the schema remains at 00014. Native mobile implementation still follows web
completion and the release gates.

## Accurate Discover corrections

Previously, pressing **Not really** on “You seem to lean toward X. Right?” recorded
an explicit dislike. Rejecting an inferred like does not establish its opposite.
That response now uses the existing owner-scoped correction RPC to make the
pattern neutral. It retains the label/category, records the user's correction
and does not create a dislike. The card explains that meaning before submission.

Positive confirmation previously reconstructed the category from the key prefix;
`learned.food.*` could become Lifestyle because its first segment was `learned`.
The action now loads the actual owner's active graph node and preserves its
stored label/category. Positive writes carry the captured memory generation.
Unknown, forgotten, scoped, low-evidence, manually corrected and unsupported-source
patterns are rejected with a reload message instead of creating a new assertion.

The page reads actual graph rows rather than legacy preference projections, which
can label imported/AI sources as inferred. Displayed cards and accepted actions
now agree on eligibility: verified owner, active inferred/reflected like, at least
two evidence events and no manual override or scoped key. Stable ordering uses
confidence and then ID. Read errors suppress the optional card, not the questions.
The existing correction RPC locks the owner profile and active node; a reset or
forget cannot recreate an old node. This does not add a new compare-and-swap
contract for simultaneous manual corrections.

## Confirmed choices survive optional reward failures

`decision-choice.ts` now owns the required choice save for the web and API. It
validates identities before reads, binds the verified owner and option to the
stored decision, derives the learning key from database fields, calls the
existing atomic RPC and checks the persisted selection before success.

The prior web action could throw after committing if optional achievement
evaluation or lookup threw, making a saved choice appear to fail. Those optional
operations are now guarded. A committed choice remains acknowledged even if no
milestones can be shown. Required-save failures still remain visible.
If another tab already reflected the same selected choice, its acknowledged
`reflected` status is retained in the UI; it does not offer another reminder as
though the choice had just been made.

## Versioned choice API

`POST /api/v1/decisions/{id}/choice` accepts only `{optionId}`. It shares verified
cookie/bearer authentication, same-origin browser writes, launch-mode current
terms and private no-store responses. It bounds actual UTF-8 bytes to 1 KiB and
rejects forged owner/resource fields. First and identical retry requests return
the confirmed selected option and decided/reflected status. The void RPC cannot
honestly distinguish which attempt first committed, so no first-write flag is
invented. Conflicting choices return 409; foreign decisions return 404; uncertain
completion returns 503 with reload guidance. No provider or reward work is needed.
See `API-V1.md` for the full contract.

## Verification

Focused Discover checks passed 18 tests; choice service/API checks passed 13;
web choice acknowledgement checks passed 3, with a separate reflected-status
interaction regression. Final integrated results are recorded below.

| Check | Status |
| --- | --- |
| Full automated suite | 443/443 passed, no failures or skips |
| TypeScript and production build | Passed |
| SQL consistency | Passed; no migration added |
| Hosted and authenticated browser checks | 20 hosted checks and 4/4 authenticated browser scenarios passed; all 3 disposable accounts removed |
| Public browser checks | 3/3 passed; 7/7 public + authenticated scenarios on the final production build |
| Source archive and independent inspection | Passed: 313 safe entries, no private configuration |

Browser verification uses disposable accounts in the previously authorized
unlaunched project. The dashboard scenario seeds only its verified fixture owner
with synthetic inferred patterns, confirms one and clears another, then checks
exported category/polarity/evidence. The main scenario tests real API choice
acknowledgement/retry/conflict, browser-origin guards and bearer isolation, then
uses the web action for the same choice and checks that learning occurred once.
These checks do not call an AI provider.

The first browser run passed Discover but correctly produced no new learning for
Soup: the preceding privacy fixture had deliberately forgotten that key. The
new learning-count assertion used an unsuitable fixture. Fresh Pasta/Curry
labels now test one learning event across cookie API, bearer API and web retries
without weakening forgetting suppression. The full rerun passed. Failure logs
and verified cleanup are retained alongside the successful run.

After cleanup, read-only counts confirmed the original **2 profiles, 6 decisions
and 0 AI memories**, with no fixture recovery journal. The Discover screenshot
was visually inspected. Public-launch configuration still fails on missing real
operator, host, retention and provider declarations; no values were invented.

## Remaining release work

Public operator/contact, HTTPS host, hosting/region, retention and AI provider
rate/budget declarations remain required before launch. Production OAuth/email
recovery, live AI quality evaluation, scheduling and real-device push still need
deployment evidence. Comparison creation and other app features still need their
remaining versioned API contracts before full native parity. No public deployment
or native app is claimed by this batch.
