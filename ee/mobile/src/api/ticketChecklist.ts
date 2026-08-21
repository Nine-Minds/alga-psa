import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { SuccessResponse } from "./tickets";

export type TicketChecklistItem = {
  checklist_item_id: string;
  ticket_id: string;
  item_name: string;
  description: string | null;
  order_number: number;
  assigned_to: string | null;
  is_required: boolean;
  completed: boolean;
  completed_by: string | null;
  completed_at: string | null;
  completed_by_name?: string | null;
  source: "manual" | "template" | "workflow";
  template_id: string | null;
};

export function getTicketChecklist(
  client: ApiClient,
  params: { apiKey: string; ticketId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<TicketChecklistItem[]>>> {
  return client.request({
    method: "GET",
    path: `/api/v1/tickets/${params.ticketId}/checklist`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export function createTicketChecklistItem(
  client: ApiClient,
  params: {
    apiKey: string;
    ticketId: string;
    itemName: string;
    isRequired?: boolean;
    auditHeaders?: Record<string, string | undefined>;
  },
): Promise<ApiResult<SuccessResponse<TicketChecklistItem>>> {
  return client.request({
    method: "POST",
    path: `/api/v1/tickets/${params.ticketId}/checklist`,
    headers: { "x-api-key": params.apiKey, ...params.auditHeaders },
    body: {
      item_name: params.itemName,
      ...(params.isRequired ? { is_required: true } : {}),
    },
  });
}

export function setTicketChecklistItemCompleted(
  client: ApiClient,
  params: {
    apiKey: string;
    ticketId: string;
    itemId: string;
    completed: boolean;
    auditHeaders?: Record<string, string | undefined>;
  },
): Promise<ApiResult<SuccessResponse<TicketChecklistItem>>> {
  return client.request({
    method: "PATCH",
    path: `/api/v1/tickets/${params.ticketId}/checklist/${params.itemId}`,
    headers: { "x-api-key": params.apiKey, ...params.auditHeaders },
    body: { completed: params.completed },
  });
}
