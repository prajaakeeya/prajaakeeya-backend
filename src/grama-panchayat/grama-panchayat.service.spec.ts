import "reflect-metadata";
import { NotFoundException } from "@nestjs/common";
import { GramaPanchayatService } from "./grama-panchayat.service";

/**
 * Behaviour unit tests for GramaPanchayatService. The service is constructed
 * directly with a mocked TypeORM repository (no DB / no server). Query builders
 * are replaced by a chainable stub whose terminal getRawMany/getRawOne resolve
 * to fixed rows. Each block locks in a specific business rule.
 */

// Build the service with a single mocked repository. Only the repo methods a
// given test exercises need to be supplied; the rest stay undefined.
function buildService(repo: Record<string, any> = {}): any {
  return new GramaPanchayatService(repo as any);
}

// Chainable QueryBuilder stub. Every builder method returns the same object so
// calls can chain; the terminal getRawMany()/getRawOne() resolve to the fixed
// data. Records andWhere calls so tests can assert filters were applied.
function makeQb(terminal: { rawMany?: any[]; rawOne?: any }) {
  const calls: { andWhere: any[][]; where: any[][] } = {
    andWhere: [],
    where: [],
  };
  const qb: any = {};
  for (const m of ["select", "addSelect", "orderBy", "groupBy"]) {
    qb[m] = jest.fn(() => qb);
  }
  qb.where = jest.fn((...args: any[]) => {
    calls.where.push(args);
    return qb;
  });
  qb.andWhere = jest.fn((...args: any[]) => {
    calls.andWhere.push(args);
    return qb;
  });
  qb.getRawMany = jest.fn(async () => terminal.rawMany ?? []);
  qb.getRawOne = jest.fn(async () => terminal.rawOne);
  qb.__calls = calls;
  return qb;
}

describe("GramaPanchayatService — findBySrNo()", () => {
  it("returns the row when found", async () => {
    const row = { srNo: 5, villageName: "Adagal" };
    const repo = { findOne: jest.fn(async () => row) };
    const service = buildService(repo);

    await expect(service.findBySrNo(5)).resolves.toBe(row);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { srNo: 5 } });
  });

  it("throws NotFoundException when the Sr.No does not exist", async () => {
    const service = buildService({ findOne: jest.fn(async () => null) });
    await expect(service.findBySrNo(999)).rejects.toThrow(NotFoundException);
    await expect(service.findBySrNo(999)).rejects.toThrow(
      "Village with Sr.No 999 not found",
    );
  });
});

describe("GramaPanchayatService — findAll()", () => {
  it("returns an empty array without querying when no filters are given", async () => {
    const createQueryBuilder = jest.fn();
    const service = buildService({ createQueryBuilder });

    await expect(service.findAll()).resolves.toEqual([]);
    await expect(service.findAll({})).resolves.toEqual([]);
    expect(createQueryBuilder).not.toHaveBeenCalled();
  });

  it("queries and returns rows when at least one filter is provided", async () => {
    const rows = [{ id: 1, villageName: "Adagal" }];
    const qb = makeQb({ rawMany: rows });
    const service = buildService({ createQueryBuilder: jest.fn(() => qb) });

    const result = await service.findAll({
      state: "Karnataka",
      district: "Bagalkote",
      taluk: "Badami",
      gpName: "Adagal",
    });

    expect(result).toBe(rows);
    // One andWhere per supplied filter.
    expect(qb.__calls.andWhere).toEqual([
      ['gp."State" = :state', { state: "Karnataka" }],
      ['gp."District" = :district', { district: "Bagalkote" }],
      ['gp."Taluk" = :taluk', { taluk: "Badami" }],
      ['gp."GP Name" = :gpName', { gpName: "Adagal" }],
    ]);
  });

  it("applies only the filters that are present", async () => {
    const qb = makeQb({ rawMany: [] });
    const service = buildService({ createQueryBuilder: jest.fn(() => qb) });

    await service.findAll({ gpName: "Adagal" });

    expect(qb.__calls.andWhere).toEqual([
      ['gp."GP Name" = :gpName', { gpName: "Adagal" }],
    ]);
  });
});

describe("GramaPanchayatService — getStates()", () => {
  it("maps the distinct rows down to a string array", async () => {
    const qb = makeQb({
      rawMany: [{ state: "Karnataka" }, { state: "Goa" }],
    });
    const service = buildService({ createQueryBuilder: jest.fn(() => qb) });

    await expect(service.getStates()).resolves.toEqual(["Karnataka", "Goa"]);
  });
});

describe("GramaPanchayatService — getDistricts()", () => {
  it("filters by state and maps to a string array", async () => {
    const qb = makeQb({ rawMany: [{ district: "Bagalkote" }] });
    const service = buildService({ createQueryBuilder: jest.fn(() => qb) });

    await expect(service.getDistricts("Karnataka")).resolves.toEqual([
      "Bagalkote",
    ]);
    expect(qb.__calls.where).toEqual([
      ['gp."State" = :state', { state: "Karnataka" }],
    ]);
  });
});

describe("GramaPanchayatService — getTaluks()", () => {
  it("filters by state + district and maps to a string array", async () => {
    const qb = makeQb({ rawMany: [{ taluk: "Badami" }] });
    const service = buildService({ createQueryBuilder: jest.fn(() => qb) });

    await expect(service.getTaluks("Karnataka", "Bagalkote")).resolves.toEqual([
      "Badami",
    ]);
    expect(qb.__calls.where).toEqual([
      ['gp."State" = :state', { state: "Karnataka" }],
    ]);
    expect(qb.__calls.andWhere).toEqual([
      ['gp."District" = :district', { district: "Bagalkote" }],
    ]);
  });
});

describe("GramaPanchayatService — getGPs()", () => {
  it("filters by state + district + taluk and maps to a string array", async () => {
    const qb = makeQb({ rawMany: [{ gpName: "Adagal" }] });
    const service = buildService({ createQueryBuilder: jest.fn(() => qb) });

    await expect(
      service.getGPs("Karnataka", "Bagalkote", "Badami"),
    ).resolves.toEqual(["Adagal"]);
    expect(qb.__calls.andWhere).toEqual([
      ['gp."District" = :district', { district: "Bagalkote" }],
      ['gp."Taluk" = :taluk', { taluk: "Badami" }],
    ]);
  });
});

describe("GramaPanchayatService — create()", () => {
  it("assigns the next Sr.No (max + 1) and persists all DTO fields", async () => {
    const qb = makeQb({ rawOne: { max: "41" } });
    const create = jest.fn((e: any) => e);
    const save = jest.fn(async (e: any) => ({ ...e }));
    const service = buildService({
      createQueryBuilder: jest.fn(() => qb),
      create,
      save,
    });

    const dto = {
      state: "Karnataka",
      district: "Bagalkote",
      taluk: "Badami",
      gpName: "Adagal",
      villageName: "Adagal",
      villageCode: "598748",
      population: "5000",
    };

    const result = await service.create(dto);

    expect(create).toHaveBeenCalledWith({
      srNo: 42,
      state: "Karnataka",
      district: "Bagalkote",
      taluk: "Badami",
      gpName: "Adagal",
      villageName: "Adagal",
      villageCode: "598748",
      population: "5000",
    });
    expect(save).toHaveBeenCalled();
    expect(result).toMatchObject({ srNo: 42, villageName: "Adagal" });
  });

  it("starts at Sr.No 1 when the table is empty (max is null)", async () => {
    const qb = makeQb({ rawOne: { max: null } });
    const create = jest.fn((e: any) => e);
    const service = buildService({
      createQueryBuilder: jest.fn(() => qb),
      create,
      save: jest.fn(async (e: any) => e),
    });

    await service.create({
      state: "Karnataka",
      district: "Bagalkote",
      taluk: "Badami",
      gpName: "Adagal",
      villageName: "Adagal",
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ srNo: 1 }));
  });
});

describe("GramaPanchayatService — update()", () => {
  it("throws NotFoundException when the row does not exist", async () => {
    const service = buildService({ findOne: jest.fn(async () => null) });
    await expect(service.update(5, { state: "Goa" })).rejects.toThrow(
      NotFoundException,
    );
  });

  it("mutates only the provided fields and saves", async () => {
    const row: any = {
      srNo: 5,
      state: "Karnataka",
      district: "Bagalkote",
      taluk: "Badami",
      gpName: "Adagal",
      villageName: "Adagal",
    };
    const save = jest.fn(async (e: any) => e);
    const service = buildService({
      findOne: jest.fn(async () => row),
      save,
    });

    const result = await service.update(5, { villageName: "Kerur" });

    expect(row.villageName).toBe("Kerur"); // changed
    expect(row.state).toBe("Karnataka"); // untouched
    expect(row.district).toBe("Bagalkote"); // untouched
    expect(save).toHaveBeenCalledWith(row);
    expect(result).toBe(row);
  });

  it("does not overwrite a field when the DTO value is undefined", async () => {
    const row: any = { srNo: 5, population: "5000", villageName: "Adagal" };
    const service = buildService({
      findOne: jest.fn(async () => row),
      save: jest.fn(async (e: any) => e),
    });

    await service.update(5, { population: undefined });

    expect(row.population).toBe("5000"); // preserved
  });
});

describe("GramaPanchayatService — delete()", () => {
  it("throws NotFoundException when the row does not exist", async () => {
    const service = buildService({ findOne: jest.fn(async () => null) });
    await expect(service.delete(5)).rejects.toThrow(NotFoundException);
  });

  it("removes the row and returns a confirmation message", async () => {
    const row = { srNo: 5, villageName: "Adagal" };
    const remove = jest.fn(async () => undefined);
    const service = buildService({
      findOne: jest.fn(async () => row),
      remove,
    });

    const result = await service.delete(5);

    expect(remove).toHaveBeenCalledWith(row);
    expect(result).toEqual({
      message: "Village 'Adagal' (Sr.No 5) deleted",
    });
  });
});

describe("GramaPanchayatService — getVillages()", () => {
  it("returns the raw village rows filtered by the full hierarchy", async () => {
    const rows = [{ id: 1, villageName: "Adagal", population: "5000" }];
    const qb = makeQb({ rawMany: rows });
    const service = buildService({ createQueryBuilder: jest.fn(() => qb) });

    const result = await service.getVillages(
      "Karnataka",
      "Bagalkote",
      "Badami",
      "Adagal",
    );

    expect(result).toBe(rows);
    expect(qb.__calls.where).toEqual([
      ['gp."State" = :state', { state: "Karnataka" }],
    ]);
    expect(qb.__calls.andWhere).toEqual([
      ['gp."District" = :district', { district: "Bagalkote" }],
      ['gp."Taluk" = :taluk', { taluk: "Badami" }],
      ['gp."GP Name" = :gpName', { gpName: "Adagal" }],
    ]);
  });
});
