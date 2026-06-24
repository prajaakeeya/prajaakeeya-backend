import type { CookieOptions, Request, Response } from "express";

/**
 * Name of the HttpOnly cookie that carries the short-lived ACCESS token.
 *
 * The `__Host-` prefix (which the spec recommends) is intentionally NOT used:
 * it mandates `Secure`, which browsers reject over plain http and would break
 * local dev / the http-based e2e suite. `Secure` is still set in production via
 * the cookie options below, giving the same transport guarantee.
 */
export const SESSION_COOKIE_NAME = "session";

/** Name of the HttpOnly cookie that carries the long-lived REFRESH token. */
export const REFRESH_COOKIE_NAME = "refresh_token";

/**
 * Path the refresh cookie is scoped to: the API global prefix (`/api`) + the
 * refresh route. The browser only ever sends the refresh token to this one
 * endpoint, keeping it out of every other request.
 */
export const REFRESH_COOKIE_PATH = "/api/auth/refresh";

/** Access token is short-lived (~15m); the cookie is a session cookie sized to it. */
const SESSION_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * Shared HttpOnly / Secure / SameSite attributes for both auth cookies.
 *
 * - `HttpOnly` — unreadable by page JS, so an XSS cannot exfiltrate the token.
 * - `Secure` — on in production, or whenever `SameSite=None` is requested
 *   (the browser requires Secure for None).
 * - `SameSite` — `Lax` by default (also gives CSRF protection for same-site
 *   frontends); set `COOKIE_SAMESITE=none` only when the frontend and backend
 *   are served from genuinely cross-site origins.
 */
function baseCookieAttrs(): Pick<
  CookieOptions,
  "httpOnly" | "secure" | "sameSite"
> {
  const isProd = process.env.NODE_ENV === "production";
  const sameSite =
    (process.env.COOKIE_SAMESITE ?? "lax").toLowerCase() === "none"
      ? "none"
      : "lax";
  return {
    httpOnly: true,
    secure: isProd || sameSite === "none",
    sameSite,
  };
}

/** Set-Cookie options for the access-token session cookie (path `/`). */
export function sessionCookieOptions(): CookieOptions {
  return { ...baseCookieAttrs(), path: "/", maxAge: SESSION_MAX_AGE_MS };
}

/**
 * Set-Cookie options for the refresh cookie. Scoped to the refresh path and
 * pinned to the refresh token's own expiry so the cookie and JWT die together.
 */
export function refreshCookieOptions(expiresAt?: Date): CookieOptions {
  return {
    ...baseCookieAttrs(),
    path: REFRESH_COOKIE_PATH,
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}

/** Set the access-token session cookie. */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

/** Set the refresh-token cookie (scoped to the refresh route). */
export function setRefreshCookie(
  res: Response,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions(expiresAt));
}

/** Clear the access-token session cookie. Mirrors the attributes it was set with. */
export function clearSessionCookie(res: Response): void {
  const { maxAge: _maxAge, ...opts } = sessionCookieOptions();
  res.clearCookie(SESSION_COOKIE_NAME, opts);
}

/** Clear the refresh cookie. Mirrors the attributes (incl. path) it was set with. */
export function clearRefreshCookie(res: Response): void {
  const { expires: _expires, ...opts } = refreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE_NAME, opts);
}

/**
 * Read a named cookie straight from the raw `Cookie` header, so it works
 * without the cookie-parser middleware (the e2e harness boots without it).
 */
export function readCookie(req: Request, name: string): string | null {
  const header = req?.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/** Passport-JWT extractor that reads the access token from the session cookie. */
export function sessionCookieExtractor(req: Request): string | null {
  return readCookie(req, SESSION_COOKIE_NAME);
}
