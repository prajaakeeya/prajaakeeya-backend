import request = require("supertest");
import { INestApplication } from "@nestjs/common";
import { AuthController } from "../src/auth/auth.controller";
import { AuthService } from "../src/auth/auth.service";
import { createE2EApp, signToken } from "./utils/e2e";

/**
 * Locks in the cookie-backed session behaviour from issue #54:
 *  - GET /auth/me authenticates from the HttpOnly session cookie (not just the
 *    Authorization header) and 401s without a session.
 *  - POST /auth/logout clears the cookie and succeeds even with no session.
 *  - POST /auth/google/exchange sets a secure HttpOnly session cookie.
 *
 * Uses the real JwtStrategy/JwtAuthGuard (so cookie + bearer extraction run
 * exactly as in production) with a mocked AuthService.
 */
describe("AuthController — cookie sessions (e2e, no DB)", () => {
  let app: INestApplication;

  const authService = {
    profile: jest.fn(async (id: number) => ({ id, role: "voter" })),
    exchangeOneTimeCode: jest.fn(async () => ({
      token: signToken({ sub: 7, role: "voter" }),
      user: { id: 7, role: "voter" },
    })),
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

  it("POST /auth/logout → 200 and clears the cookie even with no session", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/logout")
      .expect(200);

    const setCookie = res.headers["set-cookie"]?.[0] ?? "";
    expect(setCookie).toMatch(/^session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(res.body).toEqual({ success: true });
  });

  it("POST /auth/google/exchange → sets an HttpOnly session cookie", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/google/exchange")
      .send({ code: "one-time", state: "abc123" })
      .expect(201);

    expect(authService.exchangeOneTimeCode).toHaveBeenCalledWith(
      "one-time",
      "abc123",
    );
    const setCookie = res.headers["set-cookie"]?.[0] ?? "";
    expect(setCookie).toMatch(/^session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(res.body.user).toEqual({ id: 7, role: "voter" });
  });

  it("POST /auth/google/exchange → 400 when state is missing", () =>
    request(app.getHttpServer())
      .post("/api/auth/google/exchange")
      .send({ code: "one-time" })
      .expect(400));
});
