import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '../../workflowEventPublishHelpers';
import {
  integrationSyncCompletedEventPayloadSchema,
  integrationSyncFailedEventPayloadSchema,
  integrationSyncStartedEventPayloadSchema,
} from '../../../runtime/schemas/integrationEventSchemas';
import {
  buildIntegrationSyncCompletedPayload,
  buildIntegrationSyncFailedPayload,
  buildIntegrationSyncStartedPayload,
} from '../integrationSyncEventBuilders';

describe('integrationSyncEventBuilders', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const integrationId = 'b0a523cf-6bba-4a37-b71d-2d6d3d82edc2';
  const syncId = 'sync_01';

  const ctx = {
    tenantId,
    occurredAt: '2026-01-24T00:00:00.000Z',
    actor: { actorType: 'SYSTEM' as const },
  };

  it('builds INTEGRATION_SYNC_STARTED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildIntegrationSyncStartedPayload({
        integrationId,
        provider: 'ninjaone',
        syncId,
        scope: 'rmm:full',
        startedAt: '2026-01-24T00:00:00.000Z',
      }),
      ctx
    );

    expect(integrationSyncStartedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds INTEGRATION_SYNC_COMPLETED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildIntegrationSyncCompletedPayload({
        integrationId,
        provider: 'ninjaone',
        syncId,
        startedAt: '2026-01-24T00:00:00.000Z',
        completedAt: '2026-01-24T00:01:30.000Z',
        durationMs: 90_000,
        summary: { created: 1, updated: 2, deleted: 3, skipped: 4 },
        warnings: ['one non-fatal warning'],
      }),
      ctx
    );

    expect(integrationSyncCompletedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds INTEGRATION_SYNC_FAILED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildIntegrationSyncFailedPayload({
        integrationId,
        provider: 'ninjaone',
        syncId,
        startedAt: '2026-01-24T00:00:00.000Z',
        failedAt: '2026-01-24T00:00:10.000Z',
        durationMs: 10_000,
        errorCode: 'NINJAONE_API_ERROR',
        errorMessage: 'Something went wrong',
        retryable: true,
      }),
      ctx
    );

    expect(integrationSyncFailedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });
});

