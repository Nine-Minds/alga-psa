import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '../../workflowEventPublishHelpers';
import {
  projectTaskAssignedEventPayloadSchema,
  projectTaskCompletedEventPayloadSchema,
  projectTaskCreatedEventPayloadSchema,
  projectTaskDependencyBlockedEventPayloadSchema,
  projectTaskDependencyUnblockedEventPayloadSchema,
  projectTaskStatusChangedEventPayloadSchema,
} from '../../../runtime/schemas/projectEventSchemas';
import {
  buildProjectTaskAssignedPayload,
  buildProjectTaskCompletedPayload,
  buildProjectTaskCreatedPayload,
  buildProjectTaskDependencyBlockedPayload,
  buildProjectTaskDependencyUnblockedPayload,
  buildProjectTaskStatusChangedPayload,
} from '../projectTaskEventBuilders';

describe('projectTaskEventBuilders', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const actorUserId = 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0';
  const projectId = '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a';
  const taskId = '2e9caa74-0d09-4a3f-8b57-b73f81b8de31';
  const occurredAt = '2026-01-23T12:00:00.000Z';

  const ctx = {
    tenantId,
    occurredAt,
    actor: { actorType: 'USER' as const, actorUserId },
  };

  it('builds PROJECT_TASK_CREATED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildProjectTaskCreatedPayload({
        projectId,
        taskId,
        title: 'Kickoff',
        status: 'todo',
        createdByUserId: actorUserId,
        createdAt: occurredAt,
        dueDate: '2026-02-01T00:00:00.000Z',
      }),
      ctx
    );

    expect(projectTaskCreatedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds PROJECT_TASK_ASSIGNED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildProjectTaskAssignedPayload({
        projectId,
        taskId,
        assignedToId: '3b99a3a6-85b7-4c8f-bd37-4b6b5c7d0d2d',
        assignedToType: 'user',
        assignedByUserId: actorUserId,
        assignedAt: occurredAt,
      }),
      ctx
    );

    expect(projectTaskAssignedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds PROJECT_TASK_STATUS_CHANGED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildProjectTaskStatusChangedPayload({
        projectId,
        taskId,
        previousStatus: 'todo',
        newStatus: 'done',
        changedAt: occurredAt,
      }),
      ctx
    );

    expect(projectTaskStatusChangedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds PROJECT_TASK_COMPLETED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildProjectTaskCompletedPayload({
        projectId,
        taskId,
        completedByUserId: actorUserId,
        completedAt: occurredAt,
      }),
      ctx
    );

    expect(projectTaskCompletedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds PROJECT_TASK_DEPENDENCY_BLOCKED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildProjectTaskDependencyBlockedPayload({
        projectId,
        taskId,
        blockedByTaskId: '0db4bb8b-6e7b-4e2c-8b4f-34d3e4f94b6a',
        blockedAt: occurredAt,
      }),
      ctx
    );

    expect(projectTaskDependencyBlockedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds PROJECT_TASK_DEPENDENCY_UNBLOCKED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildProjectTaskDependencyUnblockedPayload({
        projectId,
        taskId,
        unblockedByTaskId: '0db4bb8b-6e7b-4e2c-8b4f-34d3e4f94b6a',
        unblockedAt: occurredAt,
      }),
      ctx
    );

    expect(projectTaskDependencyUnblockedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });
});
