import type { ApiClient } from "./client";
import type { ApiResult } from "./types";

/**
 * Client binding for POST /api/v1/mobile/auth/apple — Sign in with Apple.
 * The server returns a one-time token that the existing AuthCallback flow
 * exchanges for a mobile session.
 */

export type AppleSignInRequest = {
  identityToken: string;
  authorizationCode?: string;
  firstName?: string;
  lastName?: string;
  state: string;
};

export type AppleSignInResponse = {
  ott: string;
  state: string;
  expiresInSec: number;
};

export function signInWithAppleOnServer(
  client: ApiClient,
  body: AppleSignInRequest,
  signal?: AbortSignal,
): Promise<ApiResult<AppleSignInResponse>> {
  return client.request<AppleSignInResponse>({
    method: "POST",
    path: "/api/v1/mobile/auth/apple",
    body,
    signal,
    timeoutMs: 15_000,
  });
}
