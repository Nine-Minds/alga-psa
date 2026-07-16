import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { PaginatedResponse, SuccessResponse } from "./tickets";

export type OpportunityStage =
  | "identified"
  | "qualified"
  | "assessment"
  | "proposed"
  | "verbal"
  | "won"
  | "lost";

export type OpportunityStatus = "open" | "won" | "lost";

export type OpportunityLossReason =
  | "no_response"
  | "chose_competitor"
  | "price"
  | "timing"
  | "no_budget"
  | "not_a_fit"
  | "other";

export type OpportunityListItem = {
  opportunity_id: string;
  opportunity_number: string;
  title: string;
  client_id: string;
  client_name?: string;
  contact_id?: string | null;
  status: OpportunityStatus;
  stage: OpportunityStage;
  confidence?: string;
  mrr_cents?: number | null;
  nrr_cents?: number | null;
  hardware_cents?: number | null;
  currency_code?: string | null;
  next_action?: string | null;
  next_action_due?: string | null;
  last_activity_at?: string | null;
  days_since_activity?: number | null;
  is_stalled?: boolean;
  expected_close_date?: string | null;
  owner_id?: string;
};

export type OpportunityDetail = OpportunityListItem & {
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  ladder?: Array<{
    checkpoint: string;
    state: "reached" | "pending" | "skipped";
  }>;
  linked_quotes?: Array<{ quote_id: string; quote_number?: string; status?: string }>;
} & Record<string, unknown>;

export type ListOpportunitiesParams = {
  apiKey: string;
  page: number;
  pageSize: number;
  status?: "open" | "won" | "lost" | "all";
  search?: string;
  signal?: AbortSignal;
};

export function listOpportunities(
  client: ApiClient,
  params: ListOpportunitiesParams,
): Promise<ApiResult<PaginatedResponse<OpportunityListItem>>> {
  return client.request<PaginatedResponse<OpportunityListItem>>({
    method: "GET",
    path: "/api/v1/opportunities",
    signal: params.signal,
    query: {
      page: params.page,
      page_size: params.pageSize,
      status: params.status || undefined,
      search: params.search || undefined,
    },
    headers: { "x-api-key": params.apiKey },
  });
}

export function getOpportunity(
  client: ApiClient,
  params: { apiKey: string; opportunityId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<OpportunityDetail>>> {
  return client.request<SuccessResponse<OpportunityDetail>>({
    method: "GET",
    path: `/api/v1/opportunities/${params.opportunityId}`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export type WorkQueueItem = {
  opportunity_id: string;
  title: string;
  client_name?: string;
  next_action?: string | null;
  next_action_due?: string | null;
  why?: { text: string; emphasis?: string } | string | null;
  overdue?: boolean;
};

export type WorkQueue = {
  greeting?: string;
  sections: Array<{
    key: string;
    title?: string;
    items: WorkQueueItem[];
  }>;
};

export function getWorkQueue(
  client: ApiClient,
  params: { apiKey: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<WorkQueue>>> {
  return client.request<SuccessResponse<WorkQueue>>({
    method: "GET",
    path: "/api/v1/opportunities/work-queue",
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export type TimelineItem = {
  interaction_id: string;
  type_name?: string;
  icon?: string | null;
  title?: string | null;
  notes?: string | null;
  user_name?: string | null;
  interaction_date?: string | null;
  duration?: number | null;
};

export function getOpportunityTimeline(
  client: ApiClient,
  params: { apiKey: string; opportunityId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<TimelineItem[]>>> {
  return client.request<SuccessResponse<TimelineItem[]>>({
    method: "GET",
    path: `/api/v1/opportunities/${params.opportunityId}/timeline`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export function completeNextAction(
  client: ApiClient,
  params: {
    apiKey: string;
    opportunityId: string;
    data: { next_action: string; next_action_due: string };
    signal?: AbortSignal;
  },
): Promise<ApiResult<SuccessResponse<OpportunityDetail>>> {
  return client.request<SuccessResponse<OpportunityDetail>>({
    method: "POST",
    path: `/api/v1/opportunities/${params.opportunityId}/complete-action`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: params.data,
  });
}

export function winOpportunity(
  client: ApiClient,
  params: { apiKey: string; opportunityId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<OpportunityDetail>>> {
  return client.request<SuccessResponse<OpportunityDetail>>({
    method: "POST",
    path: `/api/v1/opportunities/${params.opportunityId}/win`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: {},
  });
}

export function loseOpportunity(
  client: ApiClient,
  params: {
    apiKey: string;
    opportunityId: string;
    data: { loss_reason: OpportunityLossReason; loss_notes?: string; lost_to?: string };
    signal?: AbortSignal;
  },
): Promise<ApiResult<SuccessResponse<OpportunityDetail>>> {
  return client.request<SuccessResponse<OpportunityDetail>>({
    method: "POST",
    path: `/api/v1/opportunities/${params.opportunityId}/lose`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: params.data,
  });
}
