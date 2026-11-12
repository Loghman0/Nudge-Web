# Development completion — 26 October 2026

This batch finishes the remaining comparison/reminder backend slice and repairs
save acknowledgement, form drafts and optional AI privacy boundaries. The owner
selected an unpublished development web app; operator/contact and public hosting
setup are deferred. Public launch stays off. Native mobile remains a later phase
using shared protected services and a native interface.

## Changes

- `comparison-service.ts` now owns creation, saved reads and explicit refresh.
  Web actions and versioned APIs use the same validation, deterministic scoring,
  evidence persistence and owner/generation guards. Unconfirmed meanings cannot
  be submitted through the create API. Stable creation identities recover an
  uncertain save; refresh requires the saved revision. New criteria option
  measurements remain unknown. See `API-V1.md` for bodies, limits and retries.
- `reminder-save.ts` is shared by web and API. It validates real calendar dates,
  explicit timezone offsets, ownership and the reflected/decided lifecycle, then
  acknowledges the persisted enabled/time/version values. Each accepted RPC
  advances the version, including an identical sequential retry. The web blocks
  repeated clicks and preserves failed custom-time drafts; ambiguous/nonexistent
  local clock times require another selection.
- Discover answers, circle creation and poll creation retain successful required
  saves when optional achievements fail. Unknown circle/poll creation outcomes
  require reload before another submit. Forms suppress immediate duplicates,
  preserve failed drafts and reset only after success. These changes do not make
  circle/poll creation exactly once across independent clients or lost sessions.
  A hosted browser check also reproduced invitation rotation committing while
  its old code remained visible. Confirmed form success now refreshes the server
  view so invitation codes, membership and vote totals reflect saved changes.
- AI interpretation uses Unicode token boundaries instead of arbitrary substring
  matches. Model-written clarification questions are replaced with neutral prompts
  based on missing fields. Explicit slots remain available. This rejects known
  `car`/`camera` and `Rust`/`trust` mistakes; lexical presence still cannot prove
  semantic truth, and users must review meaning.
- Every accounted AI operation checks current owner consent, terms and memory
  generation before use and after provider completion. Usage is settled before
  obsolete output is discarded. No automatic memory persistence is added.
- NVIDIA defaults to Lightning for interpretation and Gemma for reviewable memory
  drafts and summaries. Only enabled models can run; legacy Super/Ultra require
  explicit selection. Generic keys are forwarded to NVIDIA only with the NVIDIA
  prefix. Free prototype configuration is blocked in public-launch mode. See
  `NVIDIA-DEVELOPMENT.md` for setup and current primary sources.
- Knowledge lookup logs exclude raw database or transport messages that may
  contain private text. Dependencies use Next.js 16.4.3 and patched compatible
  transitive dependencies after the invitation reproduction exposed a transition stall under the
  15.5.28 bundled React canary. The same isolated check on 16.4.3 displays the saved
  code and finishes pending state. This is observed runtime evidence, not proof
  of a specific React internal cause. The regression resembles reports in
  [Next's issue tracker](https://github.com/vercel/next.js/issues/97990).
  Production retains Webpack explicitly, TypeScript uses the required automatic
  JSX runtime, type checking generates the required route types first, and the authenticated request entry follows the `proxy.ts`
  convention. Existing session/ownership rules remain in the shared auth helper.

## Database and deployment

No new migration is needed; the existing authorized project remains on 00014.
Its dashboard reports **Central EU (Frankfurt), eu-central-1**, recorded in the
private development configuration. No database upgrade, Edge deployment, hosting
publication or billing change was performed in this batch.

Disposable hosted writes use only accounts created by the verification script.
The script journals created IDs privately and removes those fixtures afterward.
Existing account data is excluded from test fixtures.

## Verification

Final integration evidence is recorded in `audit-2026-10-26/completion/`.
| Check | Result |
| --- | --- |
| Full automated suite | 658 passed, 0 failed, 0 skipped; includes isolated PostgreSQL/RLS, services, privacy, API and interaction checks |
| Route type generation and TypeScript | Passed on Node 24.19.0 |
| Production build | Passed with Next.js 16.4.3 and Webpack; request authentication uses `src/proxy.ts` |
| Generated SQL consistency | Passed; migrations through 00014, no new migration |
| Fixed synthetic AI contracts | 136/136 passed; zero external provider calls |
| Hosted integration | All 20 check groups passed |
| Authenticated Chromium | All 6 scenarios passed: circles/polls, saved settings, core API, dashboard/Discover, foundation and full comparison/privacy loop |
| Public Chromium | All 3 scenarios passed: interactions, accessibility/contrast/layout and public policy/sharing routes |
| Fixture cleanup and original aggregate counts | Verified 2 profiles, 6 decisions, 0 AI memories; fixture journals absent |
| npm dependency advisory snapshot | 0 known advisories for the final lockfile |
| Development configuration | Passed with public launch off and optional AI explicitly unavailable |
| NVIDIA live provider checks | Not run: private NVIDIA key and corresponding configuration are missing |
| Source package | 341 allowlisted entries; independently inspected; excludes private configuration and audit fixtures |

The circle browser scenario verifies invitation rotation without a manual reload,
old-code rejection, joining from a second account, failed poll draft retention,
two private votes, an honest tied result, leaving, confirmation and deletion.
The core API scenario covers cookie/bearer ownership, unchanged create retries,
changed-intent/stale-revision denial, refresh/addition, timezone-aware reminders,
reflected-state preservation and private cache headers.

An earlier run recorded an incomplete export response after a required backend
read error. Its failure evidence is retained. The final dashboard test waits for
the save to finish and checks export HTTP success before inspecting the data;
the complete final run passed. These checks do not establish continuous upstream
availability, production load capacity or real-device behavior.

The reproducible stale invitation under Next 15 is retained in the diagnostic
logs. On the final runtime, the same isolated check reports one mutation, an
updated visible code, zero pending forms and verified disposable cleanup.

The AI contract evaluation covers 136 explicit synthetic cases across grounding,
decoding, criteria uncertainty, memory review/privacy and English safety routing.
It performs no provider calls and does not measure model semantic accuracy.
Memory adversarial cases prove that drafts are not saved automatically; they do
not prove a model can identify every false assertion. See `AI-EVALUATION.md`.

The bounded live verifier is prepared and tested locally. Its prerequisite guard
was exercised without opt-ins and correctly refused to create a fixture or call
a provider. That refusal is not a live AI pass.

## Remaining external verification

Live NVIDIA interpretation, extraction and recap quality require a private NVIDIA
key, an opted-in disposable account and accounted provider attempts. The current
environment has no NVIDIA key. Recommendations from catalog specifications are
provisional until that evaluation runs. Manual workflows remain usable with AI off.

Public operator/contact details, verified retention and production provider terms,
HTTPS hosting, actual email/OAuth delivery and real-device push remain separate
public-release checks. They were deferred with the owner rather than invented.
Browser emulation does not establish real-device or native mobile behavior.
No claim is made that every conceivable comparison can be answered correctly:
unknown meanings or measurements require user input, and unsupported conclusions
must remain uncertain.
