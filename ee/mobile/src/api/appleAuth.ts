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

/**
 * Link / unlink an Apple ID to the currently signed-in Alga user. Used from
 * Settings when the Apple email and Alga email differ, so the unauthenticated
 * sign-in path can't auto-link by email.
 */

export type AppleLinkStatus = {
  linked: boolean;
  email?: string | null;
  isPrivateEmail?: boolean;
};

export function getAppleLinkStatus(
  client: ApiClient,
  signal?: AbortSignal,
): Promise<ApiResult<AppleLinkStatus>> {
  return client.request<AppleLinkStatus>({
    method: "GET",
    path: "/api/v1/mobile/auth/apple/link",
    signal,
    timeoutMs: 10_000,
  });
}

export type LinkAppleIdRequest = {
  identityToken: string;
  authorizationCode?: string;
};

export function linkAppleId(
  client: ApiClient,
  body: LinkAppleIdRequest,
  signal?: AbortSignal,
): Promise<ApiResult<AppleLinkStatus>> {
  return client.request<AppleLinkStatus>({
    method: "POST",
    path: "/api/v1/mobile/auth/apple/link",
    body,
    signal,
    timeoutMs: 15_000,
  });
}

export function unlinkAppleId(
  client: ApiClient,
  signal?: AbortSignal,
): Promise<ApiResult<{ linked: false }>> {
  return client.request<{ linked: false }>({
    method: "DELETE",
    path: "/api/v1/mobile/auth/apple/link",
    signal,
    timeoutMs: 15_000,
  });
}
