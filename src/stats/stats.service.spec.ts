import "reflect-metadata";
import { NotFoundException } from "@nestjs/common";
import { StatsService } from "./stats.service";

/**
 * Behaviour unit tests for StatsService.findStatsByConstituency.
 *
 * The service aggregates three things in parallel:
 *   1. voter count — a manager query builder ending in getRawOne -> { count }
 *   2. aspirant count — a candidacyRepo query builder ending in getCount
 *   3. constituency name — a manager query builder (per election type)
 *      ending in getRawOne -> { name }, with errors swallowed to null.
 *
 * StatsService has injected repos, so we bypass the constructor with
 * Object.create(prototype) and assign only the fields the method touches.
 * TypeORM query builders are replaced with chainable stubs whose terminal
 * resolves a fixed row.
 */

// A chainable query-builder stub: every builder method returns `this`, and the
// terminal methods resolve whatever was configured.
function makeQb(terminal: { getRawOne?: any; getCount?: any }): any {
  const qb: any = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
  };
  qb.getRawOne = jest.fn(async () => {
    if (terminal.getRawOne instanceof Error) throw terminal.getRawOne;
    return terminal.getRawOne;
  });
  qb.getCount = jest.fn(async () => terminal.getCount);
  return qb;
}

/**
 * Build a StatsService whose manager.createQueryBuilder() returns the queued
 * builders in order (first the voter-count builder, then the name builder),
 * and whose candidacyRepo.createQueryBuilder() returns the aspirant builder.
 */
function makeService(opts: {
  election: any;
  voterRow?: any; // { count } | null
  aspirantCount?: number;
  nameRow?: any; // { name } | null | Error
}): { service: any; managerQbs: any[]; candidacyQb: any } {
  const voterQb = makeQb({ getRawOne: opts.voterRow ?? { count: "0" } });
  const nameQb = makeQb({ getRawOne: opts.nameRow ?? { name: null } });
  const candidacyQb = makeQb({ getCount: opts.aspirantCount ?? 0 });

  const managerQbs = [voterQb, nameQb];
  let managerIdx = 0;
  const manager = {
    createQueryBuilder: jest.fn(() => managerQbs[managerIdx++]),
  };

  const service: any = Object.create(StatsService.prototype);
  Object.assign(service, {
    userRepo: { manager },
    candidacyRepo: { createQueryBuilder: jest.fn(() => candidacyQb) },
    electionsService: { findById: jest.fn(async () => opts.election) },
  });

  return { service, managerQbs, candidacyQb };
}

describe("StatsService — findStatsByConstituency()", () => {
  it("shapes the aggregate result and coerces the voter count to a number", async () => {
    const { service } = makeService({
      election: { id: 4, type: "lok_sabha", name: "Lok Sabha 2024" },
      voterRow: { count: "153" },
      aspirantCount: 9,
      nameRow: { name: "Bangalore South" },
    });

    const result = await service.findStatsByConstituency(4, 22);

    expect(result).toEqual({
      electionId: 4,
      constituencyId: 22,
      electionType: "lok_sabha",
      electionName: "Lok Sabha 2024",
      constituencyName: "Bangalore South",
      totalVoters: 153, // coerced from the "153" string
      totalAspirants: 9,
    });
  });

  it("defaults totalVoters to 0 when the voter query returns no row", async () => {
    const { service } = makeService({
      election: { id: 1, type: "state_assembly", name: "Assembly" },
      voterRow: null,
      aspirantCount: 0,
      nameRow: { name: "Some AC" },
    });

    const result = await service.findStatsByConstituency(1, 5);

    expect(result.totalVoters).toBe(0);
    expect(result.totalAspirants).toBe(0);
  });

  it("filters voters by the lok_sabha constituency column, role and flags", async () => {
    const { service, managerQbs } = makeService({
      election: { id: 4, type: "lok_sabha", name: "LS" },
      voterRow: { count: "10" },
    });

    await service.findStatsByConstituency(4, 22);

    const voterQb = managerQbs[0];
    expect(voterQb.where).toHaveBeenCalledWith(
      "u.lok_sabha_constituency_id = :constituencyId",
      { constituencyId: 22 },
    );
    expect(voterQb.andWhere).toHaveBeenCalledWith("u.role = :role", {
      role: "voter",
    });
    expect(voterQb.andWhere).toHaveBeenCalledWith("u.is_blocked = false");
    expect(voterQb.andWhere).toHaveBeenCalledWith("u.is_self_deleted = false");
  });

  it("uses the state_assembly constituency column for state_assembly elections", async () => {
    const { service, managerQbs } = makeService({
      election: { id: 2, type: "state_assembly", name: "Assembly" },
      voterRow: { count: "3" },
    });

    await service.findStatsByConstituency(2, 77);

    expect(managerQbs[0].where).toHaveBeenCalledWith(
      "u.state_assembly_constituency_id = :constituencyId",
      { constituencyId: 77 },
    );
  });

  it("uses the municipal_corporation constituency column", async () => {
    const { service, managerQbs } = makeService({
      election: { id: 3, type: "municipal_corporation", name: "BBMP" },
      voterRow: { count: "1" },
    });

    await service.findStatsByConstituency(3, 12);

    expect(managerQbs[0].where).toHaveBeenCalledWith(
      "u.municipal_corporation_constituency_id = :constituencyId",
      { constituencyId: 12 },
    );
  });

  it("uses the gram_panchayat constituency column", async () => {
    const { service, managerQbs } = makeService({
      election: { id: 5, type: "gram_panchayat", name: "GP" },
      voterRow: { count: "2" },
    });

    await service.findStatsByConstituency(5, 88);

    expect(managerQbs[0].where).toHaveBeenCalledWith(
      "u.gram_panchayat_constituency_id = :constituencyId",
      { constituencyId: 88 },
    );
  });

  it("counts only onboarded, active aspirants via aspirant_candidacies for the election + constituency", async () => {
    const { service, candidacyQb } = makeService({
      election: { id: 4, type: "lok_sabha", name: "LS" },
      aspirantCount: 7,
    });

    const result = await service.findStatsByConstituency(4, 22);

    expect(result.totalAspirants).toBe(7);
    expect(candidacyQb.innerJoin).toHaveBeenCalled();
    expect(candidacyQb.where).toHaveBeenCalledWith("c.electionId = :electionId", {
      electionId: 4,
    });
    expect(candidacyQb.andWhere).toHaveBeenCalledWith(
      "c.constituencyId = :constituencyId",
      { constituencyId: 22 },
    );
    expect(candidacyQb.andWhere).toHaveBeenCalledWith("a.isActive = :isActive", {
      isActive: true,
    });
    expect(candidacyQb.andWhere).toHaveBeenCalledWith("a.sopAgreed = :sopAgreed", {
      sopAgreed: true,
    });
    expect(candidacyQb.andWhere).toHaveBeenCalledWith("a.selfieUrl IS NOT NULL");
    expect(candidacyQb.getCount).toHaveBeenCalled();
  });

  it("propagates NotFoundException when the election does not exist", async () => {
    const service: any = Object.create(StatsService.prototype);
    Object.assign(service, {
      userRepo: { manager: { createQueryBuilder: jest.fn() } },
      candidacyRepo: { createQueryBuilder: jest.fn() },
      electionsService: {
        findById: jest.fn(async () => {
          throw new NotFoundException("Election with id 99 not found");
        }),
      },
    });

    await expect(service.findStatsByConstituency(99, 1)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe("StatsService — constituency name resolution", () => {
  it("returns the resolved constituency name from the name query", async () => {
    const { service } = makeService({
      election: { id: 4, type: "lok_sabha", name: "LS" },
      nameRow: { name: "Bangalore South" },
    });

    const result = await service.findStatsByConstituency(4, 22);
    expect(result.constituencyName).toBe("Bangalore South");
  });

  it("returns null when the name query yields no row", async () => {
    const { service } = makeService({
      election: { id: 4, type: "lok_sabha", name: "LS" },
      nameRow: null,
    });

    const result = await service.findStatsByConstituency(4, 22);
    expect(result.constituencyName).toBeNull();
  });

  it("swallows errors from the name query and returns null", async () => {
    const { service } = makeService({
      election: { id: 4, type: "lok_sabha", name: "LS" },
      nameRow: new Error("db blew up"),
    });

    const result = await service.findStatsByConstituency(4, 22);
    expect(result.constituencyName).toBeNull();
  });

  it("selects from wards (with number/name concat) for municipal elections", async () => {
    const { service, managerQbs } = makeService({
      election: { id: 3, type: "municipal_corporation", name: "BBMP" },
      nameRow: { name: "12 - JP Nagar" },
    });

    const result = await service.findStatsByConstituency(3, 12);

    expect(result.constituencyName).toBe("12 - JP Nagar");
    // second manager builder is the name resolver
    const nameQb = managerQbs[1];
    expect(nameQb.from).toHaveBeenCalledWith("wards", "w");
    expect(nameQb.where).toHaveBeenCalledWith("w.id = :id", { id: 12 });
  });
});
