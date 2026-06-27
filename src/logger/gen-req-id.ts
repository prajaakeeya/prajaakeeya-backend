import { randomUUID } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";

/**
 * Pino-http request-id generator.
 *
 * Passes through an existing X-Request-Id header when it is a non-empty string
 * of at most 128 chars with no ASCII control characters (prevents log-injection
 * via a crafted header). Falls back to a fresh UUID otherwise.
 *
 * The generated / accepted id is echoed on the response as X-Request-Id so
 * callers can correlate client-side logs with server-side request logs.
 */
export function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const existing = req.headers["x-request-id"];
  const raw = Array.isArray(existing) ? existing[0] : existing;
  const id =
    typeof raw === "string" &&
    raw.length > 0 &&
    raw.length <= 128 &&
    !/[\x00-\x1f]/.test(raw)
      ? raw
      : randomUUID();
  res.setHeader("X-Request-Id", id);
  return id;
}
