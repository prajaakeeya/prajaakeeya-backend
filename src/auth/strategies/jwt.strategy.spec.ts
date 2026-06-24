import "reflect-metadata";
import { JwtStrategy, tokenVersionCacheKey } from "./jwt.strategy";

/**
 * Locks in the tokenVersion revocation path that the controller-level e2e
 * cannot exercise (its CACHE_MANAGER mock always returns undefined, so the
 * strict-less-than rejection branch never fires). Guards against a regression
 * in the comparison operator or the cache-key format silently disabling
 * "logout / block everywhere".
 */
describe("JwtStrategy — tokenVersion revocation", () => {
  const buildStrategy = (store: Record<string, number>) => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
    const cache = {
      get: async (key: string) => store[key],
      set: async () => undefined,
    };
    return new JwtStrategy(cache as any);
  };

  it("rejects a JWT whose tokenVersion is older than the cached (revoked) version", async () => {
    const strategy = buildStrategy({ [tokenVersionCacheKey(7)]: 5 });
    await expect(
      strategy.validate({ sub: 7, tokenVersion: 4 } as any),
    ).rejects.toThrow("Session has been revoked");
  });

  it("accepts a JWT whose tokenVersion equals the cached version", async () => {
    const strategy = buildStrategy({ [tokenVersionCacheKey(7)]: 5 });
    const result = await strategy.validate({
      sub: 7,
      tokenVersion: 5,
      role: "voter",
    } as any);
    expect(result).toMatchObject({ id: 7, role: "voter", tokenVersion: 5 });
  });

  it("accepts on cache miss (no revocation marker = not revoked)", async () => {
    const strategy = buildStrategy({});
    const result = await strategy.validate({ sub: 7, tokenVersion: 0 } as any);
    expect(result.id).toBe(7);
  });

  it("rejects a blocked user before touching the cache", async () => {
    const strategy = buildStrategy({});
    await expect(
      strategy.validate({ sub: 7, isBlocked: true } as any),
    ).rejects.toThrow("User is blocked");
  });
});
