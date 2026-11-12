# Comparison and feature reliability — 28–29 October 2026

The reported comparison failure did not include an error message or inputs. Ordinary comparisons passed the first hosted browser run. Further testing found specific failures in copied criteria, incomplete drafts, AI interpretation and refreshed profile memory; these are repaired below. This does not establish that every possible input or external service will always work.

## Repairs

- A journal result's **Add criteria to this comparison** link previously opened an empty criteria draft, then validated its missing criteria before showing the editor. The options step now requests context without submitting unfinished criteria. The chosen mode and draft stay local until review; the server still requires valid, explicitly confirmed criteria before saving.
- Returning from an unfinished criterion to Options no longer traps the user behind the same validation. Draft options, definitions and criteria remain editable.
- Duplicate names, including differences only in capitalization or surrounding spaces, now produce a specific rename/remove message. Previously, silently combining names such as `Tea` and `tea` could leave their definitions unmatched and trigger an unrelated details error. Correcting the name keeps the draft usable and opens context review.
- Typed alternatives now open a deterministic context review without resolving or calling optional AI. Natural-language questions retain optional interpretation. A model that paraphrases away the original alternatives falls back to the user's explicit phrases. The manual parser excludes setting prefixes and a goal after the question from the alternatives.
- Literal option names such as `__proto__` now survive the React server/client boundary with their definitions and criteria intact. Comparison requests and results use a bounded JSON envelope, and the page passes saved comparison data as JSON. Existing server validation and ownership checks still apply. Browser checks verify saved details, copied details, criteria values and the selected result after a reload.
- Profile belief and extracted-memory lists reset when the memory generation changes. An old in-flight search cannot restore erased notes. Ordinary refreshed belief props also update the displayed list. Failed preference removal stays inline and can be retried.
- Theme changes now switch colors together. Browser accessibility checks caught intermediate low-contrast colors when inputs and buttons animated separately from their backgrounds.
- Browser test isolation now clears the Lightning-specific NVIDIA key as well as other provider keys. Tests intended to run without AI cannot inherit that key from the local environment.

## NVIDIA development verification

The private configuration had NVIDIA credentials but lacked the accounting settings required to activate AI. The development setup was applied without printing or changing credentials; public launch remains false. The configuration gate now passes with AI required.

NVIDIA still lists free prototype endpoints for [Lightning](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b) and [Gemma](https://build.nvidia.com/google/gemma-4-31b-it). This is development access under the [NVIDIA FAQ](https://docs.api.nvidia.com/nim/docs/product), not a production service guarantee.

The first six-operation synthetic run completed two interpretations, fell back on two others, and timed out on Gemma memory extraction and recap. Development configuration now selects Lightning for all short language tasks, with Gemma retained as a bounded fallback. The revised run completed **five of six** operations; one game interpretation used the editable manual fallback. A separate single-question diagnostic then succeeded and preserved the explicit setting and both alternatives. This remains an intermittent provider limit; the earlier failures are retained, not replaced with the successful retry.

The revised extraction and recap each completed in approximately 1.1 seconds in this small sample. This is not a latency guarantee or semantic-accuracy benchmark. Memory suggestions still require explicit user review. Three AI fixture accounts across these runs were deleted and cleanup verified. No real-user notes were sent. The separate diagnostic retains only the synthetic question's response locally; standard live reports omit generated text.

## Verification

The final bounded source suite passed **678 tests, zero failures and zero skips**. TypeScript, the Next.js 16.4.3 Webpack production build and generated SQL consistency checks passed. No migration was required or applied.

All **8 authenticated browser scenarios passed in both production and Turbopack development mode**. Each run also passed **20 hosted check groups**, with all three disposable accounts removed. The **4 public browser scenarios** passed after the theme repair. Public checks preceded the comparison transport change; both authenticated runs cover that change. The final duplicate-name validation repair was added after the development run and verified by the source suite and final production browser run. Evidence is retained in `.local/evidence/2026-10-28-reliability/`, with final counts, cleanup status and the source archive hash in `final-verification.json`.

The browser suite also corrected two test-only problems found in development: selectors now distinguish a visible dashboard card from hidden streamed markup, and screenshots preserve caret styles to avoid introducing a hydration mismatch before the application hydrates.

| Area | Executed coverage |
| --- | --- |
| Compare | Plain and Unicode labels, private terms, prototype-like labels, context review, journal and criteria modes, copy, reload, refresh, extra options and unsupported-evidence behavior |
| Retry | A committed save with a deliberately lost browser response, unchanged-input retry and exactly one persisted comparison |
| Decision loop | Choose, reminders, reflection, resume, history and analytics |
| Discover and setup | Six foundation questions, skipped answers, topic changes, durable responses and explicit pattern review |
| Circles | Private invitations, voting, ties, owner deletion and foreign-owner restrictions |
| Profile and privacy | Profile edit, export, belief review, memory reset, decision-history deletion, account deletion and ownership checks |
| Public UI | Login/signup/reset layout, password visibility, links, light/dark, keyboard, reduced motion, narrow screens and automated accessibility checks |

The production navigation sample measured Ask, Journal and Discover at 419, 416 and 1,420 ms on first visits, then 75, 80 and 85 ms on repeat visits. These six local samples include automation overhead; they are not a population benchmark or an improvement percentage.

Email delivery, an interactive Google OAuth round trip, actual push delivery to a physical device, and native mobile behavior are not established by these checks. Synthetic account setup uses the authorized development database and limits deletion to accounts created by each test run. External outages remain possible; no public deployment was performed.

## Reproduce

Use Node 24.19.0 from `.node-version` (the bundled test runtime is available in this checkout). The globally installed Node 24.14.0 is below the repository's declared engine range. The development browser run nevertheless used that installed version and passed; source tests, the production build and the final production browser run used the bundled supported runtime.

Run `npm test`, `npm run build`, `npm run sql:check` and the documented disposable-account browser harness. Set `NUDGE_E2E_SERVER_MODE=development` to run browser checks against the same Turbopack development mode used by `npm run dev`; the default is the production build. Private credentials must remain in local environment configuration.
