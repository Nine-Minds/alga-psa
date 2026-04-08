import { beforeEach, describe, expect, it, vi } from 'vitest';

type DbState = {
  rmm_integrations: Array<any>;
  rmm_organization_mappings: Array<any>;
  clients: Array<any>;
};

const secrets = new Map<string, string>();
let knexMock: any;
let state: DbState;

let gatewayGroups: Array<{ id: string; name: string }> = [];
let gatewayEndpointsByScope: Record<string, any[]> = {};
let fallbackEndpointsByScope: Record<string, any[]> = {};
let testConnectionError: Error | null = null;
const assertTierAccessMock = vi.fn(async () => undefined);
const listEndpointsMock = vi.fn(async (input?: { computerGroupId?: string | null }) => {
  if (input?.computerGroupId) {
    return gatewayEndpointsByScope[input.computerGroupId] || [];
  }

  return Object.values(gatewayEndpointsByScope).flat();
});
const listAgedOutAssetFallbackMock = vi.fn(async (input?: { computerGroupId?: string | null }) => {
  return fallbackEndpointsByScope[input?.computerGroupId || ''] || [];
});

const ingestNormalizedRmmDeviceSnapshotMock = vi.fn();

function createFakeKnex(db: DbState) {
  function rowsFor(table: string) {
    const rows = (db as any)[table];
    if (!rows) throw new Error(`Unknown table: ${table}`);
    return rows;
  }

  class QB {
    private whereClauses: Array<Record<string, any>> = [];
    private notNullCols: string[] = [];
    private andWhereClauses: Array<{ col: string; value: any }> = [];

    constructor(private readonly table: string) {}

    where(where: Record<string, any>) {
      this.whereClauses.push(where);
      return this;
    }

    whereNotNull(col: string) {
      this.notNullCols.push(col);
      return this;
    }

    andWhere(col: string, value: any) {
      this.andWhereClauses.push({ col, value });
      return this;
    }

    leftJoin() {
      return this;
    }

    orderBy() {
      return this;
    }

    select(cols: string[]) {
      const selected = this.filtered().map((row) => {
        const out: Record<string, unknown> = {};
        for (const col of cols) {
          const alias = col.match(/(.+)\s+as\s+(.+)/i);
          if (alias) {
            out[alias[2]!.trim()] = row[alias[1]!.trim()];
          } else {
            out[col] = row[col];
          }
        }
        return out;
      });
      return Promise.resolve(selected);
    }

    first(cols?: string[]) {
      const row = this.filtered()[0];
      if (!row) return Promise.resolve(undefined);
      if (!cols) return Promise.resolve(row);
      const out: Record<string, unknown> = {};
      for (const col of cols) out[col] = row[col];
      return Promise.resolve(out);
    }

    insert(data: any) {
      const rows = rowsFor(this.table);
      const inserted = { ...data };
      const existingIntegration =
        this.table === 'rmm_integrations'
          ? rows.find(
              (row: any) => row.tenant === inserted.tenant && row.provider === inserted.provider
            )
          : null;

      if (existingIntegration) {
        return {
          onConflict: () => ({
            merge: (patch: Record<string, unknown>) => {
              Object.assign(existingIntegration, patch);
              return { returning: async () => [existingIntegration] };
            },
          }),
          returning: async () => [existingIntegration],
        };
      }

      if (this.table === 'rmm_integrations') {
        inserted.integration_id = inserted.integration_id || 'integration_tanium';
      }
      if (this.table === 'rmm_organization_mappings') {
        inserted.mapping_id = inserted.mapping_id || `map_${rows.length + 1}`;
      }
      rows.push(inserted);

      return {
        onConflict: () => ({
          merge: (patch: Record<string, unknown>) => {
            if (this.table !== 'rmm_integrations') return { returning: async () => [inserted] };
            const existing = rows.find(
              (row: any) => row.tenant === inserted.tenant && row.provider === inserted.provider
            );
            if (existing) {
              Object.assign(existing, patch);
              return { returning: async () => [existing] };
            }
            return { returning: async () => [inserted] };
          },
        }),
        returning: async () => [inserted],
      };
    }

    async update(patch: Record<string, unknown>) {
      const rows = this.filtered();
      rows.forEach((row) => Object.assign(row, patch));
      return rows.length;
    }

    private filtered() {
      let rows = [...rowsFor(this.table)];
      for (const where of this.whereClauses) {
        rows = rows.filter((row) => Object.entries(where).every(([k, v]) => row[k] === v));
      }
      for (const col of this.notNullCols) {
        rows = rows.filter((row) => row[col] !== null && typeof row[col] !== 'undefined');
      }
      for (const clause of this.andWhereClauses) {
        rows = rows.filter((row) => row[clause.col] === clause.value);
      }
      return rows;
    }
  }

  const knex: any = (table: string) => new QB(table);
  knex.fn = { now: () => new Date('2026-04-06T12:00:00.000Z') };
  knex.raw = (value: string) => value;
  return knex;
}

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
}));

vi.mock('@alga-psa/types', () => ({
  TIER_FEATURES: {
    ADVANCED_ASSETS: 'ADVANCED_ASSETS',
  },
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexMock })),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: async (tenant: string, key: string) => secrets.get(`${tenant}:${key}`) || null,
    setTenantSecret: async (tenant: string, key: string, value: string) => {
      secrets.set(`${tenant}:${key}`, value);
    },
    deleteTenantSecret: async (tenant: string, key: string) => {
      secrets.delete(`${tenant}:${key}`);
    },
  })),
}));

vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTierAccess: (...args: any[]) => assertTierAccessMock(...args),
}));

vi.mock('../../../lib/integrations/tanium/taniumGatewayClient', () => ({
  normalizeTaniumGatewayUrl: (value: string) => value.trim(),
  TaniumGatewayClient: class {
    async testConnection() {
      if (testConnectionError) throw testConnectionError;
    }
    async listComputerGroups() {
      return gatewayGroups;
    }
    async listEndpoints(input?: { computerGroupId?: string | null }) {
      return listEndpointsMock(input);
    }
    async listAgedOutAssetFallback(input?: { computerGroupId?: string | null }) {
      return listAgedOutAssetFallbackMock(input);
    }
  },
}));

vi.mock('@alga-psa/integrations/lib/rmm/sharedAssetIngestionService', () => ({
  ingestNormalizedRmmDeviceSnapshot: (...args: any[]) => ingestNormalizedRmmDeviceSnapshotMock(...args),
}));

import {
  saveTaniumConfiguration,
  syncTaniumScopes,
  testTaniumConnection,
  triggerTaniumFullSync,
} from '../../../lib/actions/integrations/taniumActions';

describe('taniumActions', () => {
  beforeEach(() => {
    secrets.clear();
    gatewayGroups = [];
    gatewayEndpointsByScope = {};
    fallbackEndpointsByScope = {};
    testConnectionError = null;
    assertTierAccessMock.mockClear();
    listEndpointsMock.mockClear();
    listAgedOutAssetFallbackMock.mockClear();
    ingestNormalizedRmmDeviceSnapshotMock.mockReset();

    state = {
      rmm_integrations: [
        {
          tenant: 'tenant_1',
          provider: 'tanium',
          integration_id: 'integration_tanium',
          instance_url: 'https://tanium.example',
          is_active: false,
          settings: { provider_settings: { tanium: { use_asset_api_fallback: false } } },
        },
      ],
      rmm_organization_mappings: [],
      clients: [{ tenant: 'tenant_1', client_id: 'client_1', company_name: 'Client One' }],
    };

    knexMock = createFakeKnex(state);
    secrets.set('tenant_1:tanium_gateway_url', 'https://tanium.example');
    secrets.set('tenant_1:tanium_api_token', 'token');
  });

  it('T004: scope discovery refresh preserves client assignment and auto-sync flags', async () => {
    state.rmm_organization_mappings.push({
      tenant: 'tenant_1',
      mapping_id: 'map_existing',
      integration_id: 'integration_tanium',
      external_organization_id: 'scope_1',
      external_organization_name: 'Old Name',
      client_id: 'client_1',
      auto_sync_assets: false,
      auto_create_tickets: true,
    });
    gatewayGroups = [{ id: 'scope_1', name: 'New Name' }];

    const result = await (syncTaniumScopes as any)();

    expect(result.success).toBe(true);
    expect(state.rmm_organization_mappings[0]).toMatchObject({
      external_organization_name: 'New Name',
      client_id: 'client_1',
      auto_sync_assets: false,
      auto_create_tickets: true,
    });
  });

  it('T005: full sync uses Gateway endpoint fetch + shared ingestion and marks status completed', async () => {
    state.rmm_organization_mappings.push({
      tenant: 'tenant_1',
      mapping_id: 'map_1',
      integration_id: 'integration_tanium',
      external_organization_id: 'scope_1',
      client_id: 'client_1',
      auto_sync_assets: true,
    });
    gatewayEndpointsByScope.scope_1 = [{ id: 'endpoint_1', name: 'Endpoint 1', online: true, computerGroupId: 'scope_1' }];
    ingestNormalizedRmmDeviceSnapshotMock.mockResolvedValue({ action: 'created' });

    const result = await (triggerTaniumFullSync as any)();

    expect(result.success).toBe(true);
    expect(listEndpointsMock).toHaveBeenCalledTimes(1);
    expect(ingestNormalizedRmmDeviceSnapshotMock).toHaveBeenCalled();
    expect(state.rmm_integrations[0].sync_status).toBe('completed');
  });

  it('T006: falls back to Asset API when Gateway has no scope endpoints', async () => {
    state.rmm_organization_mappings.push({
      tenant: 'tenant_1',
      mapping_id: 'map_1',
      integration_id: 'integration_tanium',
      external_organization_id: 'scope_1',
      client_id: 'client_1',
      auto_sync_assets: true,
    });
    state.rmm_integrations[0].settings.provider_settings.tanium.use_asset_api_fallback = true;
    gatewayEndpointsByScope.scope_1 = [];
    fallbackEndpointsByScope.scope_1 = [
      { id: 'asset_fallback_1', name: 'Fallback Endpoint', online: false, computerGroupId: 'scope_1' },
    ];
    ingestNormalizedRmmDeviceSnapshotMock.mockResolvedValue({ action: 'updated' });

    const result = await (triggerTaniumFullSync as any)();

    expect(result.success).toBe(true);
    expect(ingestNormalizedRmmDeviceSnapshotMock).toHaveBeenCalled();
    const call = ingestNormalizedRmmDeviceSnapshotMock.mock.calls[0]?.[0];
    expect(call?.snapshot?.externalDeviceId).toBe('asset_fallback_1');
  });

  it('uses advanced-assets tier gating for Tanium actions', async () => {
    await (syncTaniumScopes as any)();

    expect(assertTierAccessMock).toHaveBeenCalledWith('ADVANCED_ASSETS');
  });

  it('clears saved Asset API secret when configuration is saved with an empty fallback URL', async () => {
    secrets.set('tenant_1:tanium_asset_api_url', 'https://old-asset.example');

    const result = await (saveTaniumConfiguration as any)(
      {
        gatewayUrl: 'https://tanium.example',
        assetApiUrl: '',
        useAssetApiFallback: false,
      }
    );

    expect(result.success).toBe(true);
    expect(secrets.has('tenant_1:tanium_asset_api_url')).toBe(false);
  });

  it('classifies Windows Server endpoints as server assets during sync', async () => {
    state.rmm_organization_mappings.push({
      tenant: 'tenant_1',
      mapping_id: 'map_1',
      integration_id: 'integration_tanium',
      external_organization_id: 'scope_1',
      client_id: 'client_1',
      auto_sync_assets: true,
    });
    gatewayEndpointsByScope.scope_1 = [
      {
        id: 'server_1',
        name: 'Server 1',
        online: true,
        osName: 'Windows Server 2022',
        computerGroupId: 'scope_1',
      },
    ];
    ingestNormalizedRmmDeviceSnapshotMock.mockResolvedValue({ action: 'created' });

    const result = await (triggerTaniumFullSync as any)();

    expect(result.success).toBe(true);
    expect(ingestNormalizedRmmDeviceSnapshotMock.mock.calls[0]?.[0]?.snapshot?.assetType).toBe('server');
  });

  it('T007: connection test failure keeps integration inactive and returns actionable error', async () => {
    testConnectionError = new Error('Unauthorized: invalid token');

    const result = await (testTaniumConnection as any)();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unauthorized');
    expect(state.rmm_integrations[0].is_active).toBe(false);
  });
});
