import { describe, expect, it } from 'vitest';

import { buildWorkflowWebhookEnvelope } from '@/lib/inboundWebhooks/workflowEnvelope';

describe('inbound webhook workflow envelope', () => {
  it('T111: envelope includes the documented workflow input fields', () => {
    expect(
      buildWorkflowWebhookEnvelope({
        webhookSlug: 'rmm-alerts',
        body: {
          alert: {
            id: 'alert-42',
            severity: 'critical',
          },
        },
        headers: {
          'content-type': 'application/json',
          'x-monitor': 'auvik',
        },
        deliveryId: 'delivery-1',
        idempotencyKey: 'alert-42',
        receivedAt: '2026-05-11T17:00:00.000Z',
      }),
    ).toEqual({
      source: 'rmm-alerts',
      body: {
        alert: {
          id: 'alert-42',
          severity: 'critical',
        },
      },
      headers: {
        'content-type': 'application/json',
        'x-monitor': 'auvik',
      },
      verified: true,
      delivery_id: 'delivery-1',
      idempotency_key: 'alert-42',
      received_at: '2026-05-11T17:00:00.000Z',
    });
  });
});
