# AGENTS.md

Guidance for AI coding agents (Claude Code, Cursor, Copilot, etc.) working in
this repository. Humans should read **[README.md](./README.md)**,
**[CONTRIBUTING.md](./CONTRIBUTING.md)**, and **[TESTING.md](./TESTING.md)** —
this file is the condensed, machine-oriented brief.

---

## Project in one line

Prajaakeeya backend — a **NestJS (TypeScript) REST API** for a civic-engagement
platform, backed by **PostgreSQL** (TypeORM) and **Redis**, with media on
**S3/CloudFront**. Modular monolith; one module per feature under `src/`.

---

## Setup & common commands

```bash
npm install            # install deps (Node 20)
npm run start:dev      # run with watch/auto-reload (dev)
npm run build          # compile to dist/
npm run start:prod     # run compiled build

npm run lint           # ESLint with --fix
npm run lint:check     # ESLint (no fix) — CI gate
npm run typecheck      # tsc --noEmit — CI gate
npm test               # full Jest suite — CI gate
npm run test:cov       # tests + coverage
```

Run before declaring work done (mirrors CI):

```bash
npm run lint:check && npm run typecheck && npm test && npm run build
```

The API serves under the global prefix **`/api`** on port `3000`. Health:
`GET /api/health`.

---

## Repository layout

```
src/
├── main.ts            # bootstrap: /api prefix, global ValidationPipe, helmet, CORS, Swagger
├── app.module.ts      # root: TypeORM, cache, throttler, all feature modules
├── migrations/        # timestamp-prefixed TypeORM migrations (<epoch>-<name>.ts)
├── seeders/           # data seeders
├── common/            # shared guards / decorators / filters / services (S3, Media)
└── <feature>/         # controller + service + entity + dto + *.spec.ts
```

Each feature follows **controller → service → repository**. Cross-cutting code
(auth guards, decorators, S3/media) lives in `src/common/`.

---

## Conventions you MUST follow

- **TypeScript + NestJS module pattern.** New feature → its own module folder
  with `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`, and a spec.
- **DTOs + `class-validator` for every request body.** The global
  `ValidationPipe` uses `whitelist + forbidNonWhitelisted + transform`, so
  **unknown body fields are rejected (400)** — keep DTOs complete and accurate.
- **Tests live next to code** as `*.spec.ts` and must be **DB-free and
  server-free** (mock repositories/dependencies). Jest auto-discovers any
  `*.spec.ts` under `src/`. See `src/votes/votes.service.spec.ts` for the
  service-test pattern, `src/wards/wards.module.spec.ts` for module wiring.
- **Auth/access control via existing guards:** `JwtAuthGuard`,
  `OptionalJwtAuthGuard` (decode-if-present, never blocks — for public routes
  that personalize), and `RolesGuard` + `@Roles(...)`. Roles are
  `voter | aspirant | admin`.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`,
  `docs:`, `chore:`). Branch off **`staging`** and open PRs into `staging`;
  `main` is production.
- **Migrations:** schema changes need a timestamp-prefixed file in
  `src/migrations/`. They auto-run on production boot; locally use
  the migration workflow against a local DB.

---

## Guardrails — do NOT do these without explicit approval

- **Do not change user-facing or API behavior incidentally.** If a task changes
  an endpoint's contract, response shape, validation, or limits, call it out and
  confirm first. (Example: do **not** change upload size limits.)
- **Do not commit secrets.** `.env` is gitignored. Never hard-code or print real
  credentials, tokens, or keys in code, tests, or commit messages.
- **Do not introduce SES (email) or OTP/SMS (MessageCentral) functionality.**
  That code is **stale/backup and unused in production**. Do not build on it,
  document it as active, or reference it in new features.
- **Auth is Google OAuth (voters & aspirants) + admin password only.** There is
  **no EPIC-ID login and no OTP login** in use. Do not add or assume them.
- **Do not weaken security checks to make a test pass.** If a test reveals a real
  access-control/privacy gap, surface it — don't paper over it.
- **Do not commit or push unless explicitly asked.** Make changes and run checks;
  let the human decide when to commit.

---

## Domain rules worth knowing

- **Aspirant contact privacy:** an aspirant's `phone` is only returned when
  `allowPhone` is true, and `whatsappNumber` only when `allowWhatsapp` is true —
  **except the owner**, who always sees their own (`findOne` checks
  `currentUser.id === aspirant.userId` via `OptionalJwtAuthGuard`). The `allow*`
  flags themselves stay in responses; only the values are withheld. Preserve
  this behavior (it's covered by `aspirants.service.spec.ts`).
- **Voting:** `castVote` requires an active voting window, one vote per user per
  window, an existing non-withdrawn aspirant, and a prior interaction.
- **Reminders:** a per-minute cron (`reminders` module) sends meeting/visit
  reminders. Under PM2 cluster it must run on **`NODE_APP_INSTANCE === "0"`**
  only — keep that guard if you touch it.

---

## Gotchas

- **Rate limiting:** global throttle is **200 req/min/IP** (stricter on auth &
  vote routes). Manual API hammering can return `429`.
- **Redis is optional locally** — cache & throttling fall back to in-memory when
  `REDIS_HOST` is unset.
- **DB SSL:** required in non-`development` envs. Locally use
  `NODE_ENV=development`. In cloud, set `RDS_SSL_INSECURE=true` or `RDS_CA_PATH`.
- **Swagger** is served only when `NODE_ENV !== production` (path configured in
  `src/main.ts`).
- New environment variables must be documented in
  [README → Environment variables](./README.md#environment-variables).

---

## Definition of done (for any code change)

1. `npm run lint:check` — clean
2. `npm run typecheck` — clean
3. `npm test` — green, with tests added for new/changed behavior
4. `npm run build` — succeeds
5. No secrets added; no incidental behavior/API change; new env vars documented
6. Schema change? migration added under `src/migrations/`
