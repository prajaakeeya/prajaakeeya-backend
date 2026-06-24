import request = require("supertest");
import { INestApplication } from "@nestjs/common";
import { AuthController } from "../src/auth/auth.controller";
import { AuthService } from "../src/auth/auth.service";
import { createE2EApp, signToken } from "./utils/e2e";

/**
 * Locks in the cookie-backed session behaviour (access + rotating refresh):
 *  - GET /auth/me authenticates from the HttpOnly access cookie (not just the
 *    Authorization header) and 401s without a session.
 *  - POST /auth/google/exchange sets BOTH the session and refresh cookies.
 *  - POST /auth/refresh rotates the session from the refresh cookie (401 if missing).
 *  - POST /auth/logout revokes the session and clears the cookies.
 *
 * Uses the real JwtStrategy/JwtAuthGuard (so cookie + bearer extraction run
 * exactly as in production) with a mocked AuthService.
 */
describe("AuthController — cookie sessions (e2e, no DB)", () => {
  let app: INestApplication;

  const session = () => ({
    accessToken: signToken({ sub: 7, role: "voter" }),
    refreshToken: "refresh-token-value",
    refreshExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    user: { id: 7, role: "voter" },
  });

  const authService = {
    profile: jest.fn(async (id: number) => ({ id, role: "voter" })),
    exchangeOneTimeCode: jest.fn(async () => ({
      ...session(),
      profile: { id: 7, role: "voter" },
    })),
    rotateRefresh: jest.fn(async () => session()),
    verifyRefreshSub: jest.fn(async () => 7),
    revokeSession: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    app = await createE2EApp({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it("GET /auth/me → 401 without a session", () =>
    request(app.getHttpServer()).get("/api/auth/me").expect(401));

  it("GET /auth/me → 200 using only the session cookie", async () => {
    const token = signToken({ sub: 42, role: "voter" });
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Cookie", `session=${token}`)
      .expect(200);
    expect(authService.profile).toHaveBeenCalledWith(42);
  });

  it("GET /auth/me → 200 still works with the Authorization header", async () => {
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${signToken({ sub: 5, role: "voter" })}`)
      .expect(200);
    expect(authService.profile).toHaveBeenCalledWith(5);
  });

  it("POST /auth/google/exchange → sets session + refresh cookies", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/google/exchange")
      .send({ code: "one-time", state: "abc123" })
      .expect(201);
    expect(authService.exchangeOneTimeCode).toHaveBeenCalledWith(
      "one-time",
      "abc123",
    );
    const cookies: string[] = (res.headers["set-cookie"] ??
      []) as unknown as string[];
    const joined = cookies.join("\n");
    expect(joined).toMatch(/session=/);
    expect(joined).toMatch(/HttpOnly/i);
    expect(joined).toMatch(/SameSite=Lax/i);
    // Refresh cookie is scoped to the refresh path.
    expect(joined).toMatch(/refresh_token=/);
    expect(joined).toMatch(/Path=\/api\/auth\/refresh/i);
    expect(res.body.user).toEqual({ id: 7, role: "voter" });
  });

  it("POST /auth/google/exchange → 400 when state is missing", () =>
    request(app.getHttpServer())
      .post("/api/auth/google/exchange")
      .send({ code: "one-time" })
      .expect(400));

  it("POST /auth/refresh → 201 rotates the session from the refresh cookie", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", "refresh_token=some-refresh")
      .expect(201);
    expect(authService.rotateRefresh).toHaveBeenCalledWith("some-refresh");
    const joined: string = (
      (res.headers["set-cookie"] ?? []) as unknown as string[]
    ).join("\n");
    expect(joined).toMatch(/session=/);
    expect(joined).toMatch(/refresh_token=/);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toEqual({ id: 7, role: "voter" });
  });

  it("POST /auth/refresh → 401 without a refresh cookie", () =>
    request(app.getHttpServer()).post("/api/auth/refresh").expect(401));

  it("POST /auth/logout → 200 and revokes the session when a refresh cookie is present", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/logout")
      .set("Cookie", "refresh_token=rt")
      .expect(200);
    expect(authService.verifyRefreshSub).toHaveBeenCalledWith("rt");
    expect(authService.revokeSession).toHaveBeenCalledWith(7);
    const joined: string = (
      (res.headers["set-cookie"] ?? []) as unknown as string[]
    ).join("\n");
    expect(joined).toMatch(/session=/);
    expect(joined).toMatch(/refresh_token=/);
    expect(res.body).toEqual({ success: true });
  });

  it("POST /auth/logout → 200 even with no session", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/logout")
      .expect(200);
    expect(authService.revokeSession).not.toHaveBeenCalled();
    expect(res.body).toEqual({ success: true });
  });
});
