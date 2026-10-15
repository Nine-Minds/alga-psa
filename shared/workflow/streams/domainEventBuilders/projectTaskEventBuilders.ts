import { builtWorkflowPayload, type BuiltWorkflowPayload } from '@alga-psa/event-schemas';
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
}): Record<string, unknown> & BuiltWorkflowPayload<'PROJECT_TASK_CREATED'> {
  return builtWorkflowPayload('PROJECT_TASK_CREATED', {
    projectId: params.projectId,
    taskId: params.taskId,
    title: params.title,
    status: params.status,
    ...(params.createdByUserId ? { createdByUserId: params.createdByUserId } : {}),
    ...(params.createdAt ? { createdAt: normalizeValue(params.createdAt) } : {}),
    ...(params.dueDate ? { dueDate: normalizeValue(params.dueDate) } : {}),
  });
}

export function buildProjectTaskAssignedPayload(params: {
  projectId: string;
  taskId: string;
  assignedToId: string;
  assignedToType: 'user' | 'team';
  assignedByUserId?: string;
  assignedByName?: string;
  assignedAt?: Date | string;
}): Record<string, unknown> & BuiltWorkflowPayload<'PROJECT_TASK_ASSIGNED'> {
  return builtWorkflowPayload('PROJECT_TASK_ASSIGNED', {
    projectId: params.projectId,
    taskId: params.taskId,
    assignedToId: params.assignedToId,
    assignedToType: params.assignedToType,
    ...(params.assignedByUserId ? { assignedByUserId: params.assignedByUserId } : {}),
    ...(params.assignedByName ? { assignedByName: params.assignedByName } : {}),
    ...(params.assignedAt ? { assignedAt: normalizeValue(params.assignedAt) } : {}),
  });
}

export function buildProjectTaskStatusChangedPayload(params: {
  projectId: string;
  taskId: string;
  previousStatus: string;
  newStatus: string;
  changedAt?: Date | string;
}): Record<string, unknown> & BuiltWorkflowPayload<'PROJECT_TASK_STATUS_CHANGED'> {
  return builtWorkflowPayload('PROJECT_TASK_STATUS_CHANGED', {
    projectId: params.projectId,
    taskId: params.taskId,
    previousStatus: params.previousStatus,
    newStatus: params.newStatus,
    ...(params.changedAt ? { changedAt: normalizeValue(params.changedAt) } : {}),
  });
}

export function buildProjectTaskCompletedPayload(params: {
  projectId: string;
  taskId: string;
  completedByUserId?: string;
  completedAt?: Date | string;
}): Record<string, unknown> & BuiltWorkflowPayload<'PROJECT_TASK_COMPLETED'> {
  return builtWorkflowPayload('PROJECT_TASK_COMPLETED', {
    projectId: params.projectId,
    taskId: params.taskId,
    ...(params.completedByUserId ? { completedByUserId: params.completedByUserId } : {}),
    ...(params.completedAt ? { completedAt: normalizeValue(params.completedAt) } : {}),
  });
}

export function buildProjectTaskDependencyBlockedPayload(params: {
  projectId: string;
  taskId: string;
  blockedByTaskId: string;
  blockedAt?: Date | string;
}): Record<string, unknown> & BuiltWorkflowPayload<'PROJECT_TASK_DEPENDENCY_BLOCKED'> {
  return builtWorkflowPayload('PROJECT_TASK_DEPENDENCY_BLOCKED', {
    projectId: params.projectId,
    taskId: params.taskId,
    blockedByTaskId: params.blockedByTaskId,
    ...(params.blockedAt ? { blockedAt: normalizeValue(params.blockedAt) } : {}),
  });
}

export function buildProjectTaskDependencyUnblockedPayload(params: {
  projectId: string;
  taskId: string;
  unblockedByTaskId: string;
  unblockedAt?: Date | string;
}): Record<string, unknown> & BuiltWorkflowPayload<'PROJECT_TASK_DEPENDENCY_UNBLOCKED'> {
  return builtWorkflowPayload('PROJECT_TASK_DEPENDENCY_UNBLOCKED', {
    projectId: params.projectId,
    taskId: params.taskId,
    unblockedByTaskId: params.unblockedByTaskId,
    ...(params.unblockedAt ? { unblockedAt: normalizeValue(params.unblockedAt) } : {}),
  });
}

export function buildProjectTaskUpdatedPayload(params: {
  projectId: string;
  taskId: string;
  phaseId?: string;
  userId?: string;
  updatedAt?: Date | string;
  changes: Record<string, { previous: unknown; new: unknown }>;
}): Record<string, unknown> & BuiltWorkflowPayload<'PROJECT_TASK_UPDATED'> {
  const updatedAt = normalizeValue(params.updatedAt) ?? new Date().toISOString();
  return builtWorkflowPayload('PROJECT_TASK_UPDATED', {
    projectId: params.projectId,
    taskId: params.taskId,
    updatedAt,
    updatedFields: Object.keys(params.changes),
    changes: params.changes,
    // Legacy fields read by the search indexer and webhook subscribers.
    ...(params.phaseId ? { phaseId: params.phaseId } : {}),
    ...(params.userId ? { userId: params.userId } : {}),
    timestamp: updatedAt,
  });
}

export function buildProjectTaskAdditionalAgentAssignedPayload(params: {
  projectId: string;
  taskId: string;
  primaryAgentId: string;
  additionalAgentId: string;
  assignedByUserId?: string;
  assignedAt?: Date | string;
}): Record<string, unknown> & BuiltWorkflowPayload<'PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED'> {
  return builtWorkflowPayload('PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED', {
    projectId: params.projectId,
    taskId: params.taskId,
    primaryAgentId: params.primaryAgentId,
    additionalAgentId: params.additionalAgentId,
    ...(params.assignedByUserId ? { assignedByUserId: params.assignedByUserId } : {}),
    ...(params.assignedAt ? { assignedAt: normalizeValue(params.assignedAt) } : {}),
  });
}

export function buildTaskCommentAddedPayload(params: {
  projectId: string;
  taskId: string;
  taskCommentId: string;
  commentContent: string;
  createdByUserId?: string;
  taskName?: string;
  threadId?: string | null;
  parentCommentId?: string | null;
  isReply?: boolean;
}): Record<string, unknown> & BuiltWorkflowPayload<'TASK_COMMENT_ADDED'> {
  return builtWorkflowPayload('TASK_COMMENT_ADDED', {
    projectId: params.projectId,
    taskId: params.taskId,
    taskCommentId: params.taskCommentId,
    commentContent: params.commentContent,
    ...(params.createdByUserId ? { createdByUserId: params.createdByUserId, userId: params.createdByUserId } : {}),
    ...(params.taskName ? { taskName: params.taskName } : {}),
    // Legacy threading / mention-handler fields.
    threadId: params.threadId,
    parentCommentId: params.parentCommentId,
    isReply: params.isReply,
    thread_id: params.threadId,
    parent_comment_id: params.parentCommentId,
    is_reply: params.isReply,
    isUpdate: false,
  });
}

export function buildTaskCommentUpdatedPayload(params: {
  projectId: string;
  taskId: string;
  taskCommentId: string;
  oldCommentContent?: string;
  newCommentContent: string;
  updatedByUserId?: string;
  taskName?: string;
}): Record<string, unknown> & BuiltWorkflowPayload<'TASK_COMMENT_UPDATED'> {
  return builtWorkflowPayload('TASK_COMMENT_UPDATED', {
    projectId: params.projectId,
    taskId: params.taskId,
    taskCommentId: params.taskCommentId,
    newCommentContent: params.newCommentContent,
    ...(params.oldCommentContent ? { oldCommentContent: params.oldCommentContent } : {}),
    ...(params.updatedByUserId ? { updatedByUserId: params.updatedByUserId, userId: params.updatedByUserId } : {}),
    ...(params.taskName ? { taskName: params.taskName } : {}),
    isUpdate: true,
  });
}
