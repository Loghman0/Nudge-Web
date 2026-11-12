# Local AI release evaluation

Run `node scripts/evaluate-ai-contracts.mjs` with the supported Node runtime.
The script does not load private environment files, instantiate a real provider,
send network requests or write application memories. Its default JSON report is
`audit-2026-10-25/ai-evaluation/local-contracts.json`; an optional argument may name
another JSON output inside the workspace. The same corpus runs in `npm test`.

The fixed 136-case corpus in `tests/fixtures/ai-release-cases.ts` has explicit
expectations independent of the functions under test:

| Boundary | Cases | What is checked |
| --- | ---: | --- |
| Interpretation grounding | 40 | Whole supplied phrases, authoritative option slots, ambiguous games/work, Unicode, mixed-language text, negation/qualifiers in supplied slots, missing settings/goals, invented alternatives and unchecked model clarification premises |
| Structured decoders | 24 | Invalid JSON/types/bounds, unknown categories, removal of unrecognized fields, invalid memory suggestions and preserved qualifications |
| Confirmed criteria | 24 | Known winners, honest ties, missing/overlapping ranges, importance tradeoffs and rejection of contradictory or malformed measurements/source links |
| Memory/privacy | 32 | No automatic durable save for any suggested assertion, explicit review, consent/provider/quota/terms gates, withdrawal/reset races and safe provider failure handling |
| Explicit English safety routing | 16 | Refusal for named urgent symptoms, medication changes, self-harm, essential-money exposure, legal commitments and abuse, alongside ordinary-choice controls |

The memory cases deliberately include temporary events, third-party statements,
quoted instructions and invented sensitive assertions from a synthetic provider.
Passing those cases proves they remain unselected temporary drafts and are not
automatically saved. It **does not prove** that the extraction model recognized
the false assertions or that every suggested sentence is semantically faithful.
User confirmation is a storage boundary, not independent factual verification.
The safety cases exercise named English rules only. Passing them is not a medical
classifier, multilingual safety guarantee or proof that every unsafe request is
recognized.

Extractive phrase matching also does not establish semantic intent. A phrase can
occur in a negated or quoted passage; language understanding still needs user
review. The corpus checks that supplied option-slot negation and qualifications
are retained, rather than claiming universal natural-language negation handling.

These are source-reviewed synthetic contract cases, **not a completed human-rated
live-model benchmark**. The JSON report keeps `liveProviderEvaluation`,
`semanticAccuracyMeasured` and `humanReviewCompleted` false. A local pass is not a
measurement of model accuracy, current factual knowledge, external source quality,
cost or latency, and cannot justify promising that Nudge can answer every choice.

Before enabling a real provider broadly, an operator must review this corpus,
add product-specific real examples and rate live outputs for faithful extraction,
missing/contradictory information, unsupported advice, unknown-term clarification,
quoted/negated content, sensitive inference and refusal behavior. Record the
actual provider/model version, consent, configuration, date and observed failures.
Use the normal verified-owner accounting/quota path for requests. Free developer
credits or a free provider tier must be explicitly configured by the operator;
this evaluator never guesses pricing or bypasses budgets. Keep live requests
disabled when those requirements cannot be verified.

`scripts/verify-nvidia-disposable.mjs` supplies a separate opt-in live pipeline
check for the current two-model development configuration. It uses six synthetic
operations, accounted requests and one disposable account with verified cleanup.
Its bounded report retains no generated text and always marks semantic accuracy
unmeasured and human review required. See `NVIDIA-DEVELOPMENT.md` for prerequisites.
It was prepared locally; a missing NVIDIA key still prevents executing it.
