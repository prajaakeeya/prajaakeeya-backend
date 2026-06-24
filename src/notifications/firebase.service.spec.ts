import "reflect-metadata";
import { FirebaseService } from "./firebase.service";

/**
 * Unit tests for FirebaseService token management + the no-op guard.
 * onModuleInit() is never called, so the Admin SDK stays uninitialised
 * (enabled = false) and sends are skipped — no Firebase credentials needed.
 */
function makeService(repo: any): any {
  return new FirebaseService(repo);
}

describe("FirebaseService", () => {
  it("is disabled until initialised", () => {
    expect(makeService({}).enabled).toBe(false);
  });

  it("registers a brand-new token", async () => {
    const create = jest.fn((x: any) => x);
    const save = jest.fn(async (x: any) => x);
    const repo = { findOne: jest.fn(async () => null), create, save };
    await makeService(repo).registerToken(57, "tok-1", "web");
    expect(create).toHaveBeenCalledWith({ userId: 57, token: "tok-1", platform: "web" });
    expect(save).toHaveBeenCalled();
  });

  it("reassigns an existing token to the current user (idempotent)", async () => {
    const existing: any = { userId: 99, token: "tok-1", platform: "web" };
    const save = jest.fn(async (x: any) => x);
    const repo = { findOne: jest.fn(async () => existing), create: jest.fn(), save };
    await makeService(repo).registerToken(57, "tok-1", "web");
    expect(existing.userId).toBe(57);
    expect(save).toHaveBeenCalledWith(existing);
  });

  it("removeToken deletes only the caller's own token", async () => {
    const del = jest.fn(async () => ({}));
    await makeService({ delete: del }).removeToken(57, "tok-1");
    expect(del).toHaveBeenCalledWith({ userId: 57, token: "tok-1" });
  });

  it("sendToUsers is a no-op when Firebase is not configured", async () => {
    const find = jest.fn();
    await makeService({ find }).sendToUsers([1, 2], { title: "t", body: "b" });
    expect(find).not.toHaveBeenCalled();
  });
});
