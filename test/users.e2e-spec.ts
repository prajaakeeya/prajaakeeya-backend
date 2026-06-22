import request = require("supertest");
import { INestApplication } from "@nestjs/common";
import { UsersController } from "../src/users/users.controller";
import { UsersService } from "../src/users/users.service";
import { createE2EApp, signToken } from "./utils/e2e";

/**
 * HTTP e2e for UsersController — real routing, the real JwtAuthGuard, and the
 * real ValidationPipe; UsersService is mocked so no DB is touched.
 */
describe("UsersController (e2e, no DB)", () => {
  let app: INestApplication;

  const usersService = {
    trackPhoneCall: jest.fn(async () => ({ ok: true })),
    findAllVoters: jest.fn(async () => ({
      data: [{ id: 1, name: "Voter A" }],
      page: 1,
      limit: 20,
      total: 1,
    })),
  };

  beforeAll(async () => {
    app = await createE2EApp({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  describe("POST /api/users/track/phone-call (guarded)", () => {
    it("rejects with 401 when no token is sent (real JwtAuthGuard)", () =>
      request(app.getHttpServer())
        .post("/api/users/track/phone-call")
        .send({ aspirantId: 54 })
        .expect(401));

    it("rejects with 400 when aspirantId is missing (ValidationPipe)", () =>
      request(app.getHttpServer())
        .post("/api/users/track/phone-call")
        .set("Authorization", `Bearer ${signToken()}`)
        .send({})
        .expect(400));

    it("rejects with 400 on an unknown field (forbidNonWhitelisted)", () =>
      request(app.getHttpServer())
        .post("/api/users/track/phone-call")
        .set("Authorization", `Bearer ${signToken()}`)
        .send({ aspirantId: 54, hacker: true })
        .expect(400));

    it("accepts a valid token + body (201) and forwards the authed user id", async () => {
      await request(app.getHttpServer())
        .post("/api/users/track/phone-call")
        .set("Authorization", `Bearer ${signToken({ sub: 57 })}`)
        .send({ aspirantId: 54, timestamp: 1780000000000 })
        .expect(201);

      expect(usersService.trackPhoneCall).toHaveBeenCalledWith(
        57,
        54,
        expect.any(Date),
      );
    });
  });

  describe("GET /api/users/voters (admin only)", () => {
    it("rejects with 401 when no token is sent", () =>
      request(app.getHttpServer())
        .get("/api/users/voters?page=1&limit=20")
        .expect(401));

    it("rejects with 403 for a non-admin (voter) token", () =>
      request(app.getHttpServer())
        .get("/api/users/voters?page=1&limit=20")
        .set("Authorization", `Bearer ${signToken({ role: "voter" })}`)
        .expect(403));

    it("returns 200 + the paginated payload for an admin token", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/users/voters?page=1&limit=20")
        .set("Authorization", `Bearer ${signToken({ role: "admin" })}`)
        .expect(200);

      expect(usersService.findAllVoters).toHaveBeenCalled();
      expect(res.body).toHaveProperty("data");
    });
  });
});
