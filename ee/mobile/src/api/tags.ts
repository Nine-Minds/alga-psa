import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { PaginatedResponse, SuccessResponse } from "./tickets";

export type TicketTag = {
  tag_id: string;
  tag_text: string;
  tagged_id?: string;
  tagged_type?: string;
  board_id?: string | null;
  background_color?: string | null;
  text_color?: string | null;
  created_by?: string | null;
};

export type TagSuggestion = {
  tag_text: string;
  background_color: string | null;
  text_color: string | null;
};

export type EntityTags = {
  entity_id: string;
  entity_type: string;
  tags: TicketTag[];
  total_tags: number;
};

export type AddTicketTagResult = {
  entity_id: string;
  entity_type: string;
  tags: TicketTag[];
  created_count: number;
};

export type RemoveTicketTagResult = {
  entity_id: string;
  entity_type: string;
  removed_count: number;
  message?: string;
};

export function getTicketTags(
  client: ApiClient,
  params: { apiKey: string; ticketId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<EntityTags>>> {
  return client.request<SuccessResponse<EntityTags>>({
    method: "GET",
    path: `/api/v1/tags/entity/ticket/${params.ticketId}`,
    signal: params.signal,
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function addTicketTag(
  client: ApiClient,
  params: {
    apiKey: string;
    ticketId: string;
    tagText: string;
    auditHeaders?: Record<string, string | undefined>;
  },
): Promise<ApiResult<SuccessResponse<AddTicketTagResult>>> {
  return client.request<SuccessResponse<AddTicketTagResult>>({
    method: "POST",
    path: `/api/v1/tags/entity/ticket/${params.ticketId}`,
    headers: {
      "x-api-key": params.apiKey,
      ...params.auditHeaders,
    },
    body: {
      entity_id: params.ticketId,
      entity_type: "ticket",
      tags: [params.tagText],
    },
  });
}

export function removeTicketTag(
  client: ApiClient,
  params: {
    apiKey: string;
    ticketId: string;
    tagId: string;
    auditHeaders?: Record<string, string | undefined>;
  },
): Promise<ApiResult<SuccessResponse<RemoveTicketTagResult>>> {
  return client.request<SuccessResponse<RemoveTicketTagResult>>({
    method: "DELETE",
    path: `/api/v1/tags/entity/ticket/${params.ticketId}`,
    headers: {
      "x-api-key": params.apiKey,
      ...params.auditHeaders,
    },
    body: {
      entity_id: params.ticketId,
      entity_type: "ticket",
      tag_ids: [params.tagId],
    },
  });
}

export function dedupeTagSuggestions(
  rows: Array<{ tag_text?: unknown; background_color?: unknown; text_color?: unknown }>,
): TagSuggestion[] {
  const seen = new Map<string, TagSuggestion>();
  for (const row of rows) {
    const text = typeof row.tag_text === "string" ? row.tag_text.trim() : "";
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.set(key, {
      tag_text: text,
      background_color: typeof row.background_color === "string" ? row.background_color : null,
      text_color: typeof row.text_color === "string" ? row.text_color : null,
    });
  }
  return [...seen.values()].sort((a, b) =>
    a.tag_text.localeCompare(b.tag_text, undefined, { sensitivity: "base" }),
  );
}

type TagCloudEntry = {
  tag_text: string;
  background_color: string | null;
  text_color: string | null;
};

export async function searchTagSuggestions(
  client: ApiClient,
  params: { apiKey: string; search: string; limit?: number; signal?: AbortSignal },
): Promise<ApiResult<TagSuggestion[]>> {
  const term = params.search.trim();
  const limit = params.limit ?? 50;

  if (!term) {
    const res = await client.request<SuccessResponse<{ tags?: TagCloudEntry[] }>>({
      method: "GET",
      path: "/api/v1/tags/cloud",
      signal: params.signal,
      query: {
        entity_type: "ticket",
        limit,
      },
      headers: {
        "x-api-key": params.apiKey,
      },
    });
    if (!res.ok) return res;
    return { ok: true, status: res.status, data: dedupeTagSuggestions(res.data.data?.tags ?? []) };
  }

  const res = await client.request<PaginatedResponse<TicketTag>>({
    method: "GET",
    path: "/api/v1/tags/search",
    signal: params.signal,
    query: {
      search_term: term,
      entity_type: "ticket",
      limit,
    },
    headers: {
      "x-api-key": params.apiKey,
    },
  });
  if (!res.ok) return res;
  return { ok: true, status: res.status, data: dedupeTagSuggestions(res.data.data ?? []) };
}
