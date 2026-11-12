# Nudge web implementation — 24 October 2026

This is the first implementation batch from `NUDGE-PRODUCT-MOBILE-AUDIT-2026-10-23.md`. Web completion remains the priority; the native mobile app follows it, using the same backend and reusable application services. This batch does not implement or publish a mobile wrapper.

## Changes

- New accounts reach a comparison before optional profile questions. Signup confirmation defaults to Decide, intentional local return paths survive authentication, and onboarding can be exited without saving. Existing decision makers can reach Today without completing onboarding.
- The mobile web bar contains Today, Decide and Journal. Discover, check-ins, patterns, profile and circles remain accessible. Today prioritizes a due check-in and an actual past outcome over streaks and a memory-strength meter.
- The dated outcome card shows the selected option and the user's real rating. Its journal link opens the exact record across pagination; Decide again copies the prior options/context, requiring fresh meaning and criteria confirmation.
- A reflection needs only an explicit 1–5 rating. Extra answers and notes are collapsed and optional. Unanswered fields stay unknown. Duplicate taps are blocked; failed requests preserve the draft. The atomic database save still owns idempotency and learning.
- Saving a reflection no longer invokes AI extraction. Comparison reasons also stay deterministic; the previous explanation action remains a no-op for compatibility. Other optional AI actions retain consent/quota protections. Privacy text describes these boundaries.
- Comparison evidence is loaded by verified owner. Pagination handles lower server row caps; the 80-history limit applies only after category, setting, reset and forgetting filters. Forgotten aliases in one setting cannot hide choices in another. Partial retrieval fails rather than creating a partial ranking.
- Missing legacy evidence status cannot display supported scores until refreshed. Relative-fit language describes score gaps, without claiming a probability of a good result. The random-choice control was removed. Today's everyday suggestions exclude game/project-specific preferences.
- Safety scope checks include the confirmed setting, goal, option details and expected outcome, in addition to option labels. Existing uncertainty-aware criteria scoring is unchanged: no invented measurements or unsupported winner.

No schema migration or new dependency is required. The shared evidence retrieval and reflection validation services can later be reused behind a versioned API.

## Verification

Verification results are recorded in `audit-2026-10-24/`:

- **244 automated tests passed**, with no failures or skips (`unit-tests.log`). This includes owner/reset/forgetting boundaries, low database row caps, missing legacy evidence state, conservative criteria winners, optional reflection fields, duplicate submissions and failure recovery.
- **TypeScript check and production build passed.** Generated SQL consistency checks passed; no database migration was added by this batch.
- **Two authenticated production-browser tests passed** against disposable accounts in the owner-authorized existing Supabase project (`hosted-browser.log`, `web-loop-hosted.json`). They cover first-decision access and optional onboarding, comparison/choice/reflection, dated outcome and decide-again, setting and criteria review, refresh/reload, Discover topic changes, export, profile changes and account deletion.
- **Three public production-browser tests passed** (`public-browser.log`), covering public and policy links, keyboard interactions, contrast/accessibility, themes, mobile layout and reduced motion.
- The dashboard passed automated accessibility and overflow checks at 320, 375, 768 and 1440 pixels in both themes, plus recorded-outcome checks at 375 and 1440 pixels. Screenshots were reviewed for the desktop and mobile layouts. These checks do not establish conformance across every assistive technology or device.
- **Hosted fixture cleanup passed**, including the analytics deletion check; the private recovery journal is absent after the successful run.
- The public launch configuration check still fails on 16 missing/invalid deployment declarations (`release-check.log`), including real operator/contact, hosting/region, retention, HTTPS URL and AI vendor/privacy information. No values were invented and the public-launch flag remains off.

The initial browser attempt encountered a local-server DNS restriction; it cleaned up its accounts. The next run exposed a test wait that mistook the button's temporary “Saving…” label for completion. The corrected test waits for persisted “Reflected” state, and the full authenticated run passes. Those failed attempts and their cleanup results are retained alongside the successful report.

The hosted verifier uses only IDs created by its own run for cleanup. It keeps a private recovery journal until account deletion is verified. Browser provider calls are disabled so these checks do not claim live model quality or real push delivery. Reflection acknowledgement still waits for its database save and optional achievement evaluation; no response-time target is claimed.

## Remaining web roadmap

1. Supply actual operator/contact, provider, hosting, retention and production URL settings; pass the release gate and verify deployed auth/export/deletion and recovery.
2. Add minimal activation and completed-loop telemetry without journal text; reconcile disclosures and collection choices before enabling it.
3. Meter actual AI provider attempts/tokens/cost and enforce spend budgets. Evaluate the remaining AI features on reviewed ambiguous, mixed-language, unfamiliar-term and adversarial cases.
4. Add evidence snapshots and saved settings/domain aliases, retaining isolation and forgetting semantics. Require user review before treating newly extracted assertions as reliable evidence.
5. Extract the remaining application services and version a small API for the core workflow. Preserve ownership, retry, revision, generation and deletion behavior.
6. Complete deployed/browser/device regression and observed beta loops before wider launch. Then implement native Today/Decide/Journal and the remaining feature parity, native notifications and offline behavior against those shared contracts.

No public deployment, live AI evaluation, real device push verification or native-device testing is claimed by this implementation batch.
