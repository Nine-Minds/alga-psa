import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { PaginatedResponse, SuccessResponse } from "./tickets";

export type TicketMaterial = {
  ticket_material_id: string;
  ticket_id: string;
  service_id: string;
  service_name?: string | null;
  sku?: string | null;
  quantity: number;
  rate: number;
  currency_code: string;
  description?: string | null;
  is_billed: boolean;
  created_at?: string | null;
};

export type AddTicketMaterialInput = {
  service_id: string;
  quantity: number;
  rate: number;
  currency_code: string;
  description?: string | null;
  /** Serialized install: deliver this specific stock unit to the ticket's client
   *  (creates the managed asset when the product opts in). */
  unit_id?: string | null;
};

export type ProductPrice = {
  price_id: string;
  currency_code: string;
  rate: number;
};

export type ProductListItem = {
  service_id: string;
  service_name: string;
  sku?: string | null;
  default_rate?: number | null;
  prices?: ProductPrice[] | null;
};

export function getTicketMaterials(
  client: ApiClient,
  params: { apiKey: string; ticketId: string },
): Promise<ApiResult<SuccessResponse<TicketMaterial[]>>> {
  return client.request<SuccessResponse<TicketMaterial[]>>({
    method: "GET",
    path: `/api/v1/tickets/${params.ticketId}/materials`,
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function addTicketMaterial(
  client: ApiClient,
  params: { apiKey: string; ticketId: string; data: AddTicketMaterialInput },
): Promise<ApiResult<SuccessResponse<TicketMaterial>>> {
  return client.request<SuccessResponse<TicketMaterial>>({
    method: "POST",
    path: `/api/v1/tickets/${params.ticketId}/materials`,
    headers: {
      "x-api-key": params.apiKey,
    },
    body: params.data,
  });
}

export function listProducts(
  client: ApiClient,
  params: { apiKey: string; search?: string; limit?: number },
): Promise<ApiResult<PaginatedResponse<ProductListItem>>> {
  return client.request<PaginatedResponse<ProductListItem>>({
    method: "GET",
    path: "/api/v1/products",
    query: {
      limit: params.limit ?? 20,
      sort: "service_name",
      order: "asc",
      is_active: true,
      ...(params.search ? { search: params.search } : {}),
    },
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export type ServiceTypeItem = {
  id: string;
  name: string;
  is_active?: boolean;
};

export function listServiceTypes(
  client: ApiClient,
  params: { apiKey: string; signal?: AbortSignal },
): Promise<ApiResult<PaginatedResponse<ServiceTypeItem>>> {
  return client.request<PaginatedResponse<ServiceTypeItem>>({
    method: "GET",
    path: "/api/v1/service-types",
    query: { limit: 100, is_active: true },
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export type CreateProductInput = {
  service_name: string;
  custom_service_type_id: string;
  unit_of_measure: string;
  sku?: string | null;
  barcode?: string | null;
};

export function createProduct(
  client: ApiClient,
  params: { apiKey: string; data: CreateProductInput },
): Promise<ApiResult<SuccessResponse<ProductListItem>>> {
  return client.request<SuccessResponse<ProductListItem>>({
    method: "POST",
    path: "/api/v1/products",
    headers: { "x-api-key": params.apiKey },
    body: params.data,
  });
}

export function setProductBarcode(
  client: ApiClient,
  params: { apiKey: string; productId: string; barcode: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<ProductListItem>>> {
  return client.request<SuccessResponse<ProductListItem>>({
    method: "PUT",
    path: `/api/v1/products/${params.productId}`,
    signal: params.signal,
    headers: {
      "x-api-key": params.apiKey,
    },
    body: { barcode: params.barcode },
  });
}
