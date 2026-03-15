import type { IDataObject } from 'n8n-workflow';

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AlgaApiError {
  statusCode?: number;
  code: string;
  message: string;
  details?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function compactObject(input: IDataObject): IDataObject {
  return Object.entries(input).reduce((acc, [key, value]) => {
    if (value === undefined || value === null || value === '') {
      return acc;
    }

    if (Array.isArray(value) && value.length === 0) {
      return acc;
    }

    acc[key] = value;
    return acc;
  }, {} as IDataObject);
}

export function parseCsvList(value: unknown): string[] {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseTags(value: unknown): string[] | undefined {
  const tags = parseCsvList(value);
  return tags.length > 0 ? tags : undefined;
}

export function parseAttributes(value: unknown): IDataObject | undefined {
  if (!value) {
    return undefined;
  }

  if (isObject(value)) {
    return value as IDataObject;
  }

  const raw = String(value).trim();
  if (!raw) {
    return undefined;
  }

  const parsed = JSON.parse(raw);
  if (!isObject(parsed)) {
    throw new Error('Attributes must be a JSON object');
  }

  return parsed as IDataObject;
}

export function ensureNonEmpty(value: unknown, fieldName: string): string {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }

  return normalized;
}

export function ensureUuid(value: unknown, fieldName: string): string {
  const normalized = ensureNonEmpty(value, fieldName);

  if (!UUID_REGEX.test(normalized)) {
    throw new Error(`${fieldName} must be a valid UUID`);
  }

  return normalized;
}

export function extractResourceLocatorValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (isObject(value) && 'value' in value) {
    return String(value.value ?? '').trim();
  }

  return '';
}

export function buildTicketCreatePayload(input: {
  title: string;
  clientId: string;
  boardId: string;
  statusId: string;
  priorityId: string;
  additionalFields?: IDataObject;
}): IDataObject {
  const additional = input.additionalFields ?? {};

  const payload: IDataObject = {
    title: input.title,
    client_id: input.clientId,
    board_id: input.boardId,
    status_id: input.statusId,
    priority_id: input.priorityId,
    location_id: additional.location_id,
    contact_name_id: additional.contact_name_id,
    category_id: additional.category_id,
    subcategory_id: additional.subcategory_id,
    assigned_to: additional.assigned_to,
    url: additional.url,
    attributes: parseAttributes(additional.attributes),
    tags: parseTags(additional.tags),
  };

  return compactObject(payload);
}

export function buildTicketUpdatePayload(additionalFields: IDataObject = {}): IDataObject {
  const payload: IDataObject = {
    title: additionalFields.title,
    client_id: additionalFields.client_id,
    board_id: additionalFields.board_id,
    status_id: additionalFields.status_id,
    priority_id: additionalFields.priority_id,
    location_id: additionalFields.location_id,
    contact_name_id: additionalFields.contact_name_id,
    category_id: additionalFields.category_id,
    subcategory_id: additionalFields.subcategory_id,
    assigned_to: additionalFields.assigned_to,
    url: additionalFields.url,
    attributes: parseAttributes(additionalFields.attributes),
    tags: parseTags(additionalFields.tags),
  };

  return compactObject(payload);
}

function normalizeOptionalUuid(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined;
  }

  return ensureUuid(value, fieldName);
}

function normalizeJsonInput(value: unknown, fieldName: string): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const raw = value.trim();
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${fieldName} must be valid JSON`);
  }
}

export function parseContactPhoneNumbers(value: unknown): IDataObject[] | undefined {
  const parsed = normalizeJsonInput(value, 'phone_numbers');

  if (parsed === undefined) {
    return undefined;
  }

  if (!Array.isArray(parsed)) {
    throw new Error('phone_numbers must be a JSON array');
  }

  return parsed.map((entry, index) => {
    if (!isObject(entry)) {
      throw new Error(`phone_numbers[${index}] must be an object`);
    }

    const phoneNumber = ensureNonEmpty(entry.phone_number, `phone_numbers[${index}].phone_number`);
    const contactPhoneNumberId = normalizeOptionalUuid(
      entry.contact_phone_number_id,
      `phone_numbers[${index}].contact_phone_number_id`,
    );
    const canonicalType =
      entry.canonical_type === undefined || entry.canonical_type === null
        ? undefined
        : ensureNonEmpty(entry.canonical_type, `phone_numbers[${index}].canonical_type`);
    const customType =
      entry.custom_type === undefined || entry.custom_type === null
        ? undefined
        : ensureNonEmpty(entry.custom_type, `phone_numbers[${index}].custom_type`);

    if (entry.is_default !== undefined && typeof entry.is_default !== 'boolean') {
      throw new Error(`phone_numbers[${index}].is_default must be a boolean`);
    }

    if (
      entry.display_order !== undefined &&
      (!Number.isInteger(entry.display_order) || Number(entry.display_order) < 0)
    ) {
      throw new Error(`phone_numbers[${index}].display_order must be a non-negative integer`);
    }

    const isDefault =
      entry.is_default === undefined ? undefined : (entry.is_default as boolean);
    const displayOrder =
      entry.display_order === undefined ? undefined : Number(entry.display_order);

    return compactObject({
      contact_phone_number_id: contactPhoneNumberId,
      phone_number: phoneNumber,
      canonical_type: canonicalType,
      custom_type: customType,
      is_default: isDefault,
      display_order: displayOrder,
    });
  });
}

export function buildContactCreatePayload(input: {
  fullName: string;
  additionalFields?: IDataObject;
}): IDataObject {
  const additional = input.additionalFields ?? {};
  const clientId = normalizeOptionalUuid(additional.client_id, 'client_id');

  return compactObject({
    full_name: input.fullName,
    email: additional.email,
    client_id: clientId,
    role: additional.role,
    notes: additional.notes,
    is_inactive: additional.is_inactive,
    phone_numbers: parseContactPhoneNumbers(additional.phone_numbers),
  });
}

export function buildContactUpdatePayload(additionalFields: IDataObject = {}): IDataObject {
  const clientId = normalizeOptionalUuid(additionalFields.client_id, 'client_id');

  return compactObject({
    full_name: additionalFields.full_name,
    email: additionalFields.email,
    client_id: clientId,
    role: additionalFields.role,
    notes: additionalFields.notes,
    is_inactive: additionalFields.is_inactive,
    phone_numbers: parseContactPhoneNumbers(additionalFields.phone_numbers),
  });
}

export function buildContactListQuery(input: {
  page: number;
  limit: number;
  filters?: IDataObject;
}): IDataObject {
  const filters = input.filters ?? {};
  const clientId = normalizeOptionalUuid(filters.client_id, 'client_id');

  return compactObject({
    page: input.page,
    limit: input.limit,
    client_id: clientId,
    search_term: filters.search_term,
    is_inactive: filters.is_inactive,
  });
}

export function buildTicketListQuery(input: {
  page: number;
  limit: number;
  sort?: string;
  order?: string;
  filters?: IDataObject;
}): IDataObject {
  return compactObject({
    page: input.page,
    limit: input.limit,
    sort: input.sort,
    order: input.order,
    ...(input.filters ?? {}),
  });
}

export function buildTicketSearchQuery(input: {
  query: string;
  limit?: number;
  includeClosed?: boolean;
  fields?: string[];
  statusIds?: string[];
  priorityIds?: string[];
  clientIds?: string[];
  assignedToIds?: string[];
}): IDataObject {
  return compactObject({
    query: input.query,
    limit: input.limit,
    include_closed: input.includeClosed,
    fields: input.fields && input.fields.length > 0 ? input.fields.join(',') : undefined,
    status_ids:
      input.statusIds && input.statusIds.length > 0 ? input.statusIds.join(',') : undefined,
    priority_ids:
      input.priorityIds && input.priorityIds.length > 0
        ? input.priorityIds.join(',')
        : undefined,
    client_ids:
      input.clientIds && input.clientIds.length > 0 ? input.clientIds.join(',') : undefined,
    assigned_to_ids:
      input.assignedToIds && input.assignedToIds.length > 0
        ? input.assignedToIds.join(',')
        : undefined,
  });
}

export function buildTicketCommentListQuery(options: IDataObject = {}): IDataObject {
  return compactObject({
    limit: options.limit,
    offset: options.offset,
    order: options.order,
  });
}

export function buildTicketCommentPayload(
  commentText: string,
  additionalFields: IDataObject = {},
): IDataObject {
  return compactObject({
    comment_text: commentText,
    is_internal: additionalFields.is_internal,
  });
}

export function normalizeSuccessResponse(response: unknown): IDataObject {
  if (response === undefined || response === null) {
    return {};
  }

  if (Array.isArray(response)) {
    return { data: response };
  }

  if (isObject(response) && 'data' in response) {
    const data = response.data;
    const pagination = response.pagination;

    if (pagination !== undefined) {
      return {
        data: Array.isArray(data) ? data : data ?? [],
        pagination,
      } as IDataObject;
    }

    if (Array.isArray(data)) {
      return { data };
    }

    if (isObject(data)) {
      return data as IDataObject;
    }

    if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
      return { data };
    }

    return { data: JSON.stringify(data ?? null) };
  }

  if (isObject(response)) {
    return response as IDataObject;
  }

  return { data: response as string | number | boolean };
}

export function normalizeDeleteSuccess(id: string, response?: unknown): IDataObject {
  const normalized = normalizeSuccessResponse(response);

  return {
    success: true,
    id,
    deleted: true,
    ...normalized,
  };
}

function parseErrorBody(value: unknown): Record<string, unknown> | undefined {
  if (isObject(value)) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (isObject(parsed)) {
        return parsed;
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function formatAlgaApiError(error: unknown): AlgaApiError {
  const raw = (error ?? {}) as Record<string, unknown>;
  const response = isObject(raw.response) ? raw.response : undefined;

  const responseBody = parseErrorBody(raw.responseBody) ?? parseErrorBody(raw.body);
  const responseData = response ? parseErrorBody(response.data) : undefined;
  const merged = responseBody ?? responseData;
  const nestedError = merged && isObject(merged.error) ? merged.error : undefined;

  const statusCode =
    (typeof raw.httpCode === 'number' ? raw.httpCode : undefined) ??
    (typeof raw.statusCode === 'number' ? raw.statusCode : undefined) ??
    (response && typeof response.status === 'number' ? response.status : undefined);

  const code =
    (nestedError && typeof nestedError.code === 'string' ? nestedError.code : undefined) ??
    (merged && typeof merged.code === 'string' ? merged.code : undefined) ??
    (typeof raw.code === 'string' ? raw.code : undefined) ??
    (statusCode ? `HTTP_${statusCode}` : 'UNKNOWN_ERROR');

  const message =
    (nestedError && typeof nestedError.message === 'string' ? nestedError.message : undefined) ??
    (merged && typeof merged.message === 'string' ? merged.message : undefined) ??
    (typeof raw.message === 'string' ? raw.message : undefined) ??
    'Request failed';

  const details =
    (nestedError && 'details' in nestedError ? nestedError.details : undefined) ??
    (merged && 'details' in merged ? merged.details : undefined);

  return {
    statusCode,
    code,
    message,
    details,
  };
}
