import "reflect-metadata";
import { JwtStrategy, tokenVersionCacheKey } from "./jwt.strategy";
import { User } from "../../users/user.entity";

/**
 * Locks in the tokenVersion revocation path — both the fast cache path and the
 * DB read-through fallback on a cache miss (#40). Guards against regressions in
 * the comparison operator, the cache-key format, or the fail-closed-on-miss /
 * fail-open-on-DB-error behaviour.
 */
describe("JwtStrategy — tokenVersion revocation", () => {
  const activeUser: Partial<User> = {
    id: 7,
    tokenVersion: 0,
    isBlocked: false,
    isSelfDeleted: false,
  };

  const buildStrategy = (
    store: Record<string, number>,
    dbUser: Partial<User> | null = activeUser,
    dbThrows = false,
  ) => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
    const cache = {
      get: async (key: string) => store[key],
      set: async () => undefined,
    };
    const userRepo = {
      findOne: async () => {
        if (dbThrows) throw new Error("db down");
        return dbUser;
      },
    };
    const mockCls = { isActive: () => false, set: jest.fn(), get: jest.fn() };
    return new JwtStrategy(cache as any, userRepo as any, mockCls as any);
  };

  // ── Fast path (cache hit) ──────────────────────────────────────────────
  it("rejects a JWT older than the cached (revoked) version — cache hit", async () => {
    const strategy = buildStrategy({ [tokenVersionCacheKey(7)]: 5 });
    await expect(
      strategy.validate({ sub: 7, tokenVersion: 4 } as any),
    ).rejects.toThrow("Session has been revoked");
  });

  it("accepts a JWT equal to the cached version — cache hit", async () => {
    const strategy = buildStrategy({ [tokenVersionCacheKey(7)]: 5 });
    const result = await strategy.validate({
      sub: 7,
      tokenVersion: 5,
      role: "voter",
    } as any);
    expect(result).toMatchObject({ id: 7, role: "voter", tokenVersion: 5 });
  });

  it("rejects a blocked user from the payload before any lookup", async () => {
    const strategy = buildStrategy({});
    await expect(
      strategy.validate({ sub: 7, isBlocked: true } as any),
    ).rejects.toThrow("User is blocked");
  });

  // ── Read-through (cache miss → DB) ─────────────────────────────────────
  it("cache miss → DB active user → accepts", async () => {
    const strategy = buildStrategy({}, activeUser);
    const result = await strategy.validate({ sub: 7, tokenVersion: 0 } as any);
    expect(result.id).toBe(7);
  });

  it("cache miss → DB tokenVersion higher than token → rejects", async () => {
    const strategy = buildStrategy({}, { ...activeUser, tokenVersion: 3 });
    await expect(
      strategy.validate({ sub: 7, tokenVersion: 2 } as any),
    ).rejects.toThrow("Session has been revoked");
  });

  it("cache miss → DB user is blocked → rejects", async () => {
    const strategy = buildStrategy({}, { ...activeUser, isBlocked: true });
    await expect(
      strategy.validate({ sub: 7, tokenVersion: 0 } as any),
    ).rejects.toThrow("Session has been revoked");
  });

  it("cache miss → DB user is self-deleted → rejects", async () => {
    const strategy = buildStrategy({}, { ...activeUser, isSelfDeleted: true });
    await expect(
      strategy.validate({ sub: 7, tokenVersion: 0 } as any),
    ).rejects.toThrow("Session has been revoked");
  });

  it("cache miss → user not found in DB → rejects", async () => {
    const strategy = buildStrategy({}, null);
    await expect(
      strategy.validate({ sub: 7, tokenVersion: 0 } as any),
    ).rejects.toThrow("Session has been revoked");
  });

  it("cache miss → DB unreachable → degrades to token claims (accepts)", async () => {
    const strategy = buildStrategy({}, null, /* dbThrows */ true);
    const result = await strategy.validate({ sub: 7, tokenVersion: 0 } as any);
    expect(result.id).toBe(7);
  });
});
