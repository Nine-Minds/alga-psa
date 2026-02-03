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
  status_id?: string | null;
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

export type TicketStatus = {
  status_id: string;
  name: string;
  is_closed: boolean;
};

export type TicketPriority = {
  priority_id: string;
  priority_name: string;
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
      fields: "mobile_list",
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

export function addTicketComment(
  client: ApiClient,
  params: {
    apiKey: string;
    ticketId: string;
    comment_text: string;
    is_internal: boolean;
    auditHeaders?: Record<string, string | undefined>;
  },
): Promise<ApiResult<SuccessResponse<TicketComment>>> {
  return client.request<SuccessResponse<TicketComment>>({
    method: "POST",
    path: `/api/v1/tickets/${params.ticketId}/comments`,
    headers: {
      "x-api-key": params.apiKey,
      ...params.auditHeaders,
    },
    body: {
      comment_text: params.comment_text,
      is_internal: params.is_internal,
    },
  });
}

export function getTicketStatuses(
  client: ApiClient,
  params: { apiKey: string },
): Promise<ApiResult<SuccessResponse<TicketStatus[]>>> {
  return client.request<SuccessResponse<TicketStatus[]>>({
    method: "GET",
    path: "/api/v1/tickets/statuses",
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function getTicketPriorities(
  client: ApiClient,
  params: { apiKey: string },
): Promise<ApiResult<SuccessResponse<TicketPriority[]>>> {
  return client.request<SuccessResponse<TicketPriority[]>>({
    method: "GET",
    path: "/api/v1/tickets/priorities",
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function updateTicketStatus(
  client: ApiClient,
  params: { apiKey: string; ticketId: string; status_id: string; auditHeaders?: Record<string, string | undefined> },
): Promise<ApiResult<SuccessResponse<TicketDetail>>> {
  return client.request<SuccessResponse<TicketDetail>>({
    method: "PUT",
    path: `/api/v1/tickets/${params.ticketId}/status`,
    headers: {
      "x-api-key": params.apiKey,
      ...params.auditHeaders,
    },
    body: {
      status_id: params.status_id,
    },
  });
}

export function updateTicketAssignment(
  client: ApiClient,
  params: {
    apiKey: string;
    ticketId: string;
    assigned_to: string | null;
    auditHeaders?: Record<string, string | undefined>;
  },
): Promise<ApiResult<SuccessResponse<TicketDetail>>> {
  return client.request<SuccessResponse<TicketDetail>>({
    method: "PUT",
    path: `/api/v1/tickets/${params.ticketId}/assignment`,
    headers: {
      "x-api-key": params.apiKey,
      ...params.auditHeaders,
    },
    body: {
      assigned_to: params.assigned_to,
    },
  });
}

export function updateTicketPriority(
  client: ApiClient,
  params: {
    apiKey: string;
    ticketId: string;
    priority_id: string;
    auditHeaders?: Record<string, string | undefined>;
  },
): Promise<ApiResult<SuccessResponse<TicketDetail>>> {
  return client.request<SuccessResponse<TicketDetail>>({
    method: "PUT",
    path: `/api/v1/tickets/${params.ticketId}`,
    headers: {
      "x-api-key": params.apiKey,
      ...params.auditHeaders,
    },
    body: {
      priority_id: params.priority_id,
    },
  });
}

export function updateTicketAttributes(
  client: ApiClient,
  params: {
    apiKey: string;
    ticketId: string;
    attributes: Record<string, unknown> | null;
    auditHeaders?: Record<string, string | undefined>;
  },
): Promise<ApiResult<SuccessResponse<TicketDetail>>> {
  return client.request<SuccessResponse<TicketDetail>>({
    method: "PUT",
    path: `/api/v1/tickets/${params.ticketId}`,
    headers: {
      "x-api-key": params.apiKey,
      ...params.auditHeaders,
    },
    body: {
      attributes: params.attributes,
    },
  });
}
