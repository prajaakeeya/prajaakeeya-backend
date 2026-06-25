# Prajaakeeya — Backend API

Backend for **Prajaakeeya**, a civic-engagement platform that connects voters
with election aspirants (candidates). Voters discover aspirants in their
constituency, interact with them (chat, meetings, visits, calls), raise local
issues, and cast votes during election windows; aspirants manage their profile,
schedule meetings/visits, and engage their constituency.

This repository is the **REST API** — a NestJS modular monolith backed by
PostgreSQL and Redis, with media served from S3/CloudFront.

> New here? This README gets you from a fresh clone to a running, tested API.
> For the test suite specifically, see **[TESTING.md](./TESTING.md)**.

---

## Table of contents

1. [Tech stack](#tech-stack)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Getting started](#getting-started)
5. [Environment variables](#environment-variables)
6. [Running the app](#running-the-app)
7. [Database & migrations](#database--migrations)
8. [Project structure](#project-structure)
9. [Modules](#modules)
10. [API documentation](#api-documentation)
11. [Authentication & authorization](#authentication--authorization)
12. [Testing](#testing)
13. [CI/CD & deployment](#cicd--deployment)
14. [Scripts reference](#scripts-reference)
15. [Coding conventions](#coding-conventions)
16. [Troubleshooting](#troubleshooting)

---

## Tech stack

| Area | Technology |
|---|---|
| Runtime | Node.js 24 (LTS) |
| Framework | [NestJS](https://nestjs.com/) 11 (TypeScript) |
| Database | PostgreSQL (AWS RDS in cloud) via [TypeORM](https://typeorm.io/) |
| Cache / rate-limit store | Redis ([ioredis](https://github.com/redisson/ioredis), self-hosted) — optional locally |
| Auth | JWT (HS256) + Passport, Google OAuth 2.0, admin password (scrypt) |
| File storage | AWS S3 + CloudFront CDN |
| API docs | Swagger / OpenAPI (`@nestjs/swagger`) |
| Validation | `class-validator` + `class-transformer` (global `ValidationPipe`) |
| Scheduling | `@nestjs/schedule` (cron — meeting/visit reminders) |
| Rate limiting | `@nestjs/throttler` (Redis-backed when configured) |
| Process manager | PM2 (cluster mode on EC2) |
| Tests | Jest |

---

## Architecture

```
      HTTPS  /api/*
   ──────────────────▶  ┌──────────────────────┐
       API clients      │   NestJS API (this)  │
                        │   PM2 cluster · EC2   │
                        └──────────┬───────────┘
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
        ┌──────────┐        ┌───────────┐        ┌───────────┐
        │ Postgres │        │   Redis   │        │   S3 +    │
        │  (RDS)   │        │ (cache +  │        │ CloudFront│
        │          │        │ throttle) │        │  (media)  │
        └──────────┘        └───────────┘        └───────────┘
```

- **Modular monolith.** Each feature is a self-contained NestJS module
  (`controller` + `service` + `entity` + `dto`). Modules import each other
  explicitly via their `@Module({ imports, exports })`.
- **Global prefix** `/api` and a global `ValidationPipe`
  (`whitelist + forbidNonWhitelisted + transform`) — unknown body fields are
  rejected with `400`.
- **Stateless auth.** JWTs carry the user identity; revocation is enforced via a
  Redis-backed `tokenVersion`. No server-side sessions.
- **Redis is optional in local dev** — cache and throttling fall back to
  in-memory when `REDIS_HOST` is not set.

---

## Prerequisites

- **Node.js 24.17.0** and npm (CI runs on Node 24).
- **PostgreSQL 14+** running locally (or a reachable instance).
- **Redis** (optional locally — recommended if you want to exercise caching /
  rate-limit behavior).
- AWS credentials **only** if you need S3 (media upload) features locally; most
  development works without them.

---

## Getting started

```bash
# 1. Clone and install
git clone <repo-url> prajaakeeya-backend
cd prajaakeeya-backend
npm install

# 2. Create your env file (see "Environment variables" below)
cp .env.example .env   # if present; otherwise create .env from the table below
#   At minimum set: DATABASE_URL, JWT_SECRET, NODE_ENV=development

# 3. Create the local database
createdb prajaakeeya          # or use your preferred Postgres tooling

# 4. Load the schema
#    Local dev: let TypeORM build the schema from entities
TYPEORM_SYNCHRONIZE=true npm run start:dev
#    (or run migrations — see "Database & migrations")

# 5. Verify
curl http://localhost:3000/api/health
```

The API listens on **http://localhost:3000** (override with `PORT`).

---

## Environment variables

Configuration is read from `.env` (loaded by `@nestjs/config`). Below are the
variables the app reads. **Never commit real secrets** — `.env` is gitignored.

### Core
| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | yes | `development` \| `production`. Controls SSL, Swagger, CORS set, CSP. |
| `PORT` | no | HTTP port (default `3000`). |
| `CORS_ALLOWED_ORIGINS_DEV` | dev | Comma-separated allowed origins (non-prod). |
| `CORS_ALLOWED_ORIGINS_PROD` | prod | Comma-separated allowed origins (prod). |

### Database (PostgreSQL)
| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | `postgres://user:pass@host:5432/db` connection string. |
| `TYPEORM_SYNCHRONIZE` | no | `true` auto-syncs schema from entities (local dev only — **never in prod**). |
| `DB_POOL_MAX` | no | Max DB pool connections. |
| `RDS_SSL_INSECURE` | prod | `true` = TLS without cert verification (fine inside a VPC). |
| `RDS_CA_PATH` | prod | Path to the AWS RDS CA bundle for verified TLS (default `/opt/rds/global-bundle.pem`). |

> In non-development environments TLS is enforced. Provide **either**
> `RDS_SSL_INSECURE=true` **or** the CA bundle, or the app throws on boot with
> instructions.

### Auth & OAuth
| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | yes | HMAC secret for signing/verifying JWTs. |
| `JWT_EXPIRES_IN` | no | Token lifetime (e.g. `120d`). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | for OAuth | Google OAuth 2.0 app credentials. |
| `GOOGLE_REDIRECT_URI` | for OAuth | Backend callback URL (`/api/auth/google/callback`). |
| `GOOGLE_FRONTEND_REDIRECT_URI` | for OAuth | Where to redirect the browser (with the issued token) after login. |

### AWS — storage (S3 / CloudFront)
| Variable | Description |
|---|---|
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | S3 credentials. |
| `AWS_S3_BUCKET_NAME` | Bucket for uploaded media. |
| `AWS_CLOUDFRONT_DOMAIN` | CDN domain used to build public media URLs (optional). |

### Push notifications (Firebase Cloud Messaging)
| Variable | Description |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service-account **JSON** (minified, single line). Enables web push. |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Alternative: **path to** the service-account JSON file on disk (easier on a server). Use this *or* the inline var. |

> If neither is set, push is disabled — in-app notifications and token registration still work.

### Error tracking (Sentry)
| Variable | Description |
|---|---|
| `SENTRY_DSN` | Sentry project DSN. Enables error/exception reporting. **If unset, Sentry is disabled** (no-op). |
| `SENTRY_TRACES_SAMPLE_RATE` | Fraction of requests sampled for performance tracing (default `0.1`; `0` = errors only). |

### Redis, caching & misc
| Variable | Description |
|---|---|
| `REDIS_HOST`, `REDIS_PORT` | Redis location (omit locally to use in-memory fallback). |
| `CACHE_TTL_MS` | Default cache TTL. |
| `THROTTLE_TTL`, `THROTTLE_LIMIT` | Global rate limit (default 200 req / 60s per IP). |
| `VOTE_THROTTLE_LIMIT` | Tighter limit for vote endpoints. |
| `NODE_APP_INSTANCE` | Set by PM2 cluster; the reminder cron only runs on instance `0`. |

A minimal local `.env`:

```bash
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/prajaakeeya
JWT_SECRET=dev-secret-change-me
JWT_EXPIRES_IN=120d
CORS_ALLOWED_ORIGINS_DEV=http://localhost:5173
```

---

## Running the app

```bash
npm run start:dev     # watch mode (auto-reload) — for development
npm run start         # run once (no watch)
npm run build         # compile TypeScript to dist/
npm run start:prod    # run the compiled build (node dist/main)
```

- Base URL: `http://localhost:3000/api`
- Health check: `GET /api/health` → `{ status, database, uptime, timestamp }`

---

## Database & migrations

- **Entities** are registered per-module via `TypeOrmModule.forFeature([...])`.
- **Local dev:** the quickest path is `TYPEORM_SYNCHRONIZE=true`, which builds
  the schema from entities. Do **not** use this against shared/production data.
- **Migrations** live in [`src/migrations/`](./src/migrations) and are
  timestamp-prefixed (`<epoch>-<name>.ts`). Only timestamp-prefixed files are
  loaded by TypeORM; legacy standalone scripts are intentionally excluded.
- **In production**, migrations run automatically on boot
  (`migrationsRun: true` when `NODE_ENV=production`), against the compiled
  `dist/migrations/[0-9]*.js`.

Creating a migration (manual, since this repo uses a glob loader):

```bash
# 1. Add src/migrations/<timestamp>-<name>.ts implementing MigrationInterface
#    (copy an existing one as a template).
# 2. Build so it lands in dist/migrations/
npm run build
# 3. It runs automatically in production; to apply locally, point a TypeORM
#    DataSource at it or temporarily run with NODE_ENV=production against a
#    local DB.
```

Seed reference geography data (Karnataka):

```bash
npm run seed:karnataka
```

---

## Project structure

```
src/
├── main.ts                  # bootstrap: global prefix /api, ValidationPipe, helmet, CORS, Swagger
├── app.module.ts            # root module: TypeORM, cache, throttler, all feature modules
├── migrations/              # timestamp-prefixed TypeORM migrations
├── seeders/                 # data seeders (e.g. seed-karnataka.ts)
├── common/                  # shared building blocks
│   ├── guards/              # JwtAuthGuard, OptionalJwtAuthGuard, RolesGuard
│   ├── decorators/          # @Public, @Roles, @CurrentUser
│   ├── filters/             # exception filters (e.g. multer)
│   ├── services/            # S3Service, MediaService, ...
│   └── controllers/         # MediaController
└── <feature>/               # one folder per feature module:
    ├── <feature>.module.ts
    ├── <feature>.controller.ts
    ├── <feature>.service.ts
    ├── <feature>.entity.ts
    ├── dto/
    └── <feature>.module.spec.ts   # tests live next to the code
```

Each feature follows the same **controller → service → repository** shape.
Cross-cutting concerns (auth guards, decorators, S3) live in `common/`.

---

## Modules

| Module | Responsibility |
|---|---|
| `auth` | Login (Google OAuth for voters/aspirants, password for admin), JWT issuance, `/auth/me`. |
| `users` | Voter profiles, reporting users, interaction tracking, account deletion. |
| `aspirants` | Aspirant profiles, meetings, visits, bookings, ratings, contact-permission flags. |
| `aspirant-chat` | 1:1 chat messages between voters and an aspirant. |
| `aspirant-discussion` | Ward-level public discussion threads. |
| `aspirant-ward-meetings` | Ward meeting scheduling for aspirants. |
| `votes` | Vote casting, voting windows, ward results. |
| `issues` | Ward issues and category "hand-raises". |
| `wards` | Ward data, ward meetings, search, voter counts. |
| `voter-roll` | Official voter roll (EPIC) lookup + Excel upload. |
| `elections` | Elections and their constituencies. |
| `geography` | States, parliamentary, assembly, municipality reference data. |
| `grama-panchayat` | Gram Panchayat geography (districts/taluks/GPs/villages). |
| `notifications` | In-app notifications (list, unread count, read/delete). |
| `forum` | Ward forum messages. |
| `reminders` | Cron job: meeting/visit reminders (15 min before + at start). |
| `stats` | Constituency-level statistics. |
| `admin` | Admin dashboard + management of users, reports, elections, wards, geography, voting windows. |
| `media` | S3 uploads (profile pictures, documents), presigned URLs. |
| `pdf-upload` | Ward PDF upload pipeline. |
| `extraction` | Voter-data extraction. |
| `verification` | EPIC verification lookups. |

---

## API documentation

- All routes are under the global prefix **`/api`** (e.g. `/api/aspirants`).
- **Swagger UI** is served **in non-production only**, at the path configured in
  [`src/main.ts`](./src/main.ts) (`SwaggerModule.setup(...)`). Open it in your
  browser while the dev server runs to explore and try every endpoint.
- Authenticate in Swagger with **Bearer &lt;JWT&gt;** (the "Authorize" button).

---

## Authentication & authorization

- **Tokens:** JWT signed HS256 with `JWT_SECRET`. The payload carries
  `{ sub, role, wardId, isBlocked, tokenVersion }`.
- **Roles:** `voter`, `aspirant`, `admin`.
- **Login methods:**
  - **Voters & aspirants** via **Google OAuth 2.0** (`/api/auth/google` → callback → redirect to the app with the issued token).
  - **Admin** via email + **password** (scrypt-hashed).
- **Guards** (`src/common/guards/`):
  - `JwtAuthGuard` — requires a valid token (respects the `@Public()` decorator).
  - `OptionalJwtAuthGuard` — decodes a token if present but never blocks; used on
    public routes that personalize for a signed-in caller (e.g. an aspirant
    seeing their own private contact details).
  - `RolesGuard` + `@Roles(...)` — role-based access.
- **Revocation:** a Redis-backed `tokenVersion` is checked on every request;
  blocking/unblocking a user bumps it and invalidates existing tokens.
- **Rate limiting:** global `ThrottlerGuard` (default 200 req/min/IP; stricter on
  auth and vote endpoints).

---

## Testing

Jest unit suite — **no database or server required** (mocked dependencies).
**29 suites · 120 tests**, all passing.

```bash
npm test            # run all tests
npm run test:watch  # watch mode
npm run test:cov    # coverage
```

Two layers: **module-wiring** tests (`*.module.spec.ts` — 22 files / 58 tests)
and **service-behavior / security** tests (`*.service.spec.ts` — 7 files /
62 tests). The suite runs in CI on every PR.

Service-behavior coverage in brief:

- **AspirantsService** (34) — contact privacy (phone/WhatsApp shown only when
  allowed, except the owner); `register` / `updatePermissions` / `withdraw`
  rules; **meeting requests** (`createBooking`) and **visits** (`createVisit`,
  `respondToVisit`, `respondToMeeting` attendance counts); and **ratings** for
  meetings, visits, and **contact** (`rateMeeting` / `rateVisit` are re-ratable;
  `rateContact` is eligibility-gated and one-time).
- **VotesService** (6), **UsersService** (5), **IssuesService** (4) — core
  business rules (voting window, reports/pagination, hand-raise/issues).
- **S3Service** (6), **FirebaseService** (5), **ChatEventsService** (2) —
  infra/integration behavior (key extraction, FCM send, SSE event stream).

See **[TESTING.md](./TESTING.md)** for the full breakdown.

---

## CI/CD & deployment

- **CI** — [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs on
  pull requests and pushes to `main` and `staging`:

  ```
  lint  →  typecheck  →  npm test --runInBand  →  build
  ```

  No external services needed (tests are fully mocked).

- **Deploy** — [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)
  builds and ships to self-hosted EC2 runners on push:
  - push to **`staging`** → staging EC2 (PM2 app `prajaakeeya-api-staging`)
  - push to **`main`** → production EC2 (PM2 app `prajaakeeya-api`)

  Migrations run automatically on production boot.

**Branch model:** develop against `staging`; `main` is production. Open PRs into
`staging`; CI must be green before merge.

---

## Scripts reference

| Script | Purpose |
|---|---|
| `npm run start:dev` | Run with watch/auto-reload. |
| `npm run start` | Run once. |
| `npm run start:prod` | Run the compiled build (`dist/main`). |
| `npm run build` | Compile to `dist/`. |
| `npm test` / `test:watch` / `test:cov` | Run tests / watch / coverage. |
| `npm run lint` | ESLint with `--fix`. |
| `npm run lint:check` | ESLint without fixing (CI). |
| `npm run typecheck` | `tsc --noEmit` type check. |
| `npm run seed:karnataka` | Seed Karnataka reference geography. |

---

## Coding conventions

- **TypeScript**, NestJS module pattern (`controller` → `service` →
  repository). One folder per feature.
- **DTOs + `class-validator`** for every request body; the global pipe rejects
  unknown fields, so keep DTOs accurate.
- **ESLint + Prettier** — run `npm run lint` before committing; CI enforces
  `lint:check` and `typecheck`.
- **Tests next to code** (`*.spec.ts`); keep them DB-free and server-free.
- Prefer explicit module `imports`/`exports` over global singletons.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Database SSL is not configured` on boot | Non-dev env without SSL config. Set `RDS_SSL_INSECURE=true` or provide `RDS_CA_PATH`. For local, ensure `NODE_ENV=development`. |
| `ECONNREFUSED` to Postgres | Postgres not running or wrong `DATABASE_URL`. |
| Schema is empty / tables missing locally | Run with `TYPEORM_SYNCHRONIZE=true` once, or apply migrations. |
| Redis connection errors locally | Omit `REDIS_HOST` — cache & throttling fall back to in-memory. |
| `429 Too Many Requests` while testing by hand | Global throttle (200/min/IP). Raise `THROTTLE_LIMIT` locally if needed. |
| Swagger 404 | Swagger is disabled when `NODE_ENV=production`; use a non-prod env. |

---

Questions or a gap in these docs? Open an issue or improve this README in your PR.
