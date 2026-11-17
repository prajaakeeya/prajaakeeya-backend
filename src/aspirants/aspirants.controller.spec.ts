import { AspirantsController } from "./aspirants.controller";

describe("AspirantsController — findByConstituency identity", () => {
  const aspirantsService = {
    findByConstituency: jest.fn(),
  };
  let controller: AspirantsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AspirantsController(aspirantsService as any);
  });

  it("uses the authenticated user's ID for personalized interaction data", () => {
    controller.findByConstituency("12", "34", {
      id: 567,
      role: "voter",
    } as any);

    expect(aspirantsService.findByConstituency).toHaveBeenCalledWith(
      12,
      34,
      567,
    );
  });

  it("does not request user-specific interaction data for anonymous callers", () => {
    controller.findByConstituency("12", "34");

    expect(aspirantsService.findByConstituency).toHaveBeenCalledWith(
      12,
      34,
      undefined,
    );
  });
});
