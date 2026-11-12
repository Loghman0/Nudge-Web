# NVIDIA development setup for Nudge

This setup is for private development and testing. NVIDIA describes Developer
Program endpoints as prototype access; public end-user operation needs a separate
production arrangement. Keep `NUDGE_PUBLIC_LAUNCH=false`. That flag does not make
a publicly reachable site private. [NVIDIA NIM FAQ](https://docs.api.nvidia.com/nim/docs/product)

## Recommended starting models

Catalog availability was rechecked on **28 October 2026**. The routing choices
below are engineering starting points, inferred from model positioning and the
tasks involved. They are not measured claims that either model is best for Nudge.

| Nudge task | Slot and exact model ID | Current catalog status |
| --- | --- | --- |
| Parse alternatives and draft a clarification | `lightning`: `nvidia/nemotron-3.5-lightning-30b-a3b` | Free prototype endpoint available; catalog context length 1M |
| Suggest reviewable memories and summarize recorded outcomes | `lightning`: `nvidia/nemotron-3.5-lightning-30b-a3b` | Current development primary after live latency checks |
| Bounded fallback | `gemma`: `google/gemma-4-31b-it` | Free prototype endpoint available; timed out in the initial live check |

Sources: [Lightning catalog](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b),
[Gemma catalog](https://build.nvidia.com/google/gemma-4-31b-it).

Nudge sends bounded text requests rather than using those full advertised context
windows. Parsing drafts require review. Memory suggestions are editable,
unselected temporary statements until the user explicitly confirms them. Ordinary
comparison reasons remain deterministic and do not require an explanation call.
The development setup selects Lightning for all short language tasks. Gemma remains enabled as a bounded fallback. The provider library retains its configurable role defaults; the setup command writes the explicit choices.

One standard NVIDIA Developer API key usually suffices for both routes, subject
to account access and model availability. The API quickstart reuses an existing
Developer API key, and both catalog examples use the NVIDIA integration endpoint.
Put the key only in private `NVIDIA_API_KEY`; do not paste it into chat, source,
logs or browser code. Per-route `NVIDIA_LIGHTNING_API_KEY` and
`NVIDIA_GEMMA_API_KEY` take precedence when provided.
[NVIDIA API quickstart](https://docs.api.nvidia.com/nim/docs/api-quickstart)

## Configure the existing app

After a suitable key is present in private `.env.local`, run:

```sh
npm run ai:configure:nvidia:dev
npm run dev:check -- --require-ai
```

The configuration command updates only the existing local configuration file.
It preserves credentials without printing them, selects `AI_PROVIDER=nvidia`,
enables `lightning,gemma`, chooses Lightning for parsing, extraction, reasoning
and summaries, and keeps public launch off. It requires a shared NVIDIA
key or both model-specific keys, refuses an already-public configuration, and
checks for concurrent file edits. Restart the local app after changing settings.

The development check validates configuration; it does not prove that a key is
valid, the provider is reachable or a model produces accurate results. Use the
normal account consent and quota path for live tests. Use synthetic notes for
initial connectivity checks.

The bounded live pipeline command is `npm run test:ai:nvidia:live`. It requires
both `NUDGE_ALLOW_HOSTED_DISPOSABLE_TESTS=1` and `NUDGE_ALLOW_LIVE_NVIDIA_TESTS=1`,
plus `NUDGE_E2E_TARGET_PROJECT_REF` matching the explicitly authorized project.
It creates one synthetic account, performs four interpretations, one memory draft
and one recap through consent/quota/accounting, then deletes only that account.
Each operation permits at most two provider attempts. A private cleanup journal
blocks another run if cleanup is uncertain. The safe JSON report contains
statuses, counts, timings and ledger usage, with no raw model text or durable
memory/decision writes. A passing pipeline still requires separate human review
of semantic quality; the command cannot establish that the suggestions are true.

## Zero rates and the accounting sentinel

The script records **zero input/output token rates** for these currently free
prototype endpoints and sets `NUDGE_AI_DEVELOPMENT_FREE=true`. The existing SQL
ledger requires a positive reservation, so each HTTP attempt temporarily holds
**one microdollar** (`0.000001`) as an accounting sentinel. This is not an endpoint
price, a purchase, a payment instruction or a charge estimate.

When reliable token usage returns, the configured zero rates settle the attempt
to zero. Missing or uncertain usage keeps the sentinel. The configured per-UTC-day
limits—`0.000100` per account and `0.001000` shared—therefore bound outstanding
sentinels to 100 and 1,000 respectively. Known zero-cost completed calls are still
subject to the separate feature quotas; these numbers are not a promise of a
particular NVIDIA call allowance. The provider's own account limits also apply.

Every fallback reserves and reconciles its own attempt. Accounting failures stop
fallback. Switching the public-launch flag on while this free-development policy
remains selected makes accounted AI unavailable; production configuration must be
prepared separately. No payment or paid endpoint is configured by this command.
See [AI-ACCOUNTING.md](AI-ACCOUNTING.md) for ledger retention and failure semantics.

## Optional and legacy routes

`openai/gpt-oss-20b` is an optional `gpt_oss` slot with an available free prototype
endpoint in the current catalog. It is excluded by default. Enabling it requires
explicit `NVIDIA_ENABLED_MODELS` inclusion and a matching accounting entry for
`nvidia:gpt_oss`, including its 2,048-token output ceiling. It can be selected as a
task primary or used when an earlier configured current route is absent. There
are still at most two attempts under one deadline; enabling it does not add a
third retry. [GPT-OSS catalog](https://build.nvidia.com/openai/gpt-oss-20b)

The older Nemotron 3 Super and Nano 3 catalog pages now mark their free endpoints
deprecated. Do not copy their old setup as the default. Historical Super/Ultra
slots remain explicit compatibility options only: both allowlist inclusion and
an explicit task role are required, and neither is an automatic fallback.
Endpoint availability for a legacy configuration is not guaranteed.
[Super catalog](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b),
[Nano 3 catalog](https://build.nvidia.com/nvidia/nemotron-3-nano-30b-a3b)

An explicitly empty/invalid allowlist or a role naming a disabled model fails
closed. A generic `AI_API_KEY` is forwarded to NVIDIA only when it has the
`nvapi-` prefix, preventing another vendor's generic key from being reused there.

## Verification boundary

The fixed local corpus in [AI-EVALUATION.md](AI-EVALUATION.md) tests grounding,
validation, uncertainty and privacy contracts with synthetic outputs. It does
not establish live model semantic accuracy, latency or reliability. Review real
outputs for unfamiliar terms, negation, quoted statements, invented facts and
unsupported advice before treating these routing recommendations as validated.
Recheck catalog availability and the applicable provider terms when configuring
a later environment. Authoring this document makes no model request and changes
no environment file.
