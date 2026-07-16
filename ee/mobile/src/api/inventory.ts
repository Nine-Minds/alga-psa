import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { PaginatedResponse, SuccessResponse } from "./tickets";

export type StockUnitStatus =
  | "in_stock"
  | "allocated"
  | "in_transit"
  | "on_loan"
  | "delivered"
  | "returned"
  | "in_rma"
  | "retired";

export type InventoryProductSummary = {
  service_id: string;
  service_name: string;
  sku?: string | null;
  barcode?: string | null;
  is_serialized: boolean;
  unit_of_measure?: string | null;
};

export type StockLevelRow = {
  service_id: string;
  service_name?: string;
  sku?: string | null;
  location_id: string;
  location_name?: string;
  quantity_on_hand: number;
  reserved_quantity: number;
  held_quantity: number;
  available: number;
  reorder_point?: number | null;
  is_low_stock?: boolean;
};

export type StockUnitSummary = {
  unit_id: string;
  service_id: string;
  service_name?: string;
  serial_number: string;
  mac_address?: string | null;
  status: StockUnitStatus;
  location_id?: string | null;
  location_name?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  warranty_expires_at?: string | null;
  warranty_term?: string | null;
};

export type StockMovementRow = {
  movement_id: string;
  movement_type: string;
  quantity: number;
  reason?: string | null;
  from_location_name?: string | null;
  to_location_name?: string | null;
  performed_by_name?: string | null;
  created_at: string;
};

export type StockUnitDetail = StockUnitSummary & {
  unit_cost?: number | null;
  cost_currency?: string | null;
  received_at?: string | null;
  delivered_at?: string | null;
  movements: StockMovementRow[];
};

export type StockLocation = {
  location_id: string;
  name: string;
  location_type: string;
  is_default?: boolean;
};

export type InventoryLookupResult =
  | { type: "product"; product: InventoryProductSummary; levels: StockLevelRow[] }
  | { type: "unit"; unit: StockUnitSummary; product: InventoryProductSummary }
  | {
      type: "multi";
      matches: Array<
        | { kind: "product"; product: InventoryProductSummary }
        | { kind: "unit"; unit: StockUnitSummary }
      >;
    }
  | {
      type: "none";
      candidates: Array<
        | { kind: "product"; product: InventoryProductSummary }
        | { kind: "unit"; unit: StockUnitSummary }
      >;
    };

export function lookupInventoryCode(
  client: ApiClient,
  params: { apiKey: string; code: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<InventoryLookupResult>>> {
  return client.request<SuccessResponse<InventoryLookupResult>>({
    method: "GET",
    path: "/api/v1/inventory/lookup",
    signal: params.signal,
    query: { code: params.code },
    headers: { "x-api-key": params.apiKey },
  });
}

export function listStockLevels(
  client: ApiClient,
  params: {
    apiKey: string;
    page: number;
    limit: number;
    search?: string;
    locationId?: string;
    serviceId?: string;
    lowStock?: boolean;
    signal?: AbortSignal;
  },
): Promise<ApiResult<PaginatedResponse<StockLevelRow>>> {
  return client.request<PaginatedResponse<StockLevelRow>>({
    method: "GET",
    path: "/api/v1/inventory/stock",
    signal: params.signal,
    query: {
      page: params.page,
      limit: params.limit,
      search: params.search || undefined,
      location_id: params.locationId || undefined,
      service_id: params.serviceId || undefined,
      low_stock: params.lowStock ? "true" : undefined,
    },
    headers: { "x-api-key": params.apiKey },
  });
}

export function listStockLocations(
  client: ApiClient,
  params: { apiKey: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<StockLocation[]>>> {
  return client.request<SuccessResponse<StockLocation[]>>({
    method: "GET",
    path: "/api/v1/inventory/stock-locations",
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export function listStockUnits(
  client: ApiClient,
  params: {
    apiKey: string;
    page: number;
    limit: number;
    search?: string;
    status?: StockUnitStatus;
    locationId?: string;
    serviceId?: string;
    clientId?: string;
    signal?: AbortSignal;
  },
): Promise<ApiResult<PaginatedResponse<StockUnitSummary>>> {
  return client.request<PaginatedResponse<StockUnitSummary>>({
    method: "GET",
    path: "/api/v1/inventory/units",
    signal: params.signal,
    query: {
      page: params.page,
      limit: params.limit,
      search: params.search || undefined,
      status: params.status || undefined,
      location_id: params.locationId || undefined,
      service_id: params.serviceId || undefined,
      client_id: params.clientId || undefined,
    },
    headers: { "x-api-key": params.apiKey },
  });
}

export function getStockUnit(
  client: ApiClient,
  params: { apiKey: string; unitId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<StockUnitDetail>>> {
  return client.request<SuccessResponse<StockUnitDetail>>({
    method: "GET",
    path: `/api/v1/inventory/units/${params.unitId}`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export type ReceiveSerialInput = {
  serial_number: string;
  mac_address?: string;
  warranty_expires_at?: string;
};

export function receiveStock(
  client: ApiClient,
  params: {
    apiKey: string;
    data: {
      service_id: string;
      location_id: string;
      quantity: number;
      unit_cost?: number;
      serials?: ReceiveSerialInput[];
    };
    signal?: AbortSignal;
  },
): Promise<ApiResult<SuccessResponse<{ received: number }>>> {
  return client.request<SuccessResponse<{ received: number }>>({
    method: "POST",
    path: "/api/v1/inventory/receipts",
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: params.data,
  });
}

export function adjustStock(
  client: ApiClient,
  params: {
    apiKey: string;
    data: {
      service_id: string;
      location_id: string;
      quantity_delta: number;
      reason: string;
    };
    signal?: AbortSignal;
  },
): Promise<ApiResult<SuccessResponse<{ adjusted: number }>>> {
  return client.request<SuccessResponse<{ adjusted: number }>>({
    method: "POST",
    path: "/api/v1/inventory/adjustments",
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: params.data,
  });
}

export type CountSessionSummary = {
  session_id: string;
  location_id: string;
  location_name?: string;
  status: string;
  line_count?: number;
  created_at?: string;
};

export type CountLineRow = {
  service_id: string;
  service_name?: string;
  sku?: string | null;
  counted_quantity: number;
};

export function listCountSessions(
  client: ApiClient,
  params: { apiKey: string; page: number; limit: number; signal?: AbortSignal },
): Promise<ApiResult<PaginatedResponse<CountSessionSummary>>> {
  return client.request<PaginatedResponse<CountSessionSummary>>({
    method: "GET",
    path: "/api/v1/inventory/counts",
    signal: params.signal,
    query: { page: params.page, limit: params.limit },
    headers: { "x-api-key": params.apiKey },
  });
}

export function startCountSession(
  client: ApiClient,
  params: { apiKey: string; data: { location_id: string }; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<CountSessionSummary>>> {
  return client.request<SuccessResponse<CountSessionSummary>>({
    method: "POST",
    path: "/api/v1/inventory/counts",
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: params.data,
  });
}

export function getCountSession(
  client: ApiClient,
  params: { apiKey: string; sessionId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<CountSessionSummary & { lines: CountLineRow[] }>>> {
  return client.request<SuccessResponse<CountSessionSummary & { lines: CountLineRow[] }>>({
    method: "GET",
    path: `/api/v1/inventory/counts/${params.sessionId}`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export function recordCount(
  client: ApiClient,
  params: {
    apiKey: string;
    sessionId: string;
    data: { service_id: string; counted_quantity: number };
    signal?: AbortSignal;
  },
): Promise<ApiResult<SuccessResponse<CountLineRow>>> {
  return client.request<SuccessResponse<CountLineRow>>({
    method: "POST",
    path: `/api/v1/inventory/counts/${params.sessionId}/records`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: params.data,
  });
}

export function submitCountSession(
  client: ApiClient,
  params: { apiKey: string; sessionId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<CountSessionSummary>>> {
  return client.request<SuccessResponse<CountSessionSummary>>({
    method: "POST",
    path: `/api/v1/inventory/counts/${params.sessionId}/submit`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export type PurchaseOrderLineRow = {
  po_line_id: string;
  service_id: string;
  service_name?: string;
  sku?: string | null;
  is_serialized?: boolean;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost?: number | null;
  cost_currency?: string | null;
};

export type PurchaseOrderSummary = {
  po_id: string;
  po_number: string;
  vendor_name?: string;
  status: string;
  order_date?: string | null;
  expected_date?: string | null;
  lines?: PurchaseOrderLineRow[];
};

export function listPurchaseOrders(
  client: ApiClient,
  params: { apiKey: string; page: number; limit: number; status?: string; signal?: AbortSignal },
): Promise<ApiResult<PaginatedResponse<PurchaseOrderSummary>>> {
  return client.request<PaginatedResponse<PurchaseOrderSummary>>({
    method: "GET",
    path: "/api/v1/inventory/purchase-orders",
    signal: params.signal,
    query: {
      page: params.page,
      limit: params.limit,
      status: params.status || undefined,
    },
    headers: { "x-api-key": params.apiKey },
  });
}

export function getPurchaseOrder(
  client: ApiClient,
  params: { apiKey: string; poId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<PurchaseOrderSummary>>> {
  return client.request<SuccessResponse<PurchaseOrderSummary>>({
    method: "GET",
    path: `/api/v1/inventory/purchase-orders/${params.poId}`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export function receivePurchaseOrderLine(
  client: ApiClient,
  params: {
    apiKey: string;
    poId: string;
    lineId: string;
    data: { quantity: number; location_id?: string; serials?: ReceiveSerialInput[] };
    signal?: AbortSignal;
  },
): Promise<ApiResult<SuccessResponse<PurchaseOrderLineRow>>> {
  return client.request<SuccessResponse<PurchaseOrderLineRow>>({
    method: "POST",
    path: `/api/v1/inventory/purchase-orders/${params.poId}/lines/${params.lineId}/receive`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: params.data,
  });
}

export type StockTransferSummary = {
  transfer_id: string;
  from_location_id: string;
  from_location_name?: string;
  to_location_id: string;
  to_location_name?: string;
  status: string;
  dispatched_at?: string | null;
  line_count?: number;
};

export function listTransfers(
  client: ApiClient,
  params: { apiKey: string; page: number; limit: number; status?: string; signal?: AbortSignal },
): Promise<ApiResult<PaginatedResponse<StockTransferSummary>>> {
  return client.request<PaginatedResponse<StockTransferSummary>>({
    method: "GET",
    path: "/api/v1/inventory/transfers",
    signal: params.signal,
    query: {
      page: params.page,
      limit: params.limit,
      status: params.status || undefined,
    },
    headers: { "x-api-key": params.apiKey },
  });
}

export function receiveTransfer(
  client: ApiClient,
  params: { apiKey: string; transferId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<StockTransferSummary>>> {
  return client.request<SuccessResponse<StockTransferSummary>>({
    method: "POST",
    path: `/api/v1/inventory/transfers/${params.transferId}/receive`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}
