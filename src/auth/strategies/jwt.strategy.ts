import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

interface JwtPayload {
  sub: number;
  role?: string;
  isBlocked?: boolean;
  wardId?: number;
  tokenVersion?: number;
}

/**
 * Build the Redis/in-memory cache key that holds the *current* tokenVersion
 * for a given user. The cache is written when a user is blocked / unblocked /
 * deleted (or any other "revoke all sessions" event), and read by this
 * strategy on every authenticated request.
 *
 * Exported so other services can write to the same key.
 */
export const tokenVersionCacheKey = (userId: number) =>
  `user:${userId}:tokenVersion`;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      // Fail loudly at startup rather than silently accepting tokens signed
      // with an empty/undefined secret, which would be a critical security hole.
      throw new Error(
        "JWT_SECRET environment variable is not set. Cannot initialise JWT strategy.",
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      // Pin the accepted signature algorithm — without this, passport-jwt
      // accepts any algorithm the token claims, enabling algorithm-confusion.
      algorithms: ["HS256"],
    });
  }

  // Returns the user identity straight from the JWT — avoids a DB lookup on
  // every authenticated request. Revocation is enforced via a Redis-backed
  // tokenVersion: when a user is blocked or otherwise has their sessions
  // revoked, the new tokenVersion is written to the cache; this strategy
  // rejects any JWT whose tokenVersion is older than the cached value.
  async validate(payload: JwtPayload) {
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

    return {
      id: payload.sub,
      role: payload.role,
      wardId: payload.wardId,
      tokenVersion: presented,
    };
  }
}
