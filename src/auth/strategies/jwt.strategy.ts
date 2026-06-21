import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "../../users/user.entity";

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

// How long a DB-resolved tokenVersion is cached after a cache miss, to bound DB
// load. revokeAllSessions overwrites this key with a higher version, so a stale
// read-through value can never under-report a revocation.
const READ_THROUGH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET,
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

    const presented = payload.tokenVersion ?? 0;
    const key = tokenVersionCacheKey(payload.sub);
    let current = await this.cache.get<number>(key);

    // Cache miss: the cache is the fast path, but a cold/evicted cache must not
    // silently disable revocation. Resolve the authoritative state from the DB
    // and populate the cache for subsequent requests.
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
        // DB unreachable: don't turn a transient DB outage into a total auth
        // failure. The JWT signature + expiry are already verified, so fall
        // back to the token's own claims (no worse than before this check).
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

    return {
      id: payload.sub,
      role: payload.role,
      wardId: payload.wardId,
      tokenVersion: presented,
    };
  }
}
