import "reflect-metadata";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { AspirantWardMeetingsService } from "./aspirant-ward-meetings.service";

/**
 * Behaviour unit tests for AspirantWardMeetingsService. The service is
 * constructed directly with mock dependencies (no DB / no HTTP / no network).
 * Each block locks in a specific business rule: ownership/role scoping,
 * ward resolution, best-effort notification fan-out, and the exact payload
 * handed to wardsService.createMeeting.
 */

// Build a service with only the dependencies a given test cares about; the
// rest are inert stubs. Constructor arg order mirrors the real constructor:
// (wardsService, aspirantsService, usersService, notificationsService, electionsService).
function buildService(deps: Record<string, any> = {}): any {
  const noop: any = {};
  return new AspirantWardMeetingsService(
    deps.wardsService ?? noop,
    deps.aspirantsService ?? noop,
    deps.usersService ?? noop,
    deps.notificationsService ?? noop,
    deps.electionsService ?? noop,
  );
}

describe("AspirantWardMeetingsService — createMeetingForAspirant()", () => {
  const userId = 1;
  const dto = {
    title: "Ward Townhall",
    description: "Discuss plans",
    meetingLink: "https://meet.google.com/xyz-abcd-efg",
    scheduledAt: 1718570400000,
  };

  it("rejects when the user has no aspirant profile", async () => {
    const service = buildService({
      aspirantsService: { findByUserId: jest.fn(async () => null) },
    });
    await expect(service.createMeetingForAspirant(userId, dto)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("creates the meeting with the aspirant's ward and the dto fields", async () => {
    const createMeeting = jest.fn(async (payload: any) => ({
      id: 50,
      ...payload,
    }));
    const service = buildService({
      aspirantsService: {
        findByUserId: jest.fn(async () => ({
          id: 9,
          wardId: 3,
          electionId: null,
          constituencyId: null,
        })),
      },
      wardsService: { createMeeting },
    });

    const result = await service.createMeetingForAspirant(userId, dto);

    expect(createMeeting).toHaveBeenCalledWith(
      {
        wardId: 3,
        title: "Ward Townhall",
        description: "Discuss plans",
        meetingLink: "https://meet.google.com/xyz-abcd-efg",
        scheduledAt: 1718570400000,
      },
      userId,
    );
    expect(result).toMatchObject({ id: 50, wardId: 3, title: "Ward Townhall" });
  });

  it("does NOT notify when the aspirant has no election/constituency", async () => {
    const notifyAspirantMeeting = jest.fn();
    const service = buildService({
      aspirantsService: {
        findByUserId: jest.fn(async () => ({
          id: 9,
          wardId: 3,
          electionId: null,
          constituencyId: null,
        })),
      },
      wardsService: {
        createMeeting: jest.fn(async () => ({ id: 50, title: "T" })),
      },
      notificationsService: { notifyAspirantMeeting },
    });

    await service.createMeetingForAspirant(userId, dto);

    expect(notifyAspirantMeeting).not.toHaveBeenCalled();
  });

  it("notifies matching constituency users with the meeting + election type", async () => {
    const notifyAspirantMeeting = jest.fn(async (..._args: any[]) => undefined);
    const aspirant = {
      id: 9,
      wardId: 3,
      electionId: 10,
      constituencyId: 20,
    };
    const service = buildService({
      aspirantsService: { findByUserId: jest.fn(async () => aspirant) },
      wardsService: {
        createMeeting: jest.fn(async () => ({
          id: 50,
          title: "Ward Townhall",
          scheduledAt: 1718570400000,
        })),
      },
      electionsService: {
        findById: jest.fn(async () => ({ type: "lok_sabha" })),
      },
      notificationsService: { notifyAspirantMeeting },
    });

    await service.createMeetingForAspirant(userId, dto);

    expect(notifyAspirantMeeting).toHaveBeenCalledTimes(1);
    const [passedAspirant, passedMeeting, passedMeta] =
      notifyAspirantMeeting.mock.calls[0];
    expect(passedAspirant).toBe(aspirant);
    expect(passedMeeting).toEqual({
      id: 50,
      title: "Ward Townhall",
      startTime: 1718570400000,
    });
    expect(passedMeta).toEqual({
      electionType: "lok_sabha",
      constituencyName: null,
    });
  });

  it("passes startTime undefined when the meeting has no scheduledAt", async () => {
    const notifyAspirantMeeting = jest.fn(async (..._args: any[]) => undefined);
    const service = buildService({
      aspirantsService: {
        findByUserId: jest.fn(async () => ({
          id: 9,
          wardId: 3,
          electionId: 10,
          constituencyId: 20,
        })),
      },
      wardsService: {
        createMeeting: jest.fn(async () => ({
          id: 50,
          title: "Ward Townhall",
          scheduledAt: null,
        })),
      },
      electionsService: {
        findById: jest.fn(async () => ({ type: "lok_sabha" })),
      },
      notificationsService: { notifyAspirantMeeting },
    });

    await service.createMeetingForAspirant(userId, dto);

    expect(notifyAspirantMeeting.mock.calls[0][1]).toEqual({
      id: 50,
      title: "Ward Townhall",
      startTime: undefined,
    });
  });

  it("still returns the created meeting when notification fan-out throws (best-effort)", async () => {
    const created = {
      id: 50,
      title: "Ward Townhall",
      scheduledAt: 1718570400000,
    };
    const service = buildService({
      aspirantsService: {
        findByUserId: jest.fn(async () => ({
          id: 9,
          wardId: 3,
          electionId: 10,
          constituencyId: 20,
        })),
      },
      wardsService: { createMeeting: jest.fn(async () => created) },
      electionsService: {
        findById: jest.fn(async () => {
          throw new Error("election lookup failed");
        }),
      },
      notificationsService: { notifyAspirantMeeting: jest.fn() },
    });

    const result = await service.createMeetingForAspirant(userId, dto);

    expect(result).toBe(created);
  });
});

describe("AspirantWardMeetingsService — getMeetingsForUserWard()", () => {
  const userId = 1;

  it("uses the ward from the user profile when present", async () => {
    const getActiveMeetingsByWard = jest.fn(async () => ["m1", "m2"]);
    const findByUserId = jest.fn();
    const service = buildService({
      usersService: {
        findById: jest.fn(async () => ({ id: userId, wardId: 7 })),
      },
      aspirantsService: { findByUserId },
      wardsService: { getActiveMeetingsByWard },
    });

    const result = await service.getMeetingsForUserWard(userId);

    expect(getActiveMeetingsByWard).toHaveBeenCalledWith(7);
    expect(findByUserId).not.toHaveBeenCalled(); // aspirant fallback not needed
    expect(result).toEqual(["m1", "m2"]);
  });

  it("falls back to the aspirant record's ward when the user has none", async () => {
    const getActiveMeetingsByWard = jest.fn(async () => ["m1"]);
    const service = buildService({
      usersService: {
        findById: jest.fn(async () => ({ id: userId, wardId: null })),
      },
      aspirantsService: { findByUserId: jest.fn(async () => ({ wardId: 4 })) },
      wardsService: { getActiveMeetingsByWard },
    });

    const result = await service.getMeetingsForUserWard(userId);

    expect(getActiveMeetingsByWard).toHaveBeenCalledWith(4);
    expect(result).toEqual(["m1"]);
  });

  it("throws when no ward can be resolved from user or aspirant", async () => {
    const service = buildService({
      usersService: { findById: jest.fn(async () => ({ id: userId })) },
      aspirantsService: { findByUserId: jest.fn(async () => null) },
    });
    await expect(service.getMeetingsForUserWard(userId)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe("AspirantWardMeetingsService — completeMeeting()", () => {
  it("rejects when the meeting does not exist", async () => {
    const service = buildService({
      wardsService: { getMeetingById: jest.fn(async () => null) },
    });
    await expect(service.completeMeeting(1, 99, "notes")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("rejects a non-creator non-admin caller", async () => {
    const service = buildService({
      wardsService: {
        getMeetingById: jest.fn(async () => ({ id: 99, createdById: 2 })),
      },
      usersService: {
        findById: jest.fn(async () => ({ id: 1, role: "voter" })),
      },
    });
    await expect(service.completeMeeting(1, 99, "notes")).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("allows the meeting creator to complete it", async () => {
    const completeMeeting = jest.fn(async () => ({
      id: 99,
      status: "completed",
    }));
    const service = buildService({
      wardsService: {
        getMeetingById: jest.fn(async () => ({ id: 99, createdById: 1 })),
        completeMeeting,
      },
      usersService: {
        findById: jest.fn(async () => ({ id: 1, role: "voter" })),
      },
    });

    const result = await service.completeMeeting(1, 99, "Great turnout");

    expect(completeMeeting).toHaveBeenCalledWith(99, "Great turnout");
    expect(result).toEqual({ id: 99, status: "completed" });
  });

  it("allows an admin who is not the creator to complete it", async () => {
    const completeMeeting = jest.fn(async () => ({ id: 99 }));
    const service = buildService({
      wardsService: {
        getMeetingById: jest.fn(async () => ({ id: 99, createdById: 2 })),
        completeMeeting,
      },
      usersService: {
        findById: jest.fn(async () => ({ id: 1, role: "admin" })),
      },
    });

    await service.completeMeeting(1, 99, "notes");

    expect(completeMeeting).toHaveBeenCalledWith(99, "notes");
  });
});

describe("AspirantWardMeetingsService — deleteMeeting()", () => {
  it("rejects when the meeting does not exist", async () => {
    const service = buildService({
      wardsService: { getMeetingById: jest.fn(async () => null) },
    });
    await expect(service.deleteMeeting(1, 99)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("rejects a non-creator non-admin caller and does not delete", async () => {
    const deleteMeeting = jest.fn();
    const service = buildService({
      wardsService: {
        getMeetingById: jest.fn(async () => ({ id: 99, createdById: 2 })),
        deleteMeeting,
      },
      usersService: {
        findById: jest.fn(async () => ({ id: 1, role: "voter" })),
      },
    });
    await expect(service.deleteMeeting(1, 99)).rejects.toThrow(
      ForbiddenException,
    );
    expect(deleteMeeting).not.toHaveBeenCalled();
  });

  it("deletes and returns { deleted: 1 } for the creator", async () => {
    const deleteMeeting = jest.fn(async () => undefined);
    const service = buildService({
      wardsService: {
        getMeetingById: jest.fn(async () => ({ id: 99, createdById: 1 })),
        deleteMeeting,
      },
      usersService: {
        findById: jest.fn(async () => ({ id: 1, role: "voter" })),
      },
    });

    const result = await service.deleteMeeting(1, 99);

    expect(deleteMeeting).toHaveBeenCalledWith(99);
    expect(result).toEqual({ deleted: 1 });
  });

  it("allows an admin who is not the creator to delete it", async () => {
    const deleteMeeting = jest.fn(async () => undefined);
    const service = buildService({
      wardsService: {
        getMeetingById: jest.fn(async () => ({ id: 99, createdById: 2 })),
        deleteMeeting,
      },
      usersService: {
        findById: jest.fn(async () => ({ id: 1, role: "admin" })),
      },
    });

    const result = await service.deleteMeeting(1, 99);

    expect(deleteMeeting).toHaveBeenCalledWith(99);
    expect(result).toEqual({ deleted: 1 });
  });
});
