import type { ApiClient } from "./client";
import type { ApiResult } from "./types";

/**
 * Client bindings for the UGC moderation endpoints under
 * /api/v1/mobile/moderation/*. See the server routes for the guideline-1.2
 * rationale.
 */

export type ReportContentRequest = {
  contentType: "ticket_comment" | "ticket_description";
  contentId?: string;
  contentAuthorUserId?: string;
  reason?: string;
};

export function reportContent(
  client: ApiClient,
  body: ReportContentRequest,
  signal?: AbortSignal,
): Promise<ApiResult<{ ok: boolean }>> {
  return client.request<{ ok: boolean }>({
    method: "POST",
    path: "/api/v1/mobile/moderation/report",
    body,
    signal,
    timeoutMs: 10_000,
  });
}

export type MutedUsersResponse = {
  mutedUserIds: string[];
};

export function listMutedUsers(
  client: ApiClient,
  signal?: AbortSignal,
): Promise<ApiResult<MutedUsersResponse>> {
  return client.request<MutedUsersResponse>({
    method: "GET",
    path: "/api/v1/mobile/moderation/mutes",
    signal,
    timeoutMs: 10_000,
  });
}

export function muteUser(
  client: ApiClient,
  body: { mutedUserId: string },
  signal?: AbortSignal,
): Promise<ApiResult<{ ok: boolean }>> {
  return client.request<{ ok: boolean }>({
    method: "POST",
    path: "/api/v1/mobile/moderation/mutes",
    body,
    signal,
    timeoutMs: 10_000,
  });
}

export function unmuteUser(
  client: ApiClient,
  mutedUserId: string,
  signal?: AbortSignal,
): Promise<ApiResult<{ ok: boolean }>> {
  return client.request<{ ok: boolean }>({
    method: "DELETE",
    path: `/api/v1/mobile/moderation/mutes/${encodeURIComponent(mutedUserId)}`,
    signal,
    timeoutMs: 10_000,
  });
}
