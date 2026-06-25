import "reflect-metadata";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { WardsService } from "./wards.service";

/**
 * Behaviour unit tests for WardsService. The service is constructed with mock
 * TypeORM repositories (no DB / no server). Query builders return a small
 * chainable stub whose terminal resolves to fixed rows. Each test locks in a
 * specific business rule, the exact fields written, or the thrown exception.
 */

// Constructor arg order mirrors the real service: (wardRepo, meetingRepo).
function buildService(deps: { repo?: any; meetingRepo?: any } = {}): any {
  const noop: any = {};
  return new WardsService(deps.repo ?? noop, deps.meetingRepo ?? noop);
}

// Minimal chainable QueryBuilder stub. Each listed method returns `qb`; the
// terminal methods resolve to the supplied rows/row so the code's mapping runs.
function qbStub(terminals: Record<string, any> = {}): any {
  const qb: any = {};
  for (const m of [
    "select",
    "addSelect",
    "where",
    "andWhere",
    "orWhere",
    "groupBy",
    "orderBy",
    "leftJoin",
    "leftJoinAndSelect",
  ]) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getOne = jest.fn(async () => terminals.getOne ?? null);
  qb.getMany = jest.fn(async () => terminals.getMany ?? []);
  qb.getRawMany = jest.fn(async () => terminals.getRawMany ?? []);
  return qb;
}

describe("WardsService — create()", () => {
  it("rejects a ward whose number already exists", async () => {
    const service = buildService({
      repo: { findOne: jest.fn(async () => ({ id: 1, number: "42" })) },
    });
    await expect(service.create({ number: "42", name: "X" })).rejects.toThrow(
      ConflictException,
    );
  });

  it("creates a ward and fills geographic defaults with 'N/A' when omitted", async () => {
    const create = jest.fn((v: any) => v);
    const save = jest.fn(async (v: any) => ({ id: 9, ...v }));
    const service = buildService({
      repo: { findOne: jest.fn(async () => null), create, save },
    });

    const result = await service.create({ number: "42", name: "Jayanagar" });

    expect(create).toHaveBeenCalledWith({
      number: "42",
      name: "Jayanagar",
      state: "N/A",
      parliamentary: "N/A",
      assembly: "N/A",
      zone: "N/A",
    });
    expect(save).toHaveBeenCalled();
    expect(result).toMatchObject({ id: 9, number: "42", state: "N/A" });
  });

  it("preserves provided geographic fields instead of defaulting them", async () => {
    const create = jest.fn((v: any) => v);
    const service = buildService({
      repo: {
        findOne: jest.fn(async () => null),
        create,
        save: jest.fn(async (v: any) => v),
      },
    });

    await service.create({
      number: "42",
      name: "Jayanagar",
      state: "Karnataka",
      parliamentary: "Bangalore South",
      assembly: "Jayanagar",
      zone: "South Zone",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "Karnataka",
        parliamentary: "Bangalore South",
        assembly: "Jayanagar",
        zone: "South Zone",
      }),
    );
  });
});

describe("WardsService — findAll()", () => {
  it("returns all wards (no filter) when query is absent", async () => {
    const all = [{ id: 1 }, { id: 2 }];
    const find = jest.fn(async () => all);
    const service = buildService({ repo: { find } });

    await expect(service.findAll()).resolves.toBe(all);
    expect(find).toHaveBeenCalledWith();
  });

  it("returns all wards when query has no geographic filters set", async () => {
    const find = jest.fn(async () => []);
    const service = buildService({ repo: { find } });

    await service.findAll({} as any);
    expect(find).toHaveBeenCalledWith();
  });

  it("filters by the provided geographic fields, ordered by number ASC", async () => {
    const find = jest.fn(async () => []);
    const service = buildService({ repo: { find } });

    await service.findAll({
      state: "Karnataka",
      assembly: "Jayanagar",
    } as any);

    expect(find).toHaveBeenCalledWith({
      where: { state: "Karnataka", assembly: "Jayanagar" },
      order: { number: "ASC" },
    });
  });
});

describe("WardsService — findOne()", () => {
  it("returns the ward when found", async () => {
    const ward = { id: 5, number: "5" };
    const service = buildService({
      repo: { findOne: jest.fn(async () => ward) },
    });
    await expect(service.findOne(5)).resolves.toBe(ward);
  });

  it("throws NotFoundException when the ward is missing", async () => {
    const service = buildService({
      repo: { findOne: jest.fn(async () => null) },
    });
    await expect(service.findOne(5)).rejects.toThrow(NotFoundException);
  });
});

describe("WardsService — update()", () => {
  it("throws NotFoundException when the ward does not exist", async () => {
    const service = buildService({
      repo: { findOne: jest.fn(async () => null) },
    });
    await expect(service.update(5, { name: "New" })).rejects.toThrow(
      NotFoundException,
    );
  });

  it("applies only the provided fields and leaves the rest untouched", async () => {
    const ward: any = {
      id: 5,
      number: "5",
      name: "Old",
      state: "Karnataka",
      zone: "South",
    };
    const save = jest.fn(async (w: any) => w);
    const service = buildService({
      repo: { findOne: jest.fn(async () => ward), save },
    });

    const result = await service.update(5, { name: "New", zone: "North" });

    expect(ward.name).toBe("New");
    expect(ward.zone).toBe("North");
    expect(ward.state).toBe("Karnataka"); // untouched
    expect(ward.number).toBe("5"); // untouched
    expect(save).toHaveBeenCalledWith(ward);
    expect(result).toBe(ward);
  });
});

describe("WardsService — delete()", () => {
  it("throws NotFoundException when the ward does not exist", async () => {
    const service = buildService({
      repo: { findOne: jest.fn(async () => null) },
    });
    await expect(service.delete(5)).rejects.toThrow(NotFoundException);
  });

  it("removes the ward and returns a descriptive message", async () => {
    const ward = { id: 5, number: "42", name: "Jayanagar" };
    const remove = jest.fn(async () => ward);
    const service = buildService({
      repo: { findOne: jest.fn(async () => ward), remove },
    });

    const result = await service.delete(5);

    expect(remove).toHaveBeenCalledWith(ward);
    expect(result).toEqual({ message: "Ward '42 - Jayanagar' deleted" });
  });
});

describe("WardsService — findByNumber() / findByName()", () => {
  it("findByNumber returns the matching ward", async () => {
    const ward = { id: 5, number: "42" };
    const service = buildService({
      repo: { findOne: jest.fn(async () => ward) },
    });
    await expect(service.findByNumber("42")).resolves.toBe(ward);
  });

  it("findByNumber throws NotFoundException when none matches", async () => {
    const service = buildService({
      repo: { findOne: jest.fn(async () => null) },
    });
    await expect(service.findByNumber("42")).rejects.toThrow(NotFoundException);
  });

  it("findByName matches case/whitespace-insensitively via the query builder", async () => {
    const ward = { id: 5, name: "Jayanagar" };
    const qb = qbStub({ getOne: ward });
    const service = buildService({
      repo: { createQueryBuilder: jest.fn(() => qb) },
    });

    await expect(service.findByName("  Jayanagar  ")).resolves.toBe(ward);
    // trimmed name is bound into the parameterized query
    expect(qb.where).toHaveBeenCalledWith(expect.any(String), {
      name: "Jayanagar",
    });
  });

  it("findByName throws NotFoundException (with the name) when none matches", async () => {
    const qb = qbStub({ getOne: null });
    const service = buildService({
      repo: { createQueryBuilder: jest.fn(() => qb) },
    });
    await expect(service.findByName("Nowhere")).rejects.toThrow(
      "Ward not found with name: Nowhere",
    );
  });
});

describe("WardsService — listByVoterCount()", () => {
  it("maps raw aggregate rows into numeric counts and shape", async () => {
    const qb = qbStub({
      getRawMany: [
        {
          id: "5",
          number: "42",
          name: "Jayanagar",
          voter_count: "10",
          aspirant_record_count: "2",
          user_aspirant_count: "2",
          total_count: "12",
        },
      ],
    });
    const service = buildService({
      repo: { createQueryBuilder: jest.fn(() => qb) },
    });

    const result = await service.listByVoterCount();

    expect(result).toEqual([
      {
        id: 5,
        number: "42",
        name: "Jayanagar",
        voterOnlyCount: 10,
        aspirantRecordCount: 2,
        userAspirantCount: 2,
        voterCount: 12, // combined total, kept for backward compatibility
      },
    ]);
  });
});

describe("WardsService — search()", () => {
  it("adds a name/number ILIKE filter when a query string is provided", async () => {
    const qb = qbStub({ getMany: [] });
    const service = buildService({
      repo: { createQueryBuilder: jest.fn(() => qb) },
    });

    await service.search("jaya");

    expect(qb.where).toHaveBeenCalledWith(expect.any(String), { q: "%jaya%" });
    expect(qb.getMany).toHaveBeenCalled();
  });

  it("does not add a filter when no query string is provided", async () => {
    const qb = qbStub({ getMany: [] });
    const service = buildService({
      repo: { createQueryBuilder: jest.fn(() => qb) },
    });

    await service.search();

    expect(qb.where).not.toHaveBeenCalled();
    expect(qb.getMany).toHaveBeenCalled();
  });
});

describe("WardsService — createMeeting()", () => {
  it("throws NotFoundException when the target ward does not exist", async () => {
    const service = buildService({
      repo: { findOne: jest.fn(async () => null) },
    });
    await expect(
      service.createMeeting({ wardId: 5, title: "T" } as any, 99),
    ).rejects.toThrow(NotFoundException);
  });

  it("creates an active meeting with creator, parsed date, and ward link", async () => {
    const create = jest.fn((v: any) => v);
    const save = jest.fn(async (v: any) => ({ id: 1, ...v }));
    const service = buildService({
      repo: { findOne: jest.fn(async () => ({ id: 5 })) },
      meetingRepo: { create, save },
    });

    const result = await service.createMeeting(
      {
        wardId: 5,
        title: "Town hall",
        description: "Agenda",
        meetingLink: "https://meet.example/x",
        scheduledAt: "2026-07-01T10:00:00.000Z",
      } as any,
      99,
    );

    expect(create).toHaveBeenCalledWith({
      wardId: 5,
      title: "Town hall",
      description: "Agenda",
      meetingLink: "https://meet.example/x",
      scheduledAt: new Date("2026-07-01T10:00:00.000Z"),
      createdById: 99,
      isActive: true,
    });
    expect(save).toHaveBeenCalled();
    expect(result).toMatchObject({ id: 1, isActive: true });
  });

  it("leaves scheduledAt undefined when not provided", async () => {
    const create = jest.fn((v: any) => v);
    const service = buildService({
      repo: { findOne: jest.fn(async () => ({ id: 5 })) },
      meetingRepo: { create, save: jest.fn(async (v: any) => v) },
    });

    await service.createMeeting({ wardId: 5, title: "T" } as any, 99);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: undefined, createdById: 99 }),
    );
  });
});

describe("WardsService — getAllMeetings()", () => {
  it("returns all meetings with no filters when none are supplied", async () => {
    const qb = qbStub({ getMany: [{ id: 1 }] });
    const service = buildService({
      meetingRepo: { createQueryBuilder: jest.fn(() => qb) },
    });

    await expect(service.getAllMeetings()).resolves.toEqual([{ id: 1 }]);
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it("applies wardId and isActive filters when provided", async () => {
    const qb = qbStub({ getMany: [] });
    const service = buildService({
      meetingRepo: { createQueryBuilder: jest.fn(() => qb) },
    });

    await service.getAllMeetings(5, true);

    expect(qb.andWhere).toHaveBeenCalledWith("meeting.wardId = :wardId", {
      wardId: 5,
    });
    expect(qb.andWhere).toHaveBeenCalledWith("meeting.isActive = :isActive", {
      isActive: true,
    });
  });
});

describe("WardsService — getMeetingById()", () => {
  it("returns the meeting with relations when found", async () => {
    const meeting = { id: 1 };
    const findOne = jest.fn(async () => meeting);
    const service = buildService({ meetingRepo: { findOne } });

    await expect(service.getMeetingById(1)).resolves.toBe(meeting);
    expect(findOne).toHaveBeenCalledWith({
      where: { id: 1 },
      relations: { ward: true, createdBy: true },
    });
  });

  it("throws NotFoundException when the meeting is missing", async () => {
    const service = buildService({
      meetingRepo: { findOne: jest.fn(async () => null) },
    });
    await expect(service.getMeetingById(1)).rejects.toThrow(NotFoundException);
  });
});

describe("WardsService — updateMeeting()", () => {
  it("throws NotFoundException when the meeting does not exist", async () => {
    const service = buildService({
      meetingRepo: { findOne: jest.fn(async () => null) },
    });
    await expect(service.updateMeeting(1, { title: "X" })).rejects.toThrow(
      NotFoundException,
    );
  });

  it("patches only the provided fields and parses scheduledAt into a Date", async () => {
    const meeting: any = {
      id: 1,
      title: "Old",
      description: "Desc",
      isActive: true,
    };
    const save = jest.fn(async (m: any) => m);
    const service = buildService({
      meetingRepo: { findOne: jest.fn(async () => meeting), save },
    });

    await service.updateMeeting(1, {
      title: "New",
      scheduledAt: "2026-07-01T10:00:00.000Z",
      isActive: false,
    } as any);

    expect(meeting.title).toBe("New");
    expect(meeting.description).toBe("Desc"); // untouched
    expect(meeting.isActive).toBe(false);
    expect(meeting.scheduledAt).toEqual(new Date("2026-07-01T10:00:00.000Z"));
    expect(save).toHaveBeenCalledWith(meeting);
  });
});

describe("WardsService — completeMeeting()", () => {
  it("throws NotFoundException when the meeting does not exist", async () => {
    const service = buildService({
      meetingRepo: { findOne: jest.fn(async () => null) },
    });
    await expect(service.completeMeeting(1, "notes")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("marks the meeting completed with notes and a completion timestamp", async () => {
    const meeting: any = { id: 1, completed: false };
    const save = jest.fn(async (m: any) => m);
    const service = buildService({
      meetingRepo: { findOne: jest.fn(async () => meeting), save },
    });

    const before = Date.now();
    await service.completeMeeting(1, "All done");
    const after = Date.now();

    expect(meeting.completed).toBe(true);
    expect(meeting.notes).toBe("All done");
    expect(meeting.completedAt).toBeInstanceOf(Date);
    const ts = meeting.completedAt.getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
    expect(save).toHaveBeenCalledWith(meeting);
  });
});

describe("WardsService — deleteMeeting()", () => {
  it("throws NotFoundException when the meeting does not exist", async () => {
    const service = buildService({
      meetingRepo: { findOne: jest.fn(async () => null) },
    });
    await expect(service.deleteMeeting(1)).rejects.toThrow(NotFoundException);
  });

  it("removes the meeting when it exists", async () => {
    const meeting = { id: 1 };
    const remove = jest.fn(async () => undefined);
    const service = buildService({
      meetingRepo: { findOne: jest.fn(async () => meeting), remove },
    });

    await expect(service.deleteMeeting(1)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith(meeting);
  });
});
