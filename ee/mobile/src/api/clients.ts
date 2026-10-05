import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { PaginatedResponse, SuccessResponse } from "./tickets";
import type { ContactListItem } from "./contacts";

export type ClientListItem = {
  client_id: string;
  client_name: string;
  email?: string | null;
  phone_no?: string | null;
  url?: string | null;
  address?: string | null;
  is_inactive?: boolean;
  client_type?: string | null;
  lifecycle_status?: "prospect" | "active" | "former" | null;
  default_currency_code?: string | null;
  account_manager_full_name?: string | null;
  logoUrl?: string | null;
  created_at?: string | null;
};

export type ClientDetail = ClientListItem & {
  account_manager_id?: string | null;
  notes?: string | null;
  tags?: string[];
  updated_at?: string | null;
  properties?: ({ industry?: string | null } & Record<string, unknown>) | null;
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
  country_code?: string | null;
  phone?: string | null;
  phone_extension?: string | null;
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

/** Writable client fields. Phone, email and address live on the default location. */
export type ClientWriteInput = {
  client_name?: string;
  client_type?: "company" | "individual";
  url?: string;
  account_manager_id?: string | null;
  is_inactive?: boolean;
  /** With is_inactive: also deactivate contacts and portal users (server default true). */
  deactivate_contacts?: boolean;
  notes?: string;
  tags?: string[];
  properties?: { industry?: string };
};

export type UpdateClientInput = ClientWriteInput;

export type CreateClientInput = ClientWriteInput & { client_name: string };

export function createClient(
  client: ApiClient,
  params: {
    apiKey: string;
    data: CreateClientInput;
    auditHeaders?: Record<string, string | undefined>;
    signal?: AbortSignal;
  },
): Promise<ApiResult<SuccessResponse<ClientDetail>>> {
  return client.request<SuccessResponse<ClientDetail>>({
    method: "POST",
    path: "/api/v1/clients",
    signal: params.signal,
    headers: {
      "x-api-key": params.apiKey,
      ...params.auditHeaders,
    },
    // billing_cycle is required by the API; monthly is the web quick-add default.
    body: { billing_cycle: "monthly", ...params.data },
  });
}

export function updateClient(
  client: ApiClient,
  params: {
    apiKey: string;
    clientId: string;
    data: UpdateClientInput;
    auditHeaders?: Record<string, string | undefined>;
    signal?: AbortSignal;
  },
): Promise<ApiResult<SuccessResponse<ClientDetail>>> {
  return client.request<SuccessResponse<ClientDetail>>({
    method: "PUT",
    path: `/api/v1/clients/${params.clientId}`,
    signal: params.signal,
    headers: {
      "x-api-key": params.apiKey,
      ...params.auditHeaders,
    },
    body: params.data,
  });
}

export function getClientContacts(
  client: ApiClient,
  params: { apiKey: string; clientId: string; page: number; limit: number; signal?: AbortSignal },
): Promise<ApiResult<PaginatedResponse<ContactListItem>>> {
  return client.request<PaginatedResponse<ContactListItem>>({
    method: "GET",
    path: `/api/v1/clients/${params.clientId}/contacts`,
    signal: params.signal,
    query: {
      page: params.page,
      limit: params.limit,
    },
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

export type ClientLocationWriteInput = {
  location_name?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country_code?: string;
  country_name?: string;
  phone?: string;
  phone_extension?: string;
  /** null clears a stored email on update. */
  email?: string | null;
  is_default?: boolean;
};

export function createClientLocation(
  client: ApiClient,
  params: {
    apiKey: string;
    clientId: string;
    data: ClientLocationWriteInput & { country_code: string; country_name: string };
    auditHeaders?: Record<string, string | undefined>;
    signal?: AbortSignal;
  },
): Promise<ApiResult<SuccessResponse<ClientLocation>>> {
  return client.request<SuccessResponse<ClientLocation>>({
    method: "POST",
    path: `/api/v1/clients/${params.clientId}/locations`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey, ...params.auditHeaders },
    body: params.data,
  });
}

export function updateClientLocation(
  client: ApiClient,
  params: {
    apiKey: string;
    clientId: string;
    locationId: string;
    data: ClientLocationWriteInput;
    auditHeaders?: Record<string, string | undefined>;
    signal?: AbortSignal;
  },
): Promise<ApiResult<SuccessResponse<ClientLocation>>> {
  return client.request<SuccessResponse<ClientLocation>>({
    method: "PUT",
    path: `/api/v1/clients/${params.clientId}/locations/${params.locationId}`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey, ...params.auditHeaders },
    body: params.data,
  });
}

// Client notes are a single BlockNote (rich-text) document per client, shared
// with the web client page. Mobile flattens blockData to text for display and
// appends paragraph blocks for new notes (see features/assets/blockNote).
export type ClientNoteContent = {
  document: unknown | null;
  blockData: unknown | null;
  lastUpdated: string | null;
};

export function getClientNotes(
  client: ApiClient,
  params: { apiKey: string; clientId: string; signal?: AbortSignal },
): Promise<ApiResult<{ data: ClientNoteContent }>> {
  return client.request<{ data: ClientNoteContent }>({
    method: "GET",
    path: `/api/v1/clients/${params.clientId}/notes`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

/** Replace the client's notes document. Pass the full block array, including
 *  any pre-existing blocks (appendNoteBlock handles that). */
export function saveClientNotes(
  client: ApiClient,
  params: { apiKey: string; clientId: string; blockData: unknown; signal?: AbortSignal },
): Promise<ApiResult<{ data: unknown }>> {
  return client.request<{ data: unknown }>({
    method: "PUT",
    path: `/api/v1/clients/${params.clientId}/notes`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: { blockData: params.blockData },
  });
}
