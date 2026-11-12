# Version 1 comparison, journal, choice, reminder and reflection API

These routes use the same owned journal records as the web app. Successful and
error responses include `apiVersion:"1"`, `Cache-Control: private, no-store,
max-age=0`, `Pragma: no-cache` and `X-Content-Type-Options: nosniff`.

## Authentication

Browser requests use the existing session cookies. Read-only GET requests may
omit Origin; all writes require an Origin matching the app URL. Native
clients may send `Authorization: Bearer <access-token>` from their own Supabase
Auth session. The server verifies identity with Auth and uses a public-key client
under that user's RLS. Invalid or malformed bearer credentials never fall back to
cookies. No service-role credential belongs in a native client. In public launch
mode, current terms acceptance is required on reads and writes.

## Create a confirmed comparison

`POST /api/v1/decisions` accepts exactly `{requestId,options,title?,context}`.
`requestId` is a stable UUID for an unchanged attempt; `options` contains two to
eight distinct labels of at most 80 characters. Context uses the existing
`CompareContext` validation, including a nonempty setting/domain and
`meaningConfirmed:true`. A criteria comparison additionally needs confirmed,
validated criteria. Unconfirmed drafts return 400 / `needs_confirmation` without
writing or calling a model. Caller-supplied scores, identity fields and unknown
nested criterion/cell fields are rejected.

Requests require JSON and have a 512 KiB actual UTF-8 byte cap. Existing per-field
limits still apply; the byte allowance accommodates bounded Unicode source notes
and links across five criteria and eight options. The shared comparison service
owns evidence retrieval, deterministic scoring, privacy-generation checks and
atomic creation with saved evidence.

Success returns 200 with `{apiVersion:"1",data:{comparison:CompareResult}}`,
including persisted option IDs, revision, meanings, criteria assessment and saved
reasons. An identical creation retry returns the same decision ID and its current
persisted state. Changed intent under the same request ID returns 409. Unknown
completion returns 503; retry the same request ID and unchanged input rather than
creating a new request. No first-write claim is made.

## Explicitly refresh an open comparison

`POST /api/v1/decisions/{decisionId}/comparison` accepts exactly
`{revision,extraLabel?}`. Supply the nonnegative integer revision read from the
comparison. The optional new label is distinct and at most 80 characters. JSON
is limited to 1 KiB. No measurement is invented for an added criteria option:
its inputs remain unknown until explicitly reviewed in a new comparison.

Success returns the same comparison envelope with an incremented revision.
Stale revisions or closed comparisons return 409; foreign/missing decisions
return 404. Refresh is an explicit new scoring operation. If its acknowledgement
is lost, reload before retrying: reusing the old revision returns 409 rather than
silently refreshing a newer comparison again. Reads continue to return saved
evidence without reranking.

## List decisions

`GET /api/v1/decisions` accepts these optional parameters:

| Parameter | Default | Accepted values |
| --- | --- | --- |
| `limit` | `20` | Integer 1–50 |
| `offset` | `0` | Integer 0–100000 |
| `q` | Empty | Up to 120 characters; a literal, case-insensitive substring of the question |
| `category` | All | `food`, `entertainment`, `travel`, `shopping`, `lifestyle`, `work`, `social`, `health`, `career`, `relationships`, `finance`, `hobbies`, `other` |
| `status` | All | `open`, `decided`, `reflected`, `abandoned` |

Unknown or repeated parameters are rejected with HTTP 400 / `invalid_query`.
Results belong to the verified caller and are ordered by `created_at` descending,
then `id` ascending. The list contains summaries, without notes or explanations.

```json
{
  "apiVersion": "1",
  "data": {
    "decisions": [{
      "id": "00000000-0000-4000-8000-000000000001",
      "question": "Which activity?",
      "category": "hobbies",
      "status": "open",
      "created_at": "2026-10-24T12:00:00.000Z",
      "decided_at": null,
      "selected_option_id": null,
      "reflection_due_at": null,
      "reminder_enabled": true
    }],
    "pagination": {"offset": 0, "limit": 20, "total": 1, "nextOffset": null},
    "consistency": "live"
  }
}
```

Use the returned `nextOffset`, which advances by the rows actually returned even
when the database API has a lower row cap. A null value marks the current end.
This is live pagination: concurrent additions or deletions can move records
between pages. The response is not a frozen export or a synchronization cursor.

## Read one decision

`GET /api/v1/decisions/{decisionId}` returns `data.decision` with the summary
fields, `comparison_revision`, `expected_outcome`, recorded `context`,
`decision_options`, `decision_reflections` and `saved_explanation`. Options are
ordered by rank. Reflections retain the user's explicit rating, optional answers
and notes; missing answers remain unknown.

Recorded context is restricted to domain, goal, option details, meaning
confirmation, mood, budget, company and confirmed criteria fields. Derived
confidence and score claims are supplied only by a validated saved explanation:

```ts
type SavedExplanation =
  | { state: "saved"; revision: number; snapshot: ComparisonEvidenceSnapshot }
  | { state: "unavailable"; revision: number };
```

The exact `ComparisonEvidenceSnapshot` contract is in
[`comparison-snapshot.ts`](../src/lib/services/comparison-snapshot.ts). It has
`version:1`, a UUID scoring run, an ISO scoring time, `basis`, `engineVersion:2`,
versioned engine weights, relative-fit confidence, cold-start/evidence flags and
two to eight option records. Each option has a label, score, numeric breakdown,
one to five reasons, warning, source counts and bounded source-ID arrays.

The snapshot preserves rendered deterministic reasons, scores, breakdowns,
warnings and bounded source counts/IDs for its exact revision. It excludes raw
source notes and preference records. It is not a complete reproducible input
archive. The `journal` basis describes relative personal fit, not factual
correctness or a calibrated chance of a good outcome. The `criteria` basis uses
the confirmed measurements/ranges recorded for that comparison.

Legacy entries, privacy-purged evidence, invalid bindings or an unavailable
evidence read return `saved_explanation:{"state":"unavailable","revision":1}`.
Their option `score` and `score_breakdown` fields are null; explicit journal
content remains readable. Reopening does not rerank against current memory.
The web's explicit refresh of an open comparison creates a new revision.

An invalid UUID returns HTTP 400 / `invalid_input`. A missing or foreign decision
returns 404 / `not_found`. A failed required journal read returns 503 /
`unavailable`; it is not presented as an empty journal.

## Commit a choice

`POST /api/v1/decisions/{decisionId}/choice` accepts exactly one field:

```json
{"optionId":"00000000-0000-4000-8000-000000000002"}
```

Both IDs must be UUIDs. The URL owns the decision identity. Unknown body fields,
including caller-supplied ownership or decision IDs, return 400. Requests require
JSON and are limited to **1 KiB of actual UTF-8 bytes**, including streamed bodies.

The shared `decision-choice.ts` service reads only the verified owner's decision,
checks that the option belongs to it and derives the learning key from its stored
category and option label. The existing `commit_choice_and_learn` RPC locks and
commits the choice and learning atomically. The service confirms the persisted
selection before acknowledging it:

```json
{"apiVersion":"1","data":{"decisionId":"...","selectedOptionId":"...","status":"decided"}}
```

First requests and identical retries both return 200 with the persisted state;
`status` can also be `reflected`. There is no claim that a particular attempt was
the first write. Retrying the same selection does not duplicate learning. A
different choice on a closed decision returns 409 / `conflict`. A foreign or
missing decision returns 404 / `not_found`; an option outside the owned decision
returns 400 / `invalid_option`. An unconfirmed save or transient error returns
503 / `unavailable`, telling the caller to reload before retrying because the
save may have completed. Raw database diagnostics stay private.

Authentication and body errors follow the shared 401/403/413/415 contracts.
This save has no AI or achievement dependency. The web action uses the same
service and handles optional achievement failures after the required save.

## Schedule or disable a check-in

`POST /api/v1/decisions/{decisionId}/reminder` accepts exactly
`{enabled:boolean,dueAt:string|null}`, with a 1 KiB JSON byte cap. An enabled
reminder requires an actual ISO calendar timestamp with seconds and explicit
`Z` or numeric UTC offset, in the future and within 365 days. It is normalized
to UTC. Disabling requires `dueAt:null`. A local time without an offset is
rejected. The web's device-local picker also rejects invalid, nonexistent or
repeated clock times instead of silently changing them.

The decision must belong to the verified caller and still await reflection.
After the existing atomic scheduling RPC, the service checks the persisted
enabled/time/version state before acknowledging:

```json
{"apiVersion":"1","data":{"decisionId":"...","enabled":true,"dueAt":"2026-10-28T12:00:00.000Z","reminderVersion":2}}
```

Every accepted scheduling call advances the reminder version, including an
identical sequential retry. This endpoint does not promise exactly-once
scheduling. A competing change or a decision no longer awaiting reflection
returns 409; foreign/missing decisions return 404; unconfirmed completion returns
503 and requires a reload before retrying. The web blocks duplicate clicks while
its required save is in flight and retains failed custom-time drafts.

## Save a reflection

`POST /api/v1/decisions/{decisionId}/reflection` accepts the same explicit reflection input as the web form. The URL determines the decision identity; client-supplied user or decision IDs cannot override it.

```json
{"rating":4,"notes":"Optional journal note"}
```

`rating` is an integer from 1 through 5. Optional `wouldRepeat`, `hasRegrets`, `wouldRecommend` and `wouldChooseAgain` are boolean or null. Omitted answers stay unknown. Notes are optional and limited to 500 characters. JSON requests are limited to 8 KiB; the server checks actual streamed bytes as well as Content-Length.

Responses use `apiVersion:"1"`, private/no-store headers and either `data` or `error`. A first successful write returns:

```json
{"apiVersion":"1","data":{"decisionId":"...","saved":true}}
```

An identical retry returns HTTP 200 with `saved:false`. A conflicting reflection returns 409. Other responses include invalid input 400, unauthenticated 401, forbidden or needs_terms 403, missing record 404, payload_too_large 413, unsupported_media_type 415 and unavailable 503. Error messages exclude raw database diagnostics.

The API and web action share `reflection-save.ts` and the existing atomic database RPC. The API returns after the required save; the web adapter retains its optional achievement evaluation and UI cache revalidation. Saving a reflection has no AI dependency.

## Discovery

The `/api/v1/discovery/*` routes require the same authenticated owner and accepted-terms checks as the decision APIs. Personal responses have `Cache-Control: private, no-store`. Their current payloads are direct JSON objects, not the decision routes' `apiVersion/data` envelope; errors use `{error:{code,message}}`. JSON request bodies are bounded to 24,000 bytes. The public six-question preview uses a separate static asset and does not call these routes before an explicit account save.

| Method and suffix | Payload / result |
| --- | --- |
| `GET profile` | Current generation, answers with question/version/revision, insights, settings, effective format capabilities and exposures. |
| `POST next` | `requestId`, `expectedGeneration`; optional `daily`, `change`, `topic`, `mode`, `localHour`, `sessionAnswers`, `consecutiveSkips`, `continueAfterPause`. Returns an eligible question or a pause/exhaustion result. |
| `POST answers` | `requestId`, `expectedGeneration`, `answers` containing one `{questionId,questionVersion,response}`. |
| `POST claim` | Same shape, with up to six validated preview answers. Retries must keep the original request ID and generation. |
| `PATCH answers/{id}` | `requestId`, `expectedGeneration`, `expectedRevision`, plus `response` and/or `active`. |
| `DELETE answers/{id}` | JSON body with `requestId`, `expectedGeneration`, `expectedRevision`. Retracts dependent evidence. |
| `POST insights/feedback` | `requestId`, `expectedGeneration`, `insightId`, `feedback` (`fits`, `sometimes`, `not_me`). |
| `POST settings` | `expectedGeneration`, `mutedTopics`, `maxDepth` (0–2), `optionalTopics`, `writtenAnswers`, `metricsEnabled`. All settings are explicit. |
| `POST suggestions` | `domain` and optional `category` strings. Returns generation and source-backed criterion suggestions. No option values or weights are invented. |

Question responses follow the published version: `choice` with `optionId`, `scale` with `value`, `ranking` with tied `groups`, optional `text` with `text`, or permitted neutral `both`/`depends`/`neither`/`skip` responses. Written answers and optional topics require operator gates and owner opt-in; do not infer availability from the format list. Unknown versions, invalid options, overlong text and stale privacy generations are rejected.

Answer and feedback writes use owner-scoped SQL retry ledgers. A retry cannot silently adopt a new generation after deletion/reset; clients must stop and let the owner review fresh state on a 409. Comparison requests may accept `criterion.discoverySuggestion={id,generation}` from a returned suggestion. The server and SQL revalidate its sources before storing private snapshot provenance; never submit guessed source IDs. Export v6 includes discovery history and retained comparison evidence.

These routes are the current versioned backend slice. Other setting management and
other app features still use the web/shared service or
RPC contracts; they do not yet have complete versioned native routes.
Authentication flows, production transport and real-device verification remain
required before native release. See `IMPLEMENTATION-2026-10-26-COMPLETION.md` for
the current rollout and verification status.
