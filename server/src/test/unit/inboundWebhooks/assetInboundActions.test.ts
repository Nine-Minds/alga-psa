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
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
  }),
}));

vi.mock('@alga-psa/shared/inboundWebhooks/externalEntityMappings', () => ({
  lookupAlgaEntityByExternalId: mocks.lookupAlgaEntityByExternalId,
  writeEntityMapping: mocks.writeEntityMapping,
}));

vi.mock('@alga-psa/shared/rmm/sharedAssetIngestionService', () => ({
  ingestNormalizedRmmDeviceSnapshot: mocks.ingestNormalizedRmmDeviceSnapshot,
}));

async function loadAssetInboundActions() {
  vi.resetModules();
  await import('@alga-psa/assets/actions/inboundActions');
  return import('@alga-psa/shared/inboundWebhooks/actions/registry');
}

describe('asset inbound webhook actions', () => {
  const tenantKnex = { name: 'tenant-knex' };
  let trx: ReturnType<typeof vi.fn>;
  let tenantPolicy: { asset_tag_claims_required: boolean };
  let tagClaim: Record<string, unknown> | undefined;
  let assetsQuery: {
    where: ReturnType<typeof vi.fn>;
    whereRaw: ReturnType<typeof vi.fn>;
    whereNot: ReturnType<typeof vi.fn>;
    first: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    returning: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tenantPolicy = { asset_tag_claims_required: false };
    tagClaim = undefined;
    const tenantsQuery = {
      where: vi.fn().mockReturnThis(),
      forKeyShare: vi.fn().mockReturnThis(),
      first: vi.fn(async () => tenantPolicy),
    };
    assetsQuery = {
      where: vi.fn().mockReturnThis(),
      whereRaw: vi.fn().mockReturnThis(),
      whereNot: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([
        {
          asset_id: 'asset-1',
          name: 'Switch 1',
        },
      ]),
    };
    const claimsQuery = {
      where: vi.fn().mockReturnThis(),
      forUpdate: vi.fn().mockReturnThis(),
      first: vi.fn(async () => tagClaim),
      insert: vi.fn((row: Record<string, unknown>) => {
        return { onConflict: () => ({ ignore: async () => { tagClaim ??= row; } }) };
      }),
    };
    trx = vi.fn((table: string) => {
      if (table === 'assets') {
        return assetsQuery;
      }
      if (table === 'tenants') return tenantsQuery;
      if (table === 'asset_tag_claims') return claimsQuery;
      throw new Error(`Unexpected table ${table}`);
    });
    mocks.createTenantKnex.mockResolvedValue({ knex: tenantKnex });
    mocks.withTransaction.mockImplementation(async (_knex: unknown, callback: (transaction: unknown) => unknown) =>
      callback(trx),
    );
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
        provider: 'ninjaone',
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

  it('T1041: RMM-path asset upsert preserves the normalized ingestion snapshot shape', async () => {
    const normalizedSnapshot = {
      provider: 'tacticalrmm',
      integrationId: 'tactical-instance',
      externalDeviceId: 'tactical-device',
      externalScopeId: 'tactical-site',
      lifecycleState: 'active',
      assetType: 'server',
      displayName: 'server-01',
      serialNumber: 'SN-123',
      status: 'online',
      location: 'Main office',
      assetTag: 'TAG-123',
      agentStatus: 'online',
      lastSeenAt: '2026-05-11T12:00:00.000Z',
      extension: {
        osType: 'linux',
        osVersion: 'Ubuntu 24.04',
        agentVersion: '2.8.0',
        lanIp: '10.0.0.10',
        wanIp: '203.0.113.10',
        cpuCores: 8,
        ramGb: 32,
      },
      metadata: {
        source: 'regression-sample',
      },
    };
    const { getAction } = await loadAssetInboundActions();
    const action = getAction('upsertAssetByExternalId');

    await action?.handle(
      {
        tenant: 'tenant-a',
        webhookSlug: 'rmm-alerts',
        deliveryId: 'delivery-1',
        headers: {},
        rawBody: { device: normalizedSnapshot },
        idempotencyKey: 'device-42',
      },
      {
        external_id: 'device-42',
        client_id: 'client-1',
        rmm_snapshot: normalizedSnapshot,
      },
    );

    expect(mocks.ingestNormalizedRmmDeviceSnapshot).toHaveBeenCalledWith({
      tenant: 'tenant-a',
      resolvedClientId: 'client-1',
      knex: tenantKnex,
      snapshot: {
        ...normalizedSnapshot,
        provider: 'tacticalrmm',
        integrationId: 'rmm-alerts',
        externalDeviceId: 'device-42',
        externalScopeId: 'tactical-site',
      },
    });
  });

  it('T1040b: rejects RMM snapshot with unsupported provider', async () => {
    const { getAction } = await loadAssetInboundActions();
    const action = getAction('upsertAssetByExternalId');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'rmm-alerts',
          deliveryId: 'delivery-1',
          headers: {},
          rawBody: {},
          idempotencyKey: 'device-42',
        },
        {
          external_id: 'device-42',
          client_id: 'client-1',
          rmm_snapshot: {
            provider: 'not-a-real-rmm',
            externalDeviceId: 'whatever',
          },
        },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        success: false,
        metadata: { reason: 'unsupported_rmm_provider' },
      }),
    );
    expect(mocks.ingestNormalizedRmmDeviceSnapshot).not.toHaveBeenCalled();
  });

  it.each([false, true])('T1042: plain asset upsert claims its tag with tenant enforcement=%s', async (claimsRequired) => {
    tenantPolicy.asset_tag_claims_required = claimsRequired;
    mocks.lookupAlgaEntityByExternalId.mockResolvedValue(null);
    const { getAction } = await loadAssetInboundActions();
    const action = getAction('upsertAssetByExternalId');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'asset-feed',
          deliveryId: 'delivery-1',
          headers: {},
          rawBody: { asset: { id: 'switch-42', name: 'Switch 1' } },
          idempotencyKey: 'switch-42',
        },
        {
          external_id: 'switch-42',
          client_id: 'client-1',
          asset_type: 'network_device',
          name: 'Switch 1',
          asset_tag: 'NET-42',
          serial_number: 'SN-SWITCH',
          status: 'active',
          location: 'MDF',
        },
      ),
    ).resolves.toEqual({
      success: true,
      entityType: 'asset',
      entityId: 'asset-1',
      externalId: 'switch-42',
      metadata: {
        name: 'Switch 1',
        rmm: false,
      },
    });

    expect(mocks.ingestNormalizedRmmDeviceSnapshot).not.toHaveBeenCalled();
    expect(mocks.lookupAlgaEntityByExternalId).toHaveBeenCalledWith(
      'tenant-a',
      'asset-feed',
      'asset',
      'switch-42',
      { knex: trx },
    );
    expect(await trx('asset_tag_claims').first()).toMatchObject({
      tenant: 'tenant-a', normalized_tag: 'NET-42', owner_kind: 'asset',
      owner_id: assetsQuery.insert.mock.calls[0][0].asset_id,
    });
    expect(assetsQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: 'tenant-a',
        asset_type: 'network_device',
        client_id: 'client-1',
        asset_tag: 'NET-42',
        asset_tag_normalized: 'NET-42',
        asset_tag_managed: claimsRequired,
        asset_tag_legacy_exempt: false,
        serial_number: 'SN-SWITCH',
        name: 'Switch 1',
        status: 'active',
        location: 'MDF',
      }),
    );
    expect(mocks.writeEntityMapping).toHaveBeenCalledWith(
      'tenant-a',
      'asset-feed',
      'asset',
      'asset-1',
      'switch-42',
      {
        knex: trx,
        metadata: {
          source: 'inbound_webhook',
          delivery_id: 'delivery-1',
        },
      },
    );
  });

  it.each(['asset', 'reservation'] as const)('rejects a plain asset upsert whose tag belongs to another %s', async (ownerKind) => {
    mocks.lookupAlgaEntityByExternalId.mockResolvedValue(null);
    if (ownerKind === 'asset') {
      assetsQuery.first.mockResolvedValue({ asset_id: 'existing-asset' });
    } else {
      tagClaim = { owner_kind: 'reservation', owner_id: 'existing-reservation' };
    }
    const { getAction } = await loadAssetInboundActions();

    await expect(getAction('upsertAssetByExternalId')?.handle(
      {
        tenant: 'tenant-a',
        webhookSlug: 'asset-feed',
        deliveryId: 'delivery-1',
        headers: {},
        rawBody: {},
        idempotencyKey: 'switch-42',
      },
      { external_id: 'switch-42', client_id: 'client-1', asset_tag: ' net-42 ' },
    )).rejects.toMatchObject({ code: 'ASSET_TAG_CONFLICT', statusCode: 409 });

    expect(assetsQuery.whereRaw).toHaveBeenCalledWith(expect.any(String), ['NET-42']);
    expect(assetsQuery.insert).not.toHaveBeenCalled();
    expect(assetsQuery.update).not.toHaveBeenCalled();
    expect(mocks.writeEntityMapping).not.toHaveBeenCalled();
    if (ownerKind === 'reservation') {
      expect(tagClaim).toEqual({ owner_kind: 'reservation', owner_id: 'existing-reservation' });
    }
  });
});
