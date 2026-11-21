import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(),
  expoConfig: undefined as Record<string, unknown> | undefined,
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("expo-notifications", () => ({
  getPermissionsAsync: () => mocks.getPermissionsAsync(),
  requestPermissionsAsync: () => mocks.requestPermissionsAsync(),
  getExpoPushTokenAsync: (...args: unknown[]) => mocks.getExpoPushTokenAsync(...args),
}));

vi.mock("expo-constants", () => ({
  default: {
    get expoConfig() {
      return mocks.expoConfig;
    },
  },
}));

vi.mock("../logging/logger", () => ({
  logger: { warn: mocks.warn, error: mocks.error, info: vi.fn(), debug: vi.fn() },
}));

import { getExpoPushToken, requestPushPermission } from "./pushTokenService";

describe("requestPushPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not prompt when permission is already granted", async () => {
    mocks.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    await expect(requestPushPermission()).resolves.toBe(true);
    expect(mocks.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("prompts and returns the user's answer", async () => {
    mocks.getPermissionsAsync.mockResolvedValue({ status: "undetermined" });
    mocks.requestPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
    await expect(requestPushPermission()).resolves.toBe(true);

    mocks.requestPermissionsAsync.mockResolvedValueOnce({ status: "denied" });
    await expect(requestPushPermission()).resolves.toBe(false);
  });
});

describe("getExpoPushToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.expoConfig = { extra: { eas: { projectId: "proj-1" } } };
  });

  it("requests the token for the EAS project", async () => {
    mocks.getExpoPushTokenAsync.mockResolvedValue({ data: "ExponentPushToken[x]" });
    await expect(getExpoPushToken()).resolves.toBe("ExponentPushToken[x]");
    expect(mocks.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: "proj-1" });
  });

  it("returns null and warns without an EAS project id", async () => {
    mocks.expoConfig = { extra: {} };
    await expect(getExpoPushToken()).resolves.toBeNull();
    expect(mocks.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalled();
  });

  it("returns null and logs when the token request throws", async () => {
    mocks.getExpoPushTokenAsync.mockRejectedValue(new Error("no FCM"));
    await expect(getExpoPushToken()).resolves.toBeNull();
    expect(mocks.error).toHaveBeenCalledWith("[PushToken] Failed to get Expo push token", expect.anything());
  });
});
