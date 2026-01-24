type ContactLike = Record<string, unknown> & {
  contact_name_id: string;
  client_id?: string | null;
};

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_, c) => String(c).toUpperCase());
}

function normalizeChangeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function areValuesEqual(a: unknown, b: unknown): boolean {
  const na = normalizeChangeValue(a);
  const nb = normalizeChangeValue(b);
  if (na === nb) return true;
  if (typeof na !== 'object' || na === null) return false;
  if (typeof nb !== 'object' || nb === null) return false;

  try {
    return JSON.stringify(na) === JSON.stringify(nb);
  } catch {
    return false;
  }
}

export function buildContactCreatedPayload(params: {
  contactId: string;
  clientId: string;
  fullName: string;
  email?: string;
  phoneNumber?: string;
  createdByUserId?: string;
  createdAt?: Date | string;
}): Record<string, unknown> {
  return {
    contactId: params.contactId,
    clientId: params.clientId,
    fullName: params.fullName,
    ...(params.email ? { email: params.email } : {}),
    ...(params.phoneNumber ? { phoneNumber: params.phoneNumber } : {}),
    ...(params.createdByUserId ? { createdByUserId: params.createdByUserId } : {}),
    ...(params.createdAt ? { createdAt: normalizeChangeValue(params.createdAt) } : {}),
  };
}

export function buildContactUpdatedPayload(params: {
  contactId: string;
  clientId: string;
  before: ContactLike;
  after: ContactLike;
  updatedFieldKeys: string[];
  updatedByUserId?: string;
  updatedAt?: Date | string;
}): Record<string, unknown> {
  const updatedFields: string[] = [];
  const changes: Record<string, { previous: unknown; new: unknown }> = {};

  for (const key of params.updatedFieldKeys) {
    if (key === 'tenant') continue;
    if (key === 'updated_at') continue;
    if (key === 'created_at') continue;
    if (key === 'contact_name_id') continue;

    const previousValue = params.before[key];
    const newValue = params.after[key];
    if (areValuesEqual(previousValue, newValue)) continue;

    const path = snakeToCamel(key);
    updatedFields.push(path);
    changes[path] = {
      previous: normalizeChangeValue(previousValue),
      new: normalizeChangeValue(newValue),
    };
  }

  return {
    contactId: params.contactId,
    clientId: params.clientId,
    ...(params.updatedByUserId ? { updatedByUserId: params.updatedByUserId } : {}),
    ...(params.updatedAt ? { updatedAt: normalizeChangeValue(params.updatedAt) } : {}),
    ...(updatedFields.length ? { updatedFields } : {}),
    ...(Object.keys(changes).length ? { changes } : {}),
  };
}

export function buildContactPrimarySetPayload(params: {
  clientId: string;
  contactId: string;
  previousPrimaryContactId?: string;
  setByUserId?: string;
  setAt?: Date | string;
}): Record<string, unknown> {
  return {
    clientId: params.clientId,
    contactId: params.contactId,
    ...(params.previousPrimaryContactId ? { previousPrimaryContactId: params.previousPrimaryContactId } : {}),
    ...(params.setByUserId ? { setByUserId: params.setByUserId } : {}),
    ...(params.setAt ? { setAt: normalizeChangeValue(params.setAt) } : {}),
  };
}

export function buildContactArchivedPayload(params: {
  contactId: string;
  clientId: string;
  archivedByUserId?: string;
  archivedAt?: Date | string;
  reason?: string;
}): Record<string, unknown> {
  return {
    contactId: params.contactId,
    clientId: params.clientId,
    ...(params.archivedByUserId ? { archivedByUserId: params.archivedByUserId } : {}),
    ...(params.archivedAt ? { archivedAt: normalizeChangeValue(params.archivedAt) } : {}),
    ...(params.reason ? { reason: params.reason } : {}),
  };
}

export function buildContactMergedPayload(params: {
  sourceContactId: string;
  targetContactId: string;
  mergedByUserId?: string;
  mergedAt?: Date | string;
  strategy?: string;
}): Record<string, unknown> {
  return {
    sourceContactId: params.sourceContactId,
    targetContactId: params.targetContactId,
    ...(params.mergedByUserId ? { mergedByUserId: params.mergedByUserId } : {}),
    ...(params.mergedAt ? { mergedAt: normalizeChangeValue(params.mergedAt) } : {}),
    ...(params.strategy ? { strategy: params.strategy } : {}),
  };
}

