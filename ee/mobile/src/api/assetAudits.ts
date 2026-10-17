import type { ApiClient } from "./client";
import type { ApiResult } from "./types";

// The audit controller answers with the { success, data } envelope; list adds
// pagination next to data.
type AuditEnvelope<T> = { success?: boolean; data: T; meta?: unknown };
type AuditListEnvelope<T> = {
  success?: boolean;
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages?: number };
};

export type AssetAuditStatus = "in_progress" | "completed" | "cancelled";
export type AssetAuditItemResult = "expected" | "present" | "missing" | "unexpected";
export type AssetAuditItemMethod = "scan" | "manual" | "register";

export type AssetAuditItem = {
  asset_id: string;
  result: AssetAuditItemResult;
  method: AssetAuditItemMethod | null;
  marked_at: string | null;
  marked_by: string | null;
  asset_name?: string | null;
  asset_tag?: string | null;
  serial_number?: string | null;
  client_id?: string | null;
  location_id?: string | null;
  location?: string | null;
};

export type AssetAudit = {
  audit_id: string;
  client_id: string;
  location_id: string | null;
  status: AssetAuditStatus;
  started_by: string;
  started_at: string;
  completed_at: string | null;
  expected_count: number;
  present_count: number;
  missing_count: number;
  unexpected_count: number;
  statuses?: string[] | null;
  notes?: string | null;
  items?: AssetAuditItem[];
};

export function startAssetAudit(
  client: ApiClient,
  params: {
    apiKey: string;
    data: { client_id: string; location_id?: string | null; statuses?: string[]; notes?: string };
    signal?: AbortSignal;
  },
): Promise<ApiResult<AuditEnvelope<AssetAudit>>> {
  return client.request<AuditEnvelope<AssetAudit>>({
    method: "POST",
    path: "/api/v1/asset-audits",
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: params.data,
  });
}

export function listAssetAudits(
  client: ApiClient,
  params: { apiKey: string; page?: number; limit?: number; clientId?: string; signal?: AbortSignal },
): Promise<ApiResult<AuditListEnvelope<AssetAudit>>> {
  return client.request<AuditListEnvelope<AssetAudit>>({
    method: "GET",
    path: "/api/v1/asset-audits",
    signal: params.signal,
    query: { page: params.page, limit: params.limit, client_id: params.clientId },
    headers: { "x-api-key": params.apiKey },
  });
}

export function getAssetAudit(
  client: ApiClient,
  params: { apiKey: string; auditId: string; signal?: AbortSignal },
): Promise<ApiResult<AuditEnvelope<AssetAudit>>> {
  return client.request<AuditEnvelope<AssetAudit>>({
    method: "GET",
    path: `/api/v1/asset-audits/${params.auditId}`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export function markAssetAuditItem(
  client: ApiClient,
  params: {
    apiKey: string;
    auditId: string;
    assetId: string;
    result?: "present" | "unexpected";
    method: AssetAuditItemMethod;
    signal?: AbortSignal;
  },
): Promise<ApiResult<AuditEnvelope<AssetAudit>>> {
  return client.request<AuditEnvelope<AssetAudit>>({
    method: "POST",
    path: `/api/v1/asset-audits/${params.auditId}/items`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: { asset_id: params.assetId, result: params.result ?? "present", method: params.method },
  });
}

export function unmarkAssetAuditItem(
  client: ApiClient,
  params: { apiKey: string; auditId: string; assetId: string; signal?: AbortSignal },
): Promise<ApiResult<AuditEnvelope<AssetAudit>>> {
  return client.request<AuditEnvelope<AssetAudit>>({
    method: "DELETE",
    path: `/api/v1/asset-audits/${params.auditId}/items/${params.assetId}`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export function completeAssetAudit(
  client: ApiClient,
  params: { apiKey: string; auditId: string; signal?: AbortSignal },
): Promise<ApiResult<AuditEnvelope<AssetAudit>>> {
  return client.request<AuditEnvelope<AssetAudit>>({
    method: "POST",
    path: `/api/v1/asset-audits/${params.auditId}/complete`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export function cancelAssetAudit(
  client: ApiClient,
  params: { apiKey: string; auditId: string; signal?: AbortSignal },
): Promise<ApiResult<AuditEnvelope<AssetAudit>>> {
  return client.request<AuditEnvelope<AssetAudit>>({
    method: "POST",
    path: `/api/v1/asset-audits/${params.auditId}/cancel`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export type AuditSegment = "remaining" | "present" | "unexpected";

/** The session's three lists, derived from the server's items. */
export function auditSegments(audit: AssetAudit | null): Record<AuditSegment, AssetAuditItem[]> {
  const items = audit?.items ?? [];
  return {
    remaining: items.filter((item) => item.result === "expected" || item.result === "missing"),
    present: items.filter((item) => item.result === "present"),
    unexpected: items.filter((item) => item.result === "unexpected"),
  };
}

/** Filters a list by name, tag or serial — what a technician reads off a label. */
export function matchesAuditSearch(item: AssetAuditItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [item.asset_name, item.asset_tag, item.serial_number]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(needle));
}
