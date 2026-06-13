# Backend Security Review

A summary of the security posture of the Prajaakeeya backend (NestJS API):
controls in place, a vulnerability-class assessment, current findings, and
remediation status. This is a living document — update it as controls and
findings change.

> **Reporting a vulnerability:** email the maintainers privately (do **not** open
> a public issue for an exploitable finding). Include steps to reproduce and
> impact.

---

## 1. Posture at a glance

| Area | Status |
|---|---|
| Authentication & authorization | ✅ Implemented & test-covered |
| Input validation | ✅ Global `ValidationPipe` (whitelist + reject-unknown) |
| Rate limiting / abuse prevention | ✅ Global + per-endpoint throttles |
| Security headers | ✅ Helmet |
| Transport security (TLS) | ✅ HTTPS (API via nginx/Let's Encrypt, FE via CloudFront) |
| Secrets handling | ✅ Gitignored; no secrets committed |
| Data-access / privacy controls | ✅ Contact-detail privacy + ownership checks |
| SQL injection | ✅ Mitigated (parameterized queries) |
| Dependency CVE scanning | ✅ CI `npm audit` (non-blocking) + Dependabot |
| Dependency advisories outstanding | ⚠️ Open — tracked, remediation automated (§4) |
| Automated DAST / external pentest | ⬜ Recommended follow-up |

---

## 2. Controls implemented

### Authentication & authorization
- **Login:** Google OAuth only → signed **JWT** bearer tokens with expiry.
- **Session revocation:** Redis-backed `tokenVersion` — blocking/deleting a user
  invalidates all their existing tokens; `isBlocked` tokens are rejected at the
  strategy (`src/auth/strategies/jwt.strategy.ts`).
- **Guards:** `JwtAuthGuard` (+ `@Public()` opt-out), `OptionalJwtAuthGuard`,
  `SseJwtAuthGuard` (query-token auth for the EventSource stream).
- **Authorization:** role-based (voter / aspirant / admin) **and** ownership
  checks on mutations — e.g. `updatePermissions` is owner-only; message /
  discussion / meeting deletes require author-or-admin → `ForbiddenException`.

### API security
- **Input validation:** global `ValidationPipe({ whitelist, transform,
  forbidNonWhitelisted })` — strips/rejects unknown fields (anti
  mass-assignment) and validates every DTO (`class-validator`).
- **Rate limiting:** global throttle (200 req/min/IP) + stricter on sensitive
  ops (voting: 5/min). `trust proxy` is set so the real client IP is used.
- **Security headers:** `helmet()` in `src/main.ts` (HSTS, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, etc.; CSP enabled in production, relaxed
  in non-prod so Swagger UI works; `Cross-Origin-Resource-Policy: cross-origin`
  for the cross-origin frontend).
- **CORS:** explicit env-driven origin allowlist (`CORS_ALLOWED_ORIGINS_*`).
- **API docs:** Swagger disabled in production; served at a non-guessable path
  in non-prod.

### Data security
- **Contact-detail privacy:** an aspirant's `phone` / `whatsappNumber` are
  returned only when `allowPhone` / `allowWhatsapp` are enabled — **except the
  owner**, who always sees their own. The value is **omitted entirely** (not
  blanked). Verified by dedicated data-privacy tests across anonymous /
  other-user / owner viewers.
- **Transport:** TLS everywhere (API over HTTPS; frontend over CloudFront).
- **Secrets:** `.env` is gitignored; `.env.example` holds dummy values only; the
  Firebase service-account JSON is not committed.

### Infrastructure & monitoring
- **Error/event monitoring:** Sentry (`src/instrument.ts`).
- **CI/CD gate:** deploys are blocked unless lint → typecheck → unit → e2e →
  build all pass (`deploy.yml` `validate` job; both deploy jobs `needs:` it).
- **Dependency scanning:** `npm audit` runs on every PR (non-blocking) and
  **Dependabot** opens weekly remediation PRs.

---

## 3. Vulnerability-class assessment

| Class | Status | How it's addressed |
|---|---|---|
| **SQL Injection** | ✅ Mitigated | All DB access via TypeORM parameterized queries / bound query-builder params; no string-concatenated SQL. |
| **NoSQL Injection** | N/A | PostgreSQL (relational) only; no NoSQL store. |
| **XSS** | ✅ Low risk | API returns JSON only — no server-rendered HTML; `X-Content-Type-Options: nosniff` set. Output encoding is the frontend's responsibility. |
| **CSRF** | N/A | Stateless **bearer-token** auth (JWT in `Authorization` header), no cookie sessions → CSRF does not apply; CORS is also restricted. |
| **Broken Access Control / IDOR** | ✅ Mitigated | Ownership + role guards on every mutation; object-level checks (e.g. delete only own resource or admin). Covered by unit tests asserting `ForbiddenException`. |
| **Authentication Bypass** | ✅ Mitigated | `JwtAuthGuard` on protected routes + `tokenVersion` revocation + `isBlocked`. E2E tests assert `401` for unauthenticated requests. |
| **Security Misconfiguration** | ✅ Addressed | Helmet headers, CORS allowlist, Swagger off in prod, validation pipe, secrets not committed. |
| **Sensitive Data Exposure** | ✅ Addressed | Contact-detail privacy filtering, secrets hygiene, TLS in transit. |
| **Vulnerable Dependencies** | ⚠️ Open | See §4 — scanned + automated remediation, advisories outstanding. |

---

## 4. Findings

### F-1 — Outstanding dependency advisories ⚠️ (open)
`npm audit` reports **47** advisories total (4 low, 27 moderate, 15 high, 1
critical); **32** are in the production dependency tree (1 low, 20 moderate, 10
high, 1 critical). Notable: `lodash` prototype-pollution, `jsdiff` DoS, `tmp`
symlink write, `webpack` build-time SSRF (dev/build only).

- **Nature:** predominantly **transitive** (pulled in by framework/build tooling),
  not packages imported directly by application code. Several (webpack, tmp) are
  **build-time / dev** only and never ship to the running server.
- **Real-world risk in context:** mostly low — they require call paths the app
  doesn't expose — but they should be tracked and cleared.
- **Severity:** High / Critical present → must be reviewed and remediated.
- **Remediation status:** **In progress (automated).**
  - CI `npm audit` (non-blocking) keeps them visible on every PR.
  - **Dependabot** opens weekly PRs to bump them.
  - **Action item:** prioritize the 1 critical + 10 high production advisories;
    review `npm audit fix` (non-`--force`) for safe semver bumps; validate via
    the existing test gate before merge.

_No exploitable application-level vulnerabilities were identified in the controls
review (§3). The primary open item is dependency hygiene (F-1)._

---

## 5. Automated security tests

Security-relevant behavior is locked in by the test suite (runs in CI, gates
deploys):

- **Access control** — unit tests assert `ForbiddenException` for non-owners
  (aspirants, discussions, ward-meetings, chat).
- **Authentication** — HTTP e2e asserts `401` on guarded endpoints without a
  token (the **real** `JwtAuthGuard` runs).
- **Input validation** — e2e asserts `400` for missing / unknown / out-of-range
  fields (the **real** `ValidationPipe` runs).
- **Data privacy** — unit tests verify phone/WhatsApp are omitted unless allowed,
  except for the owner.

---

## 6. Recommendations (future improvements)

1. **Clear the dependency advisories** (F-1) via Dependabot PRs — prioritize
   critical + high.
2. **Add an automated DAST pass** (e.g. OWASP ZAP baseline scan) and/or a
   periodic manual pentest, with a tracked findings log.
3. **Secret scanning** in CI (e.g. gitleaks) as a defence-in-depth layer.
4. **Auth-failure logging / alerting** to Sentry (repeated failed auth, blocked
   users) for security-event monitoring.
5. **Account lockout / progressive backoff** on repeated failed auth, if abuse
   is observed.
6. Periodically review CORS origins, rate-limit thresholds, and the upload size
   limit as the app evolves.
