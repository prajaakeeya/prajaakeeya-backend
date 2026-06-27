import "reflect-metadata";
import { AdminService } from "./admin.service";

function buildService(overrides: Record<string, any> = {}): AdminService {
  const noop: any = {};
  return new AdminService(
    overrides.wardsService ?? noop,
    overrides.aspirantsService ?? noop,
    overrides.votesService ?? noop,
    overrides.usersService ?? noop,
    overrides.electionsService ?? noop,
    overrides.parliamentaryService ?? noop,
    overrides.assemblyService ?? noop,
    overrides.municipalityService ?? noop,
    overrides.gramaPanchayatService ?? noop,
  );
}

// ── dashboard ─────────────────────────────────────────────────────────────────

describe("AdminService — dashboard()", () => {
  it("aggregates counts from all four services and returns totals", async () => {
    const service = buildService({
      wardsService: { findAll: jest.fn(async () => [{}, {}, {}]) },
      aspirantsService: { count: jest.fn(async () => 12) },
      votesService: { count: jest.fn(async () => 300) },
      usersService: { countRegistered: jest.fn(async () => 500) },
    });

    const result = await service.dashboard();

    expect(result).toEqual({
      totals: { wards: 3, aspirants: 12, votes: 300, citizens: 500 },
    });
  });

  it("runs all four lookups concurrently (all called exactly once)", async () => {
    const findAll = jest.fn(async () => []);
    const count = jest.fn(async () => 0);
    const countVotes = jest.fn(async () => 0);
    const countRegistered = jest.fn(async () => 0);

    const service = buildService({
      wardsService: { findAll },
      aspirantsService: { count },
      votesService: { count: countVotes },
      usersService: { countRegistered },
    });

    await service.dashboard();

    expect(findAll).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledTimes(1);
    expect(countVotes).toHaveBeenCalledTimes(1);
    expect(countRegistered).toHaveBeenCalledTimes(1);
  });
});

// ── User management ───────────────────────────────────────────────────────────

describe("AdminService — user management delegation", () => {
  it("blockUser delegates to usersService.blockUser", async () => {
    const blockUser = jest.fn(async () => ({ blocked: true }));
    const service = buildService({ usersService: { blockUser } });

    const result = await service.blockUser(42);

    expect(blockUser).toHaveBeenCalledWith(42);
    expect(result).toEqual({ blocked: true });
  });

  it("unblockUser delegates to usersService.unblockUser", async () => {
    const unblockUser = jest.fn(async () => ({ blocked: false }));
    const service = buildService({ usersService: { unblockUser } });

    await service.unblockUser(42);

    expect(unblockUser).toHaveBeenCalledWith(42);
  });

  it("deleteUser delegates to usersService.deleteUser", async () => {
    const deleteUser = jest.fn(async () => ({ deleted: true }));
    const service = buildService({ usersService: { deleteUser } });

    await service.deleteUser(7);

    expect(deleteUser).toHaveBeenCalledWith(7);
  });

  it("getAllUsers returns whatever usersService returns", async () => {
    const users = [{ id: 1 }, { id: 2 }];
    const service = buildService({
      usersService: { getAllUsers: jest.fn(async () => users) },
    });

    expect(await service.getAllUsers()).toBe(users);
  });

  it("getUsersByWard passes wardId and pagination params through", async () => {
    const getUsersByWard = jest.fn(async () => []);
    const service = buildService({ usersService: { getUsersByWard } });

    await service.getUsersByWard(5, 2, 10);

    expect(getUsersByWard).toHaveBeenCalledWith(5, 2, 10);
  });
});

// ── Report management ─────────────────────────────────────────────────────────

describe("AdminService — report management delegation", () => {
  it("getAllReports passes status + pagination to usersService", async () => {
    const getAllReports = jest.fn(async () => []);
    const service = buildService({ usersService: { getAllReports } });

    await service.getAllReports("pending", 1, 20);

    expect(getAllReports).toHaveBeenCalledWith("pending", 1, 20);
  });

  it("updateReportStatus delegates all four params", async () => {
    const updateReportStatus = jest.fn(async () => ({ id: 1, status: "resolved" }));
    const service = buildService({ usersService: { updateReportStatus } });

    const result = await service.updateReportStatus(1, "resolved", "looks good", 99);

    expect(updateReportStatus).toHaveBeenCalledWith(1, "resolved", "looks good", 99);
    expect(result).toMatchObject({ status: "resolved" });
  });
});

// ── Meetings ──────────────────────────────────────────────────────────────────

describe("AdminService — meetings", () => {
  it("getAllMeetings without wardNumber delegates directly", async () => {
    const getAllMeetings = jest.fn(async () => []);
    const service = buildService({
      wardsService: { getAllMeetings },
    });

    await service.getAllMeetings(undefined, true);

    expect(getAllMeetings).toHaveBeenCalledWith(undefined, true);
  });

  it("getAllMeetings with wardNumber resolves ward first then queries", async () => {
    const getAllMeetings = jest.fn(async () => []);
    const service = buildService({
      wardsService: {
        findByNumber: jest.fn(async () => ({ id: 88 })),
        getAllMeetings,
      },
    });

    await service.getAllMeetings("42", false);

    expect(getAllMeetings).toHaveBeenCalledWith(88, false);
  });
});

// ── Voting window ─────────────────────────────────────────────────────────────

describe("AdminService — voting window delegation", () => {
  it("setVotingWindow delegates to votesService", async () => {
    const setVotingWindow = jest.fn(async () => ({ id: 1 }));
    const service = buildService({ votesService: { setVotingWindow } });

    const dto: any = { startTime: 1000, endTime: 2000, electionId: 1 };
    await service.setVotingWindow(dto);

    expect(setVotingWindow).toHaveBeenCalledWith(dto);
  });

  it("getActiveVotingWindow delegates to votesService", async () => {
    const window = { id: 3, isActive: true };
    const service = buildService({
      votesService: { getActiveVotingWindow: jest.fn(async () => window) },
    });

    expect(await service.getActiveVotingWindow()).toBe(window);
  });
});

// ── Election management ───────────────────────────────────────────────────────

describe("AdminService — election management delegation", () => {
  it("createElection delegates to electionsService", async () => {
    const createElection = jest.fn(async () => ({ id: 10 }));
    const service = buildService({ electionsService: { createElection } });

    const dto: any = { name: "KA Assembly 2026", type: "state_assembly" };
    const result = await service.createElection(dto);

    expect(createElection).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ id: 10 });
  });
});
