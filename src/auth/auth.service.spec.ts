import "reflect-metadata";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "./auth.service";

// ── Build helper ─────────────────────────────────────────────────────────────
// Constructs a real AuthService with minimal mocked deps.
// Tests override only the deps they need; everything else is an inert noop.

const JWT_SECRET = "test-secret-minimum-32-characters!!";

function buildService(overrides: Record<string, any> = {}): AuthService {
  const noop: any = {};
  process.env.JWT_SECRET = JWT_SECRET;

  const jwtService =
    overrides.jwtService ??
    new JwtService({ secret: JWT_SECRET, signOptions: { expiresIn: "15m" } });

  return new AuthService(
    overrides.usersService ?? noop,
    jwtService,
    overrides.wardsService ?? noop,
    overrides.aspirantsService ?? noop,
    overrides.votesService ?? noop,
    overrides.s3Service ?? noop,
    overrides.electionsService ?? noop,
    overrides.parliamentaryService ?? noop,
    overrides.assemblyService ?? noop,
    overrides.gramaPanchayatService ?? noop,
    overrides.configService ?? {
      get: (key: string) => {
        if (key === "JWT_SECRET") return JWT_SECRET;
        return undefined;
      },
    },
    overrides.cache ?? noop,
  );
}

// ── OAuth state: issue + verify ───────────────────────────────────────────────

describe("AuthService — issueOAuthState / verifyOAuthState()", () => {
  it("issues a signed state token and verifies it immediately", () => {
    const service = buildService();
    const state = service.issueOAuthState("client-abc");

    expect(service.verifyOAuthState(state)).toBe("client-abc");
  });

  it("returns null for a state with a tampered signature", () => {
    const service = buildService();
    const state = service.issueOAuthState("client-abc");
    const tampered = state.slice(0, -2) + "xx";

    expect(service.verifyOAuthState(tampered)).toBeNull();
  });

  it("returns null when the state has fewer than 4 dot-separated parts", () => {
    const service = buildService();
    expect(service.verifyOAuthState("only.three.parts")).toBeNull();
  });

  it("returns null when the timestamp is older than 10 minutes", () => {
    const service = buildService();
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now - 11 * 60 * 1000);
    const expiredState = service.issueOAuthState("client-stale");
    jest.spyOn(Date, "now").mockReturnValue(now);

    expect(service.verifyOAuthState(expiredState)).toBeNull();
  });

  it("two calls with the same client state produce distinct tokens (nonce)", () => {
    const service = buildService();
    const s1 = service.issueOAuthState("same");
    const s2 = service.issueOAuthState("same");

    expect(s1).not.toBe(s2);
  });

  afterEach(() => jest.restoreAllMocks());
});

// ── One-time OAuth code: create + exchange ────────────────────────────────────

describe("AuthService — createOneTimeCode / exchangeOneTimeCode()", () => {
  function makeCache() {
    const store = new Map<string, any>();
    return {
      set: jest.fn(async (k: string, v: any) => { store.set(k, v); }),
      get: jest.fn(async (k: string) => store.get(k)),
      del: jest.fn(async (k: string) => { store.delete(k); }),
    };
  }

  it("creates a code and exchanges it for a session", async () => {
    const cache = makeCache();
    const mockUser: any = { id: 7, role: "voter" };
    const fakeSession: any = { user: mockUser, accessToken: "at", refreshToken: "rt" };

    const service = buildService({
      cache,
      usersService: {
        findById: jest.fn(async () => mockUser),
        setRefreshTokenHash: jest.fn(),
      },
    });

    jest.spyOn(service as any, "issueSession").mockResolvedValue(fakeSession);
    jest.spyOn(service as any, "profile").mockResolvedValue({ id: 7 });

    // Issue a real JWT for user 7
    const jwtService = new JwtService({ secret: JWT_SECRET });
    const token = await jwtService.signAsync({ sub: 7, role: "voter" });
    const clientState = "state-xyz";

    const code = await service.createOneTimeCode(token, clientState);
    const result = await service.exchangeOneTimeCode(code, clientState);

    expect(result.accessToken).toBe("at");
    expect(result.profile).toEqual({ id: 7 });
  });

  it("rejects when the authorization code is missing", async () => {
    const service = buildService({ cache: makeCache() });

    await expect(service.exchangeOneTimeCode("", "state")).rejects.toThrow(
      BadRequestException,
    );
  });

  it("rejects an expired or unknown code", async () => {
    const service = buildService({ cache: makeCache() });

    await expect(
      service.exchangeOneTimeCode("nonexistent-code", "state"),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("rejects when the OAuth state does not match", async () => {
    const cache = makeCache();
    const service = buildService({ cache });

    const jwtService = new JwtService({ secret: JWT_SECRET });
    const token = await jwtService.signAsync({ sub: 7 });
    const code = await service.createOneTimeCode(token, "correct-state");

    await expect(
      service.exchangeOneTimeCode(code, "wrong-state"),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("consumes the code on first exchange — replay is rejected", async () => {
    const cache = makeCache();
    const mockUser: any = { id: 7 };
    const service = buildService({
      cache,
      usersService: {
        findById: jest.fn(async () => mockUser),
        setRefreshTokenHash: jest.fn(),
      },
    });

    jest.spyOn(service as any, "issueSession").mockResolvedValue({
      user: mockUser, accessToken: "at", refreshToken: "rt",
    });
    jest.spyOn(service as any, "profile").mockResolvedValue({});

    const jwtService = new JwtService({ secret: JWT_SECRET });
    const token = await jwtService.signAsync({ sub: 7 });
    const clientState = "single-use";
    const code = await service.createOneTimeCode(token, clientState);

    await service.exchangeOneTimeCode(code, clientState);

    await expect(
      service.exchangeOneTimeCode(code, clientState),
    ).rejects.toThrow(UnauthorizedException);
  });

  afterEach(() => jest.restoreAllMocks());
});

// ── rotateRefresh ─────────────────────────────────────────────────────────────

describe("AuthService — rotateRefresh()", () => {
  it("rejects a syntactically invalid token", async () => {
    const service = buildService();
    await expect(service.rotateRefresh("not.a.jwt")).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("rejects a token signed with the wrong secret", async () => {
    const service = buildService();
    const jwtService = new JwtService({ secret: "wrong-secret" });
    const token = await jwtService.signAsync({
      sub: 1,
      type: "refresh",
      jti: "x",
    });

    await expect(service.rotateRefresh(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("rejects a token that lacks type=refresh", async () => {
    const service = buildService();
    // Use the refresh secret derivation: sha256(JWT_SECRET:refresh)
    const crypto = await import("crypto");
    const refreshSecret = crypto
      .createHash("sha256")
      .update(`${JWT_SECRET}:refresh`)
      .digest("hex");

    const jwtService = new JwtService({ secret: refreshSecret });
    const token = await jwtService.signAsync({ sub: 1, type: "access" });

    await expect(service.rotateRefresh(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("detects refresh token reuse — revokes session and throws", async () => {
    const service = buildService();
    const crypto = await import("crypto");
    const refreshSecret = crypto
      .createHash("sha256")
      .update(`${JWT_SECRET}:refresh`)
      .digest("hex");

    const jwtService = new JwtService({ secret: refreshSecret });
    const token = await jwtService.signAsync({
      sub: 5,
      type: "refresh",
      jti: "jti1",
    });

    const storedHash = crypto
      .createHash("sha256")
      .update("different-token")
      .digest("hex"); // hash of a DIFFERENT token → mismatch

    const setRefreshTokenHash = jest.fn();
    const service2 = buildService({
      usersService: {
        findById: jest.fn(async () => ({ id: 5, isBlocked: false })),
        getRefreshTokenHash: jest.fn(async () => storedHash),
        setRefreshTokenHash,
      },
    });

    await expect(service2.rotateRefresh(token)).rejects.toThrow(
      "Refresh token revoked",
    );
    expect(setRefreshTokenHash).toHaveBeenCalledWith(5, null);
  });
});

// ── verifyRefreshSub ──────────────────────────────────────────────────────────

describe("AuthService — verifyRefreshSub()", () => {
  it("returns null for a garbage string", async () => {
    const service = buildService();
    expect(await service.verifyRefreshSub("garbage")).toBeNull();
  });

  it("returns null for an access token (wrong type)", async () => {
    const service = buildService();
    const crypto = await import("crypto");
    const refreshSecret = crypto
      .createHash("sha256")
      .update(`${JWT_SECRET}:refresh`)
      .digest("hex");
    const jwtService = new JwtService({ secret: refreshSecret });
    const token = await jwtService.signAsync({ sub: 3, type: "access" });

    expect(await service.verifyRefreshSub(token)).toBeNull();
  });

  it("returns the subject id for a valid refresh token", async () => {
    const service = buildService();
    const crypto = await import("crypto");
    const refreshSecret = crypto
      .createHash("sha256")
      .update(`${JWT_SECRET}:refresh`)
      .digest("hex");
    const jwtService = new JwtService({ secret: refreshSecret });
    const token = await jwtService.signAsync({ sub: 42, type: "refresh" });

    expect(await service.verifyRefreshSub(token)).toBe(42);
  });
});

// ── revokeSession ─────────────────────────────────────────────────────────────

describe("AuthService — revokeSession()", () => {
  it("clears the refresh token hash for the given user", async () => {
    const setRefreshTokenHash = jest.fn();
    const service = buildService({
      usersService: {
        setRefreshTokenHash,
        revokeAllSessions: jest.fn(async () => {}),
      },
    });

    await service.revokeSession(7);

    expect(setRefreshTokenHash).toHaveBeenCalledWith(7, null);
  });
});

// ── getFrontendRedirectUri / getGoogleAuthUrl ─────────────────────────────────

describe("AuthService — Google OAuth URL helpers", () => {
  it("throws when GOOGLE_FRONTEND_REDIRECT_URI is not configured", () => {
    const service = buildService({
      configService: { get: () => undefined },
    });
    expect(() => service.getFrontendRedirectUri()).toThrow(BadRequestException);
  });

  it("throws when Google OAuth env vars are missing", () => {
    const service = buildService({
      configService: { get: () => undefined },
    });
    expect(() => service.getGoogleAuthUrl()).toThrow(BadRequestException);
  });

  it("builds a valid Google auth URL containing the client_id", () => {
    const service = buildService({
      configService: {
        get: (key: string) => {
          if (key === "GOOGLE_CLIENT_ID") return "my-client-id";
          if (key === "GOOGLE_REDIRECT_URI") return "https://api.example.com/cb";
          if (key === "JWT_SECRET") return JWT_SECRET;
          return undefined;
        },
      },
    });

    const url = service.getGoogleAuthUrl("some-state");

    expect(url).toContain("accounts.google.com");
    expect(url).toContain("my-client-id");
    expect(url).toContain("some-state");
  });
});
