# Question design review — 6 November 2026

## What these answers can support

Nudge can retain self-reported preferences and behavior in the context of a question, make those records inspectable, and offer relevant decision criteria. A single hypothetical response cannot establish aggression, impatience, a diagnosis or a stable personality trait. Six questions are not a personality assessment. The current starter bank has not been validated by a psychologist or against an external measure.

The puzzle-box example exposed an actual design limitation: the four answers all assumed interest in solving the puzzle and omitted frustration, stopping and shortcuts. Some starter choices also lacked observation mappings. The revised six-question set uses five ordinary first-person responses each and maps all 30 choices to limited statements of what the person reported. Frustration and avoidance are legitimate answers, not moral failings. Neither fitting, dependence on context and skipping create no inferred trait.

## Research used and implementation choices

- [Pew Research Center: Writing Survey Questions](https://www.pewresearch.org/writing-survey-questions/) describes how wording and offered choices affect responses, recommends concrete language and questions about one concept, and discusses social desirability and pretesting. Applied here: recognizable situations, alternatives with credible motives, and no single conspicuously virtuous answer. This is survey-design guidance, not validation of Nudge's items.
- [AAPOR: Best Practices](https://aapor.org/standards-and-ethics/best-practices/) recommends clear objectives, suitable response options, pretesting and allowing respondents to skip. Applied here: one answerable question, explicit context, optional non-answers and an editorial review rubric.
- [IPIP: Reliability and Validity](https://www.ipip.ori.org/ReliabilityValidity.htm) reports scale-level reliability estimates and evidence relating measures to other constructs. That evidence does not transfer to newly written or rephrased Nudge scenarios. No IPIP score, clinical interpretation or borrowed validation claim is added.

## Starter edition 2

| Question area | What is recorded | What is not inferred |
| --- | --- | --- |
| Recovery after a draining day | The reported first activity, including company, movement or unplanned scrolling | Introversion, addiction, emotional resilience |
| An unplanned day | The chosen approach to planning, catching up or accepting suggestions | Conscientiousness, dependence, laziness |
| A recent task that would not work | The recalled action, including asking for help, frustration or a shortcut | Aggression, intelligence, persistent impatience |
| Food choice | The stated role of familiarity, curiosity, price, effort or appetite | Risk tolerance across life, health status |
| Recent humor | What a recent laugh was about | Empathy, hostility, personality type |
| Starting something creative | The reported starting approach, including putting it off | Creativity level, anxiety, ability |

Only explicit, context-relevant mappings may suggest a criterion label. They never fill importance, cost, quality or other option facts. The revised stuck-task frustration/shortcut answers have no automatic criterion mapping.

Earlier definitions remain immutable. Migration `00019` inserts six version-2 definitions without altering version-1 answers. Existing preview drafts stay on their original edition, with an explicit action to start the revised set. History, export, corrections and private comparison sources resolve the exact recorded version.

## Review rubric for later batches

1. State what the answer could actually tell us and the context in which it would be useful.
2. Ask one thing in ordinary language. Do not require enthusiasm, disposable income, a particular household or a particular social life to answer.
3. Make options distinguishable and similarly specific. Include ordinary reluctance, frustration, convenience or ambivalence where appropriate without making those answers insulting.
4. Avoid compound choices that force unrelated motives together. Give each option a plausible reason; do not equate social approval with a better personality.
5. Keep a way to say the options do not fit or to skip. A selected scale value is not automatically a trait score.
6. List exactly what each mapping says, its source and limits. Inference rules need separate review; generated questions still have no automatic inference rules.
7. In cognitive interviews, ask intended users to explain the wording and their choice, identify missing responses and say whether any option feels judged. Include different cultural, language and accessibility needs.
8. Revise and pilot before claiming improved insight quality. If a future feature reports a psychological construct, choose an appropriate validated instrument and scoring protocol with qualified review; do not relabel these prompts as an expert test.

The rest of the 200-question bank remains an authored/adapted development catalog. This change revises the six entry questions and improves future generation instructions; it does not certify the entire bank as expert-validated. The generation review tool checks syntax and lexical duplicates, not psychological validity or all response bias.

## Engineering verification

The production build and all 722 local tests passed. Tests cover all 30 current answer mappings, absence of unsupported trait verdicts, preservation of exact historical definitions and draft editions, and removal of the two requested lines. The hosted database reports edition 2, 200 preserved version-1 definitions and six version-2 definitions with five mapped choices each. Three hosted browser scenarios passed for the revised preview, authenticated saving/profile/criteria flow and existing comparison reliability; both disposable accounts were removed. These checks establish implementation behavior, not psychological validity or insight quality. Local evidence: `.local/discovery-edition-all-tests.log`, `discovery-edition-build.log`, `discovery-edition-browser.log` and `discovery-edition-database.png`.
