# UX research and decisions — 27 October 2026

## Evidence and limits

Inputs: the supplied comparison, login and favicon screenshots; the supplied development timing log; the current source; and the primary sources below. No behavioral analytics or Nudge user interviews were available. We cannot honestly report actual abandonment locations, conversion improvements or what attracts Nudge users yet. The findings below are design hypotheses supported by established usability evidence, not measurements of Nudge retention.

The first route in the log took 4.7 s, of which 4.0 s was Next development work. Discover took 2.2 s, including 1.866 s of application work. Later Ask visits took 250–274 ms. These are different problems: development compilation, server data dependencies, and the lack of immediate navigation feedback. Production measurements must be reported separately, with no claimed before/after percentage from unlike environments.

## Findings mapped to implementation

| Observed friction | Evidence and rationale | Implemented response |
| --- | --- | --- |
| Two options lead to a page of simultaneous instructions, meanings, modes and optional fields | [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) recommends revealing advanced or less frequent work when needed. | Start with two option fields and one primary action. Show context separately. Place questions, definitions, saved settings and journal notes behind named disclosures. |
| Too much effort before the first useful result | [Baymard's form research](https://baymard.com/research-articles/checkout-flow-average-form-fields) found that the fields users must consider matter more than merely counting steps. This is checkout evidence, so its application to Nudge is an inference. | Reduce the visible fields, not just divide the old form into pages. Keep context short, goals optional, and existing defaults editable. |
| Users must remember what they entered while explaining terms | [NN/g recognition and recall](https://www.nngroup.com/articles/recognition-and-recall/) supports keeping task information visible or retrievable. | Keep option names in the context summary, offer inline editing and preserve drafts when going Back. |
| The same app changes logo, typography and palette at login | [NN/g usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) identify consistency and familiar conventions as ways to reduce interpretation effort. | Shared mark, wordmark, blue tokens, readable input sizing and matching light/dark account pages. |
| A click appears to do nothing while a dynamic page loads | [NN/g response-time guidance](https://www.nngroup.com/articles/response-times-3-important-limits/) calls for feedback when waits interrupt the task. [Next navigation guidance](https://nextjs.org/docs/app/getting-started/linking-and-navigating) explains streaming and loading boundaries. | Route-specific loading UI, pending state on the selected link, default prefetch for public auth links, fewer repeated auth calls, parallel independent reads, and streamed optional Discover checks. |
| Small text and controls demand careful aiming or zooming | [WCAG 2.2 target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) specifies 24 CSS px with exceptions; larger primary targets are beneficial. | Shared inputs/buttons use 48 px minimum height and 16 px input text. Visible focus, labels, status messages, dark mode and reduced motion remain supported. Automated checks do not establish complete WCAG conformance. |
| An AI may sound certain about a private or ambiguous label | [Microsoft's Human-AI Interaction guidelines](https://www.microsoft.com/en-us/research/project/guidelines-for-human-ai-interaction/) address expectations, correction and behavior when AI is wrong. | Ask for the setting, allow user-defined meanings, require confirmation, preserve unknown facts, and give a useful next action when evidence cannot support a preference. |

## Unfamiliar choices

“Mine or cut trees?” is incomplete: the setting might be a game, a particular version/mod, or real life. Nudge should not silently pick one. Likewise, “Blue room or Moon run?” could be meaningful only inside a user's group.

1. Accept the user's own labels without forcing a generic topic.
2. Ask for the setting. Offer a short optional goal and definitions, instead of asking for a full essay.
3. Let the user confirm what the options mean. AI suggestions, when available and enabled, remain editable drafts.
4. Compare only with relevant recorded evidence or the criteria/values supplied by the user. Descriptive notes are not automatically scored facts.
5. If evidence is insufficient, say so. Offer adding criteria or recording the user's own choice. Never present an arbitrary score as a confident recommendation.
6. Record the outcome later, so a similar choice has actual personal evidence next time.

This release does not add external fact retrieval or claim that AI can correctly answer literally any question. Current facts, specialist judgment and private meanings cannot be recovered from a vague label alone.

## Why use Nudge alongside a general chatbot?

The product's value is a structured, revisitable decision record: options, confirmed context, evidence, choice and outcome. A later decision can reuse what actually happened. The user can inspect, correct, export and forget that record. Explicit criteria comparisons preserve missing values and uncertainty. Those are concrete workflows, not a claim that a chatbot cannot have memory or perform comparisons. Marketing and empty-result copy now describe this distinction accurately.

## Attention without pressure

Use one primary action, concise headings, readable spacing, predictable placement and visible progress. Do not add fabricated urgency, unavoidable onboarding, streak-loss warnings, intrusive animation or hidden surveillance to obtain engagement. The age/guardian checkbox is removed from login and signup as requested; authentication does not silently create a policy acceptance record. The separate policy-consent flow remains explicit.

## Validate the hypotheses with people

Next research should recruit first-time participants with varied abilities and device sizes. Ask them to compare an everyday choice, a private nickname pair, and a choice with unknown facts; backtrack and edit; then find a past outcome. Observe completion, time to the first useful action, misunderstandings, unprompted requests for help and keyboard success. Ask participants to explain what the result means. In particular, verify they do not read relative fit as a probability or assume definitions have been independently fact-checked.

Any future funnel measurement should be separately designed with clear consent and aggregate events only: flow started, context reached, result opened, choice saved and reflection saved. Never collect raw questions, option labels, meanings or private notes as analytics. No new analytics service or tracking was added by this update.
