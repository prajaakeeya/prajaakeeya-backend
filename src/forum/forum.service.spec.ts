import "reflect-metadata";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { ForumService } from "./forum.service";

/**
 * Behaviour unit tests for ForumService — the ward-forum message rules:
 *   1. createMessage persists with the right content + scoping fields.
 *   2. getWardMessages scopes to a ward, orders newest-first, and paginates
 *      (computing skip/take + pagination meta) with defaults.
 *   3. deleteMessage enforces existence and ownership before removing.
 *
 * Constructed directly with a plain-object mock of the Message repository
 * implementing only the methods each path uses.
 */
function buildService(deps: Record<string, any> = {}): any {
  const noop: any = {};
  return new ForumService(deps.messageRepo ?? noop);
}

describe("ForumService — createMessage()", () => {
  it("persists a message with content + user/ward scoping fields", async () => {
    const create = jest.fn((m: any) => m);
    const save = jest.fn(async (m: any) => ({ id: 42, ...m }));
    const service = buildService({ messageRepo: { create, save } });

    const result = await service.createMessage(7, 3, { content: "Hello ward" });

    expect(create).toHaveBeenCalledWith({
      content: "Hello ward",
      userId: 7,
      wardId: 3,
    });
    expect(save).toHaveBeenCalledWith({
      content: "Hello ward",
      userId: 7,
      wardId: 3,
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 42,
        content: "Hello ward",
        userId: 7,
        wardId: 3,
      }),
    );
  });
});

describe("ForumService — getWardMessages()", () => {
  it("scopes to the ward, orders newest-first, and applies default pagination", async () => {
    const rows = [{ id: 2 }, { id: 1 }];
    const findAndCount = jest.fn(async () => [rows, 2]);
    const service = buildService({ messageRepo: { findAndCount } });

    const result = await service.getWardMessages(3, {});

    expect(findAndCount).toHaveBeenCalledWith({
      where: { wardId: 3 },
      order: { createdAt: "DESC" },
      skip: 0,
      take: 50,
    });
    expect(result).toEqual({
      data: rows,
      meta: { total: 2, page: 1, limit: 50, totalPages: 1 },
    });
  });

  it("computes skip/take and totalPages for an explicit page + limit", async () => {
    const findAndCount = jest.fn(async () => [[], 25]);
    const service = buildService({ messageRepo: { findAndCount } });

    const result = await service.getWardMessages(9, { page: 3, limit: 10 });

    // skip = (page - 1) * limit = (3 - 1) * 10 = 20
    expect(findAndCount).toHaveBeenCalledWith({
      where: { wardId: 9 },
      order: { createdAt: "DESC" },
      skip: 20,
      take: 10,
    });
    // totalPages = ceil(25 / 10) = 3
    expect(result.meta).toEqual({
      total: 25,
      page: 3,
      limit: 10,
      totalPages: 3,
    });
    expect(result.data).toEqual([]);
  });

  it("reports zero totalPages when there are no messages", async () => {
    const findAndCount = jest.fn(async () => [[], 0]);
    const service = buildService({ messageRepo: { findAndCount } });

    const result = await service.getWardMessages(1, {});

    expect(result.meta).toEqual({
      total: 0,
      page: 1,
      limit: 50,
      totalPages: 0,
    });
  });
});

describe("ForumService — deleteMessage()", () => {
  it("throws NotFoundException when the message does not exist", async () => {
    const remove = jest.fn();
    const service = buildService({
      messageRepo: { findOne: jest.fn(async () => null), remove },
    });

    await expect(service.deleteMessage(123, 7)).rejects.toThrow(
      NotFoundException,
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException when deleting another user's message", async () => {
    const remove = jest.fn();
    const service = buildService({
      messageRepo: {
        findOne: jest.fn(async () => ({ id: 5, userId: 99 })),
        remove,
      },
    });

    await expect(service.deleteMessage(5, 7)).rejects.toThrow(
      ForbiddenException,
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes the message and returns a success payload for the owner", async () => {
    const message = { id: 5, userId: 7 };
    const remove = jest.fn(async () => message);
    const service = buildService({
      messageRepo: { findOne: jest.fn(async () => message), remove },
    });

    const result = await service.deleteMessage(5, 7);

    expect(remove).toHaveBeenCalledWith(message);
    expect(result).toEqual({ message: "Message deleted successfully" });
  });
});
