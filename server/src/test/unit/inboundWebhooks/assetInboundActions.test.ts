import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  withTransaction: vi.fn(),
  lookupAlgaEntityByExternalId: vi.fn(),
  writeEntityMapping: vi.fn(),
  ingestNormalizedRmmDeviceSnapshot: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  withTransaction: mocks.withTransaction,
}));

vi.mock('@/lib/inboundWebhooks/externalEntityMappings', () => ({
  lookupAlgaEntityByExternalId: mocks.lookupAlgaEntityByExternalId,
  writeEntityMapping: mocks.writeEntityMapping,
}));

vi.mock('@alga-psa/integrations/lib/rmm/sharedAssetIngestionService', () => ({
  ingestNormalizedRmmDeviceSnapshot: mocks.ingestNormalizedRmmDeviceSnapshot,
}));

async function loadAssetInboundActions() {
  vi.resetModules();
  await import('@alga-psa/assets/actions/inboundActions');
  return import('@/lib/inboundWebhooks/actions/registry');
}

describe('asset inbound webhook actions', () => {
  const tenantKnex = { name: 'tenant-knex' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTenantKnex.mockResolvedValue({ knex: tenantKnex });
    mocks.lookupAlgaEntityByExternalId.mockResolvedValue({
      algaEntityId: 'client-1',
      externalEntityId: 'company-42',
      metadata: {},
    });
    mocks.ingestNormalizedRmmDeviceSnapshot.mockResolvedValue({
      action: 'created',
      assetId: 'asset-1',
    });
  });

  it('T1040: upsertAssetByExternalId delegates RMM-shaped payloads to shared RMM asset ingestion', async () => {
    const { getAction } = await loadAssetInboundActions();
    const action = getAction('upsertAssetByExternalId');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'rmm-alerts',
          deliveryId: 'delivery-1',
          headers: {},
          rawBody: { device: { id: 'device-42', hostname: 'server-01' } },
          idempotencyKey: 'device-42',
        },
        {
          external_id: 'device-42',
          client_external_id: 'company-42',
          external_scope_id: 'site-7',
          rmm_snapshot: {
            provider: 'ninjaone',
            integrationId: 'ninjaone-account',
            externalDeviceId: 'ninja-device',
            externalScopeId: 'ninja-site',
            hostname: 'server-01',
            serialNumber: 'SN-123',
          },
        },
      ),
    ).resolves.toEqual({
      success: true,
      entityType: 'asset',
      entityId: 'asset-1',
      externalId: 'device-42',
      metadata: {
        action: 'created',
        rmm: true,
      },
    });

    expect(mocks.lookupAlgaEntityByExternalId).toHaveBeenCalledWith(
      'tenant-a',
      'rmm-alerts',
      'client',
      'company-42',
      { knex: tenantKnex },
    );
    expect(mocks.ingestNormalizedRmmDeviceSnapshot).toHaveBeenCalledWith({
      tenant: 'tenant-a',
      resolvedClientId: 'client-1',
      knex: tenantKnex,
      snapshot: expect.objectContaining({
        provider: 'rmm-alerts',
        integrationId: 'rmm-alerts',
        externalDeviceId: 'device-42',
        externalScopeId: 'site-7',
        hostname: 'server-01',
        serialNumber: 'SN-123',
      }),
    });
    expect(mocks.withTransaction).not.toHaveBeenCalled();
    expect(mocks.writeEntityMapping).not.toHaveBeenCalled();
  });
});
