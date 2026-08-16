import { ApiOpenApiRegistry, zOpenApi } from '../registry';

/**
 * Integration-level RMM management.
 *
 * Distinct from the per-asset RMM routes under /api/v1/assets/{id}/rmm, which
 * act on one device. These configure and drive the sync that populates those
 * devices in the first place — the piece that previously existed only in the
 * settings UI, which is awkward for anyone onboarding tenants programmatically.
 */
export function registerRmmIntegrationRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'RMM Integrations';

  const RmmProviderParam = registry.registerSchema(
    'RmmProviderParam',
    zOpenApi.object({
      provider: zOpenApi
        .string()
        .describe(
          'RMM provider slug: ninjaone, levelio, tacticalrmm, tanium, or huntress. Scheduled device sync is available for the first four; huntress exposes no device listing.'
        ),
    })
  );

  const RmmIntegrationStatus = registry.registerSchema(
    'RmmIntegrationStatus',
    zOpenApi.object({
      provider: zOpenApi.string().describe('RMM provider slug.'),
      integrationId: zOpenApi.string().uuid(),
      isActive: zOpenApi.boolean().describe('Whether the integration is connected and enabled.'),
      syncStatus: zOpenApi.string().nullable().describe("Last sync outcome: 'completed', 'error', 'syncing', or 'pending'."),
      syncError: zOpenApi.string().nullable().describe('Failure detail from the last run, when it failed.'),
      connectedAt: zOpenApi.string().datetime().nullable(),
      lastSyncAt: zOpenApi
        .string()
        .datetime()
        .nullable()
        .describe('Any sync, scheduled or manual. A manual full sync advances this too.'),
      lastIncrementalSyncAt: zOpenApi
        .string()
        .datetime()
        .nullable()
        .describe(
          'Only the recurring device sync writes this. Use it, not lastSyncAt, to answer whether the schedule is actually running: an integration can show a recent lastSyncAt from one manual sync while nothing recurring has ever run.'
        ),
      deviceCount: zOpenApi.number().int().describe('Assets currently attributed to this provider.'),
      deviceSyncEnabled: zOpenApi.boolean().describe('Whether a recurring device sync is scheduled.'),
      deviceSyncIntervalMinutes: zOpenApi
        .number()
        .int()
        .describe('Cadence in minutes, 15 to 1440. Meaningful only when deviceSyncEnabled is true.'),
    })
  );

  const DeviceSyncUpdateBody = registry.registerSchema(
    'RmmDeviceSyncUpdateBody',
    zOpenApi.object({
      enabled: zOpenApi.boolean().describe('Turn the recurring device sync on or off.'),
      intervalMinutes: zOpenApi
        .number()
        .int()
        .min(15)
        .max(1440)
        .optional()
        .describe(
          'Cadence in minutes. Defaults to 60. Values outside 15 to 1440 are rejected rather than clamped, so the stored cadence is always the one requested. Every run spends provider API quota, and on some providers an incremental run still reads the whole device list.'
        ),
    })
  );

  const SyncTriggerBody = registry.registerSchema(
    'RmmSyncTriggerBody',
    zOpenApi.object({
      syncType: zOpenApi
        .enum(['full', 'incremental'])
        .optional()
        .describe(
          "Defaults to incremental, which resumes from the same cursor the schedule uses. 'full' re-reads every device regardless of when it was last seen."
        ),
    })
  );

  const SyncTriggerResponse = registry.registerSchema(
    'RmmSyncTriggerResponse',
    zOpenApi.object({
      provider: zOpenApi.string(),
      syncType: zOpenApi.enum(['full', 'incremental']),
      devicesProcessed: zOpenApi.number().int(),
      startedAt: zOpenApi.string().datetime(),
      finishedAt: zOpenApi.string().datetime(),
    })
  );

  const errors = {
    400: { description: 'Invalid request body, provider without a device sync, or an inactive integration.' },
    401: { description: 'Missing or invalid API key.' },
    403: { description: 'API key lacks the system_settings permission.' },
    404: { description: 'No integration configured for this provider.' },
  };

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/integrations/rmm',
    summary: 'List RMM integrations',
    description:
      'Status of every configured RMM integration, including whether a recurring device sync is scheduled, its cadence, and when it last ran.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    responses: {
      200: { description: 'Configured RMM integrations.', schema: zOpenApi.array(RmmIntegrationStatus) },
      ...errors,
    },
    extensions: { 'x-permission': 'system_settings:read' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/integrations/rmm/{provider}',
    summary: 'Get an RMM integration',
    description: 'Status of a single RMM integration.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: RmmProviderParam },
    responses: { 200: { description: 'Integration status.', schema: RmmIntegrationStatus }, ...errors },
    extensions: { 'x-permission': 'system_settings:read' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/integrations/rmm/{provider}/device-sync',
    summary: 'Configure the scheduled device sync',
    description:
      'Turns the recurring device sync on or off and sets its cadence. Writes desired state only — the scheduler reconciles the actual schedule within a few minutes, so a change is not instantaneous. Returns the integration status after the write.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: RmmProviderParam, body: { schema: DeviceSyncUpdateBody } },
    responses: { 200: { description: 'Updated integration status.', schema: RmmIntegrationStatus }, ...errors },
    extensions: { 'x-permission': 'system_settings:update' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/integrations/rmm/{provider}/sync',
    summary: 'Run a device sync now',
    description:
      'Runs a device sync immediately, through the same code path as the scheduled job. Synchronous: the response is sent when the sync finishes, which on a large estate can take minutes. A provider failure returns an error and leaves the sync cursor untouched, so the unread window is retried rather than skipped.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: RmmProviderParam, body: { schema: SyncTriggerBody } },
    responses: { 200: { description: 'Sync completed.', schema: SyncTriggerResponse }, ...errors },
    extensions: { 'x-permission': 'system_settings:update' },
    edition: 'both',
  });
}
