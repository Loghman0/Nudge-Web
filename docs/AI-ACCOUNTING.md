# AI accounting and budget configuration

Migration `00010_ai_usage_ledger.sql` adds operational accounting without saving prompts, answers, credentials or provider error bodies. Existing deterministic comparisons, reflection saves and journal features do not require an AI provider or this ledger.

## Before enabling optional AI

1. Apply the tested migration through `sql/02_UPDATE_EXISTING.sql` and run `sql/03_VERIFY_DATABASE.sql`. Do not replay the baseline on an existing project.
2. Keep `SUPABASE_SERVICE_ROLE_KEY` in the server environment. Only the server may reserve or finish an attempt; browsers cannot set prices, budgets or usage.
3. Set `NUDGE_AI_USER_DAILY_USD`, `NUDGE_AI_GLOBAL_DAILY_USD` and `NUDGE_AI_MODEL_PRICES_JSON` in the server environment. Budget and price amounts are decimal USD strings with at most six decimal places. Supply verified values for the actual provider account and model, including every allowed fallback. The app does not infer prices from model names.
4. Set provider-side spend limits where available, check the provider invoice/usage dashboard, and complete the existing vendor/privacy declarations before public launch.

The JSON value is an array of entries with these fields (placeholders below intentionally fail validation):

```json
[{
  "provider": "custom",
  "model": "replace-with-actual-model-id",
  "inputUsdPerMillion": "VERIFIED_INPUT_RATE",
  "outputUsdPerMillion": "VERIFIED_OUTPUT_RATE",
  "maxAttemptUsd": "VERIFIED_ATTEMPT_CEILING",
  "maxInputBytes": 12000,
  "maxOutputTokens": 1024
}]
```

`provider` must exactly match the transport label, for example `anthropic`, `openai`, `custom` or `nvidia:gemma`. Model IDs must also match exactly. Copying a price for a different model is not safe. The size limits above illustrate the schema, not production recommendations or provider prices. Unknown models, missing configuration and failed accounting prevent an upstream request; the manual comparison path remains available.

`maxAttemptUsd` is the amount held before each HTTP request. It must cover a conservative quote using the configured input-byte cap plus framing headroom and output-token limit. The request must fit both size caps. Budget checks and reservations serialize in PostgreSQL and apply to each UTC day, per account and globally. Every NVIDIA fallback is a separate attempt and needs a separate reservation. Existing feature quotas remain as an additional limit.

## Interpreting the records

Token counts are provider-reported when available. Cost is calculated from those counts and the configured rates; it is not a provider invoice. Prompt caching or inconsistent usage can make pricing uncertain, in which case the full reservation remains charged. A timeout, failed response, missing usage or server interruption also keeps the reservation rather than treating an unknown charge as zero. Reconciliation failure stops fallback.

A reservation is a conservative guard, not an unconditional guarantee about future invoices: provider tokenizers, pricing changes, billing categories and incorrect operator configuration can differ. If reported cost exceeds a reservation, all observed cost is charged and later requests are blocked against the exceeded budget. Provider-side caps and invoice reconciliation remain necessary.

Turning AI off or changing memory invalidates new reservations through the profile generation/consent checks. A request already reserved may have started. Account deletion removes its attempt rows while retaining anonymous daily aggregate liabilities so deletion cannot refund shared spend.

Attempt rows become eligible for bounded opportunistic cleanup after 48 hours, on later eligible reservations. Without later traffic they can remain longer. Temporary aggregate daily buckets are removed after their supporting attempt rows expire; current and previous UTC day totals are retained for budget integrity. No permanent per-user billing history is promised.

Account exports include paginated owner-only `ai_usage` records. Before migration10, the export explicitly reports `available:false`; unrelated database failures fail the export rather than returning a partial dataset.

## Provider usage references

The adapter reads Chat Completions `prompt_tokens`, `completion_tokens` and optional `total_tokens` according to the [official OpenAI API reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create). The Messages adapter reads input/output and cache categories documented in the [official Anthropic Messages reference](https://platform.claude.com/docs/en/api/http/messages). No live provider calls or price assumptions are required for the mocked regression suite.
