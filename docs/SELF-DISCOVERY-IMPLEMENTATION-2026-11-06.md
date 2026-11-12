# Self-discovery implementation — 6 November 2026

This is a historical checkpoint. The web demo was deployed on 7 November; see [current verification](RELEASE-TESTING.md) for the live browser checks and remaining service configuration.

Nudge now has a working self-discovery loop: six public questions → a reflection grounded in those answers → explicit account save → daily questions → editable evidence → relevant criteria for a decision. The web app remains unpublished. Native mobile work has not started.

Later on 6 November, the starter questions were revised with five fuller answers each, the two preview helper lines were removed, and migration `00019` was applied without changing earlier definitions. The updated build, 722 local tests and three hosted browser scenarios passed. See [Question design review](QUESTION-DESIGN-2026-11-06.md) for the changes, research and precise interpretation limits. The evidence below records the earlier implementation checkpoint.

## Delivered

- Public `/start` works without login or remote answer writes. It preserves a tab draft, supports skips and back navigation, and shows reflections before signup. Explicit saving creates a local 24-hour handoff; authenticated review is required before upload. A retry retains its original privacy generation and cannot restore answers after a memory reset.
- Today presents one daily question, optional continuation, session intensity and topic switching. Selection enforces topic opt-outs, depth/readiness gates, forgotten questions, recent-family diversity and fatigue pauses, with an 80/20 relevance/exploration mix. Uncovered decision attributes now contribute to selection.
- The bank contains 200 versioned authored/adapted questions across 18 domains. This is an engineering seed, not a claim of independent editorial or psychological validation. Choice, scale and ranking controls are available; written and optional-topic gates remain off.
- About you shows the exact answers behind reflections, mixed evidence, Fits/Sometimes/Not-me corrections, and answer editing, exclusion and deletion. Export v6 includes question versions, revisions, feedback, settings and retained comparison evidence. Privacy reset and account deletion cover the new records.
- Relevant answers suggest criterion labels with sources. Users still supply weights, ranges and option facts. Accepted suggestions are recomputed against the owner's current answers and saved in private comparison snapshots with exact answer/question revisions. Foreign, stale, excluded, mixed or rejected evidence cannot be used. Editing, deleting or rejecting supporting evidence withdraws the private source links while preserving explicit decision inputs.
- The preview downloads its six-question asset rather than the full bank. Landing copy, metadata and share image now introduce self-discovery. The mobile opening-screen overflow was fixed; authentication, existing comparisons and decision history remain available.
- The generation tool creates synthetic briefs, calls an enabled NVIDIA model only on an explicit operator run, validates drafts, checks exact/token-overlap duplicates, and produces review artifacts. It never reads user answers, generates trusted inference rules, approves itself, or publishes to the live database.
- Generation has a separate durable SQLite rate/cost ledger shared across all packages in the checkout. Reservations precede transport; absent usage retains reserved cost; interrupted/failed accounting blocks further dispatch. It is a single-machine CLI, not a distributed service.

## Database

The existing authorized Supabase project has migrations through `00018`. Migrations `00017` and `00018` were applied and verified on 5 November:

- `00017`: orphan evidence cleanup, forgotten-key preservation, correction retention and private database readiness gates enforced independently of the web API.
- `00018`: private criterion provenance v2, source validation and invalidation after rejected feedback.

Preflight for `00017` found no orphan rows requiring deletion. The hosted combined checks returned `all_privacy_checks_passed=true` and `criterion_source_checks_passed=true`. Do not rerun fresh-install SQL against this database. Generated update and verification scripts include both migrations.

## Verification evidence

| Check | Result and scope |
| --- | --- |
| Full local suite, 6 November | 719 tests; 107 suites; no failures or skips. Includes SQL ownership/privacy, retry races, typed formats, generation and accounting failures. |
| TypeScript and production build | Passed with the installed Next.js 16.4.3 and bundled Node 24.19.0. |
| Hosted browser verification, 5 November | Three scenarios passed: guest preview, authenticated discovery/edit/export/delete with a sourced criterion, and existing comparison reliability across reloads, private labels and lost responses. Disposable-account cleanup confirmed. |
| Public browser verification, 6 November | Four scenarios passed: auth design, landing interactions/keyboard/mobile, contrast/reduced motion, and public navigation/policies/sharing. |
| Real NVIDIA generation, 6 November | One synthetic brief produced a draft through the full metered runner. Reported usage: 322 input + 240 output = 562 tokens; configured cost 0; no unsettled reservation. Cost is based on the existing explicitly zero-rated development configuration, not a verified provider invoice. |
| Generated draft review | Structural, specification, exact/token-overlap checks passed. Editorial fields remain unset and the draft is unpublished. |
| Preview bundle | Full bank excluded; preview route chunk 22,064 bytes. This is not the total page transfer size or a measured user latency result. |

Local evidence is under `.local/`: `discovery-tests.log`, `discovery-build.log`, `discovery-public.log`, `discovery-browser.log`, `discovery-hosted.json`, `discovery-generation-live.log`, `discovery-preview-bundle.json` and screenshots. This folder and the operator ledger are excluded from the source archive. No claim is made that automated tests prove all future inputs, psychological accuracy, real-device accessibility or production availability.

## Remaining rollout work

- Review the bank and its inference mappings with intended users; run consented usability sessions and a pilot before making retention or insight-quality claims. Metrics plumbing exists, but no pilot results are claimed.
- Written answers and optional topics stay disabled until representative language/safety review and appropriate support guidance. Both database and server gates, then user opt-in, are required. The narrow English support check is not a multilingual crisis detector.
- Before expanding to hundreds of thousands of published questions: add evaluated semantic deduplication, indexed server-side candidate retrieval, staffed editorial review/localization, and a shared operator ledger if generation runs across machines. Current taxonomy can produce 168,960 work specifications; these are not already generated, unique or reviewed questions.
- Public hosting, operator/contact details, provider terms and verified retention settings remain release configuration work. `NUDGE_PUBLIC_LAUNCH` remains false. The source archive is a development handoff, not a public deployment.

See [Discovery operations](DISCOVERY-OPERATIONS.md) for generation commands, privacy gates and recovery limits, and [API v1](API-V1.md) for the current discovery contracts.
