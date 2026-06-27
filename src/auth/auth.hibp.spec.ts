import "reflect-metadata";
import * as cryptoModule from "crypto";
import { promisify } from "util";
import { AuthService } from "./auth.service";

// Minimal AuthService constructed with noop stubs — checkPwnedPassword only
// uses global fetch + Node crypto, so no real deps are needed.
function buildService(deps: Record<string, any> = {}): any {
  const noop: any = {};
  process.env.JWT_SECRET = "test-secret-minimum-32-chars-here!!";
  return new AuthService(
    deps.usersService ?? noop,
    deps.jwtService ?? noop,
    deps.wardsService ?? noop,
    deps.aspirantsService ?? noop,
    deps.votesService ?? noop,
    deps.s3Service ?? noop,
    deps.electionsService ?? noop,
    deps.parliamentaryService ?? noop,
    deps.assemblyService ?? noop,
    deps.gramaPanchayatService ?? noop,
    deps.configService ?? {
      get: (key: string) =>
        key === "JWT_SECRET" ? "test-secret-minimum-32-chars-here!!" : undefined,
    },
    deps.cache ?? noop,
  );
}

function sha1Upper(text: string): string {
  return cryptoModule.createHash("sha1").update(text).digest("hex").toUpperCase();
}

// ──────────────────────────────────────────────────────────────────────────────
// checkPwnedPassword
// ──────────────────────────────────────────────────────────────────────────────

describe("AuthService — checkPwnedPassword()", () => {
  let service: any;

  beforeEach(() => {
    service = buildService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns 0 when the suffix is absent from the HIBP range response", async () => {
    jest.spyOn(global, "fetch" as any).mockResolvedValueOnce({
      ok: true,
      text: async () => "AAAAA:10\r\nBBBBB:5\r\n",
    });

    expect(await service.checkPwnedPassword("definitely-not-pwned-xyz")).toBe(0);
  });

  it("returns the breach count when the SHA-1 suffix matches a line", async () => {
    const hash = sha1Upper("password123");
    const suffix = hash.slice(5);

    jest.spyOn(global, "fetch" as any).mockResolvedValueOnce({
      ok: true,
      text: async () => `AAAAA:1\r\n${suffix}:99000\r\nZZZZZ:3\r\n`,
    });

    expect(await service.checkPwnedPassword("password123")).toBe(99000);
  });

  it("returns 1 when the suffix matches but the count field is empty", async () => {
    const hash = sha1Upper("edge-case");
    const suffix = hash.slice(5);

    jest.spyOn(global, "fetch" as any).mockResolvedValueOnce({
      ok: true,
      text: async () => `${suffix}:\r\n`,
    });

    expect(await service.checkPwnedPassword("edge-case")).toBe(1);
  });

  it("returns 0 when HIBP returns a non-2xx response", async () => {
    jest.spyOn(global, "fetch" as any).mockResolvedValueOnce({ ok: false });

    expect(await service.checkPwnedPassword("any-password")).toBe(0);
  });

  it("returns 0 when fetch throws (network timeout) — fail open", async () => {
    jest.spyOn(global, "fetch" as any).mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
    );

    expect(await service.checkPwnedPassword("any-password")).toBe(0);
  });

  it("sends only the 5-char SHA-1 prefix to HIBP — never the full hash (k-Anonymity)", async () => {
    const hash = sha1Upper("k-anonymity-test");
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const fetchSpy = jest.spyOn(global, "fetch" as any).mockResolvedValueOnce({
      ok: true,
      text: async () => "",
    });

    await service.checkPwnedPassword("k-anonymity-test");

    const calledUrl: string = (fetchSpy.mock.calls[0] as any[])[0];
    expect(calledUrl).toContain(prefix);
    expect(calledUrl).not.toContain(suffix);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// adminLogin — HIBP warning propagation
// ──────────────────────────────────────────────────────────────────────────────

describe("AuthService — adminLogin() HIBP warning", () => {
  const scryptAsync = promisify(cryptoModule.scrypt);
  const SALT = "test-salt-16bytes";
  const PASSWORD = "AdminPass#1";
  let passwordHash: string;

  // Pre-compute once so tests don't each pay the scrypt cost.
  beforeAll(async () => {
    passwordHash = (
      (await scryptAsync(PASSWORD, SALT, 64)) as Buffer
    ).toString("hex");
  });

  function buildLoginService(pwnedCount: number) {
    const mockUser: any = {
      id: 1,
      role: "admin",
      passwordSalt: SALT,
      passwordHash,
      isBlocked: false,
    };
    const fakeSession: any = {
      user: mockUser,
      accessToken: "access.jwt",
      refreshToken: "refresh.jwt",
      refreshExpiresAt: new Date(Date.now() + 7 * 86400 * 1000),
    };

    const service = buildService({
      usersService: {
        findByEmail: jest.fn(async () => mockUser),
        setRefreshTokenHash: jest.fn(),
      },
      jwtService: {
        signAsync: jest.fn(async () => "signed.token"),
        decode: jest.fn(() => ({ exp: Math.floor(Date.now() / 1000) + 604800 })),
      },
    });

    jest.spyOn(service as any, "checkPwnedPassword").mockResolvedValue(pwnedCount);
    jest.spyOn(service as any, "issueSession").mockResolvedValue(fakeSession);

    return service;
  }

  afterEach(() => jest.restoreAllMocks());

  it("includes a warning field when the password appears in known breaches", async () => {
    const service = buildLoginService(42000);

    const result = await service.adminLogin({ email: "admin@test.com", password: PASSWORD });

    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/42.?000/); // locale-agnostic: comma or space separator
    expect(result.accessToken).toBe("access.jwt");
  });

  it("returns a plain session with no warning field for a clean password", async () => {
    const service = buildLoginService(0);

    const result = await service.adminLogin({ email: "admin@test.com", password: PASSWORD });

    expect(result.warning).toBeUndefined();
    expect(result.accessToken).toBe("access.jwt");
  });

  it("still issues a session when HIBP is unreachable (pwnedCount stays 0)", async () => {
    const service = buildLoginService(0);
    // checkPwnedPassword is already stubbed to 0 — simulates fail-open behaviour.
    const result = await service.adminLogin({ email: "admin@test.com", password: PASSWORD });

    expect(result).toBeDefined();
    expect(result.warning).toBeUndefined();
  });

  it("rejects login when the user is not found or is not admin role", async () => {
    const service = buildService({
      usersService: { findByEmail: jest.fn(async () => null) },
    });

    await expect(
      service.adminLogin({ email: "nobody@test.com", password: PASSWORD }),
    ).rejects.toThrow("Admin not registered");
  });
});
