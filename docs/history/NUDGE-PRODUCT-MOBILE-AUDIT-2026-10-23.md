# Nudge: product, engineering and mobile audit
**23 October 2026 · Source review and current official-source research · No application changes**

## Executive summary
1. **Verdict: Not ready for unrestricted public launch.** Suitable for a supervised private beta after deployment configuration and smoke checks.
2. **Biggest strength:** inspectable decision history, explicit criteria, and abstention when evidence cannot support a winner.
3. **Biggest risk:** users expect useful answers immediately, but an empty journal provides little evidence and Nudge does not verify outside facts.
4. **Action 1:** focus launch on recurring everyday choices and learning from outcomes.
5. **Action 2:** replace the onboarding questionnaire path with a first useful decision.
6. **Action 3:** finish the failing release configuration and verify the actual deployed service.
7. **Action 4:** make feedback fast, improve evidence retrieval, and measure completed decision loops.
8. **Action 5:** introduce shared services and a small versioned API; build an Expo app only after retention is demonstrated.

### Scope, assumptions and evidence
I assume an unlaunched product, a solo developer, an initial English-language audience aged 16+, and eventual iOS and Android support. No production analytics, billing statements, user interviews, or measured retention were supplied. Therefore audience, willingness to pay, conversion, and growth estimates below are hypotheses, not findings.

**Freshly checked:** application routes, comparison services, prompts and adapters, consent/authentication, onboarding, profile/deletion, Discover, reminders, export, migration functions, dependency manifest, and the local release configuration. The release check reports missing deployment/operator settings. No secrets are reproduced.

**Historical evidence, not rerun today:** the [18 October verification record](C:/Users/User/Desktop/Projects/Nudgenew/audit-2026-10-15/criteria-verification.json) reports 219 passing tests, build/type checks, two authenticated and three public browser scenarios, and 13 grouped hosted checks with disposable-account cleanup. It explicitly excludes deployed-app verification, live paid-AI quality benchmarking, and real-device push. The final one-line copy/resume change was covered by subsequent build/type/browser checks, not another full 219-test run.

This audit did not conduct a new penetration test, accessibility certification, load test, device session, or live-provider evaluation. Scores below assess demonstrated readiness, not an assurance that every feature is correct.

**Current stack:** Next.js 15.5.27, React 19, TypeScript, Tailwind 4, Supabase Auth/Postgres, and optional server-side AI adapters. This comes from [package.json](C:/Users/User/Desktop/Projects/Nudgenew/package.json), its dependency declarations, and **getAi()/resolve()** in [AI selection](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/ai/index.ts). The landing page currently advertises $0/month in **Pricing()**, [landing sections](C:/Users/User/Desktop/Projects/Nudgenew/src/components/landing/sections.tsx). No monetization implementation is established by this review.

## Phase 1 — Purpose and audience

**Proposed purpose:** Nudge helps people stop repeatedly second-guessing ordinary choices by showing what they previously chose, what happened, and what remains unknown.

There is no evidence that Nudge solves this better than every alternative. That is the problem it should attempt to own, then prove with user behavior. “Correct answers about literally anything” is neither a credible promise nor an achievable launch scope.

**What exists:** users compare up to eight alternatives using personal-history scoring or up to five explicit numerical criteria; clarify setting and meaning; record a choice; return to reflect; inspect/correct/forget memory; answer optional Discover questions; and use shared polls. AI interprets or summarizes language rather than supplying the ranking. See **compareOptions(), chooseOption(), askNaturally()** in [decision actions](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/ask/actions.ts), **assessCriteria()** in [criteria](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/comparison-criteria.ts), and **submitReflection()** in [history actions](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/history/actions.ts).

| Target segment | Real situation and current alternative | Reason to switch / reason not to | Expected return, to validate |
|---|---|---|---|
| Adults who repeatedly overthink leisure and routine choices — primary | “Quiet evening or go out?”, “Which activity suited me last time?” Uses memory, a friend, notes, or a chatbot | Switch for immediate recall of their own outcomes. Won't switch if filling forms takes longer than deciding | 2–4 useful sessions/week |
| People already keeping a short reflection or habit journal — secondary | Trying to understand which routines they actually enjoy. Uses Daylio, Day One, notes | Switch for a clear link from choice to outcome. Won't switch for another generic journal or unsupported causal claims | 3–5 quick check-ins/week |
| People making occasional structured purchases or project choices — secondary experiment | Comparing cost, time, reliability, or effort. Uses a spreadsheet or a decision matrix | Switch for reusable criteria and honest unknowns. Won't switch if they must manually research every value and still receive less flexibility than a spreadsheet | Episodic, often monthly; weak subscription fit |

**Need verdict:** the underlying need is recurring, but current evidence establishes a functional product, not demand. The questionnaire and comparison engine can produce an impressive demo while users never return. A useful history requires completed outcomes; counting questions answered is a poor substitute.

Start with everyday leisure/routine choices. Do not market to medical, legal, investment, emergency, or clinical-care decision use cases. That matches the intended scope of **decisionScopeError()**, [scope guard](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/decision-scope.ts), although its English phrase checks do not reliably enforce that scope.

### The “mining or cutting trees” case
The correct sequence is: ask the setting; ask the goal; establish relevant facts; then compare. “Minecraft” alone still leaves version, current inventory, game mode, constraints, and objective unresolved.

The current **groundUnderstanding()**, [interpretation](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/decision-understanding.ts), checks extracted alternatives/domain/goal against supplied text. This reduces invented interpretations. It does not establish the truth of anything stated. **compareOptions()** saves goal/details as context; **rankCandidates()**, [engine](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/decision-engine.ts), scores preferences/history/novelty, not game mechanics or hard eligibility.

Recommendation: support arbitrary *labels and settings*, while making evidence capabilities explicit:
- **Personal fit:** “What suited me before?”
- **Compare supplied facts:** “What follows from these measurements and priorities?”
- **Research needed:** “These facts are missing.” No winner until usable evidence exists.

Do not build a universal fact database now. If one domain repeatedly attracts retained users, add a narrow licensed/official data connector with entity/version identifiers, source timestamps, units, provenance, and expiration. Retrieved text must remain untrusted data; an absent source or conflict must preserve “unknown.”

## Phase 2 — Competitors

Prices below are publisher-listed US dollar examples retrieved for this audit, not local checkout quotes. Product strengths are supported by publisher descriptions; weaknesses and differentiation are my assessment. I did not hands-on benchmark these apps. **No exclusive capability is established:** another product may reproduce this workflow with templates, prompts, or new features.

| Product | Platform | Best at | Weakness relative to the proposed Nudge use case | Verified price / uncertainty | Nudge opportunity, not proven exclusivity |
|---|---|---|---|---|---|
| ChatGPT | Web and mobile ecosystem | Broad conversational help and flexible workflows | A specific repeat-choice/outcome workflow still needs to be established by the user | Free; Plus $20/month, per [official plan documentation](https://learn.chatgpt.com/docs/pricing) | A fixed, low-effort decision record with evidence and scheduled follow-up |
| Claude | Web, desktop, mobile | Broad reasoning, writing, projects and connected work | Broad scope can be unnecessary for a two-option personal routine | Free; Pro $20 monthly or $200/year, [Claude pricing](https://claude.com/pricing?content_language=English) | Less setup and a consistent choice → outcome interaction |
| Gemini | Web/mobile and Google ecosystem | Research and integration with Google apps | Nudge cannot compete on ecosystem reach; can compete on a narrowly designed interaction | Paid Google AI tiers verified; current dollar amount did not render reliably, so **not verified**, [Google plans](https://one.google.com/about/google-ai-plans/) | An inspectable personal decision ledger independent of a general chat |
| Decision Mentor | Personal iOS/Android; enterprise web workspace | Structured AHP comparisons, criteria hierarchies and AI mentoring | Formal pairwise comparison is more work for minor daily choices | Free up to 3 active personal decisions; Pro $4.99/month, [publisher pricing](https://www.decisionmentor.app/pricing) | Faster repeated-choice learning; basic weighted criteria are already a crowded feature |
| Todoist | Web and mobile | Capture, reminders and execution | Primarily organizes action rather than evaluating how a choice turned out | Free; Pro $60/year ($5/month equivalent), [pricing](https://www.todoist.com/pricing/) | Outcome reflection connected to the original alternatives |
| Day One | Web, iOS, Android, Mac | Rich journaling, recall and privacy features | More general life capture than explicit alternative comparison | Basic free; Silver $49.99/year; Gold $74.99/year, [plans](https://dayoneapp.com/plans/) | Structured decision/outcome links; do not claim memory or AI reflection is unique |
| Daylio | iOS/Android | Very fast mood/activity capture, patterns and habits | Records what happened more directly than why one option beat another | Free tier verified; current Premium dollar price **not verified**, [product](https://daylio.net/) and [Premium](https://daylio.net/faq/docs/daylio-faq/about/daylio-premium-features/) | Match its low effort while preserving the decision that preceded the outcome |
| Rosebud | Web and mobile | Guided AI journaling, personal growth, weekly reflection | A broader conversational commitment than a quick decision check-in | Publisher advertises Bloom $12.99/month or $107.99/year; free/trial eligibility should be checked at checkout, [Rosebud](https://www.rosebud.app/) | A shorter, structured interaction without implying therapeutic capability |

**The defensible gap is not “AI + memory.”** It is a trusted collection of user-confirmed, context-specific decisions and outcomes, captured with almost no effort and returned at the next relevant moment. That can create user value and switching friction; it is not a technical moat yet.

To beat “just ask a chatbot,” Nudge must do three things visibly:
1. Bring back the relevant previous outcome without the user searching.
2. Separate observed evidence from suggestions and unknowns.
3. Complete the loop in seconds, including the later check-in.

The closest practical competitors are a person's memory, notes app, and existing journal. More questions and more model choices do not defeat those alternatives.

## Phase 3 — Readiness audit

Scale: 1 = blocking gaps; 2 = substantial work; 3 = controlled-beta foundation; 4 = demonstrated release quality in the assessed scope; 5 = mature operational evidence. These are judgment scores, not measured percentages.

| Area | Score | Source fact and implication |
|---|---:|---|
| Core functionality | 3/5 | **compareOptions()/loadComparison()** persist comparisons; **assessCriteria()** conservatively handles missing values. A factual general adviser is absent, and goal/details do not enforce constraints. [Actions](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/ask/actions.ts), [criteria](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/comparison-criteria.ts) |
| Reliability and bugs | 3/5 | **create_comparison_once()** gives durable retry identity; revision/generation checks help avoid stale writes. Historical tests are substantial, but deployed OAuth, real push and live AI are unverified here. [Migration 00006](C:/Users/User/Desktop/Projects/Nudgenew/supabase/migrations/00006_privacy_boundaries.sql:89), [verification record](C:/Users/User/Desktop/Projects/Nudgenew/audit-2026-10-15/criteria-verification.json) |
| Security and privacy | 3/5 | **updateSession()**, **recentDeletionUser()**, **deleteMyAccount()** verify identity and deletion freshness; AI consent and owner-scoped operations exist. This is not an independent penetration-test result. [Session](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/supabase/middleware.ts:9), [fresh authentication](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/auth/recent-deletion-session.ts:13), [deletion](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/profile/actions.ts:179) |
| Onboarding | 2/5 | **OnboardingFlow()** leads with profile fields, optional questions and a finish step; **DashboardPage()** redirects unfinished users there. Questions are skippable, but value still comes late. [Flow](C:/Users/User/Desktop/Projects/Nudgenew/src/components/onboarding/onboarding-flow.tsx), [dashboard](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/dashboard/page.tsx:38) |
| Performance | 2/5 | **submitReflection()** awaits optional extraction before returning; **DashboardPage()** loads nine datasets and fails the entire page if any fails. No current deployed p95 or Core Web Vitals evidence. [Reflection](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/history/actions.ts:52), [dashboard](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/dashboard/page.tsx:38) |
| Error handling | 3/5 | **understandDecision()** falls back to editable manual input; **DecideClient.refresh()** preserves a concurrently typed option. Some failures still become generic page errors; long-running jobs lack a durable client status contract. [Intake](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/decision-intake.ts:11), [client](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/ask/decide-client.tsx:70) |
| Legal and data basics | 1/5 | **legalConfig**, **policies** and the **check-release.mjs top-level validator** expose unfinished operator, contact, retention, provider disclosure and host configuration. Policy templates alone are insufficient. [Config](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/legal/config.ts), [notices](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/legal/content.ts), [release validator](C:/Users/User/Desktop/Projects/Nudgenew/scripts/check-release.mjs) |
| Mobile backend | 2/5 | **createClient()** depends on Next cookies; core operations are server actions. There is no application /api/v1 decision transport in the route inventory. Supabase supplies a reusable token/RLS foundation, not a finished mobile API. [Cookie adapter](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/supabase/server.ts:7), [actions](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/ask/actions.ts) |
| Retention evidence | 1/5 | No measured activation or cohort-retention dataset supplied. Existing features are not proof of recurring use. |

### Concrete findings and fixes

| Priority | Finding, with function evidence | Required response / acceptance |
|---|---|---|
| P0: public launch | Fresh local release validation fails. **check-release.mjs**, top-level validator, checks real operator/contact/host/region/retention/AI disclosure and HTTPS settings. [Source](C:/Users/User/Desktop/Projects/Nudgenew/scripts/check-release.mjs) | Supply verified values; pass the check; verify the same values on the deployed host. Do not merely toggle public launch |
| P1: perceived intelligence | **rankingConfidence()** calls a score gap ≥0.12 “high”; this is not calibrated outcome confidence. **historyScore()** treats an unreflected choice as mildly positive. [Engine](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/decision-engine.ts:267) | Label preference separation honestly, show evidence counts, and distinguish “chosen” from “worked well”; evaluate on held-out outcomes before predictive claims |
| P1: retrieval correctness | **loadMemory()** fetches the newest 80 decisions by category, then filters by domain in JavaScript. Eighty newer decisions in other settings can hide relevant older history. [Source](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/ask/actions.ts:77) | Filter/index by a stable domain ID before the limit. Regression case: relevant decision older than 80 unrelated-domain decisions must remain eligible. This failure scenario is inferred from code order, not reproduced against a live account |
| P1: scale and completeness | **loadMemory()** reads preferences and forgotten nodes without explicit pagination. **DashboardPage()** similarly fetches all active nodes. Server row caps may silently truncate. [Memory loader](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/ask/actions.ts:77), [dashboard](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/dashboard/page.tsx:38) | Scope relevant evidence in SQL and use bounded aggregate/cursor queries. Test beyond the configured row cap |
| P1: fast feedback | **submitReflection()** awaits **extractMemoriesFromNotes()**, whose deadline is six seconds, after committing the reflection. [Source](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/history/actions.ts:18) | Acknowledge the committed reflection first; process optional extraction in a durable, consent-checked job with retry identity |
| P1: memory trust | **extractProfileMemories()** and **extractMemoriesFromNotes()** save model-derived memories without per-item review; **createLanguageTasks()** permits “strongly implied” memories. [Intake](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/profile-memory-intake.ts:8), [prompts](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/ai/language-tasks.ts:54) | Treat extractions as suggestions with source excerpts. Confirm durable constraints/preferences; keep transient statements out of identity-level memory |
| P1: unsupported safety expectations | **decisionScopeError()** is an English regex guard. **compareOptions()** checks title/options/expectedOutcome but not all goal/detail fields. [Guard](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/decision-scope.ts), [caller](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/ask/actions.ts:126) | Route all relevant text consistently; test paraphrases, mixed languages and jargon. Keep high-stakes ranking outside scope; a stronger model alone is not a safety guarantee |
| P1: AI cost control | **reserve_ai_request()** counts feature jobs; **createNvidiaProvider().run()** can use two attempts; onboarding calls two extraction methods. Adapters discard returned usage. [Quota](C:/Users/User/Desktop/Projects/Nudgenew/supabase/migrations/00009_decision_meaning_and_topics.sql:214), [routing](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/ai/nvidia.ts), [wire adapter](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/ai/openai-compatible.ts:15) | Meter attempts, token usage, latency and billed estimates; reserve a worst-case budget before requests and reconcile afterward |
| P2: settings fragmentation | **domainScope()** hashes normalized free text. “Minecraft Java” and “Minecraft Java Edition” remain separate settings. It also imports Node crypto. [Domain functions](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/decision-domain.ts:5) | Add saved domain IDs and explicit aliases/version fields. Do not silently merge settings; keep hashing server-side or remove it from the portable package |
| P2: export size | **GET()** uses **collectPages()** to fetch all rows, then produces one whole export. Database paging is not a small, paginated mobile response. [Export](C:/Users/User/Desktop/Projects/Nudgenew/src/app/api/export/route.ts:8), [collector](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/pagination.ts:3) | Keep export separate from browsing; move large exports to a downloadable job with expiry and ownership checks |
| P2: documentation drift | **Deno.serve()** in the check-in worker already claims/acknowledges durable delivery, while ARCHITECTURE.md still says delivery leases are outstanding. [Worker](C:/Users/User/Desktop/Projects/Nudgenew/supabase/functions/send-checkins/index.ts), [architecture](C:/Users/User/Desktop/Projects/Nudgenew/ARCHITECTURE.md) | Make one release checklist authoritative and link it to current verification artifacts |

### Privacy and prompt-injection boundary
**createOpenAiCompatibleProvider().complete()** and **anthropic.complete()** use server environment keys. **createLanguageTasks()** separates system instructions from user data and decodes bounded structured output; **groundUnderstanding()** checks extractive fields. These are useful controls, not proof of factual grounding or prompt-injection immunity. Free-text explanations/recaps are still model-generated prose. No tool-executing agent appears in these reviewed adapters. [Compatible adapter](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/ai/openai-compatible.ts), [Anthropic adapter](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/ai/anthropic.ts), [prompts](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/ai/language-tasks.ts), [grounding](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/decision-understanding.ts).

Do not claim end-to-end encryption: application services and optional AI can process journal text. The privacy notices themselves describe processor access in the **policies** declaration, [policy source](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/legal/content.ts). Keep request content, tokens and session state out of analytics/error logs.

### Exact launch verdict
**Not ready for an unrestricted public launch.** A supervised private beta is reasonable after:
1. Real HTTPS deployment, operator/support details, retention settings and vendor disclosure pass the release gate.
2. Deployed signup, Google OAuth, email verification/reset, logout, export and actual account deletion pass with disposable accounts.
3. Core compare → choose → reflect → recover/reload works on actual iOS Safari and Android Chrome, including poor connectivity.
4. Either live AI passes an agreed evaluation set and has budgets, or AI remains disabled for the initial beta.
5. Either scheduled push is proven on real devices with monitoring, or launch clearly uses in-app check-ins only.
6. Owner/RLS and account-deletion boundaries are rechecked on the final deployed schema; restore and incident/support procedures have owners.

The current database state was not revalidated in this audit. Previously applied migrations must not be blindly replayed or treated as newly verified.

## Phase 4 — Feature review

“Cut” means remove from the initial product surface or defer further investment, not erase user data.

### KEEP

| Feature | Platform | Reason |
|---|---|---|
| Decision → choice → outcome history | Both | The strongest basis for repeat value; **chooseOption()/submitReflection()**, decision/history actions |
| Honest abstention and explicit criteria | Both; complex editing optimized for web | Differentiates trustworthy calculation from invented certainty; **assessCriteria()** |
| Memory inspect/correct/forget, export and deletion | Both | Necessary for trust; **correctBelief(), forgetBelief(), deleteMyAccount()**, [profile actions](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/profile/actions.ts) |
| Opt-in reminders | Both | A natural reason to return when an outcome exists; **scheduleReflection()**, [reminder actions](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/history/reminder-actions.ts) |
| Discover topic switching and skipping | Both | User control prevents repetitive-topic frustration; **changeTopic()/answerQuestion()**, [Discover actions](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/discover/actions.ts:51) |

### CUT / DEFER

| Feature | Platform | Reason |
|---|---|---|
| Circles from first-launch navigation | Both | Separate collaborative problem, moderation burden and network dependence; **GroupsPage()/createPoll()**, [groups](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/groups/page.tsx), [actions](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/groups/actions.ts) |
| Streak freezes, prominent achievement counts and memory score | Both | Reward app activity rather than improved decisions; **DashboardPage()**, [dashboard](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/dashboard/page.tsx), and **computeKnowledgeScore()**, [knowledge](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/knowledge.ts:160) |
| Dice/random choice as a prominent result action | Both | Distracts from the evidence promise; **DecideClient.rollDice()**, [comparison UI](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/ask/decide-client.tsx) |
| Further broad question-bank expansion | Both | The current blocker is relevant evidence at decision time, not more generic questions; **loadQuestionState()**, [Discover](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/discover/actions.ts:34) |
| Universal research, autonomous agents and consumer BYOK at launch | Both | Proposed scope would add factual, operational and support obligations before demand is established |

### CHANGE

| Feature | Platform | Specific redesign |
|---|---|---|
| Onboarding | Both | One real choice first; ask profile facts only when needed. **OnboardingFlow()**, [flow](C:/Users/User/Desktop/Projects/Nudgenew/src/components/onboarding/onboarding-flow.tsx) |
| Navigation | Both | Today / Decide / Journal, with Discover under Today and settings in profile; current **MobileNav()/NavLinks()** expose five mobile tabs/eight sidebar destinations. [Navigation](C:/Users/User/Desktop/Projects/Nudgenew/src/components/app/nav-links.tsx) |
| Meaning review | Both | Reuse a visible, editable saved setting; ask one missing question at a time. Keep explicit confirmation when meaning changes. **DecideClient()**, [UI](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/ask/decide-client.tsx) |
| Feedback form | Both | “Would you choose it again?” Yes / No / Not sure first; optional details afterward. Currently **ReflectionForm()** includes rating plus four yes/no questions. [Form](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/history/reflection-form.tsx:33) |
| Fit/confidence display | Both | Lead with evidence and limitations; reserve numbers for expanded details. **rankingConfidence()** and **DecideClient()**, [engine](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/decision-engine.ts:267), [UI](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/ask/decide-client.tsx) |
| “About you” extracted memories | Both | Show pending suggestions with a source and confirmation; do not imply stored goals already enforce eligibility. **extractProfileMemories()**, [source](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/profile-memory-intake.ts:8), **loadMemory()**, [scoring inputs](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/ask/actions.ts:77) |

### ADD — ranked for retention and useful enjoyment

| Rank | Feature | Platform | Why |
|---:|---|---|---|
| 1 | Repeat a past decision in one tap | Both | Makes existing history useful at the next real moment; build on **loadComparisonSeed()**, [copy action](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/ask/actions.ts:288) |
| 2 | A one-question outcome card with undo | Both | Reduces the work needed to produce the evidence Nudge needs |
| 3 | “Last time…” evidence card | Both | Shows the exact dated outcome behind a suggestion, including how little evidence exists |
| 4 | Saved settings and a few reusable choice templates | Both | Avoids retyping domain and options; different games/projects remain separate |
| 5 | A deterministic weekly “what you learned” card | Both | Gives useful closure without generating flattering personality claims |
| 6 | Quick capture and share-sheet intake | Mobile | Captures a real decision where it arises; widget follows only if usage justifies it |
| 7 | “Missing fact that could change this result” | Both | Turns an uncertain comparison into an actionable next step without inventing values |

### First 60 seconds: current source-derived flow
This is a walkthrough inferred from source, not an observed user-timing study.

| Stage | Current experience | Likely friction |
|---|---|---|
| Arrival | **Hero()** offers Create account; **HindsightDemo()/CompareDemo()** provide labeled local examples. [Hero](C:/Users/User/Desktop/Projects/Nudgenew/src/components/landing/hero.tsx), [demos](C:/Users/User/Desktop/Projects/Nudgenew/src/components/landing/interactions.tsx) | Demo value may be mistaken for immediately available personal evidence |
| Account | **signUpWithEmail()** asks for eligibility and email confirmation; Google is another path. [Auth](C:/Users/User/Desktop/Projects/Nudgenew/src/app/auth/actions.ts:28) | Inbox/context switch can exceed a minute by itself |
| Setup | **OnboardingFlow()** starts with optional name/country/age/occupation and questions, then Finish | Optional does not mean effortless; skipping still requires navigating setup |
| First comparison | **DecideClient()** offers natural language, slots, meaning review, comparison basis and optional criteria | Too many concepts before the first personal result |
| Result | **compareOptions()** can correctly return insufficient evidence for a new account | Honest but potentially disappointing after signup/setup |

**Target flow:** 0–10 seconds choose a concrete example or type two options; 10–25 seconds confirm a necessary setting; 25–40 seconds see a useful comparison or the exact missing evidence; 40–60 seconds record a choice and choose when to check in. Offer account creation to preserve/sync the draft, without inventing anonymous personalized history. This is a design target, not a measured promise.

## Phase 5 — Fun and simplicity

**Signature interaction: “Pick now. Check once. Remember next time.”**

For a returning user with a saved everyday choice, one thumb can open a recent template, choose an option, and accept or change a reminder in under ten seconds. A later check-in asks one question. Arbitrary unfamiliar comparisons cannot honestly be reduced to ten seconds; the fast path is for known choices.

The satisfying moment should be *recognition*: “You tried this before; here is what you said afterward.” A subtle saved animation and optional haptic are enough. Do not award points for agreeing with the recommendation or punish a missed day.

Keep two clear actions on an outcome card: answer or dismiss. Include “Not yet” so reminders do not force premature outcomes. Use neutral lock-screen text, user-selected timing, quiet hours and a frequency cap. Do not require notification permission to use the product.

Offer detail progressively: first the two choices and one useful reason, then the evidence, then advanced criteria. When evidence is absent, “What matters most here?” is more useful than another generic Discover quiz.

## Phase 6 — Smart and cost-efficient AI

### Every AI path found in the application

The provider interface has six methods; production callers create the following paths. Model slots below are **NVIDIA defaults in source**, not evidence that those remote models are currently available or cheapest. Other selected providers can route all methods through one model.

| Call/path | Current behavior | Recommendation |
|---|---|---|
| Interpretation: **understandDecision() → provider.understandDecision()** | Consent/quota, six-second outer deadline, decoder and extractive grounding; NVIDIA parsing slot defaults to gpt-oss-20b. [Intake](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/decision-intake.ts:11), [NVIDIA routing](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/ai/nvidia.ts) | Use deterministic parsing for clear option lists; a small model for ambiguous language; ask for missing facts instead of spending on “stronger” guessing |
| Onboarding preferences: **completeOnboarding() → extractPreferences()** | Opted-in about text up to 2,000 characters; parallel with memory extraction. [Onboarding action](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/onboarding/actions.ts:12) | Remove from mandatory setup; if retained, combine preferences and memories into one schema and review before durable learning |
| Onboarding memories: **completeOnboarding() → extractMemories()** | Second request for the same input under one feature reservation; NVIDIA extraction default Gemma | Combined request above; track actual attempts rather than treating the job as one inference |
| Profile notes: **extractProfileMemories() → extractMemories()** | Up to 2,000 characters; saves bounded extracted memory with generation check. [Intake](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/profile-memory-intake.ts:8) | Extract only new user-approved notes; detect duplicates and show a confirmation preview |
| Reflection notes: **extractMemoriesFromNotes() → extractMemories()** | Notes ≥40 characters, up to three saved memories; still awaited by **submitReflection()**. [Reflection actions](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/history/actions.ts:18) | Durable background job after immediate save; transient event vs durable preference classification; no inference for empty or purely evaluative notes |
| Explanation: **explainDecision() → explainRecommendation()** | Skips criteria/insufficient evidence; sends score breakdown and no historical preference snapshot; NVIDIA default Ultra. [Explanation](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/ask/actions.ts:414) | Use deterministic reasons by default. A large model to paraphrase arithmetic has poor value; optional small-model wording only if usability tests justify it |
| Recap: **generateMonthlyRecap() → summarizeMonth()** | At least three decisions; newest 100 with sample flag; category counts and up to three positive/negative examples; NVIDIA default Super. [Recap](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/analytics/actions.ts:20) | Compute the report in code, generate optional prose once per changed report, label sample and reflected denominator |
| Legacy **parseQuestion()** | Present in **AiProvider/createLanguageTasks()**, but no production caller found in the searched source | Remove/deprecate unused interface surface; it should have zero ongoing product inference cost. [Interface](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/ai/provider.ts), [tasks](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/ai/language-tasks.ts:54) |

**Provider behavior:** **getAi()/resolve()** selects NVIDIA, Anthropic, compatible presets or a custom endpoint. NVIDIA bounds fallback to two slots within eight seconds; calling features may impose a shorter deadline. Compatible adapters set stream=false and prompt for JSON but do not request schema-constrained response formatting; they decode afterward. Anthropic pins one model in its adapter. [Selection](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/ai/index.ts:26), [NVIDIA](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/ai/nvidia.ts), [compatible complete()](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/ai/openai-compatible.ts:16), [Anthropic complete()](C:/Users/User/Desktop/Projects/Nudgenew/src/lib/services/ai/anthropic.ts).

### Changes with the best return

- **Routing:** choose a tested small model for interpretation/extraction. Use a stronger one only on a measured failure class with a bounded escalation rate. Missing facts should produce clarification, not escalation. Pin and health-check provider/model combinations; keep AI optional on failure.
- **Structured output:** use provider-native JSON Schema where supported, then retain runtime semantic validation. Require source spans for extracted memories, a field for uncertainty, and no generated ranking fields.
- **Context:** keep canonical alternatives, confirmed domain/version, the explicit goal, and only relevant evidence. Never send the whole graph or journal. Do not summarize away negation, dates, hard limits, source attribution or forgetting markers.
- **Caching:** cache interpretation by user/input/schema version; recap by user/window/data revision/consent generation; explanations by comparison revision and engine version. Apply short retention and invalidate on correction, deletion or AI withdrawal. Never share private prompts/results across users.
- **Batching:** combine the two onboarding extraction calls. Batch only deferred work with user consent and cancellation; do not delay a choice or reflection to wait for a batch discount.
- **Streaming:** unnecessary for short structured interpretation and extraction; validate complete JSON before applying anything. Only stream longer optional prose if measured latency warrants it. Streaming changes perceived latency, not inherently token cost.
- **Memory:** store observed choice/outcome separately from model interpretation. Use stable IDs, source decision/excerpt, domain, timestamps, consent generation, confirmation state and deletion state. A confidence number emitted by a model is not a probability.
- **Limits:** current **reserve_ai_request()** enforces 30 explanations/10-minute bucket, five recaps/hour, ten interpretation or extraction jobs/hour, and 1,000 global jobs/hour. Add monthly monetary caps and concurrency limits; charge retries/fallbacks to the same reservation. [SQL quota](C:/Users/User/Desktop/Projects/Nudgenew/supabase/migrations/00009_decision_meaning_and_topics.sql:214)
- **Failures:** return manual comparison and stored deterministic reasons. Use provider circuit breakers and bounded backoff; don't repeatedly bill users for identical failed work.
- **BYOK:** defer for consumers. It adds provider setup, secret custody and support complexity without improving the core loop.
- **No AI needed:** scoring supplied criteria, selecting a mathematically supported winner, counting outcomes, choosing the next curated question, scheduling reminders, exporting data and formatting evidence references.

### Cost model: transparent estimate, not an invoice

No measured token ledger or current NVIDIA billing contract was available. **Actual current cost is unknown**, including whether development credits temporarily cover requests. The calculation below prices before/after *workload shapes at the same reference rates*, so it does not pretend NVIDIA Ultra costs the same as a small model.

Reference only: GPT-5.4 Mini lists $0.75/million input tokens and $4.50/million output tokens. This is a public yardstick, not a claim it is the cheapest or selected production model. [Official model pricing](https://developers.openai.com/api/docs/models/gpt-5.4-mini).

Assume one active user makes 60 comparisons/month, uses AI for all eligible actions in the baseline, writes 20 substantial reflection notes, requests four recaps, and incurs one onboarding extraction pair. This deliberately models an AI-heavy early user; AI-off users have zero model cost.

| Work | Before: calls × input/output tokens | After: calls × input/output tokens |
|---|---|---|
| Interpret | 60 × 900 / 180 | 30 × 550 / 120; explicit/repeated options use logic/cache |
| Explain | 60 × 700 / 160 | 0; deterministic reasons |
| Extract reflection/profile notes | 20 × 1,000 / 250 | 10 × 650 / 180; only qualifying new notes |
| Recap | 4 × 1,500 / 250 | 1 × 900 / 180; changed-data cache |
| Onboarding | 2 × 1,100 / 300 | 1 × 650 / 180; combined optional schema |
| **Total** | **124,200 input + 27,000 output** | **24,550 input + 5,760 output** |
| **Reference model cost** | **$0.215/user/month** | **$0.044/user/month** |
| **With assumed 10% retry overhead** | **$0.236** | **$0.049** |

Formula: (input tokens × input price + output tokens × output price) / 1,000,000. The projected reduction is about 79% at equal rates. Token sizes, cache hits, qualifying-note frequency and retry rates are assumptions to measure, not facts about live Nudge.

If three post-change interpretation requests are substituted with a stronger model at an **illustrative, unverified tariff** of $3 input/$15 output per million, the estimate becomes about $0.057 including overhead. Reasoning tokens, search tools, audio and vendor-specific minimums can change it materially. Do not advertise a fixed cost from these numbers.

A planning example with an **assumed $50/month fixed infrastructure budget**, not a vendor quote:
- 100 active users: about $0.74 before / $0.55 after per user, including that fixed allocation.
- 1,000 active users: about $0.29 before / $0.10 after.
- These exclude taxes, payment fees, support time, storage growth, email, monitoring, bandwidth and overages.

Proposed initial AI caps: free $0.10/user/month plus daily abuse controls; paid $0.50/user/month; global daily emergency stop. These are internal spend budgets, not user-facing token promises. Once reached, keep manual comparisons/history available. A few expensive retries must not consume the whole deployment's capacity.

### AI on mobile
All provider calls belong behind an authenticated server endpoint. Verify the Supabase JWT, enforce account/consent/budget, load owner-scoped evidence, invoke the provider, validate the response, and return a typed result. Never ship model-provider or service-role keys in the application bundle.

Run input validation, numerical criteria calculations, template selection and draft editing on-device. Recompute authoritative results on the server before saving; don't trust client scores. Defer on-device language models until they have a measurable use case.

Use operation IDs and idempotency keys. If the application suspends, reconnect and fetch job status; do not rely on a mobile background process or an uninterrupted stream. Show offline drafts as unsynced. A server job must recheck consent/deletion generation before writing after a delay.

## Phase 7 — Mobile app plan

### Clear pick: React Native with Expo, after validating the web loop

| Approach | Advantage here | Cost/trade-off | Decision |
|---|---|---|---|
| React Native + Expo | Existing TypeScript/React skills, shared types and pure logic, native device integrations | DOM components, Radix, Next server components and CSS still need native UI replacements | **Pick** |
| Flutter | Strong cross-platform UI and rendering control | New Dart/UI stack; existing TypeScript domain code is not directly reused | Good technology, worse migration economics for this solo project |
| Swift + Kotlin | Maximum platform integration/control | Two UI implementations and release pipelines | Too much maintenance before product demand is proven |
| PWA/responsive web | Fastest current beta and no store submission | Does not satisfy the requested independent app by itself; native integrations and lifecycle behavior need separate work | Keep for validation, not the final mobile strategy |

The framework assessment follows the current [React Native setup guidance](https://reactnative.dev/docs/environment-setup?platform=android), [Flutter platform documentation](https://docs.flutter.dev/platform-integration), and [Expo notification support](https://docs.expo.dev/push-notifications/overview/). A journal/list/form app does not justify choosing a second language solely for theoretical rendering performance.

### Reuse vs rebuild

| Reuse | Refactor or rebuild |
|---|---|
| Supabase schema, RLS, owner-validated RPCs, consent/reset-generation semantics | Next-specific orchestration and cookie-bound dependencies |
| Criteria math, input schemas, domain types and engine test cases | Node-only domain hashing or keep it server-only; do not assume every service is mobile-safe |
| Provider adapters and prompts, running on server only | Native forms, navigation, sheets, accessibility, fonts and keyboard handling |
| Reminder scheduling concepts and durable delivery identities | APNs/FCM or Expo device tokens/delivery adapter; Web Push subscriptions are not native push tokens |
| Export/deletion rules and privacy content, after operator completion | Native reauthentication, local-data wipe, store subscription and reporting flows |

Existing **public/sw.js fetch/install handlers** cache only neutral/public assets; private journal requests remain network-only. That is a sensible current privacy boundary, not an offline journal implementation. [Service worker](C:/Users/User/Desktop/Projects/Nudgenew/public/sw.js). Existing **Deno.serve()/deliver()** implements Web Push delivery, which needs a native transport adapter. [Worker](C:/Users/User/Desktop/Projects/Nudgenew/supabase/functions/send-checkins/index.ts).

### Mobile additions, ranked

| Rank | Capability | Impact / effort | Scope |
|---:|---|---|---|
| 1 | Contextual reminders and one-tap check-in | High / medium | Core; request permission only after user schedules something |
| 2 | Quick capture and repeat-last-choice | High / low–medium | Core |
| 3 | Local drafts and an explicit sync outbox | High / medium–high | Core reliability; start with drafts rather than full offline multi-device editing |
| 4 | Biometric lock | Medium / low–medium | Optional privacy control; not a replacement for encryption or authentication |
| 5 | Share-sheet input | Medium / medium | Add once mobile users bring real choices from other apps; shared URLs remain unverified |
| 6 | Home-screen widget | Medium / medium–high | One recent template or check-in, minimal private text; after usage evidence |
| 7 | Voice input | Unproven / medium | Use keyboard dictation first; custom transcription not necessary for initial release |

### UX and screens
Three tabs: **Today, Decide, Journal**. Profile/settings from the header. Today contains the next due check-in and one useful past decision; Discover sits behind an optional “Explore preferences” entry.

Required screens: first decision/draft, auth, meaning clarification, comparison/result, decision detail, outcome check-in, journal list/search, reminder settings, memory controls, privacy/AI consent, export/deletion, and later subscription/manage-plan. Put full criteria editing behind an advanced action; keep table editing comfortable on web.

Onboarding: explain value in one sentence → try a decision → save/sync account → optional AI disclosure when first invoked → optional notification permission after selecting a reminder. Do not front-load permissions.

### Backend and device architecture
Use a small API within the existing Next deployment initially; a separate microservice is unnecessary.

| Surface | Proposed contract |
|---|---|
| Create/interpret | POST /api/v1/interpretations and POST /api/v1/comparisons |
| Read | GET /api/v1/decisions?cursor=…&limit=20; GET /api/v1/decisions/:id |
| Choose/reflect | POST /api/v1/decisions/:id/choice and /reflection with idempotency key and expected revision |
| Memory | Cursor-based reads; explicit confirm/correct/forget operations carrying memory generation |
| Jobs | GET /api/v1/jobs/:id, returning pending/succeeded/failed/cancelled |
| Account/privacy | Current consent version; reauthentication-based deletion; export job; registered device removal |
| Errors | Stable code, safe message, retryable, retryAfterSeconds, requestId; use 401/403/409/422/429/503 appropriately |

Extract application services that accept an authenticated actor and database adapter. Both Next server actions and API routes call those services. Keep SQL ownership checks; native clients can directly call exposed Supabase RPCs, so HTTP validation cannot be the only security layer. Use user-scoped JWT database access for ordinary operations; isolate service-role use to narrowly validated administrative/jobs code.

For mobile auth, use Supabase sessions and PKCE/deep-link callbacks with exact allowlists. Store refresh credentials using a tested secure-storage adapter; handle expiration, revocation, logout and token refresh races. Supabase documents React Native integration; React Native warns against storing secrets in general AsyncStorage, and Expo SecureStore documents encrypted storage and payload/platform limitations. [Supabase](https://supabase.com/docs/guides/auth/quickstarts/react-native), [React Native security](https://reactnative.dev/docs/security), [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/). Do not copy a tutorial's plain-storage choice without adapting the threat model.

For local data, use an encrypted SQLite design with a device-protected key if sensitive journal content is cached. Exclude secrets/cache keys from backups as appropriate, clear local state on sign-out/account deletion, and test interrupted writes. A biometric overlay alone does not encrypt a database.

An outbox should store operation ID, actor/account ID, payload version and expected server revision. Retry boundedly; refresh on 409 and ask the user before replacing a conflicting choice. Deletion/forgetting tombstones must beat stale queued writes. Initial offline scope should be new drafts and queued feedback, not arbitrary simultaneous edits.

Instrument small events such as comparison_started, choice_committed and reflection_saved without option text. Error reports need request IDs, build version and redacted breadcrumbs. Choose an analytics/crash tool only after its collection behavior is reflected in disclosures. Measure p95 latency, failure rates, duplicate writes and queue age.

### Store readiness — checked against current official pages
These are practical submission requirements and implementation recommendations, not a jurisdiction-specific legal opinion. Recheck at submission; storefront rules and SDK deadlines change.

| Area | Required preparation |
|---|---|
| Apple privacy | Map collected identifiers, journal content, diagnostics and third-party processing to accurate privacy labels; review SDK manifests/required reasons. [Apple privacy details](https://developer.apple.com/app-store/app-privacy-details/) |
| Apple AI consent | Disclose sharing with third-party AI and obtain explicit permission. Recommendation: named vendor, data categories and a preview before first use. [Guideline 5.1.2](https://developer.apple.com/app-store/review/guidelines/#privacy) |
| Apple deletion | Account-creating apps must let users initiate account deletion in-app; deactivation is insufficient. Explain legally retained data and subscription handling. [Deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion) |
| Apple login | If retaining Google sign-in, satisfy 4.8's equivalent privacy-preserving login requirement unless an exception applies. Sign in with Apple is the practical recommendation. [Guideline 4.8](https://developer.apple.com/app-store/review/guidelines/#login-services) |
| Google deletion/data safety | Provide both an in-app deletion path and a functional web resource for requesting deletion; complete Data safety/deletion disclosures. [Google requirement](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en) |
| AI-generated content | Google requires covered generative-AI apps to prevent restricted outputs and provide in-app reporting. Its guidance excludes some limited productivity/summarization uses; Nudge's final classification is not established here. Implement reporting and safety evaluation before expanding generative behavior. [Policy](https://support.google.com/googleplay/android-developer/answer/13985936?hl=en), [scope guidance](https://support.google.com/googleplay/android-developer/answer/14094294?hl=en-EN) |
| Billing | Plan StoreKit/Play Billing for digital subscriptions. Apple permits external purchase links in the US and specific other cases; Google has program/region exceptions. Do not apply one global external-payment rule. [Apple payments](https://developer.apple.com/app-store/review/guidelines/#in-app-purchase), [Google payments](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en) |
| Subscriptions | Show price, period, renewal/trial terms and benefits; implement restore, entitlement verification, cancellation/refund events and manage-subscription access. [Apple subscription guidance](https://developer.apple.com/app-store/subscriptions/) |
| Testing | Personal Google developer accounts created after 13 Nov 2023 need a closed test with at least 12 continuously opted-in testers for 14 days before applying for production access; internal testing alone is insufficient. [Current testing requirement](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en) |

Current **DeleteAccount()/deleteMyAccount()** provides a web deletion flow, but native access and a store-listed deletion resource still need to be built/verified. [UI](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/profile/privacy-controls.tsx), [action](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/profile/actions.ts:179). No offensive-AI-output reporting control was found in **DecideClient()/AiRecap()** or the searched app/components routes. [Comparison](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/ask/decide-client.tsx), [recap](C:/Users/User/Desktop/Projects/Nudgenew/src/app/(app)/analytics/ai-recap.tsx).

**Submission checklist:** working reviewer account and backend; real-device builds; accessible controls and text sizing; honest screenshots; valid privacy/support/deletion URLs; store age/content questionnaires; SDK/target-version requirements checked in the actual developer consoles; push denied/allowed states; offline and expired-session recovery; subscription sandbox purchase/restore/refund; deletion with pending jobs and active subscriptions; no developer secrets in bundles. Store accounts, target countries and jurisdictional obligations were not verified in this audit.

### Monetization
Keep the existing free core: manual comparison, journal, reflection, export/deletion and basic reminders. Test **$3.99/month or $29.99/year** for useful history tools, saved templates and a modest AI allowance after repeat use is established. These are proposed experiments, not market-clearing prices. Don't paywall data rights or lock away old entries after cancellation.

Avoid “unlimited AI.” Cap expensive research separately if ever added. A $3.99 subscription leaves about $3.39 at an assumed 15% platform fee or $2.79 at 30%, before taxes and other costs; these are sensitivity cases, not a verified fee entitlement. AI cost is probably not the largest early expense under the text-only model above. Acquisition, support and low paid conversion are more significant risks.

**Do now on web:** extract services from server actions; version payloads; preserve idempotency/revision/generation guards; add domain IDs and evidence snapshots; separate jobs from request latency; create a minimal event vocabulary; standardize data deletion and device-registration contracts. Do not rewrite the working web UI in React Native.

## Phase 8 — Roadmap to category leadership

“#1” is an aspiration, not an assessable roadmap outcome. Define the first win as **the easiest trustworthy way for one audience to remember what worked**.

### Prioritization
ICE uses Impact, Confidence and Ease, each 1–5; score = I × C × E. Confidence reflects this audit's evidence, not statistical certainty. Days are solo-developer planning ranges, excluding external approval. Mandatory release gates override numerical scores.

| Initiative | I | C | E | ICE | Estimated effort / dependency |
|---|---:|---:|---:|---:|---|
| Narrow launch promise and remove unsupported confidence wording | 5 | 4 | 5 | 100 | 1–2 days |
| First decision before profile/questionnaire | 5 | 4 | 3 | 60 | 3–5 days |
| One-question reflection and immediate acknowledgement | 5 | 4 | 3 | 60 | 3–5 days including job semantics |
| Repeat decision + dated evidence card | 5 | 4 | 3 | 60 | 3–5 days |
| Instrument activation/loop/retention without journal text | 5 | 5 | 2 | 50 | 2–4 days |
| AI usage ledger, spend caps and deterministic explanations | 4 | 5 | 2 | 40 | 3–5 days |
| Complete deployment/legal/service verification gate | 5 | 5 | 1 | 25 | Mandatory; 3–7 days plus operator/provider work |
| Correct domain retrieval and bounded evidence queries | 4 | 4 | 2 | 32 | 2–4 days |
| Saved settings/domain aliases | 4 | 3 | 2 | 24 | 3–5 days; preserve scope semantics |
| Versioned API and shared services | 4 | 4 | 1 | 16 | 6–10 days; before native integration |
| Expo core loop prototype | 4 | 3 | 1 | 12 | 2–3 weeks after API slice |
| Native push + offline outbox | 4 | 3 | 1 | 12 | 2–3 weeks after prototype |
| Widget/custom voice/universal fact research | 2 | 1 | 1 | 2 | Defer; no demonstrated demand |

These items do **not** all fit into two weeks. Sequence them around release risk and cohort learning.

### Roadmap and exit criteria

| Window | Deliverable | Exit gate |
|---|---|---|
| Next 2 weeks | Narrow copy; finish operator/deployment settings; test deployed core/auth/export/delete; instrument funnel; reduce reflection form and decouple extraction, or temporarily disable extraction to keep saves immediate | A supervised 10–20-person beta can complete the loop; no unresolved destructive/ownership issues; disclose unavailable AI/push |
| By day 30 | First-decision onboarding, repeat templates/evidence card, domain-before-limit fix, cost telemetry, 100–200-case AI evaluation; one cohort of 30–50 qualified users | Compare observed activation and completed loops with the targets below; address failure clusters before wider promotion |
| By day 90 | Improve the proven use case; versioned API slice; pricing experiment only with retained users; first 100 qualified users | Retention persists across at least two cohorts; no recurring data-loss or privacy incident; mobile demand tied to reminders/capture |
| Mobile prototype | Expo Today/Decide/Journal, auth, API client, one criteria flow and one check-in | A real iPhone and Android device complete the same account workflow without duplicating business logic |
| Mobile closed beta | TestFlight and Play internal testing, then required Play closed track where applicable; push, offline drafts, account deletion, crash reporting | Device matrix, interrupted-network/retry/upgrade tests; required tester period; acceptable crash/latency and completed-loop behavior |
| Store launch | Privacy forms, support/deletion links, reviewer access, compliant billing if sold, controlled rollout | Store approval plus operational readiness; halt rollout on corruption, deletion or duplicate-write regressions |

Illustrative schedule: prototype can follow the retained web cohort rather than waiting for every day-90 feature. Do not promise a store date before account eligibility, device testing and reviews are known.

### AI evaluation before enabling broadly
Use 100–200 reviewed cases across ordinary choices, ambiguous jargon, mixed-language text, version-specific questions, missing/contradictory measurements, prompt injection, high-stakes requests, and changed/withdrawn consent. Measure extraction fidelity, invented fields, unsupported winner claims, memory false positives, refusal/clarification behavior, cost and latency. Require no invented measurements or unsupported deterministic winners in the release suite. This is a finite release gate, not a guarantee about every future input.

### First 100 users
**Primary channel:** permission-based outreach in one small community whose members already discuss everyday routines and reflection. Start with 10 observed sessions, recruit 20 beta participants, then expand through their referrals and two or three short demonstrations of the actual choice → outcome → recall loop. Ask community moderators before promotional posts. This is a proposed campaign; no messages were sent.

Use one landing page for the chosen audience and a real example, not a broad “AI decides anything” claim. Ask each participant to bring a recurring choice, record two or three outcomes over two weeks, and tell you when they used a friend/chatbot instead. Collect reasons for non-use, not just compliments.

For mobile, invite retained web users who explicitly want reminders or quick capture into TestFlight/Play testing. Use store screenshots showing capture, evidence and a check-in. Do not treat app-store publication as an acquisition channel by itself. Defer paid acquisition until repeat usage and support load are understood.

### Three metrics that prove or disprove the hypothesis

| Metric | Exact definition | Initial decision threshold, proposed |
|---|---|---|
| Activation | Eligible new users who commit a real choice within 24 hours / eligible new users; report median time from first draft to choice separately | ≥60% of the recruited qualified cohort; median draft-to-choice <60 seconds |
| Completed loop | Chosen decisions with a due check-in that receive an outcome within seven days of due time / chosen decisions whose check-in became due; exclude disabled/deleted reminders | ≥40%; inspect whether reminders help or annoy |
| Week-4 retained decision use | Activated users who record a new choice or outcome during days 22–28 / activated users old enough to reach day 28 | ≥25% across two cohorts; show counts and uncertainty |

These thresholds are management hypotheses, not industry benchmarks. Discover taps, streaks, signups and AI requests do not substitute for these metrics. If fewer than one in five activated users returns in week four after two focused iterations, narrow or change the use case before investing in a full mobile release.

## Do this first — the ten highest-value actions

1. **Commit to recurring everyday choices and outcome recall.** Keep arbitrary subjects as supported input, not a promise of universal expertise.
2. **Close the failing release gate.** Real operator/contact/provider/retention/host values, actual deployment, auth, deletion and restore checks.
3. **Recruit 10 observed beta sessions and instrument the three metrics.** Establish where users stop before expanding scope.
4. **Make the first useful decision precede the profile questionnaire.** Preserve a draft across signup.
5. **Reduce reflection to one question and return immediately after save.** Move optional AI to durable jobs or disable it temporarily.
6. **Fix evidence retrieval before the domain limit and label score confidence honestly.** Add the targeted regression cases.
7. **Ship repeat-decision and dated evidence cards.** Make existing history valuable without another chatbot turn.
8. **Meter real AI attempts/spend, remove expensive paraphrasing, and benchmark the remaining calls.**
9. **Extract shared application services and a small /api/v1 contract.** Carry existing privacy/retry protections through it.
10. **Build the Expo core loop after retained users demonstrate the need for native reminders/capture.** Add store requirements and device testing from the prototype onward.

