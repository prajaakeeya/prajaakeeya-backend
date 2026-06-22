import "reflect-metadata";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { AspirantsService } from "./aspirants.service";

/**
 * Behaviour unit tests for AspirantsService. The service is constructed with
 * mock dependencies (no DB / no server); methods' internal aggregations are
 * stubbed where needed. Each block locks in a specific business rule.
 */

// Build a service with only the dependencies a given test cares about; the
// rest are inert stubs. Constructor arg order mirrors the real constructor.
function buildService(deps: Record<string, any> = {}): any {
  const noop: any = {};
  return new AspirantsService(
    deps.repo ?? noop,
    deps.meetingRepo ?? noop,
    deps.bookingRepo ?? noop,
    deps.visitRepo ?? noop,
    deps.visitResponseRepo ?? noop,
    deps.meetingResponseRepo ?? noop,
    deps.activityRatingRepo ?? noop,
    deps.interactionRepo ?? noop,
    deps.usersService ?? noop,
    deps.wardsService ?? noop,
    deps.electionsService ?? noop,
    deps.notificationsService ?? noop,
    deps.votesService ?? noop,
  );
}

// Minimal chainable QueryBuilder stub whose terminal getRawMany() resolves to
// the given rows — used by methods that aggregate response counts in SQL.
function qbReturning(rows: any[]): any {
  const qb: any = {};
  for (const m of ["select", "addSelect", "where", "groupBy"]) qb[m] = () => qb;
  qb.getRawMany = async () => rows;
  return qb;
}

describe("AspirantsService — contact privacy (findOne)", () => {
  const OWNER_USER_ID = 56;
  const ASPIRANT_ID = 54;

  let service: any;
  let aspirant: any;

  beforeEach(() => {
    aspirant = {
      id: ASPIRANT_ID,
      userId: OWNER_USER_ID,
      name: "Acchu M",
      gender: "Male", // set so the gender-fallback lookup is skipped
      electionId: null, // skip election/constituency name resolution
      constituencyId: null,
      phone: "9876543210",
      whatsappNumber: "9876543210",
      allowPhone: false,
      allowWhatsapp: true,
      allowChat: true,
      meetings: [],
      user: { isBlocked: false },
      getDocumentStatus: () => ({}),
    };

    service = buildService({
      repo: { findOne: jest.fn(async () => aspirant) },
      visitRepo: { find: jest.fn(async () => []) },
    });

    jest
      .spyOn(service, "getActivityRatingsBulk")
      .mockResolvedValue({
        meetingRatings: {},
        visitRatings: {},
        contactRatings: {},
        overallRatings: {},
      });
    jest.spyOn(service, "getMeetingResponseCounts").mockResolvedValue(new Map());
    jest.spyOn(service, "getVisitResponseCounts").mockResolvedValue(new Map());
  });

  it("hides phone from an anonymous viewer when allowPhone is false", async () => {
    const res = await service.findOne(ASPIRANT_ID);
    expect(res).toBeTruthy();
    expect("phone" in res).toBe(false);
    expect(res.phone).toBeUndefined();
    expect(res.whatsappNumber).toBe("9876543210"); // allowWhatsapp still true
    expect(res.allowPhone).toBe(false); // flag preserved
  });

  it("shows phone to the OWNER even when allowPhone is false", async () => {
    const res = await service.findOne(ASPIRANT_ID, {
      id: OWNER_USER_ID,
      role: "aspirant",
    });
    expect(res.phone).toBe("9876543210");
    expect(res.whatsappNumber).toBe("9876543210");
  });

  it("hides phone from a different logged-in user when allowPhone is false", async () => {
    const res = await service.findOne(ASPIRANT_ID, { id: 999, role: "voter" });
    expect(res.phone).toBeUndefined();
  });

  it("hides whatsappNumber from non-owners when allowWhatsapp is false", async () => {
    aspirant.allowWhatsapp = false;
    const res = await service.findOne(ASPIRANT_ID, { id: 999, role: "voter" });
    expect(res.whatsappNumber).toBeUndefined();

    const ownerRes = await service.findOne(ASPIRANT_ID, {
      id: OWNER_USER_ID,
      role: "aspirant",
    });
    expect(ownerRes.whatsappNumber).toBe("9876543210");
  });

  it("includes both phone and whatsapp for everyone when both flags are true", async () => {
    aspirant.allowPhone = true;
    aspirant.allowWhatsapp = true;
    const res = await service.findOne(ASPIRANT_ID);
    expect(res.phone).toBe("9876543210");
    expect(res.whatsappNumber).toBe("9876543210");
  });
});

describe("AspirantsService — register()", () => {
  it("rejects an unauthenticated caller", async () => {
    const service = buildService();
    await expect(service.register({}, undefined)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("rejects a phone already used by another user", async () => {
    const service = buildService({
      usersService: { findByPhone: jest.fn(async () => ({ id: 999 })) },
    });
    await expect(
      service.register({ phone: "9876543210" }, { id: 1 }),
    ).rejects.toThrow("Phone already in use");
  });

  it("rejects a whatsapp number already used by another aspirant", async () => {
    const service = buildService({
      usersService: { findByPhone: jest.fn(async () => null) },
      repo: { findOne: jest.fn(async () => ({ userId: 999 })) },
    });
    await expect(
      service.register({ whatsappNumber: "9876543210" }, { id: 1 }),
    ).rejects.toThrow("WhatsApp number already in use");
  });

  it("rejects a user who already has an active aspirant profile", async () => {
    const service = buildService({
      usersService: { findByPhone: jest.fn(async () => null) },
    });
    jest.spyOn(service, "findByUserId").mockResolvedValue({ isActive: true });
    await expect(service.register({}, { id: 1 })).rejects.toThrow(
      "already has an active aspirant profile",
    );
  });

  it("creates the aspirant when all checks pass", async () => {
    const created = { id: 7, name: "New Aspirant" };
    const service = buildService({
      usersService: { findByPhone: jest.fn(async () => null) },
    });
    jest.spyOn(service, "findByUserId").mockResolvedValue(null);
    const createSpy = jest.spyOn(service, "create").mockResolvedValue(created);

    const dto = { name: "New Aspirant" };
    const user = { id: 1 };
    await expect(service.register(dto, user)).resolves.toBe(created);
    expect(createSpy).toHaveBeenCalledWith(dto, user);
  });
});

describe("AspirantsService — updatePermissions()", () => {
  it("rejects when the aspirant is not owned by the caller", async () => {
    const service = buildService({
      repo: { findOne: jest.fn(async () => null) },
    });
    await expect(
      service.updatePermissions(54, 999, { allowPhone: false }),
    ).rejects.toThrow(NotFoundException);
  });

  it("updates only the provided flags and returns them", async () => {
    const aspirant: any = { id: 54, userId: 56, allowPhone: true, allowWhatsapp: true, allowChat: true };
    const save = jest.fn(async (a: any) => a);
    const service = buildService({
      repo: { findOne: jest.fn(async () => aspirant), save },
    });

    const result = await service.updatePermissions(54, 56, { allowPhone: false });

    expect(aspirant.allowPhone).toBe(false);
    expect(aspirant.allowWhatsapp).toBe(true); // untouched
    expect(save).toHaveBeenCalledWith(aspirant);
    expect(result).toEqual({ allowPhone: false, allowWhatsapp: true, allowChat: true });
  });
});

describe("AspirantsService — withdrawAspirant()", () => {
  it("rejects when the user has no aspirant profile", async () => {
    const service = buildService({
      repo: { findOne: jest.fn(async () => null) },
    });
    await expect(service.withdrawAspirant(1)).rejects.toThrow(NotFoundException);
  });

  it("blocks withdrawal while voting is open for the same election", async () => {
    const service = buildService({
      repo: { findOne: jest.fn(async () => ({ id: 5, electionId: 10 })) },
      votesService: {
        isVotingAllowed: jest.fn(async () => true),
        getActiveVotingWindow: jest.fn(async () => ({ electionId: 10 })),
      },
    });
    await expect(service.withdrawAspirant(1)).rejects.toThrow(
      "Cannot withdraw candidacy while voting is open",
    );
  });

  it("withdraws and reverts the user to voter when voting is not open", async () => {
    const update = jest.fn(async () => ({}));
    const setRole = jest.fn(async () => ({}));
    const clearPhone = jest.fn(async () => ({}));
    const service = buildService({
      repo: { findOne: jest.fn(async () => ({ id: 5, electionId: 10 })), update },
      votesService: {
        isVotingAllowed: jest.fn(async () => false),
        getActiveVotingWindow: jest.fn(async () => null),
      },
      usersService: { setRole, clearPhone },
    });

    const result = await service.withdrawAspirant(1);

    expect(update).toHaveBeenCalledWith(5, expect.objectContaining({ isActive: false }));
    expect(setRole).toHaveBeenCalledWith(1, "voter");
    expect(clearPhone).toHaveBeenCalledWith(1);
    expect(result).toEqual(
      expect.objectContaining({ message: expect.stringContaining("withdrawn") }),
    );
  });
});

describe("AspirantsService — rateContact()", () => {
  it("rejects when the aspirant does not exist", async () => {
    const service = buildService({ repo: { findOne: jest.fn(async () => null) } });
    await expect(service.rateContact(54, 57, 5)).rejects.toThrow(NotFoundException);
  });

  it("rejects when the voter has not contacted the aspirant", async () => {
    const service = buildService({
      repo: { findOne: jest.fn(async () => ({ id: 54 })) },
      interactionRepo: { findOne: jest.fn(async () => null) }, // never pressed
    });
    await expect(service.rateContact(54, 57, 5)).rejects.toThrow(
      "only after contacting",
    );
  });

  it("creates the rating when the voter has contacted and not yet rated", async () => {
    const create = jest.fn((x: any) => x);
    const save = jest.fn(async (x: any) => x);
    const service = buildService({
      repo: { findOne: jest.fn(async () => ({ id: 54 })) },
      interactionRepo: { findOne: jest.fn(async () => ({ isPhoneCall: true })) },
      activityRatingRepo: { findOne: jest.fn(async () => null), create, save },
    });

    await service.rateContact(54, 57, 5);

    expect(create).toHaveBeenCalledWith({
      type: "contact",
      activityId: 54,
      aspirantId: 54,
      voterId: 57,
      rating: 5,
    });
    expect(save).toHaveBeenCalled();
  });

  it("rejects a second rating (one-time only)", async () => {
    const create = jest.fn();
    const service = buildService({
      repo: { findOne: jest.fn(async () => ({ id: 54 })) },
      interactionRepo: { findOne: jest.fn(async () => ({ isPhoneCall: true })) },
      activityRatingRepo: {
        findOne: jest.fn(async () => ({ id: 1, rating: 4 })), // already rated
        create,
      },
    });

    await expect(service.rateContact(54, 57, 5)).rejects.toThrow("already rated");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("AspirantsService — createBooking() (meeting request)", () => {
  it("rejects when the aspirant does not exist", async () => {
    const service = buildService({ repo: { findOne: jest.fn(async () => null) } });
    await expect(service.createBooking(54, 57, "hi", 123)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("creates a pending booking with the voter's details and persists it", async () => {
    const create = jest.fn((x: any) => x);
    const save = jest.fn(async (x: any) => ({ id: 1, ...x }));
    const service = buildService({
      repo: { findOne: jest.fn(async () => ({ id: 54 })) },
      bookingRepo: { create, save },
    });

    const result = await service.createBooking(54, 57, "Please meet", 1780000000000);

    expect(create).toHaveBeenCalledWith({
      aspirantId: 54,
      voterId: 57,
      message: "Please meet",
      preferredAt: 1780000000000,
      status: "pending",
    });
    expect(save).toHaveBeenCalled();
    expect(result).toMatchObject({ id: 1, status: "pending" });
  });
});

describe("AspirantsService — createVisit()", () => {
  it("rejects when the aspirant does not exist", async () => {
    const service = buildService({ repo: { findOne: jest.fn(async () => null) } });
    await expect(
      service.createVisit(54, 1780000000000, undefined, undefined, undefined, undefined, undefined, {
        id: 57,
        role: "voter",
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects a caller who does not own the aspirant", async () => {
    const service = buildService({
      repo: { findOne: jest.fn(async () => ({ id: 54, userId: 999 })) },
    });
    await expect(
      service.createVisit(54, 1780000000000, undefined, undefined, undefined, undefined, undefined, {
        id: 57,
        role: "voter",
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("creates and saves the visit (notification is best-effort)", async () => {
    const create = jest.fn((x: any) => x);
    const save = jest.fn(async (x: any) => ({ id: 9, ...x }));
    const service = buildService({
      repo: { findOne: jest.fn(async () => ({ id: 54, userId: 57 })) },
      visitRepo: { create, save },
      // The post-save notify path throws on the noop deps but is swallowed —
      // the saved visit is still returned.
    });

    const result = await service.createVisit(
      54,
      1780000000000,
      1780003600000,
      "Door-to-door",
      "Meet voters",
      "Ward 5",
      "https://maps.example/x",
      { id: 57, role: "voter" },
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        aspirantId: 54,
        startTime: 1780000000000,
        title: "Door-to-door",
        location: "Ward 5",
      }),
    );
    expect(save).toHaveBeenCalled();
    expect(result).toMatchObject({ id: 9, title: "Door-to-door" });
  });
});

describe("AspirantsService — completeMeeting()", () => {
  it("rejects a caller who does not own the aspirant", async () => {
    const service = buildService({
      repo: { findOne: jest.fn(async () => ({ id: 54, userId: 999 })) },
    });
    await expect(
      service.completeMeeting(54, 10, "done", { id: 57, role: "voter" }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects when the meeting does not exist for the owner", async () => {
    const service = buildService({
      repo: { findOne: jest.fn(async () => ({ id: 54, userId: 57 })) },
      meetingRepo: { findOne: jest.fn(async () => null) },
    });
    await expect(
      service.completeMeeting(54, 10, "done", { id: 57, role: "voter" }),
    ).rejects.toThrow(NotFoundException);
  });

  it("marks the meeting complete with notes for the owner", async () => {
    const meeting: any = { id: 10, aspirantId: 54, completed: false, notes: null };
    const save = jest.fn(async (x: any) => x);
    const service = buildService({
      repo: { findOne: jest.fn(async () => ({ id: 54, userId: 57 })) },
      meetingRepo: {
        findOne: jest.fn(async () => meeting),
        save,
      },
    });

    await service.completeMeeting(54, 10, "All done", { id: 57, role: "voter" });

    expect(meeting.completed).toBe(true);
    expect(meeting.notes).toBe("All done");
    expect(save).toHaveBeenCalledWith(meeting);
  });
});

describe("AspirantsService — deleteVisit()", () => {
  it("rejects a caller who does not own the aspirant", async () => {
    const service = buildService({
      repo: { findOne: jest.fn(async () => ({ id: 54, userId: 999 })) },
    });
    await expect(
      service.deleteVisit(54, 7, { id: 57, role: "voter" }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("deletes the visit for the owner", async () => {
    const deleteFn = jest.fn(async () => ({}));
    const service = buildService({
      repo: { findOne: jest.fn(async () => ({ id: 54, userId: 57 })) },
      visitRepo: {
        findOne: jest.fn(async () => ({ id: 7, aspirantId: 54 })),
        delete: deleteFn,
      },
    });

    const result = await service.deleteVisit(54, 7, { id: 57, role: "voter" });

    expect(deleteFn).toHaveBeenCalledWith(7);
    expect(result).toEqual({ deleted: 1 });
  });

  it("allows an admin to delete any aspirant's visit", async () => {
    const deleteFn = jest.fn(async () => ({}));
    const service = buildService({
      repo: { findOne: jest.fn(async () => ({ id: 54, userId: 999 })) },
      visitRepo: {
        findOne: jest.fn(async () => ({ id: 7, aspirantId: 54 })),
        delete: deleteFn,
      },
    });

    const result = await service.deleteVisit(54, 7, { id: 1, role: "admin" });

    expect(deleteFn).toHaveBeenCalledWith(7);
    expect(result).toEqual({ deleted: 1 });
  });
});

describe("AspirantsService — deleteMeetings() ownership", () => {
  it("rejects a non-admin caller who does not own all meetings", async () => {
    const service = buildService({
      repo: { findByIds: jest.fn() },
      meetingRepo: {
        findByIds: jest.fn(async () => [{ id: 10, aspirantId: 99 }]),
      },
    });
    jest.spyOn(service, "findByUserId").mockResolvedValue({ id: 54 });

    await expect(
      service.deleteMeetings([10], { id: 57, role: "voter" }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("deletes meetings the caller owns", async () => {
    const deleteFn = jest.fn(async () => ({}));
    const service = buildService({
      meetingRepo: {
        findByIds: jest.fn(async () => [{ id: 10, aspirantId: 54 }]),
        delete: deleteFn,
      },
    });
    jest.spyOn(service, "findByUserId").mockResolvedValue({ id: 54 });

    const result = await service.deleteMeetings([10], { id: 57, role: "voter" });

    expect(deleteFn).toHaveBeenCalledWith([10]);
    expect(result).toEqual({ deleted: 1 });
  });
});

describe("AspirantsService — listBookingsForAspirant() ownership", () => {
  it("rejects a caller who does not own the aspirant", async () => {
    const service = buildService({
      repo: { findOne: jest.fn(async () => ({ id: 54, userId: 999 })) },
    });
    await expect(
      service.listBookingsForAspirant(54, { id: 57, role: "voter" }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("returns bookings for the owner", async () => {
    const service = buildService({
      repo: { findOne: jest.fn(async () => ({ id: 54, userId: 57 })) },
      bookingRepo: { find: jest.fn(async () => []) },
    });

    const result = await service.listBookingsForAspirant(54, {
      id: 57,
      role: "voter",
    });

    expect(result).toEqual([]);
  });
});

describe("AspirantsService — setMeetingLinkForMultiple() ownership", () => {
  it("rejects a non-admin caller who does not own every aspirant id", async () => {
    const service = buildService({
      repo: {
        findByIds: jest.fn(async () => [{ id: 54 }, { id: 99 }]),
      },
    });
    jest.spyOn(service, "findByUserId").mockResolvedValue({ id: 54 });

    await expect(
      service.setMeetingLinkForMultiple(
        [54, 99],
        "https://meet.example/x",
        1780000000000,
        undefined,
        undefined,
        undefined,
        undefined,
        { id: 57, role: "voter" },
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe("AspirantsService — respondToVisit()", () => {
  it("rejects when the visit does not exist", async () => {
    const service = buildService({
      visitRepo: { findOne: jest.fn(async () => null) },
    });
    await expect(service.respondToVisit(7, 57, true)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("creates a new response when the voter has not responded", async () => {
    const create = jest.fn((x: any) => x);
    const save = jest.fn(async (x: any) => x);
    const service = buildService({
      visitRepo: { findOne: jest.fn(async () => ({ id: 7 })) },
      visitResponseRepo: { findOne: jest.fn(async () => null), create, save },
    });

    await service.respondToVisit(7, 57, true);

    expect(create).toHaveBeenCalledWith({ visitId: 7, voterId: 57, attending: true });
    expect(save).toHaveBeenCalled();
  });

  it("updates the existing response instead of duplicating", async () => {
    const existing: any = { visitId: 7, voterId: 57, attending: true };
    const create = jest.fn();
    const save = jest.fn(async (x: any) => x);
    const service = buildService({
      visitRepo: { findOne: jest.fn(async () => ({ id: 7 })) },
      visitResponseRepo: { findOne: jest.fn(async () => existing), create, save },
    });

    await service.respondToVisit(7, 57, false);

    expect(existing.attending).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(existing);
  });
});

describe("AspirantsService — respondToMeeting()", () => {
  it("rejects when the meeting does not exist", async () => {
    const service = buildService({
      meetingRepo: { findOne: jest.fn(async () => null) },
    });
    await expect(service.respondToMeeting(10, 57, true)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("records the response and returns refreshed attendance counts", async () => {
    const create = jest.fn((x: any) => x);
    const save = jest.fn(async (x: any) => x);
    const service = buildService({
      meetingRepo: { findOne: jest.fn(async () => ({ id: 10 })) },
      meetingResponseRepo: {
        findOne: jest.fn(async () => null),
        create,
        save,
        createQueryBuilder: () =>
          qbReturning([{ meetingId: 10, attending: 3, notAttending: 1 }]),
      },
    });

    const result = await service.respondToMeeting(10, 57, true);

    expect(create).toHaveBeenCalledWith({
      meetingId: 10,
      voterId: 57,
      attending: true,
    });
    expect(result).toEqual({
      id: 10,
      meetingId: 10,
      attending: true,
      attendingCount: 3,
      notAttendingCount: 1,
    });
  });
});

describe("AspirantsService — rateMeeting()", () => {
  it("rejects when the meeting does not exist", async () => {
    const service = buildService({
      meetingRepo: { findOne: jest.fn(async () => null) },
    });
    await expect(service.rateMeeting(10, 57, 4)).rejects.toThrow(NotFoundException);
  });

  it("creates a meeting rating tied to the meeting's aspirant", async () => {
    const create = jest.fn((x: any) => x);
    const save = jest.fn(async (x: any) => x);
    const service = buildService({
      meetingRepo: { findOne: jest.fn(async () => ({ id: 10, aspirantId: 54 })) },
      activityRatingRepo: { findOne: jest.fn(async () => null), create, save },
    });

    await service.rateMeeting(10, 57, 4);

    expect(create).toHaveBeenCalledWith({
      type: "meeting",
      activityId: 10,
      aspirantId: 54,
      voterId: 57,
      rating: 4,
    });
    expect(save).toHaveBeenCalled();
  });

  it("updates an existing meeting rating (re-rating is allowed)", async () => {
    const existing: any = { type: "meeting", activityId: 10, voterId: 57, rating: 2 };
    const create = jest.fn();
    const save = jest.fn(async (x: any) => x);
    const service = buildService({
      meetingRepo: { findOne: jest.fn(async () => ({ id: 10, aspirantId: 54 })) },
      activityRatingRepo: { findOne: jest.fn(async () => existing), create, save },
    });

    await service.rateMeeting(10, 57, 5);

    expect(existing.rating).toBe(5);
    expect(create).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(existing);
  });
});

describe("AspirantsService — rateVisit()", () => {
  it("rejects when the visit does not exist", async () => {
    const service = buildService({
      visitRepo: { findOne: jest.fn(async () => null) },
    });
    await expect(service.rateVisit(7, 57, 4)).rejects.toThrow(NotFoundException);
  });

  it("creates a visit rating tied to the visit's aspirant", async () => {
    const create = jest.fn((x: any) => x);
    const save = jest.fn(async (x: any) => x);
    const service = buildService({
      visitRepo: { findOne: jest.fn(async () => ({ id: 7, aspirantId: 54 })) },
      activityRatingRepo: { findOne: jest.fn(async () => null), create, save },
    });

    await service.rateVisit(7, 57, 4);

    expect(create).toHaveBeenCalledWith({
      type: "visit",
      activityId: 7,
      aspirantId: 54,
      voterId: 57,
      rating: 4,
    });
    expect(save).toHaveBeenCalled();
  });

  it("updates an existing visit rating (re-rating is allowed)", async () => {
    const existing: any = { type: "visit", activityId: 7, voterId: 57, rating: 1 };
    const create = jest.fn();
    const save = jest.fn(async (x: any) => x);
    const service = buildService({
      visitRepo: { findOne: jest.fn(async () => ({ id: 7, aspirantId: 54 })) },
      activityRatingRepo: { findOne: jest.fn(async () => existing), create, save },
    });

    await service.rateVisit(7, 57, 3);

    expect(existing.rating).toBe(3);
    expect(create).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(existing);
  });
});
