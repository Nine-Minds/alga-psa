import { describe, expect, it } from 'vitest';
import {
  notificationDeliveredEventPayloadSchema,
  notificationFailedEventPayloadSchema,
  notificationReadEventPayloadSchema,
  notificationSentEventPayloadSchema,
} from '@shared/workflow/runtime/schemas/communicationsEventSchemas';
import { buildWorkflowPayload } from '@shared/workflow/streams/workflowEventPublishHelpers';
import {
  buildNotificationDeliveredPayload,
  buildNotificationFailedPayload,
  buildNotificationReadPayload,
  buildNotificationSentPayload,
} from '../notificationEventBuilders';

describe('notification domain event payload builders', () => {
  const tenantId = 'c6da0f3a-d8d7-4b34-85c8-7f75e0b4f9ce';
  const occurredAt = '2026-01-24T01:02:03.000Z';
  const notificationId = '2c9b1e2c-2f9f-4efb-9dc5-7f2d6f231f45';
  const recipientId = 'user-123';

  it('builds schema-valid NOTIFICATION_SENT payload when enriched', () => {
    const base = buildNotificationSentPayload({
      notificationId,
      channel: 'in_app',
      recipientId,
      sentAt: occurredAt,
      templateId: 'ticket-assigned',
      contextType: 'ticket',
      contextId: 'ticket-1',
    });

    const payload = buildWorkflowPayload(base, { tenantId, occurredAt });
    expect(notificationSentEventPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('builds schema-valid NOTIFICATION_DELIVERED payload when enriched', () => {
    const base = buildNotificationDeliveredPayload({
      notificationId,
      channel: 'in_app',
      recipientId,
      deliveredAt: occurredAt,
    });

    const payload = buildWorkflowPayload(base, { tenantId, occurredAt });
    expect(notificationDeliveredEventPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('builds schema-valid NOTIFICATION_FAILED payload when enriched', () => {
    const base = buildNotificationFailedPayload({
      notificationId,
      channel: 'in_app',
      recipientId,
      failedAt: occurredAt,
      errorCode: 'redis_publish_failed',
      errorMessage: 'Redis publish failed',
      retryable: true,
    });

    const payload = buildWorkflowPayload(base, { tenantId, occurredAt });
    expect(notificationFailedEventPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('builds schema-valid NOTIFICATION_READ payload when enriched', () => {
    const base = buildNotificationReadPayload({
      notificationId,
      channel: 'in_app',
      recipientId,
      readAt: occurredAt,
      client: 'web',
    });

    const payload = buildWorkflowPayload(base, { tenantId, occurredAt });
    expect(notificationReadEventPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('throws when required fields are missing', () => {
    expect(() =>
      buildNotificationSentPayload({
        // @ts-expect-error intentional
        notificationId: '',
        channel: 'in_app',
        recipientId,
      })
    ).toThrow(/notificationId/);
  });
});

