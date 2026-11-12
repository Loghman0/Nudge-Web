# Nudge: Hindsight landing redesign

## Design read and scope

Reading this as: a personal decision-journal landing page for people making everyday choices, with a clear, reflective language, leaning toward a working hindsight ledger.

The owner selected Hindsight from three working concepts. Design variance 8: the ledger, connected evidence and off-grid composition come from decisions over time. Motion intensity 7: one short entrance and meaningful sorting, toggling, focus, menu and accordion transitions. Visual density 3: short introductions, generous space, details available by interaction.

The authenticated app routes, Supabase SQL, API routes, auth code and policy pages stay outside this change. The shared root font tokens retain their files/families; only their preload hints are disabled so the landing does not download four unused fonts. Preserve `/login`, `/signup`, `/`, all existing section anchors, the legal/support destinations and the existing free-plan facts. There is no guest CTA in the current app and no annual billing period to toggle.

## Baseline critique

The old page has a readable wordmark and consistent warm tokens, but its flower illustration does not show what Nudge does. Repeated centered headings and cards make the sections difficult to distinguish.

| Finding | Severity | Recommendation |
| --- | --- | --- |
| The hero's relationship metaphor obscures the decision journal | Moderate | Put the decision/reflection loop in a working sample |
| Mobile navigation hides section links without a menu | Moderate | Add a keyboard-complete sheet |
| Theme button is 36 x 36px and replay button 13 x 13px | Critical | Use at least 44px targets |
| FAQ targets range from 20 to 40px high | Moderate | Give every trigger a 56px minimum |
| Samples resemble personal data without consistent labels | Moderate | Explicitly label sample memory and keep it local |
| Copy says skips teach beliefs and circles combine profiles | Critical | Explain answered preferences and shared polls accurately |
| Many independent decorative loops compete with content | Moderate | Remove loops and animate meaningful changes |

Eye entry is the large serif hero heading, followed by the flower. Reading flow is repetitive heading/card/heading/card. CTAs use different capitalization and labels for the same signup intent. Preserve the existing simple route destinations, export/privacy links and single free plan.

Priority: show the learning loop, correct product claims, and make navigation/controls usable on mobile and keyboard.

The eight baseline captures cover 375, 768, 1024 and 1440px in light/dark. The captured inventory records main copy, all links, interactive controls and headings. No horizontal overflow appeared in those views.

## Research notes

Primary-site content and product-asset references were reviewed; no layout, testimonials or claims are copied.

| Reference | Useful principle | Pattern to avoid |
| --- | --- | --- |
| dayoneapp.com | Tie memory to revisiting an actual moment | Borrowing awards or encryption claims |
| getstoic.com | Make the first journal action understandable | Absolute privacy and broad health promises |
| rosebud.app | Show memory retrieval in context | Testimonial/logo walls without evidence |
| reflect.app | Explain connections between notes | Generic AI glow and magic framing |
| bear.app | Let typography and useful product detail carry the page | Borrowing another product's illustration language |
| culturedcode.com/things | Explain the product through concrete tasks | Imitating device screenshots |
| cosmos.so | Give collections a recognizable visual organization | An image wall without a decision-related purpose |
| capacities.io | Connect a concrete object to other information | Fake metrics and universal productivity promises |

Current implementation references: motion.dev/docs/react-layout-animations, motion.dev/docs/react-scroll-animations, motion.dev/docs/react-motion-value, motion.dev/docs/react-use-reduced-motion, tailwindcss.com/docs/theme, ui.shadcn.com/llms.txt, radix-ui.com/primitives, developer.mozilla.org/en-US/docs/Web/API/View_Transition_API, w3.org/WAI/WCAG22/quickref, web.dev/articles/vitals.

View Transitions and CSS scroll timelines are not required by this build; the chosen Motion/IntersectionObserver implementation has a complete baseline without those newer APIs. No design-intelligence database is available in this environment.

## Tokens

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | `#EDF2F7` | `#152234` |
| Working surface | `#F9FBFD` | `#203147` |
| Main text | `#253348` | `#E9EEF5` |
| Supporting text | `#536479` | `#BAC9DB` |
| Structural line | `#BECBDA` | `#4A5E76` |
| Accent | `#355DB9` | `#A6BFF0` |

Accent labels reuse the working-surface color in light mode and canvas color in dark mode. Both themes use the same semantic roles; components contain no raw color literals.

Type: Bricolage Grotesque, one family with a fixed optical/width instance and weight variation. Display 40-80px, section heading 32-52px, title 20-28px, body 16-18px, annotations 14px. Text stays below 75 characters per line. No second family is used for headline emphasis.

Radius rule: controls and inputs 12px, bounded working surfaces 24px; static content is grouped with space rather than cards. Spacing uses a 4px base. Z-index: content 0, sticky navigation 20, sheet overlay 50, sheet 60, tooltips 70. One subtle tinted shadow is reserved for overlays.

Motion: micro 180ms, standard 320ms, entrance 760ms, exit 200ms, stagger 40ms, ease-out `(0.16,1,0.3,1)`, spring stiffness 100/damping 20. Reduced motion removes spatial movement and entrances. Press compression and submit-to-success label feedback are the two advanced button behaviors.

## Two-pass plan

First pass proposed an asymmetric hero and several explanatory panels. Self-review found that repeated panels would recreate a SaaS card kit. The second pass replaces those with a horizontal learning sequence, an off-grid computed graph, a live comparison workspace, a tabbed capability list, a plain privacy statement and one pricing panel. The signature is evidence changing a recommendation, not a decorative graph or percentage.

| Section | Composition and mobile collapse |
| --- | --- |
| Hero | Left-aligned two-line heading and working reflection ledger; stack below 768px |
| How it works | One ordered ribbon: Choose, Reflect, Learn; vertical sequence on mobile |
| Your memory | Off-grid graph connected to an evidence inspector; graph fits its container and inspector stacks |
| Ask/decide | Editable comparison workspace with its own labeled sample memory; fields/results stack |
| Features | Accessible grouped feature tabs; tabs wrap and the detail sits beneath |
| Why Nudge | Full-width typographic statement with evidence examples, no comparison-card kit |
| More features | Useful capabilities organized within the feature groups, maintaining every content job |
| Pricing | One featured $0/month plan and actual limits; no invented tiers/toggle |
| FAQ | Accessible single-open accordion |
| Footer | Wordmark, original legal/support links, sharing and signup destination |

The selected interactive concept serves as the hero wireframe. The learning ribbon and graph/inspector layouts are represented directly in the implemented components rather than ASCII diagrams.

## Interaction catalog

| Element | Trigger | Change | Meaning |
| --- | --- | --- | --- |
| Navigation | A section enters view | Active underline moves | Location |
| Navigation | Hero leaves view | Solid nav divider appears | Hierarchy |
| Mobile sheet | Open, close, Escape | Panel slides from its trigger side; focus is trapped/restored | State |
| Theme | Toggle | Semantic palette changes | Requested appearance |
| Hero | Initial visit | One short coordinated entrance | Hierarchy |
| Hindsight ledger | Record reflection | Options reorder and reasoning updates | Learning from evidence |
| Learning ribbon | Scroll through section | Progress advances using a motion value | Ordered story |
| Memory graph | Select a node | Associated evidence appears | Inspection |
| Comparison form | Compare sample options | Local memory-based ranking and reasons update | Feedback |
| Feature tabs | Select category or arrow keys | Detail changes | Progressive disclosure |
| FAQ | Toggle question | Answer opens with grid-based height transition | State |
| Share | Native share/copy | Pending, confirmation or actionable error | Feedback |
| Controls | Press/focus/hover | Compression, visible focus, accent treatment | Feedback |

## Signature and retired patterns

The hindsight ledger is the signature: a recorded positive or negative reflection changes the next recommendation and its stated evidence. It demonstrates Nudge's decision/reflection loop with deterministic local data. It sends no input to Supabase or an AI provider and does not pretend to show the visitor's account.

Retired: petals, particles, twinkles, glow orbs, wave dividers, sticky-note numbers, equal feature-card rows, decorative AI sparkles, warm cream/terracotta/sage, serif headlines and landing Lucide icons. The replacements explain actual product behavior. Bricolage Grotesque and Phosphor are scoped to the landing; authenticated screens retain their existing type/icon systems. Existing working-file leftovers and images are untouched.

## Before/after critiques

### Baseline consistency and accessibility

| Element | Issue | Fix |
| --- | --- | --- |
| Signup CTAs | Several labels for one destination | Create account throughout |
| Feature explanations | Different metaphors for the same memory loop | Choices, reflections and inspected evidence |
| Section compositions | Repeated centered heading/card pairs | Distinct ledger, ribbon, graph, form, tabs and type layouts |
| Touch controls | Undersized replay/theme/FAQ triggers | 44px minimum, 48px standard, 56px+ FAQ |

What worked: clear wordmark, familiar login/signup destinations, public policy links and a simple free plan. Readability and recognizable navigation are retained. Baseline priorities were: show the journal's purpose, remove misleading learning claims, and repair mobile/keyboard controls.

### New-page critique 1

Overall: the heading establishes the purpose, and the ledger gives the visitor an action before asking them to sign up. The initial mobile ledger was too tall to fit the first viewport.

| Finding | Severity | Fix |
| --- | --- | --- |
| The mobile ledger made the opening section 962px tall | Critical | Shorten reasons; reduce vertical gaps and combine stage/reset row |
| A redundant “Fits you.” caption suggested evidence even for unknown options | Moderate | Remove it; retain explicit no-preference result |
| Decorative evening/date metadata competed with local-sample label | Minor | Remove it |
| A capture showed an active FAQ marker at the top after scrolling | Minor | Verify observer state settles before screenshots; regression-test return to top |

Eye entry: two-line heading, then Create account, then reflection controls. Reading flow: learning sequence, connected evidence, comparison, capabilities, privacy, price, FAQ. Emphasis is on making and reviewing a decision.

Consistency: use the same button family, one Phosphor icon style, semantic theme colors and the two functional radii. Accessibility: native links/buttons/inputs; labeled form; focus styling; Radix menu/tabs/accordion semantics; no hover-only explanation.

What works: the recommendation visibly changes, graph nodes expose evidence, the sample label sets expectations, and the layouts remain identifiable on mobile. Priorities: fit the hero, remove duplicate messaging, verify navigation and error feedback.

### New-page critique 2 and Chanel pass

Overall: the compact mobile ledger and quieter annotations let the hero and action lead. The graph and editable comparison make the product concrete without fabricated account screenshots.

| Finding | Severity | Resolution |
| --- | --- | --- |
| Shared root font preloads downloaded four unused fonts on the landing | Critical | Disable preload hints only; preserve font files, families and app styles |
| The initial landing font retained unused axes/glyphs | Moderate | Fix optical/width axes, retain 400–700 weights and a Latin-1/punctuation subset |
| Signup/login prefetch could compete with landing loading | Minor | Disable automatic prefetch on these landing links; destinations preserved |
| Public launch checker still lacks real operator facts | Critical for publishing | Owner must supply facts; preserve private/noindex mode |

Chanel pass: remove the decorative evening/date label and redundant “Fits you.” accessory. This improves hierarchy without removing evidence or controls. Final priorities are deployment configuration and field performance monitoring, followed by any future signed-in visual redesign as a separate task.

Contrast: checked semantic text/background pairs, including accent buttons and tinted/selected surfaces, in both themes. The minimum measured text ratio is 5.22:1. Automated WCAG-tagged checks report zero violations in the tested desktop/mobile themes and opened sheet. Readability is supported by 16px body text, 14px minimum annotations and constrained measures. Focus and selected states use outlines, borders, weights or semantic attributes as well as color.

## Files and dependencies

Changed: `src/app/page.tsx`; `src/components/landing/{navbar,hero,sections,showcase}.tsx`; root `src/app/layout.tsx` (two preload flags); `package.json`, lockfile; third-party notices; intentional public theme assertions in `e2e/nudge.spec.ts`; this report and release-verification notes.

Added: `src/components/landing/{button,interactions}.tsx`, `{data,sample-model,motion-tokens}.ts`, `hindsight.css`; `src/fonts/BricolageGrotesque-latin.woff2`; `licenses/Bricolage-Grotesque-OFL.txt`; `tests/landing-sample.test.ts`; `e2e/landing.spec.ts`; public evidence files under `evidence/landing/`.

Install commands used for new packages:

```sh
npm install --save-exact motion@14.2.0 @phosphor-icons/react@2.1.10 @radix-ui/react-accordion@1.3.1 @radix-ui/react-dialog@1.3.1 @radix-ui/react-tabs@1.2.1 @radix-ui/react-tooltip@1.4.1 @radix-ui/react-slot@1.5.0
npm install --save-dev --save-exact @axe-core/playwright@4.13.0 lighthouse@13.5.0
```

A fresh checkout uses `npm ci`; no package install is needed for existing dependencies. Existing Framer Motion and application icon dependencies remain because authenticated screens use them. The new font is self-hosted and licensed under OFL; runtime and font notices are updated. No external font request is introduced.

## Verification and evidence

Measured on 2026-10-13 using a production Next.js build and Chromium. Lighthouse 13.5.0 mobile uses default simulated mobile throttling; desktop uses 1440×900, 40ms RTT, 10Mbps and no CPU slowdown. These are controlled local measurements, not field data.

| Check | Result |
| --- | --- |
| `npm run typecheck`, inside `npm run verify` | Passed |
| `npm test`, inside `npm run verify` | 110 passed, 0 failed, 0 skipped |
| `npm run build`, inside `npm run verify` | Passed |
| `npm run test:e2e` | 3 passed, 2 skipped (authenticated/deletion fixtures not supplied for this landing-only run) |
| `npm audit --json` | 0 known advisories at the recorded check |
| `npm run release:check` | Blocked by real owner/deployment facts previously deferred by the owner |
| Previous-ZIP scope comparison | 93 protected files identical; SQL unchanged; root layout only two preload flags |

| Lighthouse | Mobile | Desktop |
| --- | --- | --- |
| Performance | 92 | 100 |
| Accessibility | 100 | 100 |
| Best practices | 100 | 100 |
| SEO | 63 | 63 |
| LCP | 2.72s | 0.43s |
| CLS | 0 | 0 |
| Total blocking time | 232ms | 0ms |

The first mobile run was 8.71s LCP. Removing four unused font preloads and reducing the landing font from 169,596 to 32,812 bytes brought the final cold-load result to 2.72s. Mobile remains 0.22s above the requested 2.5s target. This deviation is recorded rather than claimed as a pass; deferring more below-fold client code and measuring actual deployed delivery are the next performance work. Desktop LCP and both CLS measurements meet the thresholds. Total blocking time is independent of INP.

Controlled Event Timing captured reflection, graph, FAQ, theme and menu interactions; maximum observed duration was 48ms. This is a local latency check, not field INP. Lighthouse cannot certify production INP. Collect actual traffic after launch for p75 Core Web Vitals. SEO 63 comes from intentional noindex/private preview configuration; the public-launch flag remains off.

Evidence included in the ZIP:

- `evidence/landing/verify.txt`, `browser-tests.txt`, `release-check.txt`, `dependency-audit.json`, `scope-verification.json`, `contrast-pairs.json`.
- `evidence/landing/performance/summary.json`, `lighthouse-mobile.json`, `lighthouse-desktop.json`, `interaction-events.json`.
- Eight `evidence/landing/before/before-{375,768,1024,1440}-{light,dark}.png` captures.
- Sixteen `evidence/landing/after/after-{375,768,1024,1440}-{light,dark}-{no-preference,reduce}.png` full-page captures and the matching sixteen `hero-…` viewport captures.
- Baseline and final inventories record headings, links, controls and target dimensions.

Browser scenarios exercise positive/negative/reset reflection, graph evidence, blank validation/error focus, unsupported and evidence-matching comparison, tab arrow keys, single-open FAQ, share clipboard, mobile-sheet focus trap/Escape/focus return/anchor destination, and nav return-to-top. No horizontal overflow at 320/375/768/1024/1440px; hero fits an 844px viewport at 375/1440px; headline is two lines; reduced motion removes the entrance. Axe covers WCAG 2/2.1/2.2 A/AA tags in light/dark, mobile/desktop and an opened sheet. These bounded automated checks are not a formal accessibility certification.

## Pre-flight review and remaining facts

- [x] Design read, dials, tokens and revised two-pass plan recorded.
- [x] Hindsight composition; one accent/neutral family, consistent theme/radii, no pure black/white surfaces.
- [x] Landing uses Bricolage Grotesque; existing app fonts stay outside its scope.
- [x] Landing-visible copy checked for separator em/en dashes and invented claims; signup intent is consistently Create account.
- [x] Hero/nav/targets/overflow checked; distinct layout families and explicit mobile collapse.
- [x] Accessible primitives, focus/keyboard states, sample labels, themes and reduced motion tested.
- [x] Computed graph/live components; no fabricated account screenshots, logos, testimonials, prices or customer metrics.
- [x] Routes, anchors, legal/support links and price facts preserved; protected-source comparison passed.
- [x] Typecheck, tests, build and advisory audit passed; measurement boundaries and performance deviation explained.
- [x] Font license and third-party notices included.
- [ ] Owner must supply public-launch facts: real operator name/country/address, working support/privacy email, hosting provider, data region, transfer safeguards, verified backup/log retention and HTTPS app URL. Run `npm run release:check`; enable `NUDGE_PUBLIC_LAUNCH=true` when ready.
- [ ] Mobile cold-load LCP remains slightly above target; field INP is unmeasured.

Spatial movement uses transforms/opacity. FAQ grid-row expansion and control/theme color transitions are intentional functional exceptions to a literal transform/opacity-only rule. Reduced motion disables these transitions. No decorative loops or custom scroll-state listeners remain.

No photography, customer quotes or other commercial assets are needed for this design. No fresh SQL or database reset is required. Existing `sql/02_UPDATE_EXISTING.sql` and `sql/03_VERIFY_DATABASE.sql` are unchanged. Prior authenticated-browser evidence is preserved in `RELEASE-TESTING.md`; fixtures were not reused for this landing-only run. Production Google approval, mail, replacement provider keys, push and scheduler verification retain their previous launch boundaries.

