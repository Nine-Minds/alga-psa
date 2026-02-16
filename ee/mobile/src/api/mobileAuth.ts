import type { ApiClient } from "./client";
import type { ApiResult } from "./types";

export type ExchangeOttRequest = {
  ott: string;
  state: string;
  device?: {
    platform?: string;
    appVersion?: string;
    buildVersion?: string;
    deviceId?: string;
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
  signal?: AbortSignal,
): Promise<ApiResult<ExchangeOttResponse>> {
  return client.request<ExchangeOttResponse>({
    method: "POST",
    path: "/api/v1/mobile/auth/exchange",
    body,
    signal,
  });
}

export type ExchangeOttRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

function isRetryableExchangeError(result: ApiResult<unknown>): boolean {
  if (result.ok) return false;
  if (result.error.kind === "network" || result.error.kind === "timeout") return true;
  return (
    result.error.kind === "server" &&
    result.status !== undefined &&
    (result.status === 502 || result.status === 503 || result.status === 504)
  );
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handle = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(handle);
      reject(new Error("aborted"));
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export async function exchangeOttWithRetry(
  client: ApiClient,
  body: ExchangeOttRequest,
  options: ExchangeOttRetryOptions = {},
  signal?: AbortSignal,
): Promise<ApiResult<ExchangeOttResponse>> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 2_000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) return { ok: false, error: { kind: "canceled", message: "Request canceled" } };

    const result = await exchangeOtt(client, body, signal);
    if (result.ok) return result;
    if (result.error.kind === "canceled") return result;

    const isLastAttempt = attempt === maxAttempts - 1;
    if (!isRetryableExchangeError(result) || isLastAttempt) return result;

    const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    const jittered = Math.round(delay * (0.8 + Math.random() * 0.4));
    try {
      await sleep(jittered, signal);
    } catch {
      return { ok: false, error: { kind: "canceled", message: "Request canceled" } };
    }
  }

  return { ok: false, error: { kind: "network", message: "Network request failed" } };
}

export type RefreshSessionRequest = {
  refreshToken: string;
  device?: {
    platform?: string;
    appVersion?: string;
    buildVersion?: string;
    deviceId?: string;
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

export type MobileAuthCapabilities = {
  mobileEnabled: boolean;
  providers: {
    microsoft: boolean;
    google: boolean;
  };
  hostedDomainAllowlist?: string[];
};

export function getAuthCapabilities(
  client: ApiClient,
): Promise<ApiResult<MobileAuthCapabilities>> {
  return client.request<MobileAuthCapabilities>({
    method: "GET",
    path: "/api/v1/mobile/auth/capabilities",
  });
}
