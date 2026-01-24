import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '../../workflowEventPublishHelpers';
import {
  integrationConnectedEventPayloadSchema,
  integrationDisconnectedEventPayloadSchema,
} from '../../../runtime/schemas/integrationEventSchemas';
import {
  buildIntegrationConnectedPayload,
  buildIntegrationDisconnectedPayload,
} from '../integrationConnectionEventBuilders';

describe('integrationConnectionEventBuilders', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const integrationId = 'b0a523cf-6bba-4a37-b71d-2d6d3d82edc2';
  const connectionId = integrationId;

  const ctx = {
    tenantId,
    occurredAt: '2026-01-24T00:00:00.000Z',
    actor: { actorType: 'SYSTEM' as const },
  };

  it('builds INTEGRATION_CONNECTED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildIntegrationConnectedPayload({
        integrationId,
        provider: 'ninjaone',
        connectionId,
        connectedAt: '2026-01-24T00:00:00.000Z',
      }),
      ctx
    );

    expect(integrationConnectedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds INTEGRATION_DISCONNECTED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildIntegrationDisconnectedPayload({
        integrationId,
        provider: 'ninjaone',
        connectionId,
        disconnectedAt: '2026-01-24T00:10:00.000Z',
        reason: 'user_requested',
      }),
      ctx
    );

    expect(integrationDisconnectedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });
});

