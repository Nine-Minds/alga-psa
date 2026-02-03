import type { ApiClient } from "./client";
import type { ApiResult } from "./types";

export type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export type PaginatedResponse<T> = {
  data: T[];
  pagination: Pagination;
  meta?: unknown;
};

export type TicketListItem = {
  ticket_id: string;
  ticket_number: string;
  title: string;
  status_name?: string | null;
  status_is_closed?: boolean | null;
  priority_name?: string | null;
  assigned_to_name?: string | null;
  client_name?: string | null;
  updated_at?: string | null;
  entered_at?: string | null;
};

export type ListTicketsParams = {
  apiKey: string;
  page: number;
  limit: number;
  sort?: string;
  order?: "asc" | "desc";
  search?: string;
};

export function listTickets(
  client: ApiClient,
  params: ListTicketsParams,
): Promise<ApiResult<PaginatedResponse<TicketListItem>>> {
  return client.request<PaginatedResponse<TicketListItem>>({
    method: "GET",
    path: "/api/v1/tickets",
    query: {
      page: params.page,
      limit: params.limit,
      sort: params.sort ?? "updated_at",
      order: params.order ?? "desc",
      search: params.search,
    },
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}
