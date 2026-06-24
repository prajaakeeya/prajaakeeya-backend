import "reflect-metadata";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { AspirantDiscussionService } from "./aspirant-discussion.service";

/**
 * Behaviour unit tests for AspirantDiscussionService. The service is
 * constructed directly with a mocked TypeORM repository (no DB / no server).
 * Each block locks in a specific business rule for the ward-level aspirant
 * discussion room:
 *   - createMessage: only aspirants may post; persisted fields are exact.
 *   - getMessages:   ward-scoped query, pagination math, response shape.
 *   - deleteMessage: existence + author/admin ownership enforcement.
 */

// Build the service with whatever repo mock a given test cares about.
function buildService(repo: Record<string, any> = {}): any {
  return new AspirantDiscussionService(repo as any);
}

// Minimal chainable QueryBuilder stub whose terminal getManyAndCount()
// resolves to [rows, total] — used by getMessages().
function qbReturning(rows: any[], total: number): any {
  const qb: any = {};
  for (const m of ["innerJoinAndSelect", "where", "orderBy", "skip", "take"]) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getManyAndCount = jest.fn(async () => [rows, total]);
  return qb;
}

describe("AspirantDiscussionService — createMessage()", () => {
  it("rejects a non-aspirant caller (voter)", async () => {
    const create = jest.fn();
    const save = jest.fn();
    const service = buildService({ create, save });

    await expect(
      service.createMessage(1, "voter", 7, { content: "hello" }),
    ).rejects.toThrow(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects an admin caller (only aspirants may post)", async () => {
    const service = buildService({ create: jest.fn(), save: jest.fn() });
    await expect(
      service.createMessage(1, "admin", 7, { content: "hello" }),
    ).rejects.toThrow("Only aspirants can post");
  });

  it("persists the message with exact content/userId/aspirantId on success", async () => {
    const create = jest.fn((x: any) => x);
    const save = jest.fn(async (x: any) => ({ id: 99, ...x }));
    const service = buildService({ create, save });

    const result = await service.createMessage(56, "aspirant", 7, {
      content: "Road work update",
    });

    expect(create).toHaveBeenCalledWith({
      content: "Road work update",
      userId: 56,
      aspirantId: 7,
    });
    expect(save).toHaveBeenCalledWith({
      content: "Road work update",
      userId: 56,
      aspirantId: 7,
    });
    expect(result).toEqual(
      expect.objectContaining({ id: 99, content: "Road work update" }),
    );
  });
});

describe("AspirantDiscussionService — getMessages()", () => {
  it("scopes the query to the ward number and orders by createdAt DESC", async () => {
    const qb = qbReturning([], 0);
    const service = buildService({ createQueryBuilder: jest.fn(() => qb) });

    await service.getMessages("12", {});

    expect(qb.where).toHaveBeenCalledWith("ward.number = :wardNumber", {
      wardNumber: "12",
    });
    expect(qb.orderBy).toHaveBeenCalledWith("message.createdAt", "DESC");
  });

  it("applies default pagination (page 1, limit 50 => skip 0, take 50)", async () => {
    const qb = qbReturning([], 0);
    const service = buildService({ createQueryBuilder: jest.fn(() => qb) });

    const res = await service.getMessages("12", {});

    expect(qb.skip).toHaveBeenCalledWith(0);
    expect(qb.take).toHaveBeenCalledWith(50);
    expect(res.meta).toEqual({ total: 0, page: 1, limit: 50, totalPages: 0 });
  });

  it("computes skip from page/limit and reports totalPages via ceil", async () => {
    const qb = qbReturning([], 25);
    const service = buildService({ createQueryBuilder: jest.fn(() => qb) });

    const res = await service.getMessages("12", { page: 3, limit: 10 });

    expect(qb.skip).toHaveBeenCalledWith(20); // (3 - 1) * 10
    expect(qb.take).toHaveBeenCalledWith(10);
    expect(res.meta).toEqual({ total: 25, page: 3, limit: 10, totalPages: 3 });
  });

  it("flattens each message into the public shape (user, aspirant, ward)", async () => {
    const row = {
      id: 5,
      content: "hi",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
      userId: 56,
      aspirantId: 7,
      user: { id: 56, name: "Acchu", role: "aspirant", password: "secret" },
      aspirant: {
        id: 7,
        name: "Acchu M",
        party: "Independent",
        ward: { id: 3, number: "12", name: "MG Road" },
      },
    };
    const qb = qbReturning([row], 1);
    const service = buildService({ createQueryBuilder: jest.fn(() => qb) });

    const res = await service.getMessages("12", {});

    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toEqual({
      id: 5,
      content: "hi",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
      userId: 56,
      aspirantId: 7,
      user: { id: 56, name: "Acchu", role: "aspirant" },
      aspirant: { id: 7, name: "Acchu M", party: "Independent" },
      ward: { id: 3, number: "12", name: "MG Road" },
    });
    // Sensitive/extra user fields are not leaked through the projection.
    expect("password" in res.data[0].user).toBe(false);
  });

  it("tolerates missing aspirant/ward relations without throwing", async () => {
    const row = {
      id: 6,
      content: "orphan",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      userId: 56,
      aspirantId: 7,
      user: undefined,
      aspirant: undefined,
    };
    const qb = qbReturning([row], 1);
    const service = buildService({ createQueryBuilder: jest.fn(() => qb) });

    const res = await service.getMessages("12", {});

    expect(res.data[0].user).toEqual({
      id: undefined,
      name: undefined,
      role: undefined,
    });
    expect(res.data[0].ward).toEqual({
      id: undefined,
      number: undefined,
      name: undefined,
    });
  });
});

describe("AspirantDiscussionService — deleteMessage()", () => {
  it("throws NotFound when the message does not exist", async () => {
    const remove = jest.fn();
    const service = buildService({
      findOne: jest.fn(async () => null),
      remove,
    });

    await expect(service.deleteMessage(1, 56, "aspirant")).rejects.toThrow(
      NotFoundException,
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("forbids deleting another user's message (non-admin)", async () => {
    const remove = jest.fn();
    const service = buildService({
      findOne: jest.fn(async () => ({ id: 1, userId: 999 })),
      remove,
    });

    await expect(service.deleteMessage(1, 56, "aspirant")).rejects.toThrow(
      ForbiddenException,
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("lets the author delete their own message", async () => {
    const message = { id: 1, userId: 56 };
    const remove = jest.fn(async () => undefined);
    const service = buildService({
      findOne: jest.fn(async () => message),
      remove,
    });

    const res = await service.deleteMessage(1, 56, "aspirant");

    expect(remove).toHaveBeenCalledWith(message);
    expect(res).toEqual({ message: "Message deleted successfully" });
  });

  it("lets an admin delete any message even if not the author", async () => {
    const message = { id: 1, userId: 999 };
    const remove = jest.fn(async () => undefined);
    const service = buildService({
      findOne: jest.fn(async () => message),
      remove,
    });

    const res = await service.deleteMessage(1, 56, "admin");

    expect(remove).toHaveBeenCalledWith(message);
    expect(res).toEqual({ message: "Message deleted successfully" });
  });
});
