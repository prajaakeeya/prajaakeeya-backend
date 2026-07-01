import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ClsService } from "nestjs-cls";
import { sessionCookieExtractor } from "../session-cookie";
import { User } from "../../users/user.entity";

interface JwtPayload {
  sub: number;
  role?: string;
  isBlocked?: boolean;
  wardId?: number;
  tokenVersion?: number;
}

// How long a DB-resolved tokenVersion is cached after a cache miss, to bound DB
// load. revokeAllSessions overwrites this key with a higher version, so a stale
// read-through value can never under-report a revocation.
export const READ_THROUGH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

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
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly cls: ClsService,
  ) {
    super({
      // Accept the token from either the Authorization header (bearer clients:
      // admin panel, native apps) or the HttpOnly session cookie (OAuth web
      // sessions) — both flows authenticate with the same signed JWT.
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        sessionCookieExtractor,
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET,
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
  //
  // On a cache MISS (cold/evicted cache, no Redis, or right after a deploy),
  // the revocation check must not be silently skipped — we resolve the
  // authoritative tokenVersion + isBlocked + isSelfDeleted from the DB, deny if
  // revoked, and re-populate the cache so subsequent requests stay on the fast
  // path. If the DB is unreachable we fall back to the token's own claims
  // rather than fail all auth (a DB blip must not become a total lockout).
  async validate(payload: JwtPayload) {
    if (payload.isBlocked) {
      throw new UnauthorizedException("User is blocked");
    }

    const key = tokenVersionCacheKey(payload.sub);
    const presented = payload.tokenVersion ?? 0;
    let current = await this.cache.get<number>(key);

    if (current === undefined || current === null) {
      try {
        const user = await this.userRepo.findOne({
          where: { id: payload.sub },
          select: {
            id: true,
            tokenVersion: true,
            isBlocked: true,
            isSelfDeleted: true,
          },
        });
        if (!user || user.isBlocked || user.isSelfDeleted) {
          throw new UnauthorizedException("Session has been revoked");
        }
        current = user.tokenVersion ?? 0;
        await this.cache.set(key, current, READ_THROUGH_CACHE_TTL_MS);
      } catch (err) {
        if (err instanceof UnauthorizedException) throw err;
        // DB unreachable — degrade to the signed token's claims (no worse than
        // the pre-read-through behaviour) instead of locking everyone out.
        return {
          id: payload.sub,
          role: payload.role,
          wardId: payload.wardId,
          tokenVersion: presented,
        };
      }
    }

    if (
      current !== undefined &&
      current !== null &&
      presented < Number(current)
    ) {
      throw new UnauthorizedException("Session has been revoked");
    }

    // Set the userId in the CLS context so the AuditSubscriber can access it globally
    if (this.cls.isActive()) {
      this.cls.set("userId", payload.sub);
    }

    return {
      id: payload.sub,
      role: payload.role,
      wardId: payload.wardId,
      tokenVersion: presented,
    };
  }
}
