import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '../../workflowEventPublishHelpers';
import {
  projectStatusChangedEventPayloadSchema,
  projectUpdatedEventPayloadSchema,
} from '../../../runtime/schemas/projectEventSchemas';
import { buildProjectStatusChangedPayload, buildProjectUpdatedPayload } from '../projectLifecycleEventBuilders';

describe('projectLifecycleEventBuilders', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const actorUserId = 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0';
  const projectId = '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a';
  const occurredAt = '2026-01-23T12:00:00.000Z';

  const ctx = {
    tenantId,
    occurredAt,
    actor: { actorType: 'USER' as const, actorUserId },
  };

  it('builds PROJECT_UPDATED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildProjectUpdatedPayload({
        projectId,
        before: {
          project_id: projectId,
          project_name: 'Before',
          status: '11111111-1111-1111-1111-111111111111',
          assigned_to: null,
          is_inactive: false,
        },
        after: {
          project_id: projectId,
          project_name: 'After',
          status: '22222222-2222-2222-2222-222222222222',
          assigned_to: '33333333-3333-3333-3333-333333333333',
          is_inactive: true,
        },
        updatedFieldKeys: ['project_name', 'status', 'assigned_to', 'is_inactive'],
        updatedAt: '2026-01-23T12:00:00.000Z',
      }),
      ctx
    );

    expect(projectUpdatedEventPayloadSchema.safeParse(payload).success).toBe(true);
    expect(payload.updatedFields).toEqual(['projectName', 'status', 'assignedTo', 'isInactive']);
    expect((payload as any).changes?.projectName).toEqual({ previous: 'Before', new: 'After' });
  });

  it('builds PROJECT_STATUS_CHANGED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildProjectStatusChangedPayload({
        projectId,
        previousStatus: '11111111-1111-1111-1111-111111111111',
        newStatus: '22222222-2222-2222-2222-222222222222',
        changedAt: '2026-01-23T12:00:00.000Z',
      }),
      ctx
    );

    expect(projectStatusChangedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });
});

