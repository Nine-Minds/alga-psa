function normalizeValue(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  return value.toISOString();
}

export function buildProjectTaskCreatedPayload(params: {
  projectId: string;
  taskId: string;
  title: string;
  status: string;
  createdByUserId?: string;
  createdAt?: Date | string;
  dueDate?: Date | string | null;
}): Record<string, unknown> {
  return {
    projectId: params.projectId,
    taskId: params.taskId,
    title: params.title,
    status: params.status,
    ...(params.createdByUserId ? { createdByUserId: params.createdByUserId } : {}),
    ...(params.createdAt ? { createdAt: normalizeValue(params.createdAt) } : {}),
    ...(params.dueDate ? { dueDate: normalizeValue(params.dueDate) } : {}),
  };
}

export function buildProjectTaskAssignedPayload(params: {
  projectId: string;
  taskId: string;
  assignedToId: string;
  assignedToType: 'user' | 'team';
  assignedByUserId?: string;
  assignedAt?: Date | string;
}): Record<string, unknown> {
  return {
    projectId: params.projectId,
    taskId: params.taskId,
    assignedToId: params.assignedToId,
    assignedToType: params.assignedToType,
    ...(params.assignedByUserId ? { assignedByUserId: params.assignedByUserId } : {}),
    ...(params.assignedAt ? { assignedAt: normalizeValue(params.assignedAt) } : {}),
  };
}

export function buildProjectTaskStatusChangedPayload(params: {
  projectId: string;
  taskId: string;
  previousStatus: string;
  newStatus: string;
  changedAt?: Date | string;
}): Record<string, unknown> {
  return {
    projectId: params.projectId,
    taskId: params.taskId,
    previousStatus: params.previousStatus,
    newStatus: params.newStatus,
    ...(params.changedAt ? { changedAt: normalizeValue(params.changedAt) } : {}),
  };
}

export function buildProjectTaskCompletedPayload(params: {
  projectId: string;
  taskId: string;
  completedByUserId?: string;
  completedAt?: Date | string;
}): Record<string, unknown> {
  return {
    projectId: params.projectId,
    taskId: params.taskId,
    ...(params.completedByUserId ? { completedByUserId: params.completedByUserId } : {}),
    ...(params.completedAt ? { completedAt: normalizeValue(params.completedAt) } : {}),
  };
}

