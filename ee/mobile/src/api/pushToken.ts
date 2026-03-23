import type { ApiClient } from "./client";
import type { ApiResult } from "./types";

export type RegisterPushTokenRequest = {
  expoPushToken: string;
  deviceId: string;
  platform: string;
  appVersion?: string;
};

export type UnregisterPushTokenRequest = {
  deviceId: string;
};

export function registerPushToken(
  client: ApiClient,
  body: RegisterPushTokenRequest,
): Promise<ApiResult<{ ok: boolean }>> {
  return client.request<{ ok: boolean }>({
    method: "PUT",
    path: "/api/v1/mobile/push-token",
    body,
  });
}

export function unregisterPushToken(
  client: ApiClient,
  body: UnregisterPushTokenRequest,
): Promise<ApiResult<{ ok: boolean }>> {
  return client.request<{ ok: boolean }>({
    method: "DELETE",
    path: "/api/v1/mobile/push-token",
    body,
  });
}
