import "reflect-metadata";
import { NotFoundException } from "@nestjs/common";
import { UsersService } from "./users.service";

/**
 * Behaviour unit tests for UsersService:
 *   - createReport: rejects unknown targets and disallowed attachment types,
 *     uploads valid attachments, and persists a "pending" report.
 *   - findAllVoters: correct skip/take pagination + response shaping.
 *
 * UsersService has a large constructor, so we bypass it with
 * Object.create(prototype) and assign only the fields each method touches.
 */
function makeService(fields: Record<string, any>): any {
  const service: any = Object.create(UsersService.prototype);
  Object.assign(service, fields);
  return service;
}

describe("UsersService — createReport()", () => {
  const dto = {
    reportedUserId: 5,
    reportedUserType: "voter",
    reason: "Not from this ward",
  };

  it("throws when the reported user does not exist", async () => {
    const service = makeService({
      repo: { findOne: jest.fn(async () => null) },
    });
    await expect(service.createReport(dto, 1)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("rejects an attachment with a disallowed mime type", async () => {
    const service = makeService({
      repo: { findOne: jest.fn(async () => ({ id: 5 })) },
    });
    const file: any = { mimetype: "text/plain" };
    await expect(service.createReport(dto, 1, file)).rejects.toThrow(
      "Only PDF, JPEG, and PNG",
    );
  });

  it("creates a pending report tagged with the reporter id (no attachment)", async () => {
    const create = jest.fn((r: any) => r);
    const save = jest.fn(async (r: any) => ({ id: 11, ...r }));
    const uploadFile = jest.fn();
    const service = makeService({
      repo: { findOne: jest.fn(async () => ({ id: 5 })) },
      reportRepo: { create, save },
      s3Service: { uploadFile },
    });

    const result = await service.createReport(dto, 1);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        reportedUserId: 5,
        reportedUserType: "voter",
        reason: "Not from this ward",
        reportedById: 1,
        status: "pending",
      }),
    );
    expect(uploadFile).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({ id: 11, status: "pending" }),
    );
  });

  it("uploads a valid attachment and stores its URL", async () => {
    const uploadFile = jest.fn(async () => "https://s3/report.png");
    const create = jest.fn((r: any) => r);
    const service = makeService({
      repo: { findOne: jest.fn(async () => ({ id: 5 })) },
      reportRepo: { create, save: jest.fn(async (r: any) => r) },
      s3Service: { uploadFile },
    });
    const file: any = { mimetype: "image/png" };

    await service.createReport(dto, 1, file);

    expect(uploadFile).toHaveBeenCalledWith(file, "reports");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentUrl: "https://s3/report.png" }),
    );
  });
});

describe("UsersService — findAllVoters() pagination + shaping", () => {
  function qbReturning(rows: any[], total: number) {
    const qb: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(async () => [rows, total]),
    };
    return qb;
  }

  it("applies skip/take and returns shaped, paginated data", async () => {
    const qb = qbReturning(
      [{ id: 1, name: "Asha", role: "voter", ward: null }],
      42,
    );
    const count = jest.fn(async () => 40);
    const service = makeService({
      repo: { createQueryBuilder: jest.fn(() => qb), count },
    });

    const result = await service.findAllVoters(3, 10);

    expect(qb.skip).toHaveBeenCalledWith(20); // (3 - 1) * 10
    expect(qb.take).toHaveBeenCalledWith(10);
    expect(result.total).toBe(42);
    // No search filter → totalUsers reuses the paginated total; no extra COUNT(*).
    expect(result.totalUsers).toBe(42);
    expect(count).not.toHaveBeenCalled();
    expect(result.page).toBe(3);
    expect(result.limit).toBe(10);
    expect(result.totalPages).toBe(Math.ceil(42 / 10));
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toEqual(
      expect.objectContaining({ id: 1, name: "Asha", role: "voter" }),
    );
  });
});
