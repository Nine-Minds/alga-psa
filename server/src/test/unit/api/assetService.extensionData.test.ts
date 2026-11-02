/**
 * REST AssetService extension_data: validated against the asset type's own
 * schema (not an untagged union that kept only workstation fields), written on
 * create and on update, and rejected for types without an extension table.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const state: Record<string, Row[]> = {
    assets: [], asset_statuses: [], network_device_assets: [], workstation_assets: [],
  };
  const inserts: Array<{ table: string; row: Row }> = [];

  class QB {
    private wheres: Array<Record<string, any>> = [];
    constructor(private readonly table: string) {}

    where(arg: any, op?: any, value?: any) {
      if (typeof arg === 'string') {
        const col = arg.split('.').pop()!;
        this.wheres.push({ [col]: value === undefined ? op : value });
      } else if (arg && typeof arg === 'object') {
        this.wheres.push(arg);
      }
      return this;
    }
    whereNot() {
      return this;
    }
    whereNull() {
      return this;
    }
    select(..._cols: any[]) {
      return this;
    }
    orderBy() {
      return this;
    }
    then(resolve: (value: any) => void, reject?: (reason: unknown) => void) {
      return Promise.resolve(this.rows().map((row) => ({ ...row }))).then(resolve, reject);
    }
    private rows() {
      return (state[this.table] ?? []).filter((row) =>
        this.wheres.every((w) => Object.entries(w).every(([k, v]) => row[k] === v))
      );
    }
    async first(..._cols: string[]) {
      const row = this.rows()[0];
      return row ? { ...row } : undefined;
    }
    update(patch: Row) {
      const rows = this.rows();
      rows.forEach((row) => Object.assign(row, patch));
      const result: any = Promise.resolve(rows.length);
      result.returning = () => Promise.resolve(rows.map((row) => ({ ...row })));
      return result;
    }
    async del() {
      const doomed = new Set(this.rows());
      state[this.table] = (state[this.table] ?? []).filter((row) => !doomed.has(row));
      return doomed.size;
    }
    insert(row: Row) {
      inserts.push({ table: this.table, row });
      const copy: Row = this.table === 'assets' ? { asset_id: 'new-asset', ...row } : { ...row };
      (state[this.table] ??= []).push(copy);
      const result: any = Promise.resolve([copy]);
      result.returning = () => Promise.resolve([copy]);
      return result;
    }
  }

  const knex: any = (table: string) => new QB(table);
  knex.raw = (sql: string, bindings: unknown) => ({ sql, bindings });
  knex.fn = { now: () => '2026-10-21T12:00:00.000Z' };
  knex.transaction = async (callback: (trx: any) => Promise<any>) => callback(knex);
  return { state, inserts, knex };
});

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    tenantDb: (conn: any, tenant: string) => ({
      table: (table: string) => conn(table.split(' as ')[0]).where({ tenant }),
    }),
  };
});

vi.mock('server/src/lib/eventBus/publishers', () => ({ publishEvent: vi.fn(async () => undefined), publishWorkflowEvent: vi.fn(async () => undefined), publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined), publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async () => undefined), publishUnregisteredEventType: vi.fn(async () => undefined) }));

vi.mock('@alga-psa/assets/lib/assetAttributeWrites', () => ({
  resolveWritableAssetType: vi.fn(async () => null),
  resolveAttributeSchemaForWrite: vi.fn(async () => null),
  validateAttributesForWrite: vi.fn(() => []),
  attributesMergeExpression: vi.fn(() => ({ merged: true })),
  serializeAttributesForInsert: vi.fn((value: unknown) => JSON.stringify(value)),
}));

import { AssetService } from '../../../lib/api/services/AssetService';
import { createAssetWithExtensionSchema, parseAssetExtensionData, updateAssetSchema } from '../../../lib/api/schemas/asset';

const TENANT = 'tenant-1';
const ASSET_ID = 'asset-1';
const context = { tenant: TENANT, userId: 'user-1', db: h.knex } as any;

let service: AssetService;

beforeEach(() => {
  h.state.assets = [
    { tenant: TENANT, asset_id: ASSET_ID, client_id: 'client-a', asset_type: 'network_device', status: 'active', location_id: null, contact_name_id: null },
  ];
  h.state.asset_statuses = [
    { tenant: TENANT, status_id: 'st-active', slug: 'active', label: 'Active', kind: 'deployable', is_builtin: true, is_active: true, display_order: 0 },
  ];
  h.state.network_device_assets = [];
  h.state.workstation_assets = [];
  h.inserts.length = 0;
  service = new AssetService();
  vi.spyOn(service, 'getWithDetails').mockResolvedValue({ asset_id: ASSET_ID } as any);
  vi.spyOn(service, 'getById').mockResolvedValue({ asset_id: ASSET_ID } as any);
});

describe('asset extension_data schemas', () => {
  it('keeps network device fields that the untagged union used to strip', () => {
    const parsed = parseAssetExtensionData('network_device', {
      device_type: 'firewall',
      management_ip: '192.168.1.1',
      port_count: 8,
      os_type: 'ignored',
    });
    expect(parsed?.success && parsed.data).toEqual({ device_type: 'firewall', management_ip: '192.168.1.1', port_count: 8 });
  });

  it('reports invalid values and returns null for types without an extension table', () => {
    expect(parseAssetExtensionData('network_device', { management_ip: 'not-an-ip' })?.success).toBe(false);
    expect(parseAssetExtensionData('custom_type', { anything: true })).toBeNull();
  });

  it('passes extension_data through the create and update request schemas', () => {
    const body = { extension_data: { management_ip: '10.0.0.1' } };
    expect(updateAssetSchema.parse(body).extension_data).toEqual(body.extension_data);
    const created = createAssetWithExtensionSchema.parse({
      client_id: '00000000-0000-4000-8000-000000000001',
      asset_type: 'network_device',
      asset_tag: 'FW-1',
      name: 'Firewall',
      status: 'active',
      ...body,
    });
    expect(created.extension_data).toEqual(body.extension_data);
  });
});

describe('AssetService extension_data writes', () => {
  it('writes network device fields on create', async () => {
    await service.create({
      client_id: 'client-a',
      asset_type: 'network_device',
      asset_tag: 'FW-1',
      name: 'Firewall',
      status: 'active',
      extension_data: { device_type: 'firewall', management_ip: '192.168.1.1' },
    } as any, context);
    expect(h.state.network_device_assets[0]).toMatchObject({
      asset_id: 'new-asset', tenant: TENANT, device_type: 'firewall', management_ip: '192.168.1.1',
    });
  });

  it('inserts and then updates the extension row on update using the stored asset type', async () => {
    await service.update(ASSET_ID, { extension_data: { management_ip: '192.168.1.1', port_count: 8 } } as any, context);
    expect(h.state.network_device_assets).toHaveLength(1);
    expect(h.state.network_device_assets[0]).toMatchObject({ asset_id: ASSET_ID, management_ip: '192.168.1.1', port_count: 8 });

    await service.update(ASSET_ID, { name: 'UDM', extension_data: { firmware_version: '4.1.13' } } as any, context);
    expect(h.state.network_device_assets).toHaveLength(1);
    expect(h.state.network_device_assets[0]).toMatchObject({ management_ip: '192.168.1.1', firmware_version: '4.1.13' });
    expect(h.state.assets[0]).toMatchObject({ name: 'UDM' });
    expect(h.state.assets[0]).not.toHaveProperty('extension_data');
  });

  it('validates against the new asset_type when the update changes it', async () => {
    await service.update(ASSET_ID, { asset_type: 'workstation', extension_data: { os_type: 'Windows' } } as any, context);
    expect(h.state.workstation_assets[0]).toMatchObject({ asset_id: ASSET_ID, os_type: 'Windows' });
    expect(h.state.network_device_assets).toHaveLength(0);
  });

  it('rejects invalid values and unsupported types before writing anything', async () => {
    await expect(
      service.update(ASSET_ID, { name: 'Renamed', extension_data: { management_ip: 'not-an-ip' } } as any, context)
    ).rejects.toMatchObject({ statusCode: 400, details: [expect.objectContaining({ path: ['extension_data', 'management_ip'] })] });
    expect(h.state.assets[0].name).toBeUndefined();

    h.state.assets[0].asset_type = 'custom_type';
    await expect(
      service.update(ASSET_ID, { extension_data: { management_ip: '10.0.0.1' } } as any, context)
    ).rejects.toMatchObject({ statusCode: 400, details: [expect.objectContaining({ code: 'unsupported_asset_type' })] });
    expect(h.state.network_device_assets).toHaveLength(0);
  });
});
