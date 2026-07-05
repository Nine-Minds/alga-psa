import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { PaginatedResponse } from "./tickets";

/**
 * Tenant priorities API.
 *
 * Priorities are per-type (`item_type` is 'ticket' or 'project_task') and fully
 * tenant-defined (e.g. P1..P5, 1..5), so the activities priority filter loads the real
 * set for whichever type the list is scoped to rather than assuming high/medium/low.
 */

export type PriorityItemType = "ticket" | "project_task";

export type MobilePriority = {
  priority_id: string;
  priority_name: string;
  color?: string;
};

/**
 * List the tenant's priorities for a given item type. The generic `/api/v1/priorities`
 * endpoint is a paginated list; priority sets are tiny, so a single large page suffices.
 */
export function listPriorities(
  client: ApiClient,
  params: { apiKey: string; itemType: PriorityItemType; signal?: AbortSignal },
): Promise<ApiResult<PaginatedResponse<MobilePriority>>> {
  return client.request<PaginatedResponse<MobilePriority>>({
    method: "GET",
    path: "/api/v1/priorities",
    signal: params.signal,
    query: { item_type: params.itemType, limit: 100 },
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}
