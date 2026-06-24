import "reflect-metadata";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { VotesService } from "./votes.service";

/**
 * Behaviour unit tests for VotesService.castVote — the core voting rules:
 *   1. a voting window must be active
 *   2. one vote per user per voting window
 *   3. the aspirant must exist and not have withdrawn
 *   4. the user must have interacted with an aspirant first
 *   5. on success a vote is persisted with the right fields
 *
 * Constructed with mocks; the voting-window helpers are stubbed.
 */
function buildService(deps: Record<string, any> = {}): any {
  const noop: any = {};
  return new VotesService(
    deps.repo ?? noop,
    deps.votingWindowRepo ?? noop,
    deps.usersService ?? noop,
    deps.wardsService ?? noop,
    deps.aspirantsService ?? noop,
    deps.notificationsService ?? noop,
  );
}

describe("VotesService — castVote()", () => {
  const userId = 1;
  const dto = { aspirantId: 7 };

  function setup(over: Record<string, any> = {}) {
    const repo = {
      findOne:
        over.existingVote !== undefined
          ? jest.fn(async () => over.existingVote)
          : jest.fn(async () => null),
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => ({ id: 100, ...v })),
    };
    const usersService = {
      hasAnyInteraction: jest.fn(async () => over.hasInteracted ?? true),
    };
    const aspirantsService = {
      findOne: jest.fn(async () =>
        over.aspirant === undefined
          ? { id: 7, isActive: true, wardId: 3 }
          : over.aspirant,
      ),
    };
    const service = buildService({ repo, usersService, aspirantsService });
    jest.spyOn(service, "checkVotingWindow").mockResolvedValue(undefined);
    jest
      .spyOn(service, "getActiveVotingWindow")
      .mockResolvedValue(
        over.activeWindow === undefined ? { id: 1 } : over.activeWindow,
      );
    return { service, repo, usersService, aspirantsService };
  }

  it("rejects when no voting window is active", async () => {
    const { service } = setup({ activeWindow: null });
    await expect(service.castVote(userId, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("rejects a second vote in the same window", async () => {
    const { service } = setup({ existingVote: { id: 99 } });
    await expect(service.castVote(userId, dto)).rejects.toThrow(
      "already voted",
    );
  });

  it("rejects when the aspirant does not exist", async () => {
    const { service } = setup({ aspirant: null });
    await expect(service.castVote(userId, dto)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("rejects a vote for a withdrawn aspirant", async () => {
    const { service } = setup({ aspirant: { id: 7, isActive: false } });
    await expect(service.castVote(userId, dto)).rejects.toThrow("withdrawn");
  });

  it("requires the user to have interacted before voting", async () => {
    const { service } = setup({ hasInteracted: false });
    await expect(service.castVote(userId, dto)).rejects.toThrow("interact");
  });

  it("persists the vote with the correct fields on success", async () => {
    const { service, repo } = setup();
    const saved = await service.castVote(userId, dto);

    expect(repo.create).toHaveBeenCalledWith({
      aspirantId: 7,
      wardId: 3,
      userId: 1,
      votingWindowId: 1,
    });
    expect(repo.save).toHaveBeenCalled();
    expect(saved).toEqual(
      expect.objectContaining({ aspirantId: 7, userId: 1, votingWindowId: 1 }),
    );
  });
});
