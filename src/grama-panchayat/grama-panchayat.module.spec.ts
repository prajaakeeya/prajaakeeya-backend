import "reflect-metadata";
import { MODULE_METADATA } from "@nestjs/common/constants";

import { GramaPanchayatModule } from "./grama-panchayat.module";
import { GramaPanchayatService } from "./grama-panchayat.service";
import { GramaPanchayatController } from "./grama-panchayat.controller";

describe("GramaPanchayatModule", () => {
  it("should define GramaPanchayatService as a provider", () => {
    const providers =
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, GramaPanchayatModule) ??
      [];

    expect(providers).toContain(GramaPanchayatService);
  });

  it("should define GramaPanchayatController as a controller", () => {
    const controllers =
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, GramaPanchayatModule) ??
      [];

    expect(controllers).toContain(GramaPanchayatController);
  });

  it("should export GramaPanchayatService", () => {
    const exportsMetadata =
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, GramaPanchayatModule) ?? [];

    expect(exportsMetadata).toContain(GramaPanchayatService);
  });
});
