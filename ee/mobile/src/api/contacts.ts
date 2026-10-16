import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { PaginatedResponse, SuccessResponse } from "./tickets";

export type ContactPhoneNumber = {
  contact_phone_number_id?: string;
  phone_number: string;
  extension?: string | null;
  normalized_phone_number?: string | null;
  canonical_type?: string | null;
  custom_type?: string | null;
  is_default?: boolean;
  display_order?: number;
};

export type ContactEmailAddress = {
  contact_additional_email_address_id?: string;
  email_address: string;
  normalized_email_address?: string | null;
  canonical_type?: string | null;
  custom_type?: string | null;
  display_order?: number;
};

export type ContactListItem = {
  contact_name_id: string;
  full_name: string;
  email?: string | null;
  phone_numbers?: ContactPhoneNumber[] | null;
  default_phone_number?: string | null;
  default_phone_type?: string | null;
  additional_email_addresses?: ContactEmailAddress[] | null;
  client_id?: string | null;
  client_name?: string | null;
  role?: string | null;
  notes?: string | null;
  is_inactive?: boolean;
  avatarUrl?: string | null;
};

export type ContactDetail = ContactListItem & {
  client_email?: string | null;
  client_phone?: string | null;
  /** Primary email label: a canonical type, or null when `primary_email_type` holds a custom label. */
  primary_email_canonical_type?: string | null;
  primary_email_type?: string | null;
  primary_email_custom_type_id?: string | null;
  tags?: string[];
} & Record<string, unknown>;

export type ListContactsParams = {
  apiKey: string;
  page: number;
  limit: number;
  search?: string;
  client_id?: string;
  sort?: string;
  order?: "asc" | "desc";
  signal?: AbortSignal;
};

export function listContacts(
  client: ApiClient,
  params: ListContactsParams,
): Promise<ApiResult<PaginatedResponse<ContactListItem>>> {
  return client.request<PaginatedResponse<ContactListItem>>({
    method: "GET",
    path: "/api/v1/contacts",
    signal: params.signal,
    query: {
      page: params.page,
      limit: params.limit,
      sort: params.sort ?? "full_name",
      order: params.order ?? "asc",
      is_inactive: "false",
      ...(params.search ? { search: params.search } : {}),
      ...(params.client_id ? { client_id: params.client_id } : {}),
    },
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function getContact(
  client: ApiClient,
  params: { apiKey: string; contactId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<ContactDetail>>> {
  return client.request<SuccessResponse<ContactDetail>>({
    method: "GET",
    path: `/api/v1/contacts/${params.contactId}`,
    signal: params.signal,
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export type ContactPhoneNumberInput = {
  contact_phone_number_id?: string;
  phone_number: string;
  extension?: string | null;
  canonical_type?: string | null;
  custom_type?: string | null;
  is_default?: boolean;
  display_order?: number;
};

export type ContactEmailAddressInput = {
  contact_additional_email_address_id?: string;
  email_address: string;
  canonical_type?: string | null;
  custom_type?: string | null;
  display_order?: number;
};

export type ContactWriteInput = {
  full_name?: string;
  email?: string;
  client_id?: string;
  role?: string;
  notes?: string;
  is_inactive?: boolean;
  phone_numbers?: ContactPhoneNumberInput[];
  primary_email_canonical_type?: string | null;
  primary_email_custom_type?: string | null;
  additional_email_addresses?: ContactEmailAddressInput[];
  tags?: string[];
};

export type ContactAvatarResult = { success: boolean; message: string; avatarUrl?: string | null };

/** Multipart upload of the `avatar` field; same storage path as the web contact page. */
export function uploadContactAvatar(
  client: ApiClient,
  params: { apiKey: string; contactId: string; file: { uri: string; name: string; mimeType?: string | null }; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<ContactAvatarResult>>> {
  const formData = new FormData();
  formData.append("avatar", { uri: params.file.uri, name: params.file.name, type: params.file.mimeType ?? "image/jpeg" } as any);
  return client.request<SuccessResponse<ContactAvatarResult>>({
    method: "POST",
    path: `/api/v1/contacts/${params.contactId}/avatar`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
    body: formData,
  });
}

export function deleteContactAvatar(
  client: ApiClient,
  params: { apiKey: string; contactId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<ContactAvatarResult>>> {
  return client.request<SuccessResponse<ContactAvatarResult>>({
    method: "DELETE",
    path: `/api/v1/contacts/${params.contactId}/avatar`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export type CreateContactInput = ContactWriteInput & { full_name: string; email: string };

export function createContact(
  client: ApiClient,
  params: {
    apiKey: string;
    data: CreateContactInput;
    auditHeaders?: Record<string, string | undefined>;
    signal?: AbortSignal;
  },
): Promise<ApiResult<SuccessResponse<ContactDetail>>> {
  return client.request<SuccessResponse<ContactDetail>>({
    method: "POST",
    path: "/api/v1/contacts",
    signal: params.signal,
    headers: { "x-api-key": params.apiKey, ...params.auditHeaders },
    body: params.data,
  });
}

export function updateContact(
  client: ApiClient,
  params: {
    apiKey: string;
    contactId: string;
    data: ContactWriteInput;
    auditHeaders?: Record<string, string | undefined>;
    signal?: AbortSignal;
  },
): Promise<ApiResult<SuccessResponse<ContactDetail>>> {
  return client.request<SuccessResponse<ContactDetail>>({
    method: "PUT",
    path: `/api/v1/contacts/${params.contactId}`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey, ...params.auditHeaders },
    body: params.data,
  });
}

export function formatContactTypeLabel(entry: {
  canonical_type?: string | null;
  custom_type?: string | null;
}): string | null {
  const custom = entry.custom_type?.trim();
  if (custom) return custom;
  const canonical = entry.canonical_type?.trim();
  if (!canonical) return null;
  return canonical.charAt(0).toUpperCase() + canonical.slice(1).toLowerCase();
}

export function getContactReachLine(contact: ContactListItem): string | null {
  const phone = contact.default_phone_number?.trim();
  if (phone) return phone;
  const email = contact.email?.trim();
  if (email) return email;
  return null;
}

export function buildContactAvatarUri(
  baseUrl: string | null,
  avatarUrl: string | null | undefined,
): string | undefined {
  if (!avatarUrl) return undefined;
  if (/^https?:\/\//i.test(avatarUrl)) return avatarUrl;
  if (!baseUrl) return undefined;
  return `${baseUrl.replace(/\/+$/, "")}${avatarUrl.startsWith("/") ? "" : "/"}${avatarUrl}`;
}
