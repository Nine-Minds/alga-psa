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

export type OpportunityType = "new_logo" | "expansion" | "renewal" | "project";

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
  owner_name?: string | null;
  ladder?: Array<{
    checkpoint: string;
    state: "reached" | "pending" | "skipped";
  }>;
  linked_quotes?: Array<{
    quote_id: string;
    quote_number?: string;
    status?: string;
    total_amount?: number | null;
    currency_code?: string | null;
  }>;
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

export type TranslatableText = {
  key: string;
  params?: Record<string, string | number>;
};

export type WorkQueueWhy = {
  segments: Array<{
    message: TranslatableText;
    emphasis?: boolean;
  }>;
};

export type WorkQueueActionItem = {
  kind: "action_due" | "going_quiet";
  opportunity_id: string;
  opportunity_number: string;
  title: string;
  client_name: string;
  stage: OpportunityStage;
  mrr_cents: number;
  nrr_cents: number;
  hardware_cents: number;
  currency_code: string;
  next_action?: string | null;
  next_action_due?: string | null;
  days_overdue: number;
  days_since_activity: number;
  why: WorkQueueWhy;
  is_screen_primary: boolean;
};

export type WorkQueueSuggestionItem = {
  kind: "suggestion";
  suggestion_id: string;
  generator_key: "renewal" | "tm_conversion" | "whitespace" | "asset_aging" | "inbound-lead";
  title: TranslatableText;
  client_name: string;
  mrr_cents: number;
  nrr_cents: number;
  currency_code: string;
  how: TranslatableText;
  why: WorkQueueWhy;
};

export type WorkQueueFoundTotal = {
  currency_code: string;
  mrr_cents: number;
  nrr_cents: number;
};

export type WorkQueueLesson = {
  insight_key: string;
  why: WorkQueueWhy;
  action_label: TranslatableText;
  action_href: string;
};

export type WorkQueue = {
  user_first_name: string;
  date: string;
  found_totals: WorkQueueFoundTotal[];
  do_today: WorkQueueActionItem[];
  going_quiet: WorkQueueActionItem[];
  money_found: WorkQueueSuggestionItem[];
  lesson?: WorkQueueLesson | null;
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

export type CreateOpportunityInput = {
  client_id: string;
  contact_id?: string | null;
  title: string;
  opportunity_type: OpportunityType;
  confidence?: "low" | "medium" | "high" | "committed";
  mrr_cents?: number;
  nrr_cents?: number;
  hardware_cents?: number;
  currency_code: string;
  expected_close_date?: string | null;
  next_action: string;
  next_action_due: string;
};

export function createOpportunity(
  client: ApiClient,
  params: { apiKey: string; data: CreateOpportunityInput; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<OpportunityDetail>>> {
  return client.request<SuccessResponse<OpportunityDetail>>({
    method: "POST",
    path: "/api/v1/opportunities",
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: params.data,
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

export type OpportunityStepStatus = "planned" | "current" | "done" | "skipped";

export type OpportunityStep = {
  step_id: string;
  opportunity_id: string;
  title: string;
  due_at?: string | null;
  has_time: boolean;
  duration_minutes: number;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  checkpoint?: Exclude<OpportunityStage, "identified" | "lost"> | null;
  stage?: Exclude<OpportunityStage, "won" | "lost"> | null;
  status: OpportunityStepStatus;
  sort_order: number;
  ticket_id?: string | null;
  ticket_number?: string | null;
  project_task_id?: string | null;
  project_task_name?: string | null;
  completed_at?: string | null;
};

export function listOpportunitySteps(
  client: ApiClient,
  params: { apiKey: string; opportunityId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<OpportunityStep[]>>> {
  return client.request<SuccessResponse<OpportunityStep[]>>({
    method: "GET",
    path: `/api/v1/opportunities/${params.opportunityId}/steps`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export type CompleteOpportunityStepInput = {
  next_step_id?: string | null;
  next_action?: string | null;
  next_action_due?: string | null;
  checkpoint?: "qualified" | "assessment" | "proposed" | "verbal" | null;
};

export function completeOpportunityStep(
  client: ApiClient,
  params: {
    apiKey: string;
    opportunityId: string;
    stepId: string;
    data: CompleteOpportunityStepInput;
    signal?: AbortSignal;
  },
): Promise<ApiResult<SuccessResponse<OpportunityStep[]>>> {
  return client.request<SuccessResponse<OpportunityStep[]>>({
    method: "POST",
    path: `/api/v1/opportunities/${params.opportunityId}/steps/${params.stepId}/complete`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: params.data,
  });
}

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
