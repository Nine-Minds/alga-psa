import type { ApiClient } from "./client";
import type { SuccessResponse } from "./tickets";
import type { ApiResult } from "./types";

export type TicketDocument = {
  document_id: string;
  document_name: string;
  type_name?: string | null;
  type_icon?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  created_by_full_name?: string | null;
  updated_at?: string | null;
  file_id?: string | null;
};

export type TicketDocumentUpload = {
  uri: string;
  name: string;
  mimeType?: string | null;
};

function toFormData(file: TicketDocumentUpload): FormData {
  const formData = new FormData();
  formData.append("file", {
    uri: file.uri,
    name: file.name,
    type: file.mimeType ?? "application/octet-stream",
  } as any);
  return formData;
}

export function getTicketDocuments(
  client: ApiClient,
  params: { apiKey: string; ticketId: string },
): Promise<ApiResult<SuccessResponse<TicketDocument[]>>> {
  return client.request<SuccessResponse<TicketDocument[]>>({
    method: "GET",
    path: `/api/v1/tickets/${params.ticketId}/documents`,
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function deleteTicketDocument(
  client: ApiClient,
  params: { apiKey: string; ticketId: string; documentId: string },
): Promise<ApiResult<SuccessResponse<null>>> {
  return client.request<SuccessResponse<null>>({
    method: "DELETE",
    path: `/api/v1/tickets/${params.ticketId}/documents/${params.documentId}`,
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function uploadTicketDocument(
  client: ApiClient,
  params: { apiKey: string; ticketId: string; file: TicketDocumentUpload | FormData },
): Promise<ApiResult<SuccessResponse<TicketDocument>>> {
  return client.request<SuccessResponse<TicketDocument>>({
    method: "POST",
    path: `/api/v1/tickets/${params.ticketId}/documents`,
    headers: {
      "x-api-key": params.apiKey,
    },
    body: params.file instanceof FormData ? params.file : toFormData(params.file),
  });
}
