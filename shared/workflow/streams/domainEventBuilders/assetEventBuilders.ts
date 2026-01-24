function snakeToCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_, c) => String(c).toUpperCase());
}

function snakeToCamelPath(value: string): string {
  return value
    .split('.')
    .map((segment) => snakeToCamel(segment))
    .join('.');
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

function getValueAtPath(root: unknown, path: string): unknown {
  if (!root || typeof root !== 'object') return undefined;
  const parts = path.split('.').filter(Boolean);
  let current: any = root;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

export function computeAssetWarrantyExpiring(params: {
  now: string | Date;
  previousExpiresAt?: string | Date | null;
  newExpiresAt?: string | Date | null;
  windowDays?: number;
}): { expiresAt: string; daysUntilExpiry: number } | null {
  const windowDays = params.windowDays ?? 30;
  if (windowDays <= 0) return null;

  const now = toDate(params.now);
  const nextExpiresAt = toDate(params.newExpiresAt);
  if (!now || !nextExpiresAt) return null;

  const previousExpiresAt = toDate(params.previousExpiresAt);
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffMs = nextExpiresAt.getTime() - now.getTime();
  if (diffMs < 0) return null;

  const daysUntilExpiry = Math.max(0, Math.ceil(diffMs / msPerDay));
  if (daysUntilExpiry > windowDays) return null;

  if (previousExpiresAt) {
    const previousDiffMs = previousExpiresAt.getTime() - now.getTime();
    const previousDaysUntilExpiry = Math.ceil(previousDiffMs / msPerDay);
    if (previousDaysUntilExpiry <= windowDays && previousDaysUntilExpiry >= 0) return null;
  }

  return {
    expiresAt: nextExpiresAt.toISOString(),
    daysUntilExpiry,
  };
}

export function buildAssetCreatedPayload(params: {
  assetId: string;
  clientId?: string;
  createdByUserId?: string;
  createdAt?: Date | string;
  assetType?: string;
  serialNumber?: string;
}): Record<string, unknown> {
  return {
    assetId: params.assetId,
    ...(params.clientId ? { clientId: params.clientId } : {}),
    ...(params.createdByUserId ? { createdByUserId: params.createdByUserId } : {}),
    ...(params.createdAt ? { createdAt: normalizeChangeValue(params.createdAt) } : {}),
    ...(params.assetType ? { assetType: params.assetType } : {}),
    ...(params.serialNumber ? { serialNumber: params.serialNumber } : {}),
  };
}

export function buildAssetUpdatedPayload(params: {
  assetId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  updatedPaths: string[];
  updatedByUserId?: string;
  updatedAt?: Date | string;
}): Record<string, unknown> {
  const updatedFields: string[] = [];
  const changes: Record<string, { previous: unknown; new: unknown }> = {};

  for (const path of params.updatedPaths) {
    const previousValue = getValueAtPath(params.before, path);
    const newValue = getValueAtPath(params.after, path);
    if (areValuesEqual(previousValue, newValue)) continue;

    const camelPath = snakeToCamelPath(path);
    updatedFields.push(camelPath);
    changes[camelPath] = {
      previous: normalizeChangeValue(previousValue),
      new: normalizeChangeValue(newValue),
    };
  }

  return {
    assetId: params.assetId,
    ...(params.updatedByUserId ? { updatedByUserId: params.updatedByUserId } : {}),
    ...(params.updatedAt ? { updatedAt: normalizeChangeValue(params.updatedAt) } : {}),
    ...(updatedFields.length ? { updatedFields } : {}),
    ...(Object.keys(changes).length ? { changes } : {}),
  };
}

export function buildAssetAssignedPayload(params: {
  assetId: string;
  previousOwnerType?: string;
  previousOwnerId?: string;
  newOwnerType: string;
  newOwnerId: string;
  assignedAt?: Date | string;
}): Record<string, unknown> {
  return {
    assetId: params.assetId,
    ...(params.previousOwnerType ? { previousOwnerType: params.previousOwnerType } : {}),
    ...(params.previousOwnerId ? { previousOwnerId: params.previousOwnerId } : {}),
    newOwnerType: params.newOwnerType,
    newOwnerId: params.newOwnerId,
    ...(params.assignedAt ? { assignedAt: normalizeChangeValue(params.assignedAt) } : {}),
  };
}

export function buildAssetUnassignedPayload(params: {
  assetId: string;
  previousOwnerType: string;
  previousOwnerId: string;
  unassignedAt?: Date | string;
  reason?: string;
}): Record<string, unknown> {
  return {
    assetId: params.assetId,
    previousOwnerType: params.previousOwnerType,
    previousOwnerId: params.previousOwnerId,
    ...(params.unassignedAt ? { unassignedAt: normalizeChangeValue(params.unassignedAt) } : {}),
    ...(params.reason ? { reason: params.reason } : {}),
  };
}

export function buildAssetWarrantyExpiringPayload(params: {
  assetId: string;
  expiresAt: Date | string;
  daysUntilExpiry: number;
  clientId?: string;
}): Record<string, unknown> {
  return {
    assetId: params.assetId,
    expiresAt: normalizeChangeValue(params.expiresAt),
    daysUntilExpiry: params.daysUntilExpiry,
    ...(params.clientId ? { clientId: params.clientId } : {}),
  };
}

