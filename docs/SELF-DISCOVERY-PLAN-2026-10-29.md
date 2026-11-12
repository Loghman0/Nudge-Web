# Nudge: self-discovery first, decisions informed by what you learn

Design specification, 29 October 2026. Based on the current checkout and the research linked below. This document proposes changes; it does not claim they are implemented or that a new database migration has been applied. The existing app continues to run.

**Recommendation:** make the first useful interaction six light questions and a small, inspectable reflection. Make the daily home screen a question. Keep decision help immediately available, then make its suggestions more relevant as evidence accumulates. Position Nudge as a personal reflection tool with a decision journal, not a personality test, therapist or predictor.

## 1. Critique and product choices

The direction addresses two real product constraints: a new visitor may have no decision ready, and an empty profile cannot personalize much. A short discovery experience can create value and a reason to return before a consequential decision arises. This is a product hypothesis to test; the repository contains no evidence proving that Nudge's users will retain better under this flow.

The risk is replacing an empty decision tool with an entertaining questionnaire that produces flattering but vague descriptions. Six answers do not establish a personality. A hypothetical choice is not an observed behavior, and a plausible explanation is not proof. The useful promise is **“Notice what matters to you, and bring it into your choices.”**

Specific choices:

- Use **six questions**, with progress and Skip, followed by a reflection available without an account. Treat approximately one minute as a design target to test, not a measured promise.
- Pilot roughly **200 approved questions drawn from existing content and generated candidates**, not 100,000 rows. Scale the authoring system early; grow published content when coverage and quality justify it.
- Separate questions intended to provide evidence from questions asked for enjoyment. A cardboard-box joke does not need to become a creativity score.
- Replace “knowledge %” with concrete counts and observations: “12 answers across 5 areas,” “3 patterns you confirmed,” and “We haven't explored work yet.”
- Keep **Today / About you / Decide** as primary navigation. Put Journal inside Decide, and keep Circles secondary. Decision help never requires a minimum answer count.
- Do not require an account to see the initial result. Do not use streak loss, an endless feed, personality-completion meters or rewards for disclosing more intimate information.
- Avoid claiming superiority to general chatbots on model intelligence. Nudge's value is a low-effort, longitudinal workflow: answer, inspect a reflection, correct it, apply it to a choice, and revisit the outcome.

Progressive disclosure supports showing a small initial task and revealing detail when needed. It does not prove that exactly six questions will improve conversion. [NN/g research guidance](https://www.nngroup.com/articles/progressive-disclosure/).

## 2. What exists and what changes

| Verified current implementation | Consequence for this design |
| --- | --- |
| 24 Discover topic IDs in `src/lib/discover/types.ts`; related follow-ups, Change topic, Keep exploring and Pause in the Discover UI | Promote and extend this experience; do not build a parallel question product. |
| 552 baseline, 168 branching and 6 foundation seed definitions in source | 726 source definitions are a starting inventory, not a verified count of distinct published questions in the hosted database. Audit duplicates and mappings before reuse. |
| `/discover` and `/onboarding` require authentication | Add a public `/start` outside the protected app layout. Keep protected account routes protected. |
| Actual question rendering and answer RPCs accept A/B/skip | Add a typed, versioned response contract. A TypeScript mention of free text or scale is not an implemented renderer. |
| Foundation currently collapses Both / Depends / Neither / Skip into `skip` | Preserve these meanings separately. Do not reconstruct distinctions from old data. |
| Latest selector prioritizes a matching follow-up, then least-answered topic, then fixed ordering | Add diversity, effort, freshness and controlled exploration. Preserve user-directed topic changes. |
| `knowledge_nodes`, `knowledge_evidence`, `knowledge_edges`, verification, forgetting and privacy generation already exist | Extend the evidence model rather than maintaining a competing personality database. |
| Criteria comparisons intentionally do not load personal preferences; saved `ai_memories` are not read by the comparison-memory loader | Build an explicit evidence-to-criterion suggestion service. Saving a note must not imply it currently affects decisions. |
| Existing versioned decision APIs, ownership checks, idempotency, explicit criteria confirmation and uncertainty intervals | Preserve these contracts and reuse the backend for later native mobile work. |

Important source files include `src/app/(app)/discover/*`, `src/components/onboarding/onboarding-flow.tsx`, `src/lib/discover/*`, `src/lib/services/knowledge.ts`, `src/lib/services/comparison-memory.ts`, `comparison-criteria.ts`, `comparison-settings.ts`, `profile-memory-intake.ts`, and `src/lib/supabase/middleware.ts`.

## 3. Product experience

### Before an account

**Opening:** “Find a few things that make life fit you better.” Primary button: **Try six questions**. Secondary: **I have a decision to make**. One short privacy sentence: “Your trial answers stay in this tab until you choose to save them.” Link to details and a persistent Clear answers control. Do not ask for name, occupation or age as discovery questions.

**Question screen:** one prompt, two to four balanced choices, progress such as “2 of 6,” Back, Skip and a deliberate Next button after selection. The first release uses tap choices and this-or-that; scenarios are prompt styles using those controls. No typing required. Do not auto-advance before the user can inspect a selection. Preserve answers on Back and reload within the tab.

**Result:** “A first reflection.” Show at most two observations, each linked to the exact answer. If two questions support a common theme, offer a tentative, narrow interpretation. For example, after selecting a small experiment and a rough sketch:

> You chose a small first attempt in the puzzle and a rough sketch for the postcard. Trying a low-stakes version may suit how you begin a new activity. Does that fit?

Responses: **Yes, usually / Only sometimes / Not really**. These are user corrections, not votes that automatically multiply the same evidence. If the answers do not support a shared theme, show two literal preferences instead. If most answers were skipped, show what was answered and offer a different topic; do not manufacture a profile.

**Save:** “Keep these answers and build on them.” Primary **Save my answers**, secondary **Keep exploring**, and **Clear answers**. Signup preserves the reviewed results and does not repeat the six questions. AI consent is separate and off by default.

**Guest-state implementation:** keep the six low-sensitivity structured responses in `sessionStorage`, with an in-memory fallback when storage is unavailable. On an explicit Save action, offer a bounded same-device pending draft in local storage for up to 24 hours so email confirmation in another tab can resume it. Store version IDs, option IDs and the user's corrections, not generated psychological labels. Expired drafts are ignored and removed when the app next runs; browser storage cannot guarantee physical erasure at an exact time while the browser is closed. Clear immediately after a successful claim or a Clear action. Explain that a different device cannot recover this local draft. Do not put answers or draft contents in URLs, email links, logs or analytics. Do not create anonymous Supabase accounts for this preview.

After authentication, revalidate the catalog, show the pending answers for review, obtain the current privacy generation, and submit an owner-scoped idempotent claim. Authentication callbacks never silently import a draft. A generation change during submission rejects the stale claim. Another signed-in person using the same browser must explicitly review the draft before importing it.

### Daily home screen

The first card is **Today's question**, followed by the most recent useful reflection. “Decide something” remains visible as a secondary action. After an answer show a brief factual acknowledgment; do not manufacture an insight after every tap.

Offer **Another three / Change topic / That's enough for today**. After three more answers, show a stopping point again. Allow continuing by choice. After two skips in a row, offer a lighter question, another topic or a pause. A skip must never be treated as disliking an option or avoiding a subject psychologically.

An optional “What fits right now?” control offers **Something light / Curious / Room to reflect**. This chooses effort and depth. If the user does not choose, start light. A temporary energy or mood choice is session context, not a durable trait. Time of day can mildly affect question length and requested reminder time; it must not infer loneliness or vulnerability at night.

Use one durable daily question assignment per local calendar day, stable across reloads/devices. Extra-session questions have their own reservation IDs. Change topic explicitly replaces the assignment with an auditable skip/change event; it does not save a fabricated answer.

### About you

Use three understandable views:

| View | Example | User controls |
| --- | --- | --- |
| What you said | “For focused work, you ranked quiet first.” | View original prompt, edit, stop using, delete |
| Possible patterns | “You chose smaller groups in three recent social situations.” | Why this appeared, supporting/conflicting answers, Fits / Depends / Not me |
| What you confirmed | “Small groups usually suit me after work.” | Change scope, edit, use in decisions on/off, forget |

Show variation as useful information: “You prefer a plan for work, but more freedom on weekends.” Do not flatten it into an inconsistency score. No diagnoses, morality scores or labels such as “an anxious person.” Descriptive tendencies can exist, but are contextual observations rather than validated personality traits.

Each reflection must reveal evidence IDs/dates, scope and uncertainty. Explanation wording must not make weak evidence sound stronger: Microsoft's HAX guidance explicitly warns that explanations can increase over-reliance. [HAX explanation guidance](https://www.microsoft.com/en-us/haxtoolkit/guideline/make-clear-why-the-system-did-what-it-did/).

### Accessible interactions

Keep readable text, visible labels, focus management, keyboard operation, reduced motion and 44–48 px primary targets. Sliders start unanswered and offer labeled tap steps; the midpoint is not a saved default. Ranking offers Move up/down or rank buttons, not drag-only controls. Short text is optional and bounded. “Depends,” “Neither fits” and “Skip” are separate responses. Localized wording and response options require review, not literal translation alone.

## 4. Taxonomy and 30 example questions

Use a hierarchy of **domain -> subdomain -> attribute/situation**, with stable IDs and multiple descriptive tags. Hypothetical, scenario and ranking are formats or contexts, not psychological domains. Preserve the existing 24 topic keys through mappings rather than renaming evidence keys in place.

| Domain | Initial subdomains |
| --- | --- |
| Rest and energy | Breaks, recovery, stimulation, solitude |
| Time and routines | Planning, pace, transitions, consistency |
| Values and priorities | Autonomy, novelty, quality, convenience, contribution |
| Relationships and belonging | Friendship, family, companionship, communication, boundaries |
| Work and collaboration | Focus, task structure, feedback, coordination, ambition |
| Learning and curiosity | Practice, explanations, starting strategies, challenge |
| Money and consumption | Repair, borrowing, purchasing trade-offs, saving priorities |
| Food and senses | Flavor, texture, preparation, familiarity |
| Culture and identity | Stories, music, traditions, language, belonging; sensitive identity only if explicitly volunteered |
| Play and humor | Cooperation, competition, games, wordplay, absurdity |
| Creativity and making | Starting, experimenting, finishing, craft, aesthetics |
| Childhood and change | Ordinary memories, enduring interests, changed preferences; optional |
| Uncertainty and fears | Low-stakes uncertainty, reassurance, starting something unfamiliar; optional |
| Ethics and community | Fairness, reciprocity, contribution, sustainability |
| Places and environment | Home, travel, outdoors, surroundings, access preferences |
| Movement and physical comfort | Enjoyable movement, comfort, rest; no diagnosis or fitness judgment |
| Digital life and attention | Notifications, channels, information habits, privacy |
| Future and goals | Aspirations, priorities, reversible experiments, definitions of progress |

Cross-cutting metadata: locale, semantic family, context, time horizon, depth, sensitivity, age suitability, estimated effort, accessibility needs, playful/evidence purpose, permitted inference and decision relevance. Coverage is extensible; no finite taxonomy honestly covers every possible private meaning.

The following are design fixtures, not a proposal to manually author a huge bank. Starred rows form the first six-question pilot: **1, 3, 9, 13, 17, 19**. All support Skip; closed questions also support a suitable Depends/Neither path.

| # | Domain / format | Question and responses | Maximum justified interpretation |
| --- | --- | --- | --- |
| 1 ★ | Rest / tap | A busy day gives you 20 minutes back. What sounds best? Quiet music / A familiar person / A tiny hands-on project / Fresh air. | A preferred break in this situation. |
| 2 | Rest / slider | For a relaxed evening, where is your sweet spot? Very little going on ↔ A little buzz around me. | Evening stimulation preference; not introversion. |
| 3 ★ | Time / scenario | Tomorrow is unexpectedly free. Pick your plan: One thing to look forward to, rest open / A few things lined up / Decide when I wake up. | Planning for an uncommitted day. |
| 4 | Time / ranking | What would make a free afternoon feel well used? Rest / Finish a lingering task / Time with someone. Rank or tie. | Relative priorities for this scenario. |
| 5 | Values / scenario | A service you use offers one free upgrade. Less waiting / More choice / More dependable results / Easier help if something goes wrong? | A service trade-off, not a global value hierarchy. |
| 6 | Values / short text | What tiny inconvenience are you surprisingly unwilling to put up with? | A candidate friction point, reviewed before reuse. |
| 7 | Relationships / scenario | A friend says, “Today was a lot.” What would you offer first? Listen / A practical hand / A distraction / Ask what would help. | Stated support style; not empathy scoring. |
| 8 | Relationships / slider | For a casual catch-up, how much notice feels good? Same-day is fine ↔ A few days ahead. Also: Depends on who. | Scheduling preference in this context. |
| 9 ★ | Learning / scenario | You find a puzzle box with no obvious opening. First move? Try one small thing / Look for an example / Ask for a hint / Study it for a moment. | Starting strategy for this low-stakes task. |
| 10 | Work / ranking | For an hour of work or study, rank your top two: Quiet / A clear brief / Someone to ask / Control over the pace. | Explicit focus supports; not ability. |
| 11 | Work / short text | What makes a group task feel easier before anyone even starts? | A possible collaboration preference, reviewed before reuse. |
| 12 | Money / tap | An everyday item breaks. If each option is practical, which would you explore first? Repair / Borrow / Buy used / Buy new. | Approach to this purchase; no wealth inference. |
| 13 ★ | Food / this-or-that | A café has two equally appealing snacks. Your favorite made really well / A combination you've never tried? | Familiarity versus novelty for this snack scenario. |
| 14 | Food / slider | Pick the texture you're in the mood for: Smooth and soft ↔ Crisp and crunchy. | A temporary sensory preference. |
| 15 | Culture / tap | A spare hour somewhere unfamiliar: Local music / A food market / A small museum / Ordinary streets and shops? | Interest in this scenario; no ethnicity/class inference. |
| 16 | Culture / short text | Is there a small tradition you enjoy keeping—or inventing? “None” is fine. | The volunteered tradition, not a guessed religion or origin. |
| 17 ★ | Humor / this-or-that | Which joke is more likely to get you? A painfully good pun / A completely absurd situation. | Humor preference; no personality or intelligence score. |
| 18 | Play / scenario | A group is choosing a game. What sounds better tonight? Solve something together / Outsmart each other / Make something ridiculous. | Tonight's game preference. |
| 19 ★ | Creativity / scenario | Making a postcard for fun: start with A messy sketch / A color / A reference / A message? | A creative starting method in this task. |
| 20 | Creativity / short text | Give an ordinary cardboard box a second career. What does it become? | Playful response only; no trait inference. |
| 21 | Childhood / optional text | What ordinary thing did you enjoy doing as a child that still sounds fun? | A voluntarily named interest; no childhood analysis. |
| 22 | Change / tap | Revisiting an old hobby: Familiar feeling / Seeing how I've changed / Trying it differently / I'd rather try something new? | Present preference about revisiting activities. |
| 23 | Uncertainty / scenario | Trying something unfamiliar for fun: what makes the first step easier? Tiny practice run / Familiar person / Watch once / Clear instructions. | Preferred support; not an anxiety label. |
| 24 | Uncertainty / slider | For a low-stakes day out, how much surprise is welcome? Tell me the plan ↔ Leave plenty to discover. | Bounded surprise preference, not financial risk tolerance. |
| 25 | Ethics / scenario | Three friends want the one quiet seat on a trip. Best starting rule? Take turns / Draw lots / Ask who needs it most / Talk it through. | A chosen fairness procedure, not a morality score. |
| 26 | Community / tap | At a friendly event, which role sounds good? Welcome people / Set things up / Teach a small skill / Help quietly in the background. | Contribution preference in that setting. |
| 27 | Places / ranking | For an afternoon place, rank two: Quiet / Easy to reach / Interesting things nearby / Comfortable seating. | Explicit location criteria; no inferred disability. |
| 28 | Movement / tap | A short change of pace today: Gentle stretch / Short walk if practical / Move to music / Stay still and rest? | Present comfort preference; no health judgment. |
| 29 | Digital / scenario | You get 40 notification-free minutes. Silence everything / Let chosen people through / Check once halfway / I don't need that today? | Session interruption preference. |
| 30 | Future / short text | What would you like to make a little more room for next month? | A self-described current goal, with a review date. |

Short text is initially limited to 140 characters. Deeper material is opt-in. Culture, childhood and fears should not become a route to extracting political, religious, sexual, trauma or health information without an explicit purpose. No diagnosis or sensitive identity may be inferred from these questions.

Question wording, ordering and response choices influence answers. Use one concept per prompt, balanced nonjudgmental choices, and stable wording for intentional rechecks. Pilot comprehension, rather than assuming entertaining copy measures a trait. [Pew's questionnaire methodology](https://www.pewresearch.org/writing-survey-questions/).

## 5. Next-question selection

Use an explainable heuristic first, with logged selector versions. A contextual bandit is a later option only after sufficient consented data and a defensible reward definition. Do not optimize dwell time or the volume of personal disclosures.

**Required data:** published question version/family/topic, quality approval, response schema, effort/depth, permitted audiences, mappings; the user's explicit topics/mutes, session mode, optional timezone, answer/exposure history, reviewed attributes with freshness/conflict, and a current decision only when the user deliberately requests relevant questions. No microphone, keyboard surveillance, inferred protected identity or ambient personal data.

Hard eligibility comes first: published and locale-reviewed; suitable content and depth; not muted or forgotten; not already served in this session; semantic-family cooldown; no inappropriate sensitive content; compatible with explicit topic choice. An LLM cannot override these gates.

For eligible questions, normalize features to [0,1]:

```text
score(q) = .25 learning_need
         + .20 coverage_gap
         + .15 relevance_to_user_chosen_goal_or_decision
         + .15 energy_and_format_fit
         + .10 semantic_novelty
         + .05 time_of_day_fit
         + .10 reviewed_quality
         - .25 estimated_session_burden
         - .30 near_repetition
         - .20 topic_run_penalty
```

These weights are initial product parameters, not learned or scientifically validated coefficients. `learning_need` means a relevant, permitted attribute is uncertain or stale; it does not mean every unknown personal fact should be collected. Missing time or mood contributes a neutral feature, not a fabricated value. Burden uses question count, explicit “lighter” requests and repeated skips. Response time alone cannot diagnose fatigue or reduce trust in an answer.

```text
next_question(user, session, requested_topic, request_id):
    if reservation_exists(user, request_id): return its_question
    if session.first_daily_slot and active_daily_assignment_exists(user.local_date):
        return that_assignment
    if session.is_guest_preview:
        return next_unseen_item_from_reviewed_six_question_pack()

    if session.two_consecutive_skips or session.three_since_last_pause:
        return OFFER_CONTINUE_OR_CHANGE_TOPIC_OR_STOP

    depth = min(user.explicit_depth_permission, gradual_depth_for_recent_sessions)
    pool = indexed_candidates(locale, requested_topic, depth, limit=200)
    pool = hard_filter(pool, muted_topics, sensitivity_permission,
                       forgotten_attributes, served_families, cooldowns)
    pool = enforce_variety(pool, max_same_topic_run=2,
                          explicit_topic_session_may_override=True)

    if pool is empty:
        return OFFER_TOPIC_CHANGE_OR_STOP  # never lift safety constraints

    if eligible_recheck_due and session.recheck_share < .10:
        q = choose_oldest_relevant_user_permitted_recheck(pool)
    else if random() < .20:
        q = sample_undercovered_topic_then_distinct_family(pool)
    else:
        q = softmax_sample(top_20_by_score(pool), temperature=.15)

    atomically_reserve(user, request_id, q.version, selector_version,
                       privacy_generation, coarse_reason_codes)
    return q
```

For normal selection, 80% prioritizes usefulness and 20% explores approved undercovered areas. Rechecks are capped at 10% of delivered questions and use the same wording when measuring change. Persist assignments and retries so refreshes and double-clicks cannot produce extra questions or evidence. No questions are marked answered by mere exposure.

Cold start after the preview remains easy and varied for the first few sessions. A deeper ladder is enabled by the user, never solely by a high answer count. Limit related follow-ups to two before broadening by default. Users choosing a specific topic can stay there. A provisional 30-day semantic-family cooldown limits repetitive paraphrases; deliberate rechecks are separately labeled and scheduled by attribute freshness.

## 6. The evolving profile

Maintain a single evidence graph with distinct **preferences, values, habits, goals, constraints and descriptive tendencies**. Store the original answer separately from an observation derived from it. Every observation names the question version, answer revision, mapping rule, context and permitted uses.

Example record:

```json
{
  "attribute": "work.environment.quiet",
  "kind": "preference",
  "scope": {"activity": "focused_work"},
  "statement": "Quiet surroundings help me focus",
  "evidence_state": "user_confirmed",
  "supporting_answer_ids": ["answer-17", "answer-31"],
  "conflicting_answer_ids": [],
  "last_confirmed_at": "2026-10-29T10:00:00Z",
  "allowed_uses": ["reflection", "suggest_decision_criterion"],
  "aggregation_version": 1
}
```

The timestamp and IDs above are illustrative, not a real user's data.

Use deterministic, reviewed mappings for structured responses. Weight direct statements above indirect hypotheticals. A playful-only question contributes no latent trait. A choice of A provides no automatic dislike of B. Ranking provides ordinal preference, not a measured distance or a numeric decision weight. Temporary mood or texture preference expires with the session unless the user chooses to retain it.

An internal evidence weight can use `source_weight × context_match × 2^(-age_days/half_life)`, with one semantic family's contribution capped and repeated evidence in a single session capped. Keep support and opposition or a categorical distribution; do not force every attribute into like/dislike. Hypothetical variations from the same family do not count as independent confirmation. A user confirmation of the same observation changes its status, not its independent-evidence count.

Initial visible states:

- **You said:** one direct statement, with date and context.
- **Early signal:** a limited contextual suggestion.
- **Repeated pattern:** an initial product gate of three independent families across two sessions with coherent scope and no substantial unresolved contradiction.
- **Mixed:** relevant evidence points in different directions.
- **You confirmed:** the user's explicit interpretation, still editable and scoped.

Do not display model confidence as probability that the user “really is” a trait. Internal confidence remains an uncalibrated prioritization heuristic until separately evaluated. Proposed recheck intervals: goals/constraints around 30 days, routines around 90, tastes around 180; user changes and decision context can require earlier confirmation. These are tunable defaults, not psychological laws. A previously stated affordability constraint must be checked for the present decision.

When answers differ, first test whether their contexts differ. Ask “Different situations, or has this changed?” rather than correcting the user. A direct correction supersedes the current interpretation. Editing an answer retracts its previous derived evidence before rebuilding affected nodes; it must not add another independent signal. Users can delete old history as well as change what is currently used.

## 7. Item 9: make decision help visibly personal

There is no global “enough questions” threshold. Personalize a field as soon as there is relevant, current, permitted evidence; leave unrelated fields unknown even after hundreds of answers.

For “Course A or Course B?” the app might know a confirmed preference for hands-on learning and a recently stated limit of three evenings a week. Show:

> From your answers: **Hands-on practice**. Add it as a criterion?
>
> You previously said **up to three evenings a week**. Still right for this choice?

Each has **Use / Edit / Not for this decision** and a source/date disclosure. Once accepted, it is a draft criterion or constraint, not a claim about either course. Ask which criterion matters most today; do not generate a 4/5 weight from a vague preference.

| Field | Permitted behavior |
| --- | --- |
| Setting and private definitions | Draft from an explicitly selected saved setting, with confirmation. |
| Criterion names | Suggest from reviewed, relevant attributes: quiet surroundings, flexibility, hands-on practice. |
| Importance | Reuse a previously explicit ranking only as a labeled suggestion for a compatible decision; confirm current priority. |
| Personal constraints | Offer a dated explicit limit; confirm it is still current. |
| Price, duration, workload, travel time, game mechanics | Require user-provided or retrieved verifiable facts with source/date. Do not fill from personality or model memory. |
| Unknown measurements | Keep unknown, propagate intervals, explain what is missing. |
| Winner | Show only when the confirmed inputs support it. Otherwise offer a focused next question or a reversible experiment. |

For “Mine or cut trees?”, first ask “Which game, project or real-life setting?” If it is Minecraft, ask version/mod only if the answer depends on it, then the immediate goal. Reuse only compatible saved meanings and preferences. Liking creative activities does not prove which action obtains a needed resource. A factual retrieval capability would be a separate, sourced feature; it is not created by the profile.

The UI has three clear classes: **Remembered** (exact statements), **Suggested** (editable interpretation), **Unknown** (missing facts). Show at most three relevant suggestions, not a new long form. Ask one useful missing question at a time. Where available, choose a missing input that could change the ranking; don't imply mathematical value-of-information estimates before they are implemented.

Implement `decision-personalization.ts` returning suggestions with attribute IDs, evidence IDs, scope, dates and confirmation requirements. Use a reviewed `attribute_criterion_rules` mapping. Keep scoring in the existing comparison service. Store accepted suggestions in the comparison snapshot, and check privacy generation on suggestion delivery and final save.

## 8. Generation pipeline and scalable schema

**Choose offline generation with a published bank**, not a model call whenever someone taps Next. There is no need to generate private user-targeted questions to achieve variety.

```text
coverage gaps + taxonomy + approved template families
  -> bounded generation batches with fictional scenarios only
  -> schema / language / length / accessibility validation
  -> exact normalization and content hash deduplication
  -> semantic family matching and near-duplicate review
  -> tone, ambiguity, leading-choice, sensitivity and safety checks
  -> validate answer-to-attribute mappings and inference ceilings
  -> human editorial review / stratified sampling
  -> small pilot -> publish immutable version -> monitor / retire
```

Use slots for meaningful differences: situation, constraint, time horizon and trade-off. Changing a person's name or paraphrasing a sentence is not a new independent question. All wording variants remain in one semantic family. Embeddings help find duplicates in public question content, not validate psychological constructs. Similarity thresholds must be calibrated against a labeled duplicate set; borderline pairs go to review.

A coverage grid such as 70 subdomains × 30 situations × 8 prompt structures × 6 variants produces 100,800 **candidate combinations**. It does not prove 100,800 useful independent questions. Report approved family count separately from variants and translations. Generate toward actual uncovered cells; avoid Cartesian combinations that are nonsensical or culturally inappropriate.

Review 100% of the first approximately 200 published items, all new mapping rules/templates and all sensitive content. At larger scale, low-risk batches based on approved families can use automated checks plus a proposed 10% random sample stratified by locale/domain/format; any critical failure quarantines the batch. Sampling is not proof that unsampled content is safe. Sensitive content cannot pass merely because an LLM judge approves it. Include manual review of age suitability and local language. Retire bad versions without rewriting historical prompts.

**Schema direction:** add new version/event tables after migration `00014`, preserve old IDs and binary APIs through adapters, and retain the existing knowledge graph. Avoid a direct alteration of the `questions` row shape before updating `discover_next_question`, which returns an explicit `setof public.questions` projection.

| Table | Important fields / constraints |
| --- | --- |
| `question_domains` | `id, parent_id, slug UNIQUE, label, sensitivity_default`; hierarchical taxonomy. |
| `question_families` | `id, domain_id, subdomain_id, template_id, semantic_key UNIQUE, purpose, legacy_question_id`; one semantic construct/situation family. |
| `question_versions` | `id, family_id, revision, locale, format, prompt, choices JSONB, response_schema JSONB, depth, effort, sensitivity, status, content_hash, reviewed_by, reviewed_at`; immutable published versions; unique family/revision/locale. |
| `question_tags` / `tags` | Many-to-many version tags with stable keys; indexed by tag and version. |
| `question_signal_rules` | `id, version_id, attribute_key, condition JSONB, observation JSONB, inference_ceiling, rule_version, review_status`; server derives signals, never accepts arbitrary client traits. |
| `discovery_sessions` | `id, user_id, local_date, mode, optional_energy, depth_permission, privacy_generation, created_at, expires_at`; private, no account record for guest preview. |
| `question_exposures` | `id, user_id, session_id, version_id, request_id UNIQUE per owner, slot, selector_version, reason_codes, state, served_at, coarse_duration`; reservation is not an answer. |
| `answer_events` | `id, user_id, exposure_id, version_id, response_kind, response JSONB, context JSONB, supersedes_id, revision, request_id, intent_hash, generation, created_at`; unique owner/request; one current revision per answer lineage. Nullable `exposure_id` uses `ON DELETE SET NULL`, so exposure-retention cleanup cannot delete saved answers; the answer retains its immutable version and permitted durable context. |
| `discovery_claims` | `user_id, request_id, intent_hash, generation, result_ids`; private idempotency ledger for explicit post-signup imports; no anonymous remote draft. |
| `attribute_definitions` | `key, kind, value_schema, sensitivity, allowed_uses, half_life_days, version`; no inferred diagnosis or protected identity. |
| Existing `knowledge_evidence` | Add answer-event lineage, family, rule/version, typed observation, context and revocation metadata. |
| Existing `knowledge_nodes` | Add contextual attribute identity, aggregation version, evidence-strength/conflict state and explicit confirmation metadata; only compatible preference types project to the legacy preferences table. |
| `insight_cards` | `id, user_id, pattern_key, evidence_ids, conflicting_ids, generation, template_version, status`; derived, private and rebuildable. |
| `attribute_criterion_rules` | `attribute_key, decision_domain, suggested_label, value_kind, allowed_scope, confirmation_required, version`; reviewed mappings. |
| `question_generation_batches` | Coverage specification, prompt/model versions, counts, quality findings, approval, token/cost totals; no private user answers. |

Example typed response envelope:

```ts
type Response =
  | { kind: "choice"; optionId: string }
  | { kind: "scale"; value: number }
  | { kind: "ranking"; groups: string[][] } // ties are explicit
  | { kind: "text"; text: string }
  | { kind: "depends"; context?: string }
  | { kind: "both" }
  | { kind: "neither" }
  | { kind: "skip" };
```

Validate against the exact published version: valid option IDs, numeric range/step, no duplicated rank IDs, allowed ties/partial rankings, bounded text and response size. Client-supplied attributes, weights and confidence are rejected. The server owns question-to-evidence mapping.

Index `(status, locale, domain, depth)`, family/content hashes, `(user_id, created_at)` and `(user_id, family_id)` exposure summaries. Retrieve a few hundred eligible candidates using indexed topic/family pools rather than scanning 100,000 items or `ORDER BY random()` on the full bank. Cache public catalog versions; never cache personalized results under public keys. Partition events only when actual volume requires it.

Migration/backfill must preserve old `question_answers` and their A/B/skip meaning, identify original sources and avoid generating evidence twice. New answers have one authoritative event store. Legacy endpoints become adapters to the new service; old rows are retained for readable history until an audited migration completes. Use mapping IDs and deduplication keys to prevent dual-write inflation.

Atomic owner-only RPCs handle submit/edit/delete/claim: lock the relevant profile/session, verify identity and generation, validate the version, write the answer and evidence, invalidate/rebuild affected profile/insight projections, and save the retry result. Same request + same intent returns the same result; changed intent fails. Serialization and privacy conflicts must not silently retry into a new generation. Public access exposes only published question content; unpublished content and personal answers require the appropriate owner/editor authorization.

## 9. Trust, privacy and distress

**Stored after an explicit save:** original question/version and response, volunteered context, revision history, derived observations, exact evidence links, confirmation/correction state, and permitted uses. Users see the same information that decision personalization can use. Hidden personality or vulnerability scores are prohibited.

**Proposed retention policy, to implement and verify:** guest preview lasts for the tab; explicit pending local save is valid for 24 hours; saved answers stay until deleted; optional session energy expires after the session/day unless the user chooses to retain it; personal exposure events expire after 30 days; truly aggregate non-identifying quality metrics may last 90 days; operational logs omit answers. Ephemeral energy stays in the expiring session record and is excluded from durable answer/evidence context unless retention is explicitly chosen; any accidental copies must join the expiry cleanup. Verify backup/vendor retention separately before making deletion promises. Do not claim deletion from a provider that cannot be verified.

Three different controls must be explicit: **Stop using this** revokes personalization use; **Delete this answer** deletes the answer/history and retracts dependent evidence; **Erase learned memory** keeps the current app's documented journal distinction while clearing all learning inputs and projections. Export includes answer versions, contexts, evidence and confirmations in readable JSON. Account deletion covers all new tables. Forgotten keys, generation barriers and queue cancellation prevent delayed AI jobs, guest imports or cache rebuilds from restoring deleted information. Suggestions and snapshots referencing withdrawn evidence must be invalidated or clearly marked as no longer based on retained evidence, consistent with existing privacy behavior.

Use owner-scoped RLS, authenticated server validation, private/no-store personal responses, least-privilege worker access, rate limits and redacted errors. Never load private answers into global question-generation prompts, embeddings shared across users or analytics. Private user-text embeddings are unnecessary for the first releases. Public bank embeddings are sufficient for question deduplication.

Optional AI gets only the minimum relevant, consented evidence packet. Treat all text as data, not instructions. Require structured output with evidence IDs and bounded language. Reject unsupported statements; a generated confidence number is not evidence. Preserve the existing pre/post-call consent and generation checks and attempt accounting. Verify vendor retention/training terms before processing sensitive free text; free prototype endpoints must not be assumed to provide confidential clinical infrastructure.

**Distress behavior:** ordinary tiredness or a selected sad mood should invite a lighter question or a pause, not a crisis label. Clear concerning free text pauses profiling and deeper prompts. Respond briefly and kindly, acknowledge the statement, and encourage appropriate real-world support. Where imminent danger is explicitly indicated, prioritize immediate safety and a trusted person/emergency support, using a maintained location-appropriate resource directory; never invent phone numbers or claim the app contacted help. Let the user choose location rather than guessing from language. For younger users, include a trusted adult where appropriate. Do not contact anyone without explicit authorization, send sensitive push previews, or turn crisis text into marketing or engagement features.

The current English regex decision router is not an adequate multilingual distress system. Free text and sensitive prompt categories remain gated until reviewed multilingual examples, negation/quotation cases, false positives, fallback behavior and resource availability have been tested. Offer help access even when automated detection misses something; no detector guarantees coverage. Do not store a permanent “at risk” trait. Keep any necessary safety handling separate from ordinary profiling, with minimal retention and explicit operational policy.

This is a non-clinical product. The WHO describes risks from inaccurate outputs and automation bias in health applications; Nudge should not imply clinical assessment or treatment. [WHO guidance](https://www.who.int/news/item/18-01-2024-who-releases-ai-ethics-and-governance-guidance-for-large-multi-modal-models). NIST likewise identifies confident fabrication and privacy risks in generative systems. [NIST Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf).

## 10. Phased implementation in this repository

| Phase | Concrete work | Completion evidence |
| --- | --- | --- |
| 1: Small useful product | Public six-question `/start`; evidence-linked deterministic starter result; explicit local draft -> signup -> claim; Today question as home; Today/About you/Decide navigation; approximately 200 reviewed bank items; choice/scenario formats with separate Both/Depends/Neither/Skip responses; remove knowledge %. Add the minimum version/event/claim schema and lineage. Extend owner export, answer deletion, memory reset, account deletion and stale-generation protection to every new personal table/cache before any answer can be saved. | Anonymous preview creates no account/remote answer; result visible before login; skip/back/reload work; same-device signup handoff works; repeated claim has one effect; no private data in URLs/events; no duplicate onboarding; exports contain new answers; deletion retracts their evidence; reset blocks pending old claims/jobs; account deletion leaves no new private records. |
| 2: Evolving evidence | About-you evidence cards, contextual aggregation, richer answer editing/retraction UI, insight correction; energy preference and explainable 80/20 selector; topic/family diversity. | Contradictions remain visible; edited answers retract all descendants; existing Phase 1 privacy invariants extend to every new projection; reloads preserve daily question; blocked topics never served; no false learning from skip/exposure. |
| 3: Personal decision payoff | `decision-personalization.ts`, reviewed attribute-to-criterion rules, source-backed suggestion chips, remembered settings/constraints, one missing-input question at a time; accepted-suggestion provenance in comparison snapshots. | Relevant suggestions appear; unrelated contexts do not leak; prices/measurements remain unknown without evidence; importance requires confirmation; a privacy reset invalidates stale suggestions. |
| 4: Rich formats and scale | Accessible slider/ranking/text renderers; free-text safety and optional reviewed extraction; generation jobs, semantic dedup, editorial review, localization and catalog expansion. | Format validation and accessibility tests; safety and prompt-injection fixtures; exact/semantic duplicate evaluation; sampled batch audit; no unreviewed item published; AI outage leaves the daily loop usable. |
| 5: Measured refinement | Consented pilot, cohort metrics, selector experiments and profiling of actual bottlenecks; consider learned ranking only when data justifies it. | Evidence of meaningful insight and useful decision transfer, not merely increased answer volume. |

Phase 1 includes explicit saving of structured answers, with deterministic observation statements. Rich inferred patterns and criteria suggestions arrive only with their reviewed mappings and tests. There is no need to finish a huge bank or add a new model service before trying the core product.

File changes:

- New public route under `src/app/(public)/start/`; update `src/components/landing/hero.tsx` and relevant landing copy.
- Shared `QuestionRenderer` under `src/components/discovery/`, extracted from `src/components/onboarding/onboarding-flow.tsx` and Discover views.
- Update `src/app/(auth)/signup/page.tsx`, `src/app/auth/actions.ts`, `src/lib/auth/foundation-path.ts` and callback handling for the reviewed draft claim; keep authentication and consent checks intact.
- Change `src/app/(app)/dashboard/page.tsx`, `src/components/app/dashboard-view.tsx`, `src/components/app/nav-links.tsx`; adapt `/discover` to the same shared daily experience.
- Extend `src/lib/discover/types.ts`/`loaders.ts`; add `question-selection.ts`, `discovery-answer.ts`, `answer-profile-mapping.ts`, `profile-aggregation.ts`, `insight-builder.ts` and `decision-personalization.ts` under shared services.
- Add `GET /api/v1/discovery/catalog`, authenticated `POST /api/v1/discovery/next`, `POST /api/v1/discovery/answers`, `PATCH/DELETE /api/v1/discovery/answers/[id]`, and `POST /api/v1/discovery/claim`. Public catalog only; reservations and user state are private. Web actions are thin service adapters.
- Extend profile views/actions, `/api/export`, privacy reset/deletion, comparison snapshots, AI consent/accounting action types and cleanup jobs for the new data.
- Add additive migrations after `00014`, regenerate `src/lib/types/database.ts` and generated SQL bundles, and keep old decision APIs compatible for the future native app.

Roll out behind independent discovery-preview, discovery-home and personalization feature flags. Apply additive schema first, verify old decision flows, then enable preview/home, then suggestions. Disabling the new UI must not strand saved answers. Snapshot/backfill validation and the existing disposable-account harness are migration gates; no baseline SQL rerun against the existing project.

## 11. AI cost and performance

The six-question preview, ordinary answers, selection, structured profile mapping, simple reflections and numeric comparison scoring need **zero runtime model calls**. Question generation and semantic dedup run offline. Cache published packs by catalog version/locale; prefetch the next public question assets. Cache private insight results by owner, evidence hash, generation and template/model version; invalidate on edits/deletion.

Use a model only for optional free-text extraction, interpretation of an unfamiliar decision and, later, rendering a complex evidence-backed summary that a template cannot express. Extract suggestions once and ask for review. Don't re-extract on every page view. Keep one bounded request and at most one accounted fallback per task. Per-user/global caps, deadlines and circuit breakers preserve the existing safeguards.

For the current NVIDIA setup, keep deterministic fallback available: the last live report completed five of six pipeline operations, not perfect availability. Do not assume that an endpoint advertised as free remains unrestricted or suitable for all personal data. Use the already-tested configured models initially; add models only after task-specific evaluation.

Track tokens and usage even when the configured prototype rate is zero. Estimate paid operation cost as `(input_tokens × verified_input_rate + output_tokens × verified_output_rate) / 1,000,000`, plus any hosting/embedding costs. Unknown provider usage or rates remain unknown liabilities; never silently treat them as zero. Batch generation budgets are separate from interactive user budgets. Proposed operational target: over 95% of ordinary discovery answers involve no runtime LLM call; this is an architectural target to measure, not a current result.

## 12. Metrics and validation

Primary success measure: **weekly users who judge at least one reflection useful or use a source-backed suggestion in a decision**. Keep the two components separate in reporting so one cannot hide failure of the other. Time in app and raw question count are secondary diagnostics, not optimization goals.

| Metric | Precise definition / use |
| --- | --- |
| Preview completion | Reflection reached / preview started; separately report how many questions were actually answered, so skips cannot masquerade as evidence. |
| Save conversion | Account created and claim succeeded within 24h / guest reflections shown, among measurable sessions. Report existing-user claims separately. |
| First-value time | Median and p90 from start to a reflection the user rates useful; separate load latency from answering time. |
| D1 / D7 return | Activated cohort returning for meaningful activity on day 1 / day 7 in the user's timezone; show cohort size and uncertainty. |
| Insight quality | Optional Fits / Partly / Doesn't fit plus Useful / Not useful. Report response rate, contradiction/correction rate, and qualitative reasons; liking a flattering statement is not proof of accuracy. |
| Decision transfer | Eligible decision sessions that accept at least one relevant suggestion; measure later edits, usefulness and perceived effort. Acceptance alone is not correctness. |
| Outcome learning | Chosen decisions with later reflections and whether users report that remembered context helped; do not claim causation from observational outcomes. |
| Fatigue | Skip runs, user-requested topic changes, stops and per-position drop-off; no inference that a particular person is distressed. |
| Coverage / quality | Distinct approved families, repeated-family exposure, topic diversity when not user-restricted, defective item rate by domain/locale/format. |
| Trust and reliability | Wrong-context suggestions, unsupported-claim reports, privacy-reset regressions, duplicate writes, answer-save failures and invalid exports. |
| Cost and responsiveness | Model calls per answer, tokens/cost per useful reflection, AI fallback rate, p95 selection/save latency; proposed targets: selection <=300ms server-side and next-card visible <=500ms on defined test conditions. |

Use minimal events such as `preview_started`, `question_served`, `answer_submitted`, `reflection_seen`, `reflection_feedback`, `claim_succeeded`, `topic_changed`, `suggestion_used` and `decision_reflected`. No raw prompts, answers, private labels, free text or inferred traits in analytics. Collect funnel events only within the chosen consented measurement policy; report the measurable/opted-in population and its selection bias rather than presenting it as all users. Security logging is separate and content-redacted.

Start with 8–12 consented usability sessions, including keyboard/screen-reader and small-screen users. Ask users to explain the reflection, find its source, disagree with it, change a topic, and apply an appropriate suggestion to a decision with missing facts. This identifies usability failures; it cannot estimate population retention. Follow with a small opt-in multiweek pilot and compare to the existing decision-first flow only after instrumenting a baseline. Larger A/B sample sizes must follow a chosen meaningful effect and statistical power, not an arbitrary participant count.

Pre-register provisional product gates after the initial baseline: no critical privacy/ownership failures; no invented option facts in the evaluation set; most observed participants can explain and correct a reflection unaided; reported usefulness improves without raising unwanted-intimacy complaints. Numerical conversion targets such as a particular 60% completion rate would be business hypotheses, not research facts, and should not be invented before observing Nudge's baseline.

Repeated-survey research shows that protocol details and population affect participation; it does not provide a universal daily-question frequency for Nudge. Test pacing with this audience. [Original EMA randomized study](https://www.jmir.org/2023/1/e45764).

The early releases should prove one complete loop: **six questions -> a grounded reflection -> save -> return to one useful question -> see a relevant preference help with a real decision**. Phase 1 validates the preview, saving and daily return; Phase 3 adds the explicit decision payoff. The staged rollout makes each part observable without requiring a large-scale model or a huge question bank.
