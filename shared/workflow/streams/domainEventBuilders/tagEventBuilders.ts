function normalizeTimestamp(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  return value.toISOString();
}

export function buildTagDefinitionCreatedPayload(params: {
  tagId: string;
  tagName: string;
  createdByUserId?: string;
  createdAt?: Date | string;
}): Record<string, unknown> {
  return {
    tagId: params.tagId,
    tagName: params.tagName,
    ...(params.createdByUserId ? { createdByUserId: params.createdByUserId } : {}),
    ...(params.createdAt ? { createdAt: normalizeTimestamp(params.createdAt) } : {}),
  };
}

export function buildTagDefinitionUpdatedPayload(params: {
  tagId: string;
  previousName?: string;
  newName?: string;
  updatedByUserId?: string;
  updatedAt?: Date | string;
}): Record<string, unknown> {
  return {
    tagId: params.tagId,
    ...(params.previousName ? { previousName: params.previousName } : {}),
    ...(params.newName ? { newName: params.newName } : {}),
    ...(params.updatedByUserId ? { updatedByUserId: params.updatedByUserId } : {}),
    ...(params.updatedAt ? { updatedAt: normalizeTimestamp(params.updatedAt) } : {}),
  };
}

export function buildTagAppliedPayload(params: {
  tagId: string;
  entityType: string;
  entityId: string;
  appliedByUserId?: string;
  appliedAt?: Date | string;
}): Record<string, unknown> {
  return {
    tagId: params.tagId,
    entityType: params.entityType,
    entityId: params.entityId,
    ...(params.appliedByUserId ? { appliedByUserId: params.appliedByUserId } : {}),
    ...(params.appliedAt ? { appliedAt: normalizeTimestamp(params.appliedAt) } : {}),
  };
}

export function buildTagRemovedPayload(params: {
  tagId: string;
  entityType: string;
  entityId: string;
  removedByUserId?: string;
  removedAt?: Date | string;
}): Record<string, unknown> {
  return {
    tagId: params.tagId,
    entityType: params.entityType,
    entityId: params.entityId,
    ...(params.removedByUserId ? { removedByUserId: params.removedByUserId } : {}),
    ...(params.removedAt ? { removedAt: normalizeTimestamp(params.removedAt) } : {}),
  };
}

