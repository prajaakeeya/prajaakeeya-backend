import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { IssuesService } from "./issues.service";

/**
 * Behaviour unit tests for IssuesService:
 *   - createHandRaise is a TOGGLE: raising a category you already raised
 *     removes it ({ raised: false }); otherwise it adds it ({ raised: true }).
 *   - a category is required.
 *   - createIssue persists with the resolved ward + scoping fields.
 *
 * electionsService.findById is mocked to a non-municipal election so
 * resolveWardId returns undefined without needing the wards service.
 */
function buildService(deps: Record<string, any> = {}): any {
  const noop: any = {};
  const handRepo = deps.handRepo ?? noop;
  // Mock DataSource: transaction(cb) runs cb with a manager whose
  // getRepository(HandRaise) returns the wired-up hand repo and query() is a
  // no-op (advisory-lock SELECT). Lets createHandRaise run against the mocks.
  const manager: any = {
    getRepository: () => handRepo,
    query: jest.fn(async () => []),
  };
  const dataSource = deps.dataSource ?? {
    transaction: async (cb: any) => cb(manager),
  };
  return new IssuesService(
    deps.repo ?? noop,
    handRepo,
    deps.electionsService ?? { findById: jest.fn(async () => ({ id: 1, type: "state_assembly", name: "AC" })) },
    deps.wardsService ?? noop,
    deps.usersService ?? noop,
    dataSource,
  );
}

describe("IssuesService — createHandRaise() toggle", () => {
  it("requires a non-empty category", async () => {
    const service = buildService({ handRepo: {} });
    await expect(
      service.createHandRaise(1, 1, 2, { category: "   " }),
    ).rejects.toThrow(BadRequestException);
  });

  it("removes an existing hand-raise (toggle off)", async () => {
    const del = jest.fn(async () => ({}));
    const service = buildService({
      handRepo: { findOne: jest.fn(async () => ({ id: 50 })), delete: del },
    });

    const res = await service.createHandRaise(1, 1, 2, { category: "Roads" });

    expect(del).toHaveBeenCalledWith(50);
    expect(res).toEqual({ raised: false });
  });

  it("creates a hand-raise when none exists (toggle on)", async () => {
    const save = jest.fn(async (h: any) => h);
    const create = jest.fn((h: any) => h);
    const service = buildService({
      handRepo: { findOne: jest.fn(async () => null), create, save },
    });

    const res = await service.createHandRaise(1, 1, 2, { category: "Roads" });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ electionId: 1, constituencyId: 2, createdById: 1, category: "Roads" }),
    );
    expect(save).toHaveBeenCalled();
    expect(res).toEqual({ raised: true });
  });
});

describe("IssuesService — createIssue()", () => {
  it("persists an issue with scoping + creator fields", async () => {
    const create = jest.fn((i: any) => i);
    const save = jest.fn(async (i: any) => ({ id: 9, ...i }));
    const service = buildService({ repo: { create, save } });

    const result = await service.createIssue(1, 1, 2, {
      title: "Broken streetlight",
      description: "Dark since a week",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        electionId: 1,
        constituencyId: 2,
        createdById: 1,
        title: "Broken streetlight",
        description: "Dark since a week",
      }),
    );
    expect(result).toEqual(expect.objectContaining({ id: 9, title: "Broken streetlight" }));
  });
});
