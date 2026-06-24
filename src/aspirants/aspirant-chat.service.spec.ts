import "reflect-metadata";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { AspirantChatService } from "./aspirant-chat.service";

/**
 * Behaviour unit tests for AspirantChatService.
 *
 * Constructed directly with mocked dependencies. The TypeORM repos are plain
 * objects implementing only the methods the service touches; ChatEventsService
 * and NotificationsService are jest.fn() stubs so nothing hits a DB, SSE bus,
 * or network. Tests assert real behaviour: persisted fields, returned shapes,
 * thrown exceptions, and which side-effects fire.
 */
function buildService(deps: Record<string, any> = {}): {
  service: any;
  repo: any;
  aspirantRepo: any;
  notificationsService: any;
  chatEvents: any;
  userRepo: any;
} {
  const userRepo = {
    findOne: jest.fn(async () =>
      "sender" in deps ? deps.sender : { id: 1, name: "Sender" },
    ),
  };
  const repo = {
    create: jest.fn((v: any) => ({ ...v })),
    save: jest.fn(async (v: any) => ({
      id: 100,
      createdAt: new Date(0),
      ...v,
    })),
    findOne: jest.fn(async () => null),
    findAndCount: jest.fn(async () => [[], 0]),
    remove: jest.fn(async () => undefined),
    manager: {
      getRepository: jest.fn(() => userRepo),
    },
    ...deps.repo,
  };
  const aspirantRepo = {
    findOne: jest.fn(async () =>
      deps.aspirant === undefined
        ? { id: 7, name: "Asha", userId: 42 }
        : deps.aspirant,
    ),
    ...deps.aspirantRepo,
  };
  const notificationsService = {
    notifyAspirantChatMessage: jest.fn(async () => undefined),
    ...deps.notificationsService,
  };
  const chatEvents = {
    publish: jest.fn(),
    ...deps.chatEvents,
  };

  const service = new AspirantChatService(
    repo as any,
    aspirantRepo as any,
    notificationsService as any,
    chatEvents as any,
  );
  return {
    service,
    repo,
    aspirantRepo,
    notificationsService,
    chatEvents,
    userRepo,
  };
}

describe("AspirantChatService", () => {
  describe("createMessage()", () => {
    it("persists the message with content, userId and aspirantId", async () => {
      const { service, repo } = buildService();

      const saved = await service.createMessage(1, 7, { content: "hello" });

      expect(repo.create).toHaveBeenCalledWith({
        content: "hello",
        userId: 1,
        aspirantId: 7,
      });
      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(saved).toEqual(
        expect.objectContaining({ content: "hello", userId: 1, aspirantId: 7 }),
      );
    });

    it("publishes a message.created SSE event with the saved message", async () => {
      const { service, chatEvents } = buildService();

      const saved = await service.createMessage(1, 7, { content: "hi" });

      expect(chatEvents.publish).toHaveBeenCalledWith({
        aspirantId: 7,
        type: "message.created",
        payload: saved,
      });
    });

    it("notifies prior participants with aspirant + sender details", async () => {
      const { service, notificationsService } = buildService({
        aspirant: { id: 7, name: "Asha", userId: 42 },
        sender: { id: 1, name: "Ravi" },
      });

      await service.createMessage(1, 7, { content: "manifesto?" });

      expect(
        notificationsService.notifyAspirantChatMessage,
      ).toHaveBeenCalledWith({
        aspirantId: 7,
        aspirantUserId: 42,
        aspirantName: "Asha",
        senderId: 1,
        senderName: "Ravi",
        content: "manifesto?",
      });
    });

    it("passes null aspirantUserId/senderName when those are absent", async () => {
      const { service, notificationsService } = buildService({
        aspirant: { id: 7, name: "Asha" }, // no userId
        sender: null, // user lookup returns null
      });

      await service.createMessage(1, 7, { content: "yo" });

      expect(
        notificationsService.notifyAspirantChatMessage,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ aspirantUserId: null, senderName: null }),
      );
    });

    it("skips the notification when the aspirant is not found", async () => {
      const { service, notificationsService } = buildService({
        aspirant: null,
      });

      await service.createMessage(1, 7, { content: "ghost room" });

      expect(
        notificationsService.notifyAspirantChatMessage,
      ).not.toHaveBeenCalled();
    });

    it("still returns the saved message when notification fan-out throws (best-effort)", async () => {
      const { service, chatEvents } = buildService({
        notificationsService: {
          notifyAspirantChatMessage: jest.fn(async () => {
            throw new Error("notify boom");
          }),
        },
      });

      const saved = await service.createMessage(1, 7, { content: "resilient" });

      // SSE still fired and the message is returned despite the notify failure.
      expect(chatEvents.publish).toHaveBeenCalledTimes(1);
      expect(saved).toEqual(expect.objectContaining({ content: "resilient" }));
    });
  });

  describe("getMessages()", () => {
    it("returns paginated data and meta using defaults (page 1, limit 50)", async () => {
      const rows = [{ id: 2 }, { id: 1 }];
      const { service, repo } = buildService({
        repo: { findAndCount: jest.fn(async () => [rows, 2]) },
      });

      const result = await service.getMessages(7, {});

      expect(repo.findAndCount).toHaveBeenCalledWith({
        where: { aspirantId: 7 },
        order: { createdAt: "DESC" },
        skip: 0,
        take: 50,
      });
      expect(result).toEqual({
        data: rows,
        meta: { total: 2, page: 1, limit: 50, totalPages: 1 },
      });
    });

    it("computes skip and totalPages from page/limit", async () => {
      const { service, repo } = buildService({
        repo: { findAndCount: jest.fn(async () => [[], 25]) },
      });

      const result = await service.getMessages(7, { page: 3, limit: 10 });

      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(result.meta).toEqual({
        total: 25,
        page: 3,
        limit: 10,
        totalPages: 3,
      });
    });
  });

  describe("deleteMessage()", () => {
    it("throws NotFoundException when the message does not exist", async () => {
      const { service } = buildService({
        repo: { findOne: jest.fn(async () => null) },
      });

      await expect(service.deleteMessage(5, 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when deleting someone else's message", async () => {
      const { service, repo } = buildService({
        repo: {
          findOne: jest.fn(async () => ({ id: 5, userId: 99, aspirantId: 7 })),
        },
      });

      await expect(service.deleteMessage(5, 1)).rejects.toThrow(
        ForbiddenException,
      );
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it("removes the message, emits message.deleted, and returns confirmation", async () => {
      const message = { id: 5, userId: 1, aspirantId: 7 };
      const { service, repo, chatEvents } = buildService({
        repo: {
          findOne: jest.fn(async () => message),
          remove: jest.fn(async () => undefined),
        },
      });

      const result = await service.deleteMessage(5, 1);

      expect(repo.remove).toHaveBeenCalledWith(message);
      expect(chatEvents.publish).toHaveBeenCalledWith({
        aspirantId: 7,
        type: "message.deleted",
        payload: { id: 5 },
      });
      expect(result).toEqual({ message: "Message deleted" });
    });
  });
});
