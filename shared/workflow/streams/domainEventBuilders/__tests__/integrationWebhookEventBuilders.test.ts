import { describe, expect, it } from 'vitest';
import { integrationWebhookReceivedEventPayloadSchema } from '@shared/workflow/runtime/schemas/integrationEventSchemas';
import { buildWorkflowPayload } from '@shared/workflow/streams/workflowEventPublishHelpers';
import {
  buildIntegrationWebhookReceivedPayload,
  sanitizeIntegrationWebhookRawPayload,
} from '../integrationWebhookEventBuilders';

describe('integration webhook domain event payload builders', () => {
  it('builds schema-valid INTEGRATION_WEBHOOK_RECEIVED payload when enriched', () => {
    const base = buildIntegrationWebhookReceivedPayload({
      integrationId: 'b6f16b58-28fe-4bc5-9e84-7bb2b7189a0b',
      provider: 'ninjaone',
      webhookId: 'activity-123',
      eventName: 'NODE_UPDATED',
      receivedAt: '2026-01-24T01:02:03.000Z',
      rawPayloadRef: 'integration-webhook:ref-1',
    });

    const payload = buildWorkflowPayload(base, {
      tenantId: 'c6da0f3a-d8d7-4b34-85c8-7f75e0b4f9ce',
      occurredAt: '2026-01-24T01:02:03.000Z',
    });

    expect(integrationWebhookReceivedEventPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('redacts sensitive keys when generating a raw payload snapshot', () => {
    const rawPayload = {
      authorization: 'Bearer abc123',
      nested: {
        apiKey: 'xyz',
        token: 'tkn',
        ok: 'value',
        $secret: 'should-redact',
        secretRef: 'also-redact',
      },
      arr: [{ password: 'p@ss', keep: 1 }],
    };

    const result = sanitizeIntegrationWebhookRawPayload(rawPayload, { maxBytes: 10_000 });
    expect(result.truncated).toBe(false);
    expect(result.snapshot).toEqual({
      authorization: '***',
      nested: {
        apiKey: '***',
        token: '***',
        ok: 'value',
        $secret: '***',
        secretRef: '***',
      },
      arr: [{ password: '***', keep: 1 }],
    });
  });

  it('truncates the snapshot when too large', () => {
    const rawPayload = { big: 'x'.repeat(5000) };
    const result = sanitizeIntegrationWebhookRawPayload(rawPayload, { maxBytes: 50 });
    expect(result.truncated).toBe(true);
    expect(result.snapshot).toEqual({ truncated: true, size: expect.any(Number), max: 50 });
  });
});

