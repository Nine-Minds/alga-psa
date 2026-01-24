import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import {
  mapResendWebhookToWorkflowEvents,
  verifyResendWebhookSignature,
} from 'server/src/services/email/webhooks/resendWebhookEvents';

function signSvix(secret: string, timestamp: string, payload: string): string {
  const secretBytes = Buffer.from(secret, 'base64');
  return crypto.createHmac('sha256', secretBytes).update(`${timestamp}.${payload}`).digest('base64');
}

describe('verifyResendWebhookSignature', () => {
  it('accepts when secret is not configured', () => {
    const headers = new Headers({
      'svix-id': 'msg_123',
      'svix-timestamp': String(Math.floor(Date.now() / 1000)),
      'svix-signature': 'v1,abc',
    });

    expect(
      verifyResendWebhookSignature({
        payload: '{"ok":true}',
        headers,
        webhookSecret: undefined,
      }).verified
    ).toBe(true);
  });

  it('verifies a valid svix signature with whsec_ secret', () => {
    const rawSecret = Buffer.from('super-secret').toString('base64');
    const webhookSecret = `whsec_${rawSecret}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = JSON.stringify({ type: 'email.delivered', created_at: '2026-01-24T01:02:03.000Z', data: {} });
    const signature = signSvix(rawSecret, timestamp, payload);

    const headers = new Headers({
      'svix-id': 'msg_123',
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${signature}`,
    });

    const result = verifyResendWebhookSignature({ payload, headers, webhookSecret });
    expect(result).toEqual({ verified: true });
  });

  it('rejects when signature does not match', () => {
    const rawSecret = Buffer.from('super-secret').toString('base64');
    const webhookSecret = `whsec_${rawSecret}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = '{"ok":true}';

    const headers = new Headers({
      'svix-id': 'msg_123',
      'svix-timestamp': timestamp,
      'svix-signature': 'v1,ZmFrZXNpZw==',
    });

    const result = verifyResendWebhookSignature({ payload, headers, webhookSecret });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('signature_mismatch');
  });
});

describe('mapResendWebhookToWorkflowEvents', () => {
  it('maps email.delivered to EMAIL_DELIVERED', () => {
    const webhook = {
      type: 'email.delivered',
      created_at: '2026-01-24T01:02:03.000Z',
      data: {
        email_id: 'email_123',
        to: ['recipient@example.com'],
        tags: {
          alga_tenant_id: 'tenant-123',
          alga_workflow_message_id: '2c9b1e2c-2f9f-4efb-9dc5-7f2d6f231f45',
          alga_correlation_id: 'corr-123',
        },
      },
    };

    const events = mapResendWebhookToWorkflowEvents({ webhook, svixId: 'svix_1' });
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('EMAIL_DELIVERED');
    expect(events[0].tenantId).toBe('tenant-123');
    expect(events[0].correlationId).toBe('corr-123');
    expect(events[0].payload).toMatchObject({
      messageId: '2c9b1e2c-2f9f-4efb-9dc5-7f2d6f231f45',
      providerMessageId: 'email_123',
      to: 'recipient@example.com',
      deliveredAt: '2026-01-24T01:02:03.000Z',
      provider: 'resend',
    });
  });

  it('maps email.bounced to EMAIL_BOUNCED (hard)', () => {
    const webhook = {
      type: 'email.bounced',
      created_at: '2026-01-24T01:02:03.000Z',
      data: {
        email_id: 'email_123',
        to: ['recipient@example.com'],
        tags: {
          alga_workflow_message_id: '2c9b1e2c-2f9f-4efb-9dc5-7f2d6f231f45',
        },
      },
    };

    const events = mapResendWebhookToWorkflowEvents({ webhook, svixId: 'svix_2' });
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('EMAIL_BOUNCED');
    expect(events[0].payload).toMatchObject({
      bounceType: 'hard',
      bouncedAt: '2026-01-24T01:02:03.000Z',
    });
  });

  it('maps email.soft_bounced to EMAIL_BOUNCED (soft)', () => {
    const webhook = {
      type: 'email.soft_bounced',
      created_at: '2026-01-24T01:02:03.000Z',
      data: {
        email_id: 'email_123',
        to: ['recipient@example.com'],
        tags: {
          alga_workflow_message_id: '2c9b1e2c-2f9f-4efb-9dc5-7f2d6f231f45',
        },
      },
    };

    const events = mapResendWebhookToWorkflowEvents({ webhook, svixId: 'svix_3' });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ bounceType: 'soft' });
  });

  it('maps email.complained to EMAIL_COMPLAINT_RECEIVED', () => {
    const webhook = {
      type: 'email.complained',
      created_at: '2026-01-24T01:02:03.000Z',
      data: {
        email_id: 'email_123',
        to: ['recipient@example.com'],
        tags: {
          alga_workflow_message_id: '2c9b1e2c-2f9f-4efb-9dc5-7f2d6f231f45',
        },
      },
    };

    const events = mapResendWebhookToWorkflowEvents({ webhook, svixId: 'svix_4' });
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('EMAIL_COMPLAINT_RECEIVED');
    expect(events[0].payload).toMatchObject({ provider: 'resend' });
  });

  it('maps contact.updated unsubscribed to EMAIL_UNSUBSCRIBED', () => {
    const webhook = {
      type: 'contact.updated',
      created_at: '2026-01-24T01:02:03.000Z',
      data: {
        email: 'recipient@example.com',
        unsubscribed: true,
        tags: {
          alga_tenant_id: 'tenant-123',
          alga_workflow_message_id: '2c9b1e2c-2f9f-4efb-9dc5-7f2d6f231f45',
        },
      },
    };

    const events = mapResendWebhookToWorkflowEvents({ webhook, svixId: 'svix_5' });
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('EMAIL_UNSUBSCRIBED');
    expect(events[0].payload).toMatchObject({
      recipientEmail: 'recipient@example.com',
      source: 'resend',
    });
  });
});

