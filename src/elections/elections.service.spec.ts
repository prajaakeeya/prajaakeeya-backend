import "reflect-metadata";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { ElectionsService } from "./elections.service";

/**
 * Behaviour unit tests for ElectionsService. The service is constructed with
 * mock dependencies (no DB / no server / no network). TypeORM repos and the
 * geography services are plain objects implementing only the methods each path
 * calls. Each block locks in a specific business rule.
 */

// Build a service with only the dependencies a given test cares about; the
// rest are inert stubs. Constructor arg order mirrors the real constructor.
function buildService(deps: Record<string, any> = {}): any {
  const noop: any = {};
  return new ElectionsService(
    deps.repo ?? noop,
    deps.parliamentaryService ?? noop,
    deps.assemblyService ?? noop,
    deps.municipalityService ?? noop,
    deps.wardsService ?? noop,
    deps.gramaPanchayatService ?? noop,
  );
}

describe("ElectionsService — onModuleInit() seeding", () => {
  it("creates each missing seed election with its type and name", async () => {
    const created: any[] = [];
    const saved: any[] = [];
    const repo = {
      findOne: jest.fn(async () => null), // nothing exists yet
      create: jest.fn((v: any) => {
        created.push(v);
        return v;
      }),
      save: jest.fn(async (v: any) => {
        saved.push(v);
        return v;
      }),
    };
    const service = buildService({ repo });

    await service.onModuleInit();

    // All four canonical election types are seeded.
    expect(repo.create).toHaveBeenCalledTimes(4);
    expect(repo.save).toHaveBeenCalledTimes(4);
    expect(created).toEqual([
      { type: "lok_sabha", name: "Lok Sabha (MP)" },
      { type: "state_assembly", name: "State Assembly (MLA)" },
      {
        type: "municipal_corporation",
        name: "Municipal Corporation (Corporator)",
      },
      { type: "gram_panchayat", name: "Gram Panchayat (Village)" },
    ]);
  });

  it("does not recreate seeds that already exist", async () => {
    const repo = {
      findOne: jest.fn(async () => ({ id: 1, type: "lok_sabha" })), // every type exists
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => v),
    };
    const service = buildService({ repo });

    await service.onModuleInit();

    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("clears a legacy GBA scope on the existing municipal_corporation seed", async () => {
    const muni: any = { id: 3, type: "municipal_corporation", scope: "GBA" };
    const repo = {
      // Return the GBA-scoped municipal row for every lookup; other types are
      // irrelevant to this assertion since they have no scope to migrate.
      findOne: jest.fn(async ({ where }: any) =>
        where.type === "municipal_corporation"
          ? muni
          : { id: 9, type: where.type },
      ),
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => v),
    };
    const service = buildService({ repo });

    await service.onModuleInit();

    expect(muni.scope).toBeUndefined();
    expect(repo.save).toHaveBeenCalledWith(muni);
  });
});

describe("ElectionsService — findAll()", () => {
  it("returns the full list straight from the repo", async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const repo = { find: jest.fn(async () => rows) };
    const service = buildService({ repo });

    await expect(service.findAll()).resolves.toBe(rows);
    expect(repo.find).toHaveBeenCalledTimes(1);
  });
});

describe("ElectionsService — createElection()", () => {
  it("rejects a duplicate election type", async () => {
    const repo = {
      findOne: jest.fn(async () => ({ id: 1, type: "lok_sabha" })),
      create: jest.fn(),
      save: jest.fn(),
    };
    const service = buildService({ repo });

    await expect(
      service.createElection({ type: "lok_sabha", name: "Lok Sabha" }),
    ).rejects.toThrow(ConflictException);
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("creates and persists a new election with a typed type field", async () => {
    const repo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => ({ id: 5, ...v })),
    };
    const service = buildService({ repo });

    const dto = {
      type: "municipal_corporation",
      name: "Municipal Corporation",
      scope: "GBA",
    };
    const result = await service.createElection(dto);

    expect(repo.create).toHaveBeenCalledWith({
      type: "municipal_corporation",
      name: "Municipal Corporation",
      scope: "GBA",
    });
    expect(repo.save).toHaveBeenCalled();
    expect(result).toMatchObject({ id: 5, type: "municipal_corporation" });
  });
});

describe("ElectionsService — updateElection()", () => {
  it("throws NotFound when the election does not exist", async () => {
    const repo = { findOne: jest.fn(async () => null), save: jest.fn() };
    const service = buildService({ repo });

    await expect(service.updateElection(99, { name: "X" })).rejects.toThrow(
      NotFoundException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("updates only the provided fields and persists", async () => {
    const election: any = { id: 1, name: "Old", scope: "GBA" };
    const repo = {
      findOne: jest.fn(async () => election),
      save: jest.fn(async (e: any) => e),
    };
    const service = buildService({ repo });

    const result = await service.updateElection(1, { name: "New Name" });

    expect(election.name).toBe("New Name");
    expect(election.scope).toBe("GBA"); // untouched (dto.scope undefined)
    expect(repo.save).toHaveBeenCalledWith(election);
    expect(result).toBe(election);
  });

  it("can clear/update the scope field independently", async () => {
    const election: any = { id: 1, name: "Old", scope: "GBA" };
    const repo = {
      findOne: jest.fn(async () => election),
      save: jest.fn(async (e: any) => e),
    };
    const service = buildService({ repo });

    await service.updateElection(1, { scope: "" });

    expect(election.scope).toBe("");
    expect(election.name).toBe("Old"); // name untouched
  });
});

describe("ElectionsService — deleteElection()", () => {
  it("throws NotFound when the election does not exist", async () => {
    const repo = { findOne: jest.fn(async () => null), remove: jest.fn() };
    const service = buildService({ repo });

    await expect(service.deleteElection(99)).rejects.toThrow(NotFoundException);
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it("removes the election and returns a confirmation message", async () => {
    const election = { id: 1, name: "Lok Sabha (MP)" };
    const repo = {
      findOne: jest.fn(async () => election),
      remove: jest.fn(async () => undefined),
    };
    const service = buildService({ repo });

    const result = await service.deleteElection(1);

    expect(repo.remove).toHaveBeenCalledWith(election);
    expect(result).toEqual({ message: "Election 'Lok Sabha (MP)' deleted" });
  });
});

describe("ElectionsService — findById()", () => {
  it("throws NotFound for an unknown id", async () => {
    const repo = { findOne: jest.fn(async () => null) };
    const service = buildService({ repo });

    await expect(service.findById(99)).rejects.toThrow(NotFoundException);
  });

  it("returns the election when found", async () => {
    const election = { id: 1, type: "lok_sabha" };
    const repo = { findOne: jest.fn(async () => election) };
    const service = buildService({ repo });

    await expect(service.findById(1)).resolves.toBe(election);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
  });
});

describe("ElectionsService — findByType()", () => {
  it("throws NotFound for an unknown type", async () => {
    const repo = { findOne: jest.fn(async () => null) };
    const service = buildService({ repo });

    await expect(service.findByType("gram_panchayat")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("returns the election matching the type", async () => {
    const election = { id: 4, type: "gram_panchayat" };
    const repo = { findOne: jest.fn(async () => election) };
    const service = buildService({ repo });

    await expect(service.findByType("gram_panchayat")).resolves.toBe(election);
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { type: "gram_panchayat" },
    });
  });
});

describe("ElectionsService — getConstituenciesByScope() / getMunicipalities()", () => {
  it("delegates scope lookup to wardsService.findByMunicipality", async () => {
    const wards = [{ id: 1 }];
    const wardsService = { findByMunicipality: jest.fn(async () => wards) };
    const service = buildService({ wardsService });

    await expect(service.getConstituenciesByScope("GBA")).resolves.toBe(wards);
    expect(wardsService.findByMunicipality).toHaveBeenCalledWith("GBA");
  });

  it("delegates municipality lookup to municipalityService.findAll", () => {
    const list = [{ id: 1 }];
    const municipalityService = { findAll: jest.fn(() => list) };
    const service = buildService({ municipalityService });

    expect(service.getMunicipalities("Karnataka")).toBe(list);
    expect(municipalityService.findAll).toHaveBeenCalledWith("Karnataka");
  });
});

describe("ElectionsService — getConstituencies() routing by type", () => {
  function setup(type: string, sourceList: any[]) {
    const repo = { findOne: jest.fn(async () => ({ id: 1, type })) };
    const parliamentaryService = { findAll: jest.fn(async () => []) };
    const assemblyService = { findAll: jest.fn(async () => []) };
    const wardsService = { findAll: jest.fn(async () => []) };
    const gramaPanchayatService = { findAll: jest.fn(async () => []) };
    const services: any = {
      parliamentaryService,
      assemblyService,
      wardsService,
      gramaPanchayatService,
    };
    // Point the relevant source at the expected rows.
    const map: Record<string, string> = {
      lok_sabha: "parliamentaryService",
      state_assembly: "assemblyService",
      municipal_corporation: "wardsService",
      gram_panchayat: "gramaPanchayatService",
    };
    services[map[type]].findAll = jest.fn(async () => sourceList);
    const service = buildService({ repo, ...services });
    return { service, repo, ...services };
  }

  it("routes lok_sabha to parliamentaryService", async () => {
    const rows = [{ id: "p1" }];
    const { service, parliamentaryService } = setup("lok_sabha", rows);

    const res = await service.getConstituencies("lok_sabha");

    expect(parliamentaryService.findAll).toHaveBeenCalled();
    expect(res).toEqual({
      election: { id: 1, type: "lok_sabha" },
      constituencies: rows,
    });
  });

  it("routes state_assembly to assemblyService", async () => {
    const rows = [{ id: "a1" }];
    const { service, assemblyService } = setup("state_assembly", rows);

    const res = await service.getConstituencies("state_assembly");

    expect(assemblyService.findAll).toHaveBeenCalled();
    expect(res.constituencies).toBe(rows);
  });

  it("routes municipal_corporation to wardsService.findAll", async () => {
    const rows = [{ id: "w1" }];
    const { service, wardsService } = setup("municipal_corporation", rows);

    const res = await service.getConstituencies("municipal_corporation");

    expect(wardsService.findAll).toHaveBeenCalled();
    expect(res.constituencies).toBe(rows);
  });

  it("routes gram_panchayat to gramaPanchayatService and forwards filters", async () => {
    const rows = [{ id: "g1" }];
    const { service, gramaPanchayatService } = setup("gram_panchayat", rows);
    const filters = { state: "KA", district: "BLR" };

    const res = await service.getConstituencies("gram_panchayat", filters);

    expect(gramaPanchayatService.findAll).toHaveBeenCalledWith(filters);
    expect(res.constituencies).toBe(rows);
  });

  it("propagates NotFound from findByType when the type is unknown", async () => {
    const repo = { findOne: jest.fn(async () => null) };
    const service = buildService({ repo });

    await expect(service.getConstituencies("lok_sabha" as any)).rejects.toThrow(
      NotFoundException,
    );
  });
});
