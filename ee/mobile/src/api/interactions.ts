import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { PaginatedResponse, SuccessResponse } from "./tickets";

export type InteractionType = {
  type_id: string;
  type_name: string;
  icon?: string | null;
  is_system?: boolean;
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
  interaction_date?: string | null;
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
