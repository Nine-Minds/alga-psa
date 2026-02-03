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

export type SuccessResponse<T> = {
  data: T;
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
  contact_name?: string | null;
  updated_at?: string | null;
  entered_at?: string | null;
  closed_at?: string | null;
};

export type TicketDetail = TicketListItem & Record<string, unknown>;

export type TicketStats = {
  total_tickets: number;
  open_tickets: number;
  closed_tickets: number;
  overdue_tickets: number;
  unassigned_tickets: number;
};

export type TicketComment = {
  comment_id?: string;
  comment_text: string;
  is_internal?: boolean;
  created_by_name?: string | null;
  created_at?: string | null;
};

export type ListTicketsParams = {
  apiKey: string;
  page: number;
  limit: number;
  sort?: string;
  order?: "asc" | "desc";
  search?: string;
  filters?: {
    is_open?: boolean;
    is_closed?: boolean;
    assigned_to?: string;
    has_assignment?: boolean;
    priority_name?: string;
    updated_from?: string;
  };
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
      ...(params.filters ?? {}),
    },
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function getTicketById(
  client: ApiClient,
  params: { apiKey: string; ticketId: string },
): Promise<ApiResult<SuccessResponse<TicketDetail>>> {
  return client.request<SuccessResponse<TicketDetail>>({
    method: "GET",
    path: `/api/v1/tickets/${params.ticketId}`,
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function getTicketStats(
  client: ApiClient,
  params: { apiKey: string },
): Promise<ApiResult<SuccessResponse<TicketStats>>> {
  return client.request<SuccessResponse<TicketStats>>({
    method: "GET",
    path: "/api/v1/tickets/stats",
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function getTicketComments(
  client: ApiClient,
  params: { apiKey: string; ticketId: string },
): Promise<ApiResult<SuccessResponse<TicketComment[]>>> {
  return client.request<SuccessResponse<TicketComment[]>>({
    method: "GET",
    path: `/api/v1/tickets/${params.ticketId}/comments`,
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}
