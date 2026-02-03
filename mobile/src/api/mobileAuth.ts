import type { ApiClient } from "./client";
import type { ApiResult } from "./types";

export type ExchangeOttRequest = {
  ott: string;
  state: string;
  device?: {
    platform?: string;
    appVersion?: string;
  };
};

export type ExchangeOttResponse = {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  tenantId?: string;
  user?: { id: string; email?: string; name?: string };
};

export function exchangeOtt(
  client: ApiClient,
  body: ExchangeOttRequest,
): Promise<ApiResult<ExchangeOttResponse>> {
  return client.request<ExchangeOttResponse>({
    method: "POST",
    path: "/api/v1/mobile/auth/exchange",
    body,
  });
}

export type RefreshSessionRequest = {
  refreshToken: string;
  device?: {
    platform?: string;
    appVersion?: string;
  };
};

export type RefreshSessionResponse = {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
};

export function refreshSession(
  client: ApiClient,
  body: RefreshSessionRequest,
): Promise<ApiResult<RefreshSessionResponse>> {
  return client.request<RefreshSessionResponse>({
    method: "POST",
    path: "/api/v1/mobile/auth/refresh",
    body,
  });
}

export type RevokeSessionRequest = {
  refreshToken: string;
};

export function revokeSession(
  client: ApiClient,
  body: RevokeSessionRequest,
): Promise<ApiResult<unknown>> {
  return client.request<unknown>({
    method: "POST",
    path: "/api/v1/mobile/auth/revoke",
    body,
  });
}
