import type { CookieOptions, Request, Response } from "express";

/**
 * Name of the HttpOnly session cookie that carries the signed JWT.
 *
 * The `__Host-` prefix (which the spec recommends) is intentionally NOT used:
 * it mandates `Secure`, which browsers reject over plain http and would break
 * local dev / the http-based e2e suite. `Secure` is still set in production via
 * {@link sessionCookieOptions}, giving the same transport guarantee.
 */
export const SESSION_COOKIE_NAME = "session";

/** JWTs default to a 24h lifetime (see AuthModule); match the cookie to it. */
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Build the Set-Cookie options for the session cookie.
 *
 * - `HttpOnly` — unreadable by page JS, so an XSS cannot exfiltrate the token.
 * - `Secure` — on in production, or whenever `SameSite=None` is requested
 *   (the browser requires Secure for None).
 * - `SameSite` — `Lax` by default; set `COOKIE_SAMESITE=none` only when the
 *   frontend and backend are served from genuinely cross-site origins.
 * - `Path=/` — sent to every API route.
 */
export function sessionCookieOptions(): CookieOptions {
  const isProd = process.env.NODE_ENV === "production";
  const sameSite =
    (process.env.COOKIE_SAMESITE ?? "lax").toLowerCase() === "none"
      ? "none"
      : "lax";
  return {
    httpOnly: true,
    secure: isProd || sameSite === "none",
    sameSite,
    path: "/",
    maxAge: SESSION_MAX_AGE_MS,
  };
}

/** Set the session cookie carrying the signed JWT. */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

/** Clear the session cookie. Mirrors the attributes used when it was set. */
export function clearSessionCookie(res: Response): void {
  const { maxAge: _maxAge, ...opts } = sessionCookieOptions();
  res.clearCookie(SESSION_COOKIE_NAME, opts);
}

/**
 * Passport-JWT extractor that reads the token from the session cookie.
 *
 * Parses the raw `Cookie` header directly so it works without the
 * cookie-parser middleware (the e2e harness boots without it).
 */
export function sessionCookieExtractor(req: Request): string | null {
  const header = req?.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}
