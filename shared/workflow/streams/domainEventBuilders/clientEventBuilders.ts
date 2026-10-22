import { builtWorkflowPayload, type BuiltWorkflowPayload } from '@alga-psa/event-schemas';

type ClientLike = Record<string, unknown> & {
  client_id: string;
  properties?: unknown;
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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  if (Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function buildClientCreatedPayload(params: {
  clientId: string;
  clientName: string;
  createdByUserId?: string;
  createdAt?: Date | string;
  status?: string;
}): Record<string, unknown> & BuiltWorkflowPayload<'CLIENT_CREATED'> {
  return builtWorkflowPayload('CLIENT_CREATED', {
    clientId: params.clientId,
    clientName: params.clientName,
    ...(params.createdByUserId ? { createdByUserId: params.createdByUserId } : {}),
    ...(params.createdAt ? { createdAt: normalizeChangeValue(params.createdAt) } : {}),
    ...(params.status ? { status: params.status } : {}),
  });
}

export function buildClientUpdatedPayload(params: {
  clientId: string;
  before: ClientLike;
  after: ClientLike;
  updatedFieldKeys: string[];
  updatedAt?: Date | string;
}): Record<string, unknown> & BuiltWorkflowPayload<'CLIENT_UPDATED'> {
  const updatedFields: string[] = [];
  const changes: Record<string, { previous: unknown; new: unknown }> = {};

  const updatedKeySet = new Set(params.updatedFieldKeys);
  if (updatedKeySet.has('properties')) {
    const beforeProperties = asRecord(params.before.properties);
    const afterProperties = asRecord(params.after.properties);
    const allKeys = new Set([...Object.keys(beforeProperties), ...Object.keys(afterProperties)]);

    for (const key of allKeys) {
      const previousValue = beforeProperties[key];
      const newValue = afterProperties[key];
      if (areValuesEqual(previousValue, newValue)) continue;

      const path = `properties.${snakeToCamel(key)}`;
      updatedFields.push(path);
      changes[path] = {
        previous: normalizeChangeValue(previousValue),
        new: normalizeChangeValue(newValue),
      };
    }
  }

  for (const key of params.updatedFieldKeys) {
    if (key === 'tenant') continue;
    if (key === 'updated_at') continue;
    if (key === 'created_at') continue;
    if (key === 'properties') continue;

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

  return builtWorkflowPayload('CLIENT_UPDATED', {
    clientId: params.clientId,
    ...(params.updatedAt ? { updatedAt: normalizeChangeValue(params.updatedAt) } : {}),
    ...(updatedFields.length ? { updatedFields } : {}),
    ...(Object.keys(changes).length ? { changes } : {}),
  });
}

export function buildClientStatusChangedPayload(params: {
  clientId: string;
  previousStatus: string;
  newStatus: string;
  changedAt?: Date | string;
}): Record<string, unknown> & BuiltWorkflowPayload<'CLIENT_STATUS_CHANGED'> {
  return builtWorkflowPayload('CLIENT_STATUS_CHANGED', {
    clientId: params.clientId,
    previousStatus: params.previousStatus,
    newStatus: params.newStatus,
    ...(params.changedAt ? { changedAt: normalizeChangeValue(params.changedAt) } : {}),
  });
}

export function buildClientOwnerAssignedPayload(params: {
  clientId: string;
  previousOwnerUserId?: string;
  newOwnerUserId: string;
  assignedByUserId?: string;
  assignedAt?: Date | string;
}): Record<string, unknown> & BuiltWorkflowPayload<'CLIENT_OWNER_ASSIGNED'> {
  return builtWorkflowPayload('CLIENT_OWNER_ASSIGNED', {
    clientId: params.clientId,
    ...(params.previousOwnerUserId ? { previousOwnerUserId: params.previousOwnerUserId } : {}),
    newOwnerUserId: params.newOwnerUserId,
    ...(params.assignedByUserId ? { assignedByUserId: params.assignedByUserId } : {}),
    ...(params.assignedAt ? { assignedAt: normalizeChangeValue(params.assignedAt) } : {}),
  });
}

export function buildClientMergedPayload(params: {
  sourceClientId: string;
  targetClientId: string;
  mergedByUserId?: string;
  mergedAt?: Date | string;
  strategy?: string;
}): Record<string, unknown> & BuiltWorkflowPayload<'CLIENT_MERGED'> {
  return builtWorkflowPayload('CLIENT_MERGED', {
    sourceClientId: params.sourceClientId,
    targetClientId: params.targetClientId,
    ...(params.mergedByUserId ? { mergedByUserId: params.mergedByUserId } : {}),
    ...(params.mergedAt ? { mergedAt: normalizeChangeValue(params.mergedAt) } : {}),
    ...(params.strategy ? { strategy: params.strategy } : {}),
  });
}

export function buildClientArchivedPayload(params: {
  clientId: string;
  archivedByUserId?: string;
  archivedAt?: Date | string;
  reason?: string;
}): Record<string, unknown> & BuiltWorkflowPayload<'CLIENT_ARCHIVED'> {
  return builtWorkflowPayload('CLIENT_ARCHIVED', {
    clientId: params.clientId,
    ...(params.archivedByUserId ? { archivedByUserId: params.archivedByUserId } : {}),
    ...(params.archivedAt ? { archivedAt: normalizeChangeValue(params.archivedAt) } : {}),
    ...(params.reason ? { reason: params.reason } : {}),
  });
}


// ---- client locations ------------------------------------------------------------------------
// Kept in this file so the locations ride the existing @alga-psa/workflow-streams export.

export function buildClientLocationCreatedPayload(params: {
  locationId: string;
  clientId: string;
  isDefault?: boolean;
  createdByUserId?: string;
  createdAt?: Date | string;
}): Record<string, unknown> & BuiltWorkflowPayload<'CLIENT_LOCATION_CREATED'> {
  return builtWorkflowPayload('CLIENT_LOCATION_CREATED', {
    locationId: params.locationId,
    clientId: params.clientId,
    ...(params.isDefault !== undefined ? { isDefault: params.isDefault } : {}),
    ...(params.createdByUserId ? { createdByUserId: params.createdByUserId } : {}),
    ...(params.createdAt ? { createdAt: normalizeChangeValue(params.createdAt) } : {}),
  });
}

export function buildClientLocationUpdatedPayload(params: {
  locationId: string;
  clientId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  updatedByUserId?: string;
  updatedAt?: Date | string;
}): Record<string, unknown> & BuiltWorkflowPayload<'CLIENT_LOCATION_UPDATED'> {
  const updatedFields: string[] = [];
  const changes: Record<string, { previous: unknown; new: unknown }> = {};
  for (const key of new Set([...Object.keys(params.before), ...Object.keys(params.after)])) {
    if (key === 'tenant' || key === 'updated_at' || key === 'created_at') continue;
    const previousValue = params.before[key];
    const newValue = params.after[key];
    if (areValuesEqual(previousValue, newValue)) continue;
    const path = snakeToCamel(key);
    updatedFields.push(path);
    changes[path] = { previous: normalizeChangeValue(previousValue), new: normalizeChangeValue(newValue) };
  }

  return builtWorkflowPayload('CLIENT_LOCATION_UPDATED', {
    locationId: params.locationId,
    clientId: params.clientId,
    ...(params.updatedByUserId ? { updatedByUserId: params.updatedByUserId } : {}),
    ...(params.updatedAt ? { updatedAt: normalizeChangeValue(params.updatedAt) } : {}),
    ...(updatedFields.length ? { updatedFields } : {}),
    ...(Object.keys(changes).length ? { changes } : {}),
  });
}

export function buildClientLocationDeactivatedPayload(params: {
  locationId: string;
  clientId: string;
  deactivatedByUserId?: string;
  deactivatedAt?: Date | string;
}): Record<string, unknown> & BuiltWorkflowPayload<'CLIENT_LOCATION_DEACTIVATED'> {
  return builtWorkflowPayload('CLIENT_LOCATION_DEACTIVATED', {
    locationId: params.locationId,
    clientId: params.clientId,
    ...(params.deactivatedByUserId ? { deactivatedByUserId: params.deactivatedByUserId } : {}),
    ...(params.deactivatedAt ? { deactivatedAt: normalizeChangeValue(params.deactivatedAt) } : {}),
  });
}

export function buildClientLocationDeletedPayload(params: {
  locationId: string;
  clientId: string;
  deletedByUserId?: string;
  deletedAt?: Date | string;
}): Record<string, unknown> & BuiltWorkflowPayload<'CLIENT_LOCATION_DELETED'> {
  return builtWorkflowPayload('CLIENT_LOCATION_DELETED', {
    locationId: params.locationId,
    clientId: params.clientId,
    ...(params.deletedByUserId ? { deletedByUserId: params.deletedByUserId } : {}),
    ...(params.deletedAt ? { deletedAt: normalizeChangeValue(params.deletedAt) } : {}),
  });
}
