# Prajaakeeya — Backend API

> **Civic tech for Karnataka's democracy.** Voters discover election candidates in their constituency, interact with them directly, raise local issues, and cast votes. Candidates manage their profiles, schedule ward meetings, and engage their constituency. Built for scale — from a ward of 2,000 voters to a Lok Sabha constituency of 2 million.

[![CI](https://github.com/prajaakeeya/prajaakeeya-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/prajaakeeya/prajaakeeya-backend/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/prajaakeeya/prajaakeeya-backend/graph/badge.svg)](https://codecov.io/gh/prajaakeeya/prajaakeeya-backend)

[![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)](https://redis.io/)

[![AWS EC2](https://img.shields.io/badge/Compute-EC2%20%2B%20PM2-FF9900?logo=amazonaws&logoColor=white)](https://aws.amazon.com/ec2/)
[![AWS RDS](https://img.shields.io/badge/Database-RDS%20PostgreSQL-527FFF?logo=amazonaws&logoColor=white)](https://aws.amazon.com/rds/)
[![AWS S3](https://img.shields.io/badge/Media-S3%20%2B%20CloudFront-569A31?logo=amazons3&logoColor=white)](https://aws.amazon.com/s3/)
[![Firebase](https://img.shields.io/badge/Push-Firebase%20FCM-FFCA28?logo=firebase&logoColor=black)](https://firebase.google.com/)

---

## What Is This?

Prajaakeeya is a civic platform built by volunteers to close the gap between voters and elected representatives in Karnataka. In most Indian elections, voters receive zero direct communication from candidates before or after election day. Prajaakeeya changes that.

This repository is the **REST API** — a NestJS modular monolith that powers the web app, the PWA mobile apps, and the admin dashboard.

**What voters can do:**
- Discover all candidates registered in their ward, municipal, Gram Panchayat, Assembly, or Lok Sabha constituency
- Chat directly with a candidate, attend their ward meetings, or request a personal visit
- Rate candidates on their quality of engagement (chat, meetings, visits, phone calls)
- Raise civic issues tied to their ward and see which candidates respond
- Cast a vote — but only after at least one verified interaction with a candidate

**What candidates (aspirants) can do:**
- Register a profile with manifesto, constituency, and contact preferences
- Schedule ward meetings and home visits; respond to individual meeting requests
- Receive votes and see their constituency-level standing
- Manage document uploads (SOP agreement, identity verification)

**What makes the vote meaningful:**
The vote is **interaction-gated** — a voter cannot cast a ballot until they have genuinely engaged with a candidate (chat, meeting, visit, or call). This eliminates passive name-recognition voting and forces candidates to be accessible.

---

## How It Works

```
Voter opens the app
  └─ Browses candidates in their ward / constituency
      └─ Chats with, meets, or visits a candidate
          └─ Interaction verified → vote unlocked
              └─ Votes cast inside an active election window
                  └─ Ward results visible in real time
```

Election windows are time-bounded — an admin opens a window tied to a specific election. Votes are **per-window per-user**, enforced with a database-level unique constraint to close concurrent-request races.

---

## Architecture

```mermaid
graph TB
    classDef userNode    fill:#4A90E2,stroke:#2563EB,stroke-width:2px,color:#fff
    classDef feNode      fill:#7C3AED,stroke:#5B21B6,stroke-width:2px,color:#fff
    classDef apiNode     fill:#E0234E,stroke:#B91C3E,stroke-width:2px,color:#fff
    classDef dbNode      fill:#336791,stroke:#1E4D6B,stroke-width:2px,color:#fff
    classDef cacheNode   fill:#DC382D,stroke:#B22222,stroke-width:2px,color:#fff
    classDef mediaNode   fill:#569A31,stroke:#3D7A20,stroke-width:2px,color:#fff
    classDef pushNode    fill:#F59E0B,stroke:#D97706,stroke-width:2px,color:#fff

    voter["👤 Voter\n(Web + PWA)"]:::userNode
    aspirant["🏛️ Aspirant\n(Web + PWA)"]:::userNode
    admin["🔑 Admin\n(Web)"]:::userNode

    fe["React + Vite\nAmplify CDN"]:::feNode

    subgraph api["NestJS API  ·  PM2 Cluster  ·  EC2"]
        direction LR
        auth["auth\nGoogle OAuth · scrypt"]:::apiNode
        votes["votes\nwindow · cast · results"]:::apiNode
        aspirantsM["aspirants\nprofile · meetings · visits"]:::apiNode
        chat["chat + SSE\nReal-time events"]:::apiNode
        issues["issues\nwards · hand-raises"]:::apiNode
        notif["notifications\nFCM push"]:::apiNode
    end

    db[("PostgreSQL\nRDS\nvoter data · votes\nprofiles · elections")]:::dbNode
    redis[("Redis\nRate-limit · Cache\nPub/Sub SSE fan-out")]:::cacheNode
    s3[("S3 + CloudFront\nMedia · Documents\nPDFs")]:::mediaNode
    firebase[("Firebase FCM\nPush notifications")]:::pushNode

    voter & aspirant & admin --> fe
    fe -- "HTTPS /api/*" --> api
    auth & votes & aspirantsM & chat & issues --> db
    chat & auth & votes --> redis
    aspirantsM --> s3
    notif --> firebase
```

**Key design decisions:**

| Decision | Rationale |
|---|---|
| Modular monolith | Each feature is a self-contained NestJS module. No microservices until scale requires it. |
| Interaction-gated votes | Prevents name-recognition voting; enforces genuine candidate–voter engagement. |
| Redis pub/sub for SSE | Multiple PM2 workers share one fan-out channel — no dropped chat events between cluster nodes. |
| JWT access (15m) + rotating refresh (7d) | Short-lived access tokens; refresh rotation means a stolen token can't be reused after one rotation cycle. |
| DB-level vote uniqueness | `UNIQUE(userId, votingWindowId)` constraint closes check-then-insert races under concurrent election traffic. |

---

## Election Coverage

The platform models Karnataka's full electoral hierarchy:

```
India
└── Lok Sabha constituency  (543 nationwide)
    └── Vidhan Sabha / State Assembly  (224 in Karnataka)
        ├── Municipal Corporation  (e.g. Greater Bengaluru Authority)
        │   └── Ward
        └── Gram Panchayat
            └── Village
```

A voter can hold constituency IDs at multiple levels simultaneously — common in Karnataka where a single voter is part of a ward, a GP, an Assembly segment, and a Lok Sabha constituency at once.

---

## Getting Started

### Option A — Docker (fastest)

```bash
git clone https://github.com/prajaakeeya/prajaakeeya-backend
cd prajaakeeya-backend
cp .env.example .env   # fill in DATABASE_URL + JWT_SECRET at minimum
docker compose up --build
```

The API starts at **http://localhost:3000/api**. Postgres 16 and Redis 7 start automatically; the API waits for a healthy DB before accepting connections.

### Option B — Local Node.js

**Prerequisites:** Node.js 22, PostgreSQL 14+, Redis (optional — cache and rate-limiting fall back to in-memory).

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL + JWT_SECRET
createdb prajaakeeya
TYPEORM_SYNCHRONIZE=true npm run start:dev   # builds schema on first run
```

Verify: `curl http://localhost:3000/api/health`

---

## Environment Variables

### Core
| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | yes | `development` \| `production` — controls SSL, Swagger, CORS, CSP |
| `PORT` | no | HTTP port (default `3000`) |
| `DATABASE_URL` | yes | `postgres://user:pass@host:5432/db` |
| `JWT_SECRET` | yes | HMAC signing secret (min 32 chars) |
| `REDIS_HOST` / `REDIS_PORT` | no | Redis location — omit for in-memory fallback |

### Auth & OAuth
| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 credentials (voter / aspirant login) |
| `GOOGLE_REDIRECT_URI` | Backend callback URL — `/api/auth/google/callback` |
| `GOOGLE_FRONTEND_REDIRECT_URI` | Where the browser is sent after login |
| `JWT_ACCESS_EXPIRES_IN` | Access token TTL (default `15m`) |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token TTL (default `7d`) |

### AWS — Storage
| Variable | Description |
|---|---|
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | S3 credentials |
| `AWS_S3_BUCKET_NAME` | Media upload bucket |
| `AWS_CLOUDFRONT_DOMAIN` | CDN domain for public media URLs |

### Push & Observability
| Variable | Description |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service-account JSON (single line) for FCM push |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Alternative: path to the JSON file on disk |
| `SENTRY_DSN` | Sentry project DSN — leave unset to disable |

### Rate Limiting & SSL
| Variable | Default | Description |
|---|---|---|
| `THROTTLE_TTL` / `THROTTLE_LIMIT` | 60000ms / 200 | Global rate limit per IP |
| `VOTE_THROTTLE_LIMIT` | 5 | Per-minute limit on the vote endpoint |
| `TYPEORM_SYNCHRONIZE` | false | Auto-sync schema from entities — **dev only, never in prod** |
| `RDS_SSL_INSECURE` | — | `true` = encrypted but unverified TLS (fine inside a private VPC) |
| `RDS_CA_PATH` | `/opt/rds/global-bundle.pem` | Path to AWS RDS CA bundle for verified TLS |

**Minimal `.env` for local development:**

```bash
NODE_ENV=development
DATABASE_URL=postgres://postgres:postgres@localhost:5432/prajaakeeya
JWT_SECRET=dev-secret-replace-in-production-min-32-chars
```

---

## Modules

| Module | What it owns |
|---|---|
| `auth` | Google OAuth login, admin password login (scrypt), JWT issuance, refresh token rotation, session revocation |
| `users` | Voter profiles, reports, interaction tracking, account deletion |
| `aspirants` | Candidate profiles, meetings, visits, bookings, activity ratings, contact-permission flags |
| `aspirant-chat` | 1:1 chat between voter and candidate; SSE real-time event stream |
| `aspirant-discussion` | Ward-level public discussion threads |
| `aspirant-ward-meetings` | Ward meeting scheduling and attendance for aspirants |
| `votes` | Vote casting, election windows (open/close), ward results |
| `issues` | Civic issue creation, ward hand-raises, issue resolution tracking |
| `wards` | Ward data, ward meetings, voter counts by ward |
| `elections` | Elections and their constituency bindings |
| `geography` | States, Lok Sabha, Vidhan Sabha, municipality reference data |
| `grama-panchayat` | District / taluk / GP / village hierarchy |
| `notifications` | In-app notifications — list, unread count, mark read/delete |
| `reminders` | Cron: meeting + visit reminders at 15 min before and at start time |
| `stats` | Constituency-level aggregate statistics |
| `admin` | Dashboard, user management, reports, election/ward/geography CRUD, voting window control |
| `media` | S3 upload pipeline, presigned URL generation, file-type enforcement |
| `audit` | Immutable audit event log — votes cast, admin actions, aspirant registration, voting window open |

---

## Authentication & Authorization

- **Voters and aspirants** log in via **Google OAuth 2.0** (`/api/auth/google` → callback → access token + rotating refresh token in httpOnly cookie).
- **Admins** log in with email + **scrypt-hashed password** (`/api/auth/admin/login`). Login is checked against [HaveIBeenPwned](https://haveibeenpwned.com/Passwords) using k-Anonymity — a warning is returned if the password appears in known breach data.
- **Access tokens** (HS256, 15 min) carry `{ sub, role, wardId, tokenVersion }`.
- **Refresh tokens** rotate on every use. A reused or forged refresh token triggers reuse-detection and revokes the entire session.
- **Revocation** is enforced per-request via a Redis-cached `tokenVersion` — blocking a user invalidates tokens within one cache TTL cycle.
- **Guards**: `JwtAuthGuard`, `OptionalJwtAuthGuard` (public routes that personalize for signed-in callers), `RolesGuard + @Roles(...)`.

---

## Database & Migrations

Migrations live in [`src/migrations/`](./src/migrations/) — timestamp-prefixed. Only timestamp-prefixed files are loaded by TypeORM; legacy standalone scripts in that directory are intentionally excluded.

```bash
# Seed Karnataka electoral geography (Lok Sabha, Assembly, GP, Village reference data)
npm run seed:karnataka

# Production: migrations run automatically before the app accepts traffic
# Local dev: use TYPEORM_SYNCHRONIZE=true on first run, then switch to migrations
```

---

## Testing

**262 tests · 34 suites · no external dependencies** (all dependencies mocked — no DB, no server required).

```bash
npm test              # run all 262 tests
npm run test:watch    # watch mode
npm run test:cov      # coverage report
```

| Suite | Tests | Business rules guarded |
|---|---|---|
| AspirantsService | 34 | Contact privacy, booking/visit gates, rating rules (one-time contact rating, re-ratable meeting/visit) |
| VotesService | 6 | Window enforcement, uniqueness, aspirant active-status check, interaction gate |
| UsersService | 5 | Report pagination, account lifecycle |
| IssuesService | 4 | Hand-raise eligibility, issue lifecycle |
| S3Service | 6 | Key extraction, presign expiry behavior |
| FirebaseService | 5 | FCM send, token registration |

---

## CI/CD

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs on every PR and push to `main` / `staging`:

```
lint  →  typecheck  →  test (262)  →  build
```

[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml):

| Push to | Target | PM2 app |
|---|---|---|
| `staging` | Staging EC2 | `prajaakeeya-api-staging` |
| `main` | Production EC2 | `prajaakeeya-api` |

**Branch model:** `staging` is the integration branch. `main` is production. All contributor PRs target `staging`.

---

## Scripts

| Script | Purpose |
|---|---|
| `npm run start:dev` | Watch mode — auto-reloads on file changes |
| `npm run start:prod` | Run the compiled build (`node dist/main`) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm test` | Run all tests |
| `npm run typecheck` | `tsc --noEmit` — zero-overhead type check |
| `npm run lint` | ESLint with `--fix` |
| `npm run seed:karnataka` | Seed Karnataka electoral geography |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Database SSL is not configured` on boot | Set `RDS_SSL_INSECURE=true` or provide `RDS_CA_PATH`. For local dev: ensure `NODE_ENV=development`. |
| `ECONNREFUSED` to Postgres | Postgres not running or wrong `DATABASE_URL`. |
| Tables missing locally | Run with `TYPEORM_SYNCHRONIZE=true` once to build the schema from entities. |
| Redis connection errors locally | Omit `REDIS_HOST` — throttling and cache fall back to in-memory. |
| `429 Too Many Requests` while testing | Global throttle is 200 req/min/IP. Raise `THROTTLE_LIMIT` locally. |
| Swagger 404 | Swagger is disabled in production. Run with `NODE_ENV=development`. |

---

> **Frontend:** [prajaakeeya-frontend](https://github.com/prajaakeeya/prajaakeeya-frontend) — React + Vite SPA / PWA
> **Test detail:** [TESTING.md](./TESTING.md)
