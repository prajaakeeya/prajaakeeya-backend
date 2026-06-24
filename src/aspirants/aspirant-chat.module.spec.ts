import "reflect-metadata";
import { MODULE_METADATA } from "@nestjs/common/constants";

import { AspirantChatModule } from "./aspirant-chat.module";
import { AspirantChatService } from "./aspirant-chat.service";
import { AspirantChatController } from "./aspirant-chat.controller";

describe("AspirantChatModule", () => {
  it("should define AspirantChatService as a provider", () => {
    const providers =
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AspirantChatModule) ?? [];

    expect(providers).toContain(AspirantChatService);
  });

  it("should define AspirantChatController as a controller", () => {
    const controllers =
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AspirantChatModule) ??
      [];

    expect(controllers).toContain(AspirantChatController);
  });

  it("should export AspirantChatService", () => {
    const exportsMetadata =
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, AspirantChatModule) ?? [];

    expect(exportsMetadata).toContain(AspirantChatService);
  });
});
