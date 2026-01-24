import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '../../workflowEventPublishHelpers';
import {
  integrationTokenExpiringEventPayloadSchema,
  integrationTokenRefreshFailedEventPayloadSchema,
} from '../../../runtime/schemas/integrationEventSchemas';
import {
  buildIntegrationTokenExpiringPayload,
  buildIntegrationTokenRefreshFailedPayload,
  getIntegrationTokenExpiringStatus,
} from '../integrationTokenEventBuilders';

describe('integrationTokenEventBuilders', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const integrationId = 'b0a523cf-6bba-4a37-b71d-2d6d3d82edc2';
  const connectionId = integrationId;

  const ctx = {
    tenantId,
    occurredAt: '2026-01-24T00:00:00.000Z',
    actor: { actorType: 'SYSTEM' as const },
  };

  it('builds INTEGRATION_TOKEN_EXPIRING payloads compatible with schema', () => {
    const now = '2026-01-24T00:00:00.000Z';
    const expiresAt = '2026-01-29T00:00:00.000Z';
    const { shouldNotify, daysUntilExpiry } = getIntegrationTokenExpiringStatus({
      now,
      expiresAt,
      windowDays: 7,
    });

    expect(shouldNotify).toBe(true);
    expect(daysUntilExpiry).toBe(5);

    const payload = buildWorkflowPayload(
      buildIntegrationTokenExpiringPayload({
        integrationId,
        provider: 'ninjaone',
        connectionId,
        expiresAt,
        daysUntilExpiry,
        notifiedAt: now,
      }),
      ctx
    );

    expect(integrationTokenExpiringEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds INTEGRATION_TOKEN_REFRESH_FAILED payloads compatible with schema', () => {
    const failedAt = '2026-01-24T00:01:00.000Z';
    const payload = buildWorkflowPayload(
      buildIntegrationTokenRefreshFailedPayload({
        integrationId,
        provider: 'ninjaone',
        connectionId,
        failedAt,
        errorCode: '401',
        errorMessage: 'Unauthorized',
        retryable: false,
      }),
      ctx
    );

    expect(integrationTokenRefreshFailedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });
});

