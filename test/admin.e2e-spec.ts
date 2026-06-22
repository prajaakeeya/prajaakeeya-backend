import request = require("supertest");
import { INestApplication } from "@nestjs/common";
import { AdminController } from "../src/admin/admin.controller";
import { AdminService } from "../src/admin/admin.service";
import { createE2EApp, signToken } from "./utils/e2e";

/**
 * Locks in admin-route authorization: every `/admin/*` endpoint is gated by
 * JwtAuthGuard + RolesGuard(@Roles("admin")), so a normal user's token cannot
 * reach admin functionality. Uses GET /admin/users as a representative route.
 */
describe("AdminController — role guard (e2e, no DB)", () => {
  let app: INestApplication;

  const adminService = {
    getAllUsers: jest.fn(async () => []),
  };

  beforeAll(async () => {
    app = await createE2EApp({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: adminService }],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it("rejects with 401 when no token is sent", () =>
    request(app.getHttpServer()).get("/api/admin/users").expect(401));

  it("rejects with 403 for a non-admin (voter) token", () =>
    request(app.getHttpServer())
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${signToken({ role: "voter" })}`)
      .expect(403));

  it("rejects with 403 for an aspirant token", () =>
    request(app.getHttpServer())
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${signToken({ role: "aspirant" })}`)
      .expect(403));

  it("allows an admin token through to the service", async () => {
    await request(app.getHttpServer())
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${signToken({ role: "admin" })}`)
      .expect(200);

    expect(adminService.getAllUsers).toHaveBeenCalled();
  });
});
