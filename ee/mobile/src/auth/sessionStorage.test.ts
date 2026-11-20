import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSecureJson: vi.fn(),
  setSecureJson: vi.fn(),
  deleteItem: vi.fn(),
}));

vi.mock("../storage/secureStorage", () => ({
  getSecureJson: (...args: unknown[]) => mocks.getSecureJson(...args),
  setSecureJson: (...args: unknown[]) => mocks.setSecureJson(...args),
  secureStorage: { deleteItem: (...args: unknown[]) => mocks.deleteItem(...args) },
}));

import { clearStoredSession, getStoredSession, storeSession } from "./sessionStorage";

const SESSION = {
  accessToken: "a",
  refreshToken: "r",
  expiresAtMs: 1000,
  tenantId: "t-1",
  user: { id: "u-1" },
};

describe("sessionStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the session from secure storage under the session key", async () => {
    mocks.getSecureJson.mockResolvedValue(SESSION);
    await expect(getStoredSession()).resolves.toEqual(SESSION);
    expect(mocks.getSecureJson).toHaveBeenCalledWith("alga.mobile.session");
  });

  it("returns null when nothing is stored", async () => {
    mocks.getSecureJson.mockResolvedValue(null);
    await expect(getStoredSession()).resolves.toBeNull();
  });

  it("persists the session as JSON under the same key", async () => {
    mocks.setSecureJson.mockResolvedValue(undefined);
    await storeSession(SESSION);
    expect(mocks.setSecureJson).toHaveBeenCalledWith("alga.mobile.session", SESSION);
  });

  it("deletes the stored session on clear", async () => {
    mocks.deleteItem.mockResolvedValue(undefined);
    await clearStoredSession();
    expect(mocks.deleteItem).toHaveBeenCalledWith("alga.mobile.session");
  });

  it("propagates storage write failures so callers can react", async () => {
    mocks.setSecureJson.mockRejectedValue(new Error("keychain locked"));
    await expect(storeSession(SESSION)).rejects.toThrow("keychain locked");
  });
});
