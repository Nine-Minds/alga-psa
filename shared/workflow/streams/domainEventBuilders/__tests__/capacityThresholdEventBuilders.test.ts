import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '../../workflowEventPublishHelpers';
import { capacityThresholdReachedEventPayloadSchema } from '../../../runtime/schemas/schedulingEventSchemas';
import { buildCapacityThresholdReachedPayload } from '../capacityThresholdEventBuilders';

describe('capacityThresholdEventBuilders', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const actorUserId = 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0';
  const teamId = '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a';
  const occurredAt = '2026-01-23T12:00:00.000Z';

  const ctx = {
    tenantId,
    occurredAt,
    actor: { actorType: 'USER' as const, actorUserId },
  };

  it('builds CAPACITY_THRESHOLD_REACHED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildCapacityThresholdReachedPayload({
        teamId,
        date: '2026-01-24',
        capacityLimit: 8,
        currentBooked: 8.5,
        triggeredAt: '2026-01-24T10:00:00.000Z',
      }),
      ctx
    );

    expect(capacityThresholdReachedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });
});

