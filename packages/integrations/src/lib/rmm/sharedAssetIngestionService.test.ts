import { describe, expect, it, vi } from 'vitest';
import { ingestNormalizedRmmDeviceSnapshot } from './sharedAssetIngestionService';
import type { NormalizedRmmExternalDeviceSnapshot } from './contracts';

// The shared service uses the real tenantDb, whose scoped-query machinery emits
// an alias-qualified two-arg `.where('table.tenant', value)` the fake knex below
// does not understand. Mock tenantDb to delegate with object-form tenant scoping.
vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => conn(table).where({ tenant }),
    unscoped: (table: string) => conn(table),
  }),
}));

type DbState = {
  assets: Array<any>;
  workstation_assets: Array<any>;
  server_assets: Array<any>;
  tenant_external_entity_mappings: Array<any>;
  rmm_organization_mappings: Array<any>;
};

let assetCounter = 0;
let mappingCounter = 0;

function createFakeKnex(state: DbState) {
  function rowsFor(table: string): any[] {
    // Tables the assignment helper and the group lookup touch are created on
    // demand so each test only has to seed what it cares about.
    const key = table.split(' as ')[0];
    if (!(state as any)[key]) (state as any)[key] = [];
    return (state as any)[key];
  }

  function matches(row: any, where: Record<string, any>) {
    return Object.entries(where).every(([k, v]) => row[k] === v);
  }

  class QueryBuilder {
    private wheres: Array<Record<string, any>> = [];

    constructor(table: string) {
      this.table = table.split(' as ')[0];
    }

    private readonly table: string;

    where(where: Record<string, any>) {
      this.wheres.push(where);
      return this;
    }

    whereNotNull(col: string) {
      this.wheres.push({ __not_null: col } as any);
      return this;
    }

    // setAssetAssignee closes the open assignment row (unassigned_at IS NULL)
    // and the group lookup joins asset_groups; both reach this builder now.
    whereNull(col: string) {
      this.wheres.push({ __is_null: col } as any);
      return this;
    }

    whereIn(col: string, values: any[]) {
      this.wheres.push({ __in: { col, values } } as any);
      return this;
    }

    join(_table: string, _on: unknown) {
      return this;
    }

    select(..._cols: string[]) {
      return this;
    }

    orderBy(_col: string, _dir?: string) {
      return this;
    }

    then(resolve: (value: any) => void, reject?: (reason: unknown) => void) {
      return Promise.resolve(this.filtered().map((row) => ({ ...row }))).then(resolve, reject);
    }

    andWhere(col: string, value: any) {
      this.wheres.push({ [col]: value });
      return this;
    }

    private filtered() {
      let rows = [...rowsFor(this.table)];
      for (const where of this.wheres) {
        if ('__not_null' in where) {
          const col = (where as any).__not_null;
          rows = rows.filter((row) => row[col] !== null && typeof row[col] !== 'undefined');
          continue;
        }
        if ('__is_null' in where) {
          const col = (where as any).__is_null;
          rows = rows.filter((row) => row[col] === null || typeof row[col] === 'undefined');
          continue;
        }
        if ('__in' in where) {
          const { col, values } = (where as any).__in;
          rows = rows.filter((row) => values.includes(row[col]));
          continue;
        }
        rows = rows.filter((row) => matches(row, where));
      }
      return rows;
    }

    async first(...cols: string[]) {
      const row = this.filtered()[0];
      if (!row) return undefined;
      if (!cols.length) return row;
      const result: Record<string, unknown> = {};
      for (const col of cols) result[col] = row[col];
      return result;
    }

    async update(patch: Record<string, unknown>) {
      const rows = this.filtered();
      rows.forEach((row) => Object.assign(row, patch));
      return rows.length;
    }

    insert(data: any) {
      const rows = rowsFor(this.table);
      const row = { ...data };

      if (this.table === 'assets') {
        row.asset_id = row.asset_id || `asset_${++assetCounter}`;
      }

      if (this.table === 'tenant_external_entity_mappings') {
        row.id = row.id || `map_${++mappingCounter}`;
      }

      if (row.asset_id && typeof row.asset_id === 'object' && 'bindings' in row.asset_id) {
        row.asset_id = String((row.asset_id as any).bindings?.[0] ?? '');
      }

      rows.push(row);

      const response = {
        returning: async (_cols: string[]) => [row],
        onConflict: (_cols: string[]) => ({
          merge: async (patch: Record<string, unknown>) => {
            const existing = rows.find(
              (candidate) =>
                candidate.tenant === row.tenant &&
                String(candidate.asset_id) === String(row.asset_id)
            );
            if (existing) {
              Object.assign(existing, patch);
            }
          },
        }),
      };

      return response;
    }
  }

  const knex: any = (table: string) => new QueryBuilder(table);
  knex.fn = { now: () => new Date('2026-04-06T12:00:00.000Z') };
  knex.raw = (_sql: string, bindings: any[]) => ({ bindings });
  knex.transaction = async (cb: (trx: any) => Promise<any>) => cb(knex);
  return knex;
}

function buildSnapshot(overrides: Partial<NormalizedRmmExternalDeviceSnapshot> = {}): NormalizedRmmExternalDeviceSnapshot {
  return {
    provider: 'tanium',
    integrationId: 'integration_1',
    externalDeviceId: 'device_1',
    externalScopeId: 'scope_1',
    lifecycleState: 'active',
    assetType: 'workstation',
    displayName: 'Endpoint One',
    serialNumber: 'SN-1',
    status: 'active',
    location: 'HQ',
    assetTag: 'tanium:device_1',
    agentStatus: 'online',
    lastSeenAt: '2026-04-06T11:00:00.000Z',
    extension: {
      osType: 'Windows',
      osVersion: '11',
      currentUser: 'alice',
      lanIp: '10.0.0.5',
    },
    metadata: { source: 'test' },
    ...overrides,
  };
}

describe('sharedAssetIngestionService', () => {
  it('T002/T139: creates asset + extension + external mapping from the mapping\u2019s client', async () => {
    const state: DbState = {
      assets: [],
      workstation_assets: [],
      server_assets: [],
      tenant_external_entity_mappings: [],
      rmm_organization_mappings: [
        {
          tenant: 'tenant_1',
          integration_id: 'integration_1',
          external_organization_id: 'scope_1',
          client_id: 'client_1',
        },
      ],
    };
    const knex = createFakeKnex(state);

    const result = await ingestNormalizedRmmDeviceSnapshot({
      tenant: 'tenant_1',
      snapshot: buildSnapshot(),
      knex,
    });

    expect(result.action).toBe('created');
    expect(state.assets).toHaveLength(1);
    expect(state.workstation_assets).toHaveLength(1);
    expect(state.tenant_external_entity_mappings).toHaveLength(1);
    expect(state.tenant_external_entity_mappings[0]).toMatchObject({
      integration_type: 'tanium',
      external_entity_id: 'device_1',
      external_realm_id: 'scope_1',
      sync_status: 'synced',
    });
  });

  it('T003: re-ingesting mapped snapshot updates existing asset and does not duplicate assets', async () => {
    const state: DbState = {
      assets: [
        {
          tenant: 'tenant_1',
          asset_id: 'asset_existing',
          asset_type: 'workstation',
          name: 'Old Name',
          serial_number: 'OLD',
          status: 'active',
          location: 'Old',
          rmm_provider: 'tanium',
          rmm_device_id: 'device_1',
        },
      ],
      workstation_assets: [],
      server_assets: [],
      tenant_external_entity_mappings: [
        {
          id: 'map_existing',
          tenant: 'tenant_1',
          integration_type: 'tanium',
          alga_entity_type: 'asset',
          alga_entity_id: 'asset_existing',
          external_entity_id: 'device_1',
          external_realm_id: 'scope_1',
          sync_status: 'pending',
        },
      ],
      rmm_organization_mappings: [],
    };
    const knex = createFakeKnex(state);

    const result = await ingestNormalizedRmmDeviceSnapshot({
      tenant: 'tenant_1',
      snapshot: buildSnapshot({
        displayName: 'Updated Endpoint',
        serialNumber: 'SN-UPDATED',
      }),
      knex,
    });

    expect(result.action).toBe('updated');
    expect(state.assets).toHaveLength(1);
    expect(state.assets[0]).toMatchObject({
      name: 'Updated Endpoint',
      serial_number: 'SN-UPDATED',
      rmm_device_id: 'device_1',
      rmm_provider: 'tanium',
    });
    expect(state.tenant_external_entity_mappings).toHaveLength(1);
    expect(state.tenant_external_entity_mappings[0].sync_status).toBe('synced');
  });

  // FR-G5 (alga-2026-0002672): sync used to re-stamp `client_id` on update,
  // which reverted a manual client move on every run and fought the RMM
  // organization move. The update path now leaves ownership alone; re-pointing
  // an organization moves its devices through moveRmmOrganizationAssets.
  it('T138: leaves asset ownership and the assignee alone when a device appears under a new mapped scope', async () => {
    const state: DbState = {
      assets: [
        {
          tenant: 'tenant_1',
          asset_id: 'asset_existing',
          asset_type: 'workstation',
          client_id: 'client_old',
          contact_name_id: 'contact_of_client_old',
          name: 'Old Name',
          serial_number: 'OLD',
          status: 'active',
          location: 'Old',
          rmm_provider: 'tanium',
          rmm_device_id: 'device_1',
        },
      ],
      workstation_assets: [],
      server_assets: [],
      tenant_external_entity_mappings: [
        {
          id: 'map_existing',
          tenant: 'tenant_1',
          integration_type: 'tanium',
          alga_entity_type: 'asset',
          alga_entity_id: 'asset_existing',
          external_entity_id: 'device_1',
          external_realm_id: 'scope_old',
          sync_status: 'pending',
        },
      ],
      rmm_organization_mappings: [
        {
          tenant: 'tenant_1',
          integration_id: 'integration_1',
          external_organization_id: 'scope_new',
          client_id: 'client_new',
        },
      ],
    };
    const knex = createFakeKnex(state);

    const result = await ingestNormalizedRmmDeviceSnapshot({
      tenant: 'tenant_1',
      snapshot: buildSnapshot({
        externalScopeId: 'scope_new',
        displayName: 'Moved Endpoint',
      }),
      knex,
    });

    expect(result.action).toBe('updated');
    expect(state.assets).toHaveLength(1);
    expect(state.assets[0]).toMatchObject({
      // Ownership is the operator's to change, not sync's.
      client_id: 'client_old',
      contact_name_id: 'contact_of_client_old',
      name: 'Moved Endpoint',
      rmm_organization_id: 'scope_new',
    });
    expect(state.tenant_external_entity_mappings).toHaveLength(1);
    expect(state.tenant_external_entity_mappings[0]).toMatchObject({
      id: 'map_existing',
      external_entity_id: 'device_1',
      external_realm_id: 'scope_new',
      sync_status: 'synced',
    });
  });

  it('keeps the assigned contact when a re-sync leaves the device on the same client', async () => {
    const state: DbState = {
      assets: [
        {
          tenant: 'tenant_1',
          asset_id: 'asset_existing',
          asset_type: 'workstation',
          client_id: 'client_1',
          contact_name_id: 'contact_1',
          name: 'Old Name',
          serial_number: 'OLD',
          status: 'active',
          location: 'Old',
          rmm_provider: 'tanium',
          rmm_device_id: 'device_1',
        },
      ],
      workstation_assets: [],
      server_assets: [],
      tenant_external_entity_mappings: [
        {
          id: 'map_existing',
          tenant: 'tenant_1',
          integration_type: 'tanium',
          alga_entity_type: 'asset',
          alga_entity_id: 'asset_existing',
          external_entity_id: 'device_1',
          external_realm_id: 'scope_1',
          sync_status: 'pending',
        },
      ],
      rmm_organization_mappings: [
        {
          tenant: 'tenant_1',
          integration_id: 'integration_1',
          external_organization_id: 'scope_1',
          client_id: 'client_1',
        },
      ],
    };
    const knex = createFakeKnex(state);

    const result = await ingestNormalizedRmmDeviceSnapshot({
      tenant: 'tenant_1',
      snapshot: buildSnapshot({ displayName: 'Same Client Endpoint' }),
      knex,
    });

    expect(result.action).toBe('updated');
    expect(state.assets[0]).toMatchObject({
      client_id: 'client_1',
      contact_name_id: 'contact_1',
      name: 'Same Client Endpoint',
    });
  });

  it('reclassifies an existing asset type when the normalized snapshot type changes', async () => {
    const state: DbState = {
      assets: [
        {
          tenant: 'tenant_1',
          asset_id: 'asset_existing',
          asset_type: 'mobile_device',
          client_id: 'client_1',
          name: 'Old Name',
          serial_number: 'OLD',
          status: 'active',
          location: 'Old',
          rmm_provider: 'tanium',
          rmm_device_id: 'device_1',
        },
      ],
      workstation_assets: [],
      server_assets: [],
      tenant_external_entity_mappings: [
        {
          id: 'map_existing',
          tenant: 'tenant_1',
          integration_type: 'tanium',
          alga_entity_type: 'asset',
          alga_entity_id: 'asset_existing',
          external_entity_id: 'device_1',
          external_realm_id: 'scope_1',
          sync_status: 'pending',
        },
      ],
      rmm_organization_mappings: [],
    };
    const knex = createFakeKnex(state);

    const result = await ingestNormalizedRmmDeviceSnapshot({
      tenant: 'tenant_1',
      snapshot: buildSnapshot({
        assetType: 'workstation',
        extension: {
          osType: 'macOS',
          osVersion: 'macOS 26.3',
          currentUser: 'roberisaacs',
          lanIp: '192.168.254.190',
          wanIp: '10.0.156.6',
          lastRebootAt: '2026-04-15T10:00:00Z',
          cpuModel: 'Apple M4 Max 2.4GHz',
          cpuCores: 16,
          ramGb: 48,
          diskUsage: [{ name: '/', total_gb: 995, free_gb: 20, utilization_percent: 39 }],
          installedSoftware: [{ name: 'Docker Desktop', version: '4.40.0' }],
          systemInfo: { manufacturer: 'Apple', model: 'Mac16,5' },
        },
      }),
      knex,
    });

    expect(result.action).toBe('updated');
    expect(state.assets[0]).toMatchObject({
      asset_type: 'workstation',
    });
    expect(state.workstation_assets).toHaveLength(1);
    expect(state.workstation_assets[0]).toMatchObject({
      asset_id: 'asset_existing',
      os_type: 'macOS',
      os_version: 'macOS 26.3',
      current_user: 'roberisaacs',
      lan_ip: '192.168.254.190',
      wan_ip: '10.0.156.6',
      cpu_model: 'Apple M4 Max 2.4GHz',
      cpu_cores: 16,
      ram_gb: 48,
      disk_usage: JSON.stringify([{ name: '/', total_gb: 995, free_gb: 20, utilization_percent: 39 }]),
      installed_software: JSON.stringify([{ name: 'Docker Desktop', version: '4.40.0' }]),
      system_info: JSON.stringify({ manufacturer: 'Apple', model: 'Mac16,5' }),
    });
  });

  // FR-B6: `snapshot.status` is a loose `string` on the contract. Every mapper
  // sends `active` or `inactive` today, but a provider word must never become
  // the new asset's status, because no asset_statuses row would define it.
  it('ignores a provider status that is not one of the two slugs ingestion owns', async () => {
    for (const [providerStatus, lifecycleState, expected] of [
      ['Decommissioned', 'active', 'active'],
      ['Decommissioned', 'offline', 'inactive'],
      ['inactive', 'active', 'inactive'],
      ['active', 'offline', 'active'],
    ] as Array<[string, 'active' | 'offline', string]>) {
      const state: DbState = {
        assets: [],
        workstation_assets: [],
        server_assets: [],
        tenant_external_entity_mappings: [],
        rmm_organization_mappings: [
          {
            tenant: 'tenant_1',
            integration_id: 'integration_1',
            external_organization_id: 'scope_1',
            client_id: 'client_1',
          },
        ],
      };

      const result = await ingestNormalizedRmmDeviceSnapshot({
        tenant: 'tenant_1',
        snapshot: buildSnapshot({ status: providerStatus, lifecycleState }),
        knex: createFakeKnex(state),
      });

      expect(result.action).toBe('created');
      expect(state.assets[0].status).toBe(expected);
    }
  });
});
