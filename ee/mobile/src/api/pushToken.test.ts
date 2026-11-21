import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import {
  registerPushToken,
  sendTestPushNotification,
  unregisterPushToken,
  updatePushPriorityThreshold,
} from "./pushToken";

function makeClient() {
  const request = vi.fn(async () => ({ ok: true, status: 200, data: { ok: true } }));
  return { client: { request } as unknown as ApiClient, request };
}

describe("push token API", () => {
  it("registers with the session token as x-api-key and keeps it out of the body", async () => {
    const { client, request } = makeClient();
    await registerPushToken(client, {
      apiKey: "session-token",
      expoPushToken: "ExponentPushToken[abc]",
      deviceId: "device-1",
      platform: "ios",
      appVersion: "1.6.5",
      priorityThreshold: "normal",
    });
    expect(request).toHaveBeenCalledWith({
      method: "PUT",
      path: "/api/v1/mobile/push-token",
      headers: { "x-api-key": "session-token" },
      body: {
        expoPushToken: "ExponentPushToken[abc]",
        deviceId: "device-1",
        platform: "ios",
        appVersion: "1.6.5",
        priorityThreshold: "normal",
      },
    });
  });

  it("unregisters this device", async () => {
    const { client, request } = makeClient();
    await unregisterPushToken(client, { apiKey: "k", deviceId: "device-1" });
    expect(request).toHaveBeenCalledWith({
      method: "DELETE",
      path: "/api/v1/mobile/push-token",
      headers: { "x-api-key": "k" },
      body: { deviceId: "device-1" },
    });
  });

  it("patches only the priority threshold", async () => {
    const { client, request } = makeClient();
    await updatePushPriorityThreshold(client, { apiKey: "k", deviceId: "device-1", priorityThreshold: "high" });
    expect(request).toHaveBeenCalledWith({
      method: "PATCH",
      path: "/api/v1/mobile/push-token",
      headers: { "x-api-key": "k" },
      body: { deviceId: "device-1", priorityThreshold: "high" },
    });
  });

  it("asks the server for a test push without a body", async () => {
    const { client, request } = makeClient();
    await sendTestPushNotification(client, { apiKey: "k" });
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/mobile/push-token/test",
      headers: { "x-api-key": "k" },
    });
  });
});
