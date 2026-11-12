# Nudge

A self-discovery app with daily questions, reflections grounded in your answers, and decision help that can use what you choose to share.

Built with Next.js App Router, TypeScript, Tailwind and Supabase. AI is optional.
The web demo is deployed at https://projectnudge.vercel.app. The public-launch
configuration flag remains disabled while operator and retention details are deferred.

## Run locally

Use Node 24.15+ (verified with 24.19.0), or supported Node 22.22.2+.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Keep credentials in `.env.local`. Set the public Supabase URL/key and local site URL.
Never distribute this file. For an already configured checkout, keep its existing environment.

The first visit in development compiles a route. To assess actual production navigation:

```sh
npm run build
npm start
```

## Project map

- `mobile/` — independent native Android client; see its README and parity map for the current build scope.
- `src/` — routes, components and shared services.
- `public/` — public assets. `brand/nudge-mark.svg` is the canonical logo.
- `supabase/` — versioned database migrations, functions and generated fresh-install SQL.
- `sql/` — generated install/update/verification scripts.
- `tests/`, `e2e/` — automated checks and browser workflows.
- `scripts/` — repeatable development, verification and packaging tools.
- `docs/` — current guides; `docs/history/` — previous implementation reports.
- `.local/` — ignored local evidence and archived one-off files. Never ship this folder.
- `.next/`, `node_modules/`, `.playwright-runtime/` — build output and installed tooling.

## Guides

- [Latest deployed-web verification and service limitations](docs/RELEASE-TESTING.md)
- [Current web features](docs/FEATURES.md)
- [Google sign-in configuration and verification](docs/GOOGLE-SIGN-IN.md)
- [Self-discovery implementation and verification](docs/SELF-DISCOVERY-IMPLEMENTATION-2026-11-06.md)
- [Self-discovery design and phased roadmap](docs/SELF-DISCOVERY-PLAN-2026-10-29.md)
- [Question catalog, generation and privacy operations](docs/DISCOVERY-OPERATIONS.md)
- [Question wording and interpretation review](docs/QUESTION-DESIGN-2026-11-06.md)
- [UX findings and design decisions](docs/UX-RESEARCH-2026-10-27.md)
- [Current reliability fixes and verification](docs/IMPLEMENTATION-2026-10-28-RELIABILITY.md)
- [UI and navigation update](docs/IMPLEMENTATION-2026-10-27-UX.md)
- [Architecture](docs/ARCHITECTURE.md) and [versioned API](docs/API-V1.md)
- [NVIDIA development setup](docs/NVIDIA-DEVELOPMENT.md)
- [AI evaluation limits](docs/AI-EVALUATION.md) and [usage accounting](docs/AI-ACCOUNTING.md)
- [Testing](docs/RELEASE-TESTING.md)
- [Public launch requirements](docs/LAUNCH.md) and [production operations](docs/PRODUCTION.md)

## Database

Existing installations need migrations through `00019` for the discovery catalog, privacy controls, accepted criterion sources and revised starter questions.
Use `sql/02_UPDATE_EXISTING.sql` for missing migrations, then `sql/03_VERIFY_DATABASE.sql`.
Do not rerun a baseline or fresh-install SQL against an existing database.
`supabase/nudge_complete_setup.sql` is the canonical generated fresh-install bundle.

## Checks

```sh
npm run typecheck
npm test
npm run build
npm run sql:check
npm run dev:check
npm run test:e2e:public
npm run release:package
npm run release:archive-check
```

Authenticated browser verification requires dedicated disposable accounts; see the testing guide.
The release archive contains allowlisted source, docs and tests, never `.env.local` or `.local/`.
To regenerate the icons from the editable SVG, run `node scripts/build-brand.mjs`.

Manual comparisons work without an AI key. NVIDIA's development endpoints are for prototyping;
the live-provider test and `dev:check -- --require-ai` are separate from synthetic tests.
Native mobile development follows the validated web app and reuses its backend services.
