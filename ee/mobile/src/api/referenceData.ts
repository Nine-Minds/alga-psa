import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { PaginatedResponse } from "./tickets";

// --- Clients ---

export type ClientListItem = {
  client_id: string;
  client_name: string;
  email?: string | null;
  phone?: string | null;
  is_inactive?: boolean;
  logoUrl?: string | null;
};

export function listClients(
  client: ApiClient,
  params: {
    apiKey: string;
    search?: string;
    limit?: number;
    signal?: AbortSignal;
  },
): Promise<ApiResult<PaginatedResponse<ClientListItem>>> {
  return client.request<PaginatedResponse<ClientListItem>>({
    method: "GET",
    path: "/api/v1/clients",
    query: {
      limit: params.limit ?? 50,
      sort: "client_name",
      order: "asc",
      ...(params.search ? { search: params.search } : {}),
    },
    headers: { "x-api-key": params.apiKey },
    signal: params.signal,
  });
}

// --- Contacts ---

export type ContactListItem = {
  contact_name_id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  client_id?: string | null;
  avatarUrl?: string | null;
};

export function listContacts(
  client: ApiClient,
  params: {
    apiKey: string;
    clientId?: string;
    search?: string;
    limit?: number;
    signal?: AbortSignal;
  },
): Promise<ApiResult<PaginatedResponse<ContactListItem>>> {
  return client.request<PaginatedResponse<ContactListItem>>({
    method: "GET",
    path: "/api/v1/contacts",
    query: {
      limit: params.limit ?? 50,
      sort: "full_name",
      order: "asc",
      ...(params.clientId ? { client_id: params.clientId } : {}),
      ...(params.search ? { search: params.search } : {}),
    },
    headers: { "x-api-key": params.apiKey },
    signal: params.signal,
  });
}

// --- Boards ---

export type BoardListItem = {
  board_id: string;
  board_name: string;
  is_default?: boolean;
  default_assigned_to?: string | null;
};

export function listBoards(
  client: ApiClient,
  params: {
    apiKey: string;
    signal?: AbortSignal;
  },
): Promise<ApiResult<PaginatedResponse<BoardListItem>>> {
  return client.request<PaginatedResponse<BoardListItem>>({
    method: "GET",
    path: "/api/v1/boards",
    query: {
      limit: 100,
      sort: "name",
      order: "asc",
    },
    headers: { "x-api-key": params.apiKey },
    signal: params.signal,
  });
}

// --- Categories ---

export type CategoryListItem = {
  category_id: string;
  category_name: string;
  parent_category?: string | null;
};

export function listTicketCategories(
  client: ApiClient,
  params: {
    apiKey: string;
    signal?: AbortSignal;
  },
): Promise<ApiResult<PaginatedResponse<CategoryListItem>>> {
  return client.request<PaginatedResponse<CategoryListItem>>({
    method: "GET",
    path: "/api/v1/categories/ticket",
    query: { limit: 100 },
    headers: { "x-api-key": params.apiKey },
    signal: params.signal,
  });
}

// --- Client Locations ---

export type LocationListItem = {
  location_id: string;
  location_name: string | null;
  address_line1?: string | null;
  city?: string | null;
  state_province?: string | null;
};

export type SuccessResponseArray<T> = {
  data: T[];
};

export function listClientLocations(
  client: ApiClient,
  params: {
    apiKey: string;
    clientId: string;
    signal?: AbortSignal;
  },
): Promise<ApiResult<SuccessResponseArray<LocationListItem>>> {
  return client.request<SuccessResponseArray<LocationListItem>>({
    method: "GET",
    path: `/api/v1/clients/${params.clientId}/locations`,
    headers: { "x-api-key": params.apiKey },
    signal: params.signal,
  });
}
