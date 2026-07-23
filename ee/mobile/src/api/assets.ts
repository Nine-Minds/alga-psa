import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { SuccessResponse } from "./tickets";

// The asset controller returns the { success, data, meta } envelope; data holds
// the asset row merged with sub-objects.
type AssetEnvelope<T> = { success?: boolean; data: T; meta?: unknown };

export type AssetWarrantyStatus = "active" | "expiring_soon" | "expired" | "unknown";

export type MaintenanceSchedule = {
  schedule_id: string;
  schedule_name: string;
  description?: string | null;
  maintenance_type?: string | null;
  frequency?: string | null;
  next_maintenance?: string | null;
  last_maintenance?: string | null;
  is_active?: boolean;
  created_by_name?: string | null;
};

export type AssetDetail = {
  asset_id: string;
  asset_tag: string;
  name: string;
  serial_number?: string | null;
  asset_type?: string | null;
  status: string;
  client_id: string;
  client_name?: string | null;
  location?: string | null;
  purchase_date?: string | null;
  warranty_end_date?: string | null;
  warranty_status?: AssetWarrantyStatus;
  service_id?: string | null;
  stock_unit_id?: string | null;
  maintenance_schedules?: MaintenanceSchedule[];
} & Record<string, unknown>;

export type CreateAssetInput = {
  client_id: string;
  asset_type: string;
  asset_tag: string;
  name: string;
  status: string;
  serial_number?: string;
};

/** Register a device found in the field as a managed asset. */
export function createAsset(
  client: ApiClient,
  params: { apiKey: string; data: CreateAssetInput },
): Promise<ApiResult<AssetEnvelope<{ asset_id: string } & Record<string, unknown>>>> {
  return client.request<AssetEnvelope<{ asset_id: string } & Record<string, unknown>>>({
    method: "POST",
    path: "/api/v1/assets",
    headers: { "x-api-key": params.apiKey },
    body: params.data,
  });
}

export function getAsset(
  client: ApiClient,
  params: { apiKey: string; assetId: string; signal?: AbortSignal },
): Promise<ApiResult<AssetEnvelope<AssetDetail>>> {
  return client.request<AssetEnvelope<AssetDetail>>({
    method: "GET",
    path: `/api/v1/assets/${params.assetId}`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export function getAssetMaintenance(
  client: ApiClient,
  params: { apiKey: string; assetId: string; signal?: AbortSignal },
): Promise<ApiResult<AssetEnvelope<MaintenanceSchedule[]>>> {
  return client.request<AssetEnvelope<MaintenanceSchedule[]>>({
    method: "GET",
    path: `/api/v1/assets/${params.assetId}/maintenance`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export type MaintenanceHistoryItem = {
  history_id: string;
  maintenance_type?: string | null;
  description?: string | null;
  performed_at?: string | null;
  performed_by_user_name?: string | null;
};

export type RecordMaintenanceInput = {
  schedule_id: string;
  maintenance_type: "preventive" | "corrective" | "inspection" | "calibration" | "replacement";
  description?: string;
  duration_hours?: number;
};

/** Log a scheduled maintenance task as done (advances the schedule's next-due date). */
export function recordAssetMaintenance(
  client: ApiClient,
  params: { apiKey: string; assetId: string; data: RecordMaintenanceInput; signal?: AbortSignal },
): Promise<ApiResult<AssetEnvelope<unknown>>> {
  return client.request<AssetEnvelope<unknown>>({
    method: "POST",
    path: `/api/v1/assets/${params.assetId}/maintenance/record`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: params.data,
  });
}

export type AssetSoftwareItem = {
  software_id: string;
  name: string;
  publisher?: string | null;
  version?: string | null;
  category?: string | null;
  software_type?: string | null;
  install_date?: string | null;
};

export function getAssetSoftware(
  client: ApiClient,
  params: { apiKey: string; assetId: string; signal?: AbortSignal },
): Promise<ApiResult<{ data: AssetSoftwareItem[]; summary?: { total_installed?: number } }>> {
  return client.request<{ data: AssetSoftwareItem[]; summary?: { total_installed?: number } }>({
    method: "GET",
    path: `/api/v1/assets/${params.assetId}/software`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

// Asset notes are a single BlockNote (rich-text) document per asset — GET reads
// it, PUT replaces it. Mobile flattens blockData to text for display and appends
// paragraph blocks for new notes (see features/assets/blockNote).
export type AssetNoteContent = {
  document: unknown | null;
  blockData: unknown | null;
  lastUpdated: string | null;
};

export function getAssetNotes(
  client: ApiClient,
  params: { apiKey: string; assetId: string; signal?: AbortSignal },
): Promise<ApiResult<{ data: AssetNoteContent }>> {
  return client.request<{ data: AssetNoteContent }>({
    method: "GET",
    path: `/api/v1/assets/${params.assetId}/notes`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

/** Replace the asset's notes document. Callers must pass the full block array,
 *  including any pre-existing blocks (appendNoteBlock handles that). */
export function saveAssetNotes(
  client: ApiClient,
  params: { apiKey: string; assetId: string; blockData: unknown; signal?: AbortSignal },
): Promise<ApiResult<{ data: unknown }>> {
  return client.request<{ data: unknown }>({
    method: "PUT",
    path: `/api/v1/assets/${params.assetId}/notes`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: { blockData: params.blockData },
  });
}

export function getAssetHistory(
  client: ApiClient,
  params: { apiKey: string; assetId: string; signal?: AbortSignal },
): Promise<ApiResult<AssetEnvelope<MaintenanceHistoryItem[]>>> {
  return client.request<AssetEnvelope<MaintenanceHistoryItem[]>>({
    method: "GET",
    path: `/api/v1/assets/${params.assetId}/history`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export type AssetTicketRow = {
  ticket_id: string;
  ticket_number?: string;
  title?: string;
  status_name?: string;
  is_closed?: boolean;
  relationship_type?: string | null;
  entered_at?: string | null;
};

export function getAssetTickets(
  client: ApiClient,
  params: { apiKey: string; assetId: string; signal?: AbortSignal },
): Promise<ApiResult<AssetEnvelope<AssetTicketRow[]>>> {
  return client.request<AssetEnvelope<AssetTicketRow[]>>({
    method: "GET",
    path: `/api/v1/assets/${params.assetId}/tickets`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

/** Link an existing ticket to this asset (writes asset_associations, visible from either side). */
export function linkAssetToTicket(
  client: ApiClient,
  params: {
    apiKey: string;
    ticketId: string;
    assetId: string;
    relationshipType?: string;
    notes?: string;
    signal?: AbortSignal;
  },
): Promise<ApiResult<SuccessResponse<unknown>>> {
  return client.request<SuccessResponse<unknown>>({
    method: "POST",
    path: `/api/v1/tickets/${params.ticketId}/assets`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: {
      asset_id: params.assetId,
      relationship_type: params.relationshipType ?? "affected",
      notes: params.notes,
    },
  });
}

export type CreateTicketFromAssetInput = {
  title: string;
  description?: string;
  priority_id: string;
  status_id: string;
  board_id: string;
  asset_id: string;
  client_id: string;
  contact_name_id?: string;
  category_id?: string;
};

export function createTicketFromAsset(
  client: ApiClient,
  params: { apiKey: string; data: CreateTicketFromAssetInput; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<{ ticket_id: string; ticket_number?: string }>>> {
  return client.request<SuccessResponse<{ ticket_id: string; ticket_number?: string }>>({
    method: "POST",
    path: "/api/v1/tickets/from-asset",
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: params.data,
  });
}
