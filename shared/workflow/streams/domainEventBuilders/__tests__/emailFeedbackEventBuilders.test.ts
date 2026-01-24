import { describe, expect, it } from 'vitest';
import {
  emailBouncedEventPayloadSchema,
  emailComplaintReceivedEventPayloadSchema,
  emailDeliveredEventPayloadSchema,
  emailUnsubscribedEventPayloadSchema,
} from '@shared/workflow/runtime/schemas/communicationsEventSchemas';
import { buildWorkflowPayload } from '@shared/workflow/streams/workflowEventPublishHelpers';
import {
  buildEmailBouncedPayload,
  buildEmailComplaintReceivedPayload,
  buildEmailDeliveredPayload,
  buildEmailUnsubscribedPayload,
} from '../emailFeedbackEventBuilders';

describe('email feedback domain event payload builders', () => {
  it('builds schema-valid EMAIL_DELIVERED payload when enriched', () => {
    const base = buildEmailDeliveredPayload({
      messageId: '2c9b1e2c-2f9f-4efb-9dc5-7f2d6f231f45',
      providerMessageId: 'provider-msg-1',
      to: 'recipient@example.com',
      deliveredAt: '2026-01-24T01:02:03.000Z',
      provider: 'resend',
    });

    const payload = buildWorkflowPayload(base, {
      tenantId: 'c6da0f3a-d8d7-4b34-85c8-7f75e0b4f9ce',
      occurredAt: '2026-01-24T01:02:03.000Z',
    });

    expect(emailDeliveredEventPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('builds schema-valid EMAIL_BOUNCED payload when enriched', () => {
    const base = buildEmailBouncedPayload({
      messageId: '2c9b1e2c-2f9f-4efb-9dc5-7f2d6f231f45',
      providerMessageId: 'provider-msg-2',
      to: 'recipient@example.com',
      bouncedAt: '2026-01-24T01:02:03.000Z',
      bounceType: 'hard',
      smtpCode: '550',
      smtpMessage: 'Mailbox not found',
    });

    const payload = buildWorkflowPayload(base, {
      tenantId: 'c6da0f3a-d8d7-4b34-85c8-7f75e0b4f9ce',
      occurredAt: '2026-01-24T01:02:03.000Z',
    });

    expect(emailBouncedEventPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('builds schema-valid EMAIL_COMPLAINT_RECEIVED payload when enriched', () => {
    const base = buildEmailComplaintReceivedPayload({
      messageId: '2c9b1e2c-2f9f-4efb-9dc5-7f2d6f231f45',
      providerMessageId: 'provider-msg-3',
      to: 'recipient@example.com',
      complainedAt: '2026-01-24T01:02:03.000Z',
      provider: 'resend',
      complaintType: 'spam',
    });

    const payload = buildWorkflowPayload(base, {
      tenantId: 'c6da0f3a-d8d7-4b34-85c8-7f75e0b4f9ce',
      occurredAt: '2026-01-24T01:02:03.000Z',
    });

    expect(emailComplaintReceivedEventPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('builds schema-valid EMAIL_UNSUBSCRIBED payload when enriched', () => {
    const base = buildEmailUnsubscribedPayload({
      recipientEmail: 'recipient@example.com',
      unsubscribedAt: '2026-01-24T01:02:03.000Z',
      source: 'resend',
      messageId: '2c9b1e2c-2f9f-4efb-9dc5-7f2d6f231f45',
    });

    const payload = buildWorkflowPayload(base, {
      tenantId: 'c6da0f3a-d8d7-4b34-85c8-7f75e0b4f9ce',
      occurredAt: '2026-01-24T01:02:03.000Z',
    });

    expect(emailUnsubscribedEventPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('throws when required fields are missing', () => {
    expect(() =>
      buildEmailDeliveredPayload({
        // @ts-expect-error intentional
        messageId: '',
        providerMessageId: 'provider-msg',
        to: 'recipient@example.com',
        provider: 'resend',
      })
    ).toThrow(/messageId/);
  });
});

