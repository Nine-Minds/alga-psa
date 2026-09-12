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

export type TestPushResult = {
  ok: boolean;
  deviceCount: number;
  reason?: "no_active_tokens" | "send_failed";
  results: Array<{ platform: string; status: "ok" | "error"; error?: string | null }>;
};

// The token endpoints authenticate with the session token as x-api-key like
// every other v1 call. Relying on the client's 401 → refresh → retry path
// instead burned a refresh rotation per launch and failed silently whenever
// that detour did not complete.
function authHeaders(apiKey: string): Record<string, string> {
  return { "x-api-key": apiKey };
}

export function registerPushToken(
  client: ApiClient,
  params: RegisterPushTokenRequest & { apiKey: string },
): Promise<ApiResult<{ ok: boolean }>> {
  const { apiKey, ...body } = params;
  return client.request<{ ok: boolean }>({
    method: "PUT",
    path: "/api/v1/mobile/push-token",
    headers: authHeaders(apiKey),
    body,
  });
}

export function unregisterPushToken(
  client: ApiClient,
  params: UnregisterPushTokenRequest & { apiKey: string },
): Promise<ApiResult<{ ok: boolean }>> {
  const { apiKey, ...body } = params;
  return client.request<{ ok: boolean }>({
    method: "DELETE",
    path: "/api/v1/mobile/push-token",
    headers: authHeaders(apiKey),
    body,
  });
}

/** Ask the server to push a test notification to this user's registered devices. */
export function sendTestPushNotification(
  client: ApiClient,
  params: { apiKey: string },
): Promise<ApiResult<TestPushResult>> {
  return client.request<TestPushResult>({
    method: "POST",
    path: "/api/v1/mobile/push-token/test",
    headers: authHeaders(params.apiKey),
  });
}
