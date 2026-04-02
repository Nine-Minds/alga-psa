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

export type TicketRichAttributes = {
  description?: string | null;
  due_date?: string | null;
  watcher_user_ids?: string[] | null;
  [key: string]: unknown;
};

export type TicketDetail = TicketListItem & {
  attributes?: TicketRichAttributes | null;
  description_html?: string | null;
  priority_id?: string | null;
  assigned_to?: string | null;
  due_date?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  client_email?: string | null;
  client_phone?: string | null;
  location_name?: string | null;
  location_id?: string | null;
} & Record<string, unknown>;

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
  comment_html?: string | null;
  is_internal?: boolean;
  is_resolution?: boolean;
  created_by?: string | null;
  created_by_name?: string | null;
  created_by_avatar_url?: string | null;
  created_at?: string | null;
  kind?: "comment" | "event";
  event_type?: string | null;
  event_text?: string | null;
  optimistic?: boolean;
  reactions?: AggregatedReaction[];
  reaction_user_names?: Record<string, string>;
};

export type TicketStatus = {
  status_id: string;
  board_id: string;
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
  signal?: AbortSignal;
  filters?: {
    is_open?: boolean;
    is_closed?: boolean;
    assigned_to?: string;
    has_assignment?: boolean;
    priority_name?: string;
    status_ids?: string;
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
    signal: params.signal,
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
    is_resolution?: boolean;
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
      ...(params.is_resolution ? { is_resolution: true } : {}),
    },
  });
}

export function getTicketStatuses(
  client: ApiClient,
  params: { apiKey: string; board_id?: string },
): Promise<ApiResult<SuccessResponse<TicketStatus[]>>> {
  return client.request<SuccessResponse<TicketStatus[]>>({
    method: "GET",
    path: "/api/v1/tickets/statuses",
    query: params.board_id ? { board_id: params.board_id } : undefined,
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

export function updateTicketComment(
  client: ApiClient,
  params: {
    apiKey: string;
    ticketId: string;
    commentId: string;
    comment_text: string;
    auditHeaders?: Record<string, string | undefined>;
  },
): Promise<ApiResult<SuccessResponse<TicketComment>>> {
  return client.request<SuccessResponse<TicketComment>>({
    method: "PUT",
    path: `/api/v1/tickets/${params.ticketId}/comments/${params.commentId}`,
    headers: {
      "x-api-key": params.apiKey,
      ...params.auditHeaders,
    },
    body: {
      comment_text: params.comment_text,
    },
  });
}

export function updateTicketTitle(
  client: ApiClient,
  params: {
    apiKey: string;
    ticketId: string;
    title: string;
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
      title: params.title,
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

// --- Create Ticket ---

export type CreateTicketParams = {
  apiKey: string;
  title: string;
  board_id: string;
  client_id: string;
  status_id: string;
  priority_id: string;
  location_id?: string;
  contact_name_id?: string;
  category_id?: string;
  assigned_to?: string;
  attributes?: Record<string, unknown>;
  auditHeaders?: Record<string, string | undefined>;
};

export function createTicket(
  client: ApiClient,
  params: CreateTicketParams,
): Promise<ApiResult<SuccessResponse<TicketDetail>>> {
  const { apiKey, auditHeaders, ...body } = params;
  return client.request<SuccessResponse<TicketDetail>>({
    method: "POST",
    path: "/api/v1/tickets",
    headers: {
      "x-api-key": apiKey,
      ...auditHeaders,
    },
    body,
  });
}

// --- Emoji Reactions ---

export type AggregatedReaction = {
  emoji: string;
  count: number;
  userIds: string[];
  currentUserReacted: boolean;
};

export function toggleCommentReaction(
  client: ApiClient,
  params: { apiKey: string; ticketId: string; commentId: string; emoji: string },
): Promise<ApiResult<SuccessResponse<{ added: boolean }>>> {
  return client.request<SuccessResponse<{ added: boolean }>>({
    method: "POST",
    path: `/api/v1/tickets/${params.ticketId}/comments/${params.commentId}/reactions`,
    headers: { "x-api-key": params.apiKey },
    body: { emoji: params.emoji },
  });
}
