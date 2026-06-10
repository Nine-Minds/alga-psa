import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { PaginatedResponse, SuccessResponse } from "./tickets";

export type ClientListItem = {
  client_id: string;
  client_name: string;
  email?: string | null;
  phone_no?: string | null;
  url?: string | null;
  address?: string | null;
  is_inactive?: boolean;
  client_type?: string | null;
  account_manager_full_name?: string | null;
  logoUrl?: string | null;
  created_at?: string | null;
};

export type ClientDetail = ClientListItem & {
  account_manager_id?: string | null;
  notes?: string | null;
  updated_at?: string | null;
} & Record<string, unknown>;

export type ClientLocation = {
  location_id: string;
  location_name: string | null;
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state_province?: string | null;
  postal_code?: string | null;
  country_name?: string | null;
  phone?: string | null;
  email?: string | null;
  is_default?: boolean;
};

export type ListClientsParams = {
  apiKey: string;
  page: number;
  limit: number;
  search?: string;
  signal?: AbortSignal;
};

export function listClients(
  client: ApiClient,
  params: ListClientsParams,
): Promise<ApiResult<PaginatedResponse<ClientListItem>>> {
  return client.request<PaginatedResponse<ClientListItem>>({
    method: "GET",
    path: "/api/v1/clients",
    signal: params.signal,
    query: {
      page: params.page,
      limit: params.limit,
      sort: "client_name",
      order: "asc",
      is_inactive: "false",
      client_name: params.search || undefined,
    },
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function getClient(
  client: ApiClient,
  params: { apiKey: string; clientId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<ClientDetail>>> {
  return client.request<SuccessResponse<ClientDetail>>({
    method: "GET",
    path: `/api/v1/clients/${params.clientId}`,
    signal: params.signal,
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function getClientLocations(
  client: ApiClient,
  params: { apiKey: string; clientId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<ClientLocation[]>>> {
  return client.request<SuccessResponse<ClientLocation[]>>({
    method: "GET",
    path: `/api/v1/clients/${params.clientId}/locations`,
    signal: params.signal,
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}
