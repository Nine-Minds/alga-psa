import { builtWorkflowPayload, type BuiltWorkflowPayload } from '@alga-psa/event-schemas';
type ProjectLike = Record<string, unknown> & {
  project_id: string;
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

export function buildProjectUpdatedPayload(params: {
  projectId: string;
  before: ProjectLike;
  after: ProjectLike;
  updatedFieldKeys: string[];
  updatedAt?: Date | string;
}): Record<string, unknown> & BuiltWorkflowPayload<'PROJECT_UPDATED'> {
  const updatedFields: string[] = [];
  const changes: Record<string, { previous: unknown; new: unknown }> = {};

  for (const key of params.updatedFieldKeys) {
    if (key === 'tenant') continue;
    if (key === 'updated_at') continue;
    if (key === 'created_at') continue;

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

  return builtWorkflowPayload('PROJECT_UPDATED', {
    projectId: params.projectId,
    ...(params.updatedAt ? { updatedAt: normalizeChangeValue(params.updatedAt) } : {}),
    ...(updatedFields.length ? { updatedFields } : {}),
    ...(Object.keys(changes).length ? { changes } : {}),
  });
}

export function buildProjectStatusChangedPayload(params: {
  projectId: string;
  previousStatus: string;
  newStatus: string;
  changedAt?: Date | string;
}): Record<string, unknown> & BuiltWorkflowPayload<'PROJECT_STATUS_CHANGED'> {
  return builtWorkflowPayload('PROJECT_STATUS_CHANGED', {
    projectId: params.projectId,
    previousStatus: params.previousStatus,
    newStatus: params.newStatus,
    ...(params.changedAt ? { changedAt: normalizeChangeValue(params.changedAt) } : {}),
  });
}

/**
 * PROJECT_CREATED. `userId` and `timestamp` are legacy fields (subscribers and webhooks read them)
 * and stay alongside the v2 `createdByUserId` / `createdAt`. `projectName` / `clientId` are extra
 * context some creators attach.
 */
export function buildProjectCreatedPayload(params: {
  projectId: string;
  createdByUserId?: string;
  createdAt?: Date | string;
  projectName?: string;
  clientId?: string | null;
}): Record<string, unknown> & BuiltWorkflowPayload<'PROJECT_CREATED'> {
  const createdAt = params.createdAt ? normalizeChangeValue(params.createdAt) : undefined;
  return builtWorkflowPayload('PROJECT_CREATED', {
    projectId: params.projectId,
    ...(params.projectName !== undefined ? { projectName: params.projectName } : {}),
    ...(params.clientId !== undefined ? { clientId: params.clientId } : {}),
    ...(params.createdByUserId ? { createdByUserId: params.createdByUserId, userId: params.createdByUserId } : {}),
    ...(createdAt ? { createdAt, timestamp: createdAt } : {}),
  });
}

export function buildProjectAssignedPayload(params: {
  projectId: string;
  assignedToId: string;
  assignedByUserId?: string;
  assignedAt?: Date | string;
}): Record<string, unknown> & BuiltWorkflowPayload<'PROJECT_ASSIGNED'> {
  const assignedAt = params.assignedAt
    ? params.assignedAt instanceof Date
      ? params.assignedAt.toISOString()
      : params.assignedAt
    : new Date().toISOString();
  return builtWorkflowPayload('PROJECT_ASSIGNED', {
    projectId: params.projectId,
    assignedToId: params.assignedToId,
    assignedToType: 'user',
    ...(params.assignedByUserId ? { assignedByUserId: params.assignedByUserId } : {}),
    assignedAt,
    // Legacy fields still read by notification subscribers.
    assignedTo: params.assignedToId,
    ...(params.assignedByUserId ? { userId: params.assignedByUserId } : {}),
    timestamp: assignedAt,
  });
}

export function buildProjectClosedPayload(params: {
  projectId: string;
  closedByUserId?: string;
  closedAt?: Date | string;
  reason?: string;
  /** Legacy raw status patch that caused the close; kept for existing subscribers. */
  statusChanges?: Record<string, unknown>;
}): Record<string, unknown> & BuiltWorkflowPayload<'PROJECT_CLOSED'> {
  const closedAt = params.closedAt
    ? params.closedAt instanceof Date
      ? params.closedAt.toISOString()
      : params.closedAt
    : new Date().toISOString();
  return builtWorkflowPayload('PROJECT_CLOSED', {
    projectId: params.projectId,
    ...(params.closedByUserId ? { closedByUserId: params.closedByUserId, userId: params.closedByUserId } : {}),
    closedAt,
    ...(params.reason ? { reason: params.reason } : {}),
    ...(params.statusChanges ? { changes: params.statusChanges } : {}),
  });
}
