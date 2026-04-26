import type {
  IContactEmailAddress,
  IContactPhoneNumber,
} from '../../../interfaces/contact.interfaces';

type ContactLike = Record<string, unknown> & {
  contact_name_id: string;
  client_id?: string | null;
};

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_, c) => String(c).toUpperCase());
}

function expandUpdatedContactFieldKey(value: string): string[] {
  if (value === 'primary_email_custom_type') {
    return ['primary_email_type', 'primary_email_custom_type_id'];
  }
  return [value];
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
  clientId?: string | null;
  fullName: string;
  email?: string;
  primaryEmailCanonicalType?: string | null;
  primaryEmailCustomTypeId?: string | null;
  primaryEmailType?: string | null;
  additionalEmailAddresses?: IContactEmailAddress[];
  phoneNumbers?: IContactPhoneNumber[];
  defaultPhoneNumber?: string;
  defaultPhoneType?: string;
  createdByUserId?: string;
  createdAt?: Date | string;
}): Record<string, unknown> {
  return {
    contactId: params.contactId,
    ...(params.clientId ? { clientId: params.clientId } : {}),
    fullName: params.fullName,
    ...(params.email ? { email: params.email } : {}),
    ...(params.primaryEmailCanonicalType !== undefined ? { primaryEmailCanonicalType: params.primaryEmailCanonicalType } : {}),
    ...(params.primaryEmailCustomTypeId ? { primaryEmailCustomTypeId: params.primaryEmailCustomTypeId } : {}),
    ...(params.primaryEmailType ? { primaryEmailType: params.primaryEmailType } : {}),
    ...(params.additionalEmailAddresses?.length ? { additionalEmailAddresses: params.additionalEmailAddresses } : {}),
    ...(params.phoneNumbers?.length ? { phoneNumbers: params.phoneNumbers } : {}),
    ...(params.defaultPhoneNumber ? { defaultPhoneNumber: params.defaultPhoneNumber } : {}),
    ...(params.defaultPhoneType ? { defaultPhoneType: params.defaultPhoneType } : {}),
    ...(params.createdByUserId ? { createdByUserId: params.createdByUserId } : {}),
    ...(params.createdAt ? { createdAt: normalizeChangeValue(params.createdAt) } : {}),
  };
}

export function buildContactUpdatedPayload(params: {
  contactId: string;
  clientId?: string | null;
  before: ContactLike;
  after: ContactLike;
  updatedFieldKeys: string[];
  updatedByUserId?: string;
  updatedAt?: Date | string;
}): Record<string, unknown> {
  const updatedFields: string[] = [];
  const changes: Record<string, { previous: unknown; new: unknown }> = {};
  const seenPaths = new Set<string>();

  for (const key of params.updatedFieldKeys) {
    for (const resolvedKey of expandUpdatedContactFieldKey(key)) {
      if (resolvedKey === 'tenant') continue;
      if (resolvedKey === 'updated_at') continue;
      if (resolvedKey === 'created_at') continue;
      if (resolvedKey === 'contact_name_id') continue;

      const previousValue = params.before[resolvedKey];
      const newValue = params.after[resolvedKey];
      if (areValuesEqual(previousValue, newValue)) continue;

      const path = snakeToCamel(resolvedKey);
      if (seenPaths.has(path)) continue;
      seenPaths.add(path);
      updatedFields.push(path);
      changes[path] = {
        previous: normalizeChangeValue(previousValue),
        new: normalizeChangeValue(newValue),
      };
    }
  }

  return {
    contactId: params.contactId,
    ...(params.clientId ? { clientId: params.clientId } : {}),
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
  clientId?: string | null;
  archivedByUserId?: string;
  archivedAt?: Date | string;
  reason?: string;
}): Record<string, unknown> {
  return {
    contactId: params.contactId,
    ...(params.clientId ? { clientId: params.clientId } : {}),
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
