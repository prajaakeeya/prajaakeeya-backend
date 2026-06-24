import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";
import { JwtService } from "@nestjs/jwt";
import type { Request, Response } from "express";
import { tokenVersionCacheKey } from "../../auth/strategies/jwt.strategy";
import { sessionCookieExtractor } from "../../auth/session-cookie";
import { AuthUser } from "../decorators/current-user.decorator";

/** Shape of the verified SSE JWT payload (subset of fields we rely on). */
interface SseJwtPayload {
  sub: number;
  role?: string;
  wardId?: number;
  tokenVersion?: number;
  isBlocked?: boolean;
}

/**
 * Auth guard for Server-Sent Events routes.
 *
 * The browser `EventSource` API cannot set request headers, so the JWT is read
 * from the `token` query param (falling back to a Bearer header for non-browser
 * clients). On success the decoded identity is attached to `req.user`.
 *
 * It also sets `X-Accel-Buffering: no` so SSE bytes stream immediately through
 * buffering proxies (nginx / ALB).
 *
 * Mirrors `JwtStrategy`: signature + expiry are pinned to HS256, and the same
 * `isBlocked` / Redis `tokenVersion` revocation checks run so a blocked or
 * revoked user cannot hold an SSE stream open until the token expires.
 */
@Injectable()
export class SseJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader("X-Accel-Buffering", "no");

    const header: string | undefined = req.headers?.authorization;
    const token: string | undefined =
      // Cookie first — set automatically by the browser, keeps the JWT out of
      // the URL (a `?token=` query leaks into access logs / Referer).
      sessionCookieExtractor(req) ||
      (req.query?.token as string) ||
      (header?.startsWith("Bearer ") ? header.slice(7) : undefined);

    if (!token) throw new UnauthorizedException("Missing token");

    let payload: SseJwtPayload;
    try {
      payload = this.jwtService.verify<SseJwtPayload>(token, {
        secret: process.env.JWT_SECRET,
        algorithms: ["HS256"],
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }

    // Revocation checks, identical to JwtStrategy.validate().
    if (payload.isBlocked) {
      throw new UnauthorizedException("User is blocked");
    }
    const cached = await this.cache.get<number>(
      tokenVersionCacheKey(payload.sub),
    );
    const presented = payload.tokenVersion ?? 0;
    if (cached !== undefined && cached !== null && presented < Number(cached)) {
      throw new UnauthorizedException("Session has been revoked");
    }

    req.user = {
      id: payload.sub,
      role: payload.role,
      wardId: payload.wardId,
    };
    return true;
  }
}
