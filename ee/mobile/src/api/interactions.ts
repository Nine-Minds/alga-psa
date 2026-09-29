import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { PaginatedResponse, SuccessResponse } from "./tickets";

export type InteractionType = {
  type_id: string;
  type_name: string;
  icon?: string | null;
  is_system?: boolean;
};

export type InteractionStatus = {
  status_id: string;
  name: string;
  is_closed: boolean;
  is_default?: boolean | null;
  order_number?: number | null;
};

export type InteractionItem = {
  interaction_id: string;
  type_id: string;
  type_name?: string;
  icon?: string | null;
  title?: string | null;
  notes?: string | null;
  client_id?: string | null;
  contact_name_id?: string | null;
  opportunity_id?: string | null;
  ticket_id?: string | null;
  user_id?: string;
  user_name?: string | null;
  client_name?: string | null;
  contact_name?: string | null;
  interaction_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  status_name?: string | null;
  is_status_closed?: boolean | null;
  duration?: number | null;
};

export type CreateInteractionInput = {
  type_id: string;
  title?: string;
  notes?: string;
  client_id?: string;
  contact_name_id?: string;
  opportunity_id?: string;
  ticket_id?: string;
  duration?: number;
  interaction_date?: string;
  start_time?: string;
  end_time?: string;
  create_schedule_entry?: boolean;
  /** Calendar assignees. Defaults to self; assigning others requires user_schedule:update. */
  schedule_assigned_user_ids?: string[];
};

export function listInteractionTypes(
  client: ApiClient,
  params: { apiKey: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<InteractionType[]>>> {
  return client.request<SuccessResponse<InteractionType[]>>({
    method: "GET",
    path: "/api/v1/interaction-types",
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export function listInteractions(
  client: ApiClient,
  params: {
    apiKey: string;
    page: number;
    limit: number;
    opportunityId?: string;
    clientId?: string;
    contactId?: string;
    ticketId?: string;
    userId?: string;
    typeId?: string;
    isClosed?: boolean;
    dateFrom?: string;
    dateTo?: string;
    signal?: AbortSignal;
  },
): Promise<ApiResult<PaginatedResponse<InteractionItem>>> {
  return client.request<PaginatedResponse<InteractionItem>>({
    method: "GET",
    path: "/api/v1/interactions",
    signal: params.signal,
    query: {
      page: params.page,
      limit: params.limit,
      opportunity_id: params.opportunityId || undefined,
      client_id: params.clientId || undefined,
      contact_id: params.contactId || undefined,
      ticket_id: params.ticketId || undefined,
      user_id: params.userId || undefined,
      type_id: params.typeId || undefined,
      is_closed: params.isClosed === undefined ? undefined : String(params.isClosed),
      date_from: params.dateFrom || undefined,
      date_to: params.dateTo || undefined,
    },
    headers: { "x-api-key": params.apiKey },
  });
}

export function createInteraction(
  client: ApiClient,
  params: { apiKey: string; data: CreateInteractionInput; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<InteractionItem>>> {
  return client.request<SuccessResponse<InteractionItem>>({
    method: "POST",
    path: "/api/v1/interactions",
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: params.data,
  });
}

export function getInteraction(
  client: ApiClient,
  params: { apiKey: string; interactionId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<InteractionItem>>> {
  return client.request<SuccessResponse<InteractionItem>>({
    method: "GET",
    path: `/api/v1/interactions/${params.interactionId}`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export function listInteractionStatuses(
  client: ApiClient,
  params: { apiKey: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<InteractionStatus[]>>> {
  return client.request<SuccessResponse<InteractionStatus[]>>({
    method: "GET",
    path: "/api/v1/interaction-statuses",
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

/** Change an interaction's status or notes (title and timing stay web-only for now). */
export function updateInteraction(
  client: ApiClient,
  params: { apiKey: string; interactionId: string; data: { status_id?: string | null; notes?: string }; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<InteractionItem>>> {
  return client.request<SuccessResponse<InteractionItem>>({
    method: "PUT",
    path: `/api/v1/interactions/${params.interactionId}`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: params.data,
  });
}
