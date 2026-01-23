import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '../../workflowEventPublishHelpers';
import {
  scheduleBlockCreatedEventPayloadSchema,
  scheduleBlockDeletedEventPayloadSchema,
} from '../../../runtime/schemas/schedulingEventSchemas';
import { buildScheduleBlockCreatedPayload, buildScheduleBlockDeletedPayload } from '../scheduleBlockEventBuilders';

describe('scheduleBlockEventBuilders', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const actorUserId = 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0';
  const scheduleBlockId = '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a';
  const occurredAt = '2026-01-23T12:00:00.000Z';

  const ctx = {
    tenantId,
    occurredAt,
    actor: { actorType: 'USER' as const, actorUserId },
  };

  it('builds SCHEDULE_BLOCK_CREATED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildScheduleBlockCreatedPayload({
        entry: {
          entry_id: scheduleBlockId,
          work_item_type: 'ad_hoc',
          work_item_id: null,
          is_private: true,
          scheduled_start: '2026-01-24T10:00:00.000Z',
          scheduled_end: '2026-01-24T11:00:00.000Z',
          assigned_user_ids: [actorUserId],
          created_at: '2026-01-23T11:59:00.000Z',
          title: 'Out to lunch',
        },
        timezone: 'UTC',
      }),
      ctx
    );

    expect(scheduleBlockCreatedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds SCHEDULE_BLOCK_DELETED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(buildScheduleBlockDeletedPayload({ scheduleBlockId }), ctx);

    expect(scheduleBlockDeletedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });
});

