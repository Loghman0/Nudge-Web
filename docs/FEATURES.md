# Nudge web features

Nudge starts with self-discovery and offers decision help when needed. The deployed web demo has its own [verification record](RELEASE-TESTING.md). The independent native Android preview now includes account sign-in wiring, explicit preview saving, Today and About you. [Mobile verification](../mobile/docs/VERIFICATION.md) separates source/hosted checks from outstanding installed-device tests and remaining parity work.

| Area | Current behavior |
| --- | --- |
| First visit | Six optional public questions, back/skip controls and answer-grounded reflections before signup. Upload requires authenticated review. |
| Today | A daily question, optional continuation, session intensity and topic changes that do not submit answers. |
| About you | Reflections with their evidence; answer correction, exclusion, deletion and topic preferences. Written answers and optional topics remain disabled pending review. |
| Decide | Two to eight options, explicit setting/meaning review, personal history or confirmed criteria, missing-evidence handling, saved explanations, resume/copy/refresh and choice recording. |
| Journal and outcomes | Comparisons, reflections, reminder timing and check-ins. Mobile check-ins are accessible from the header. |
| Earlier preferences | Review stale beliefs and confirm or reject eligible inferred likes. Rejection clears an inference rather than inventing its opposite. |
| Secondary tools | Outcome patterns, decision circles, journal, check-ins and optional starter preferences under About you → Earlier decisions and memory. |
| Decision circles | Private invitations, rotation, membership, polls, voting, ties, closing and owner deletion. Personal journal answers remain separate. |
| Privacy | Owner-scoped records, reviewed AI-memory saves, export v6, memory reset, history deletion and account deletion. Stale requests cannot recreate forgotten evidence. |
| Authentication | Google signup for the hosted demo; existing email/password login and recovery remain available. Controlled-inbox signup confirmation and recovery delivery passed before new email signup was deferred. Custom SMTP is needed to enable unrestricted email signup. |
| AI | Optional. The hosted demo has no provider keys; manual comparisons and discovery work without AI. Live provider quality is checked separately. |

Database source includes migrations through `00019`. Existing installations use the generated update and verification scripts. Never replay the fresh-install bundle against an existing database. See [launch configuration](LAUNCH.md), [verification](RELEASE-TESTING.md) and [Google sign-in](GOOGLE-SIGN-IN.md).

Real push delivery, independent psychological validation, pilot metrics and large-scale question publication are not established by browser tests. The demo retains `NUDGE_PUBLIC_LAUNCH=false` while operator/retention configuration remains deferred.

The superseded batch-two feature report is preserved in [history](history/FEATURES-LEGACY-BATCH-2.md).
