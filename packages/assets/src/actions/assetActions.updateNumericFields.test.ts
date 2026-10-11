/**
 * alga0002283: warranty-only asset edits failed with "Failed to update asset".
 *
 * Root cause: getAsset returned raw rows, so pg NUMERIC columns (e.g.
 * network_device_assets.power_draw_watts) reached the edit form as the string
 * "0.00", which updateAssetSchema (z.number()) rejected on every later save.
 * These tests pin the action-level contract: getAsset is normalised, a
 * form-shaped warranty-only update succeeds with null numerics, and
 * validation failures are RETURNED (not thrown) with their issue paths.
 *
 * The in-memory harness cannot reproduce the driver's NUMERIC-as-string
 * behaviour on its own, so rows are seeded with the string pg would return.
 * The real-database proof lives in
 * server/src/test/integration/assetSaveWarranty.integration.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'a0000000-0000-4000-8000-00000000000a';
const CLIENT_ID = 'b0000000-0000-4000-8000-00000000000b';
const ASSET_ID = 'f0000000-0000-4000-8000-00000000000f';
const NOW_ISO = '2026-06-12T12:00:00.000Z';

type Row = Record<string, any>;

// LEVERAGE: pattern asset-actions-inmemory-harness — this knex QB mock is copied from
// assetActions.customTypes.test.ts (and assetActions.postCommit.test.ts); a shared
// hoistable harness would let each asset action test stay a page long.
const h = vi.hoisted(() => {
  const TENANT = 'a0000000-0000-4000-8000-00000000000a';

  const dbState: Record<string, Row[]> = {};
  let uuidCounter = 0;

  const nextUuid = () => {
    uuidCounter += 1;
    return `c0000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
  };

  const resetDb = () => {
    for (const key of Object.keys(dbState)) delete dbState[key];
    for (const table of [
      'assets', 'asset_type_registry', 'asset_history', 'asset_relationships', 'asset_associations',
      'team_members', 'users', 'user_roles', 'clients', 'workstation_assets', 'network_device_assets',
      'server_assets', 'mobile_device_assets', 'printer_assets',
    ]) {
      dbState[table] = [];
    }
    uuidCounter = 0;
  };

  const stripPrefix = (key: string) => (key.includes('.') ? key.split('.').pop()! : key);

  class QB {
    private readonly table: string;
    private objWheres: Array<Record<string, any>> = [];
    private inWheres: Array<{ col: string; vals: any[] }> = [];

    constructor(tableSpec: string) {
      this.table = tableSpec.split(' as ')[0];
    }

    private get rows(): Row[] {
      if (!dbState[this.table]) dbState[this.table] = [];
      return dbState[this.table];
    }

    where(arg1: any, arg2?: any) {
      if (typeof arg1 === 'function') return this;
      if (typeof arg1 === 'string') {
        this.objWheres.push({ [stripPrefix(arg1)]: arg2 });
        return this;
      }
      const normalized: Record<string, any> = {};
      for (const [key, value] of Object.entries(arg1)) normalized[stripPrefix(key)] = value;
      this.objWheres.push(normalized);
      return this;
    }

    andWhere(arg1: any, arg2?: any) { return this.where(arg1, arg2); }
    orWhere() { return this; }
    whereIn(col: string, vals: any[]) { this.inWheres.push({ col: stripPrefix(col), vals }); return this; }
    select(..._cols: any[]) { return this; }
    leftJoin(_table: any, _fn: any) { return this; }
    orderBy() { return this; }

    private filtered(): Row[] {
      let rows = [...this.rows];
      for (const where of this.objWheres) {
        rows = rows.filter((row) => Object.entries(where).every(([k, v]) => row[k] === v));
      }
      for (const { col, vals } of this.inWheres) {
        rows = rows.filter((row) => vals.includes(row[col]));
      }
      return rows;
    }

    private detached(): Row[] {
      return this.filtered().map((row) => ({ ...row }));
    }

    first() { return Promise.resolve(this.detached()[0]); }

    insert(data: Row | Row[]) {
      const incoming = (Array.isArray(data) ? data : [data]).map((row) => {
        const copy: Row = { ...row };
        if (this.table === 'assets' && !copy.asset_id) copy.asset_id = nextUuid();
        if (typeof copy.attributes === 'string') copy.attributes = JSON.parse(copy.attributes);
        return copy;
      });
      this.rows.push(...incoming);
      const result: any = Promise.resolve(incoming);
      result.returning = () => Promise.resolve(incoming);
      return result;
    }

    update(patch: Row) {
      const rows = this.filtered();
      for (const row of rows) Object.assign(row, patch);
      return Promise.resolve(rows.length);
    }

    delete() {
      const remaining = this.rows.filter(
        (row) =>
          !(
            this.objWheres.every((where) => Object.entries(where).every(([k, v]) => row[k] === v)) &&
            this.inWheres.every(({ col, vals }) => vals.includes(row[col]))
          )
      );
      dbState[this.table] = remaining;
      return Promise.resolve(this.rows.length - remaining.length);
    }

    then(resolve: (value: any) => void, reject?: (reason: unknown) => void) {
      return Promise.resolve(this.detached()).then(resolve, reject);
    }

    catch(onReject: (reason: unknown) => any) {
      return Promise.resolve(this.detached()).catch(onReject);
    }
  }

  const clone = (value: any): any => {
    if (value instanceof Date) return new Date(value.getTime());
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
    }
    return value;
  };

  const knexMock: any = (tableSpec: string) => new QB(tableSpec);
  knexMock.raw = (sql: string, bindings: string) => ({ __raw: true, sql, bindings });
  knexMock.fn = { now: () => '2026-06-12T12:00:00.000Z' };
  // Real transactions roll back on throw — snapshot and restore so rollback
  // behaviour (the output-schema check lives inside the transaction) is observable.
  knexMock.transaction = async (cb: (trx: any) => Promise<any>) => {
    const snapshot = clone(dbState);
    try {
      return await cb(knexMock);
    } catch (error) {
      for (const key of Object.keys(dbState)) delete dbState[key];
      Object.assign(dbState, snapshot);
      throw error;
    }
  };
  knexMock.schema = { hasTable: async () => false };

  const mockUser = {
    user_id: 'd0000000-0000-4000-8000-00000000000d',
    user_type: 'internal' as const,
    roles: [{ role_id: 'role-1' }],
  };

  return { TENANT, dbState, knexMock, mockUser, resetDb };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(h.mockUser, { tenant: h.TENANT }, ...args),
  hasPermission: vi.fn(async () => true),
  localizeActionError: vi.fn(async (value: unknown) => value),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: h.knexMock, tenant: h.TENANT })),
  withTransaction: vi.fn(async (_knex: unknown, cb: (trx: unknown) => Promise<unknown>) => cb(h.knexMock)),
  resolveEffectiveTimeZone: vi.fn(async () => 'UTC'),
  tenantDb: (conn: any, tenant: string) => ({
    table: (t: string) => conn(t).where({ tenant }),
    unscoped: (t: string, _reason?: string) => conn(t),
    tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q),
  }),
}));

vi.mock('@alga-psa/core', () => ({ deleteEntityWithValidation: vi.fn() }));

vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/event-bus/workflow/dateDomainEvents', () => ({
  emitDateDomainEventOnce: vi.fn(async () => undefined),
  toTenantLocalDate: vi.fn(() => '2026-12-31'),
}));

vi.mock('@alga-psa/workflow-streams', () => ({
  buildAssetAssignedPayload: vi.fn(() => ({})),
  buildAssetCreatedPayload: vi.fn(() => ({})),
  buildAssetUnassignedPayload: vi.fn(() => ({})),
  buildAssetUpdatedPayload: vi.fn(() => ({})),
  buildAssetWarrantyExpiringPayload: vi.fn(() => ({})),
  computeAssetWarrantyExpiring: vi.fn(() => null),
}));

vi.mock('@alga-psa/authorization/kernel', () => ({
  BuiltinAuthorizationKernelProvider: class {},
  BundleAuthorizationKernelProvider: class {
    constructor(_opts: unknown) {}
  },
  RequestLocalAuthorizationCache: class {},
  createAuthorizationKernel: () => ({ authorizeResource: async () => ({ allowed: true }) }),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));

vi.mock('@alga-psa/authorization/pagination', () => ({ buildAuthorizationAwarePage: vi.fn() }));
vi.mock('../lib/assetFactsService', () => ({ listAvailableAssetFactsForAsset: vi.fn(async () => []) }));

import { bulkUpdateAssets, createAsset, getAsset, updateAsset } from './assetActions';

function seedAsset(overrides: Row = {}): Row {
  const row: Row = {
    tenant: TENANT,
    asset_id: ASSET_ID,
    asset_type: 'network_device',
    client_id: CLIENT_ID,
    asset_tag: 'NET-001',
    name: 'Core switch',
    status: 'active',
    serial_number: '',
    location: '',
    location_id: null,
    // pg's `timestamp` type parser (knexfile.ts) hands back Date objects.
    created_at: new Date(NOW_ISO),
    updated_at: new Date(NOW_ISO),
    purchase_date: null,
    warranty_end_date: null,
    attributes: null,
    ...overrides,
  };
  h.dbState.assets.push(row);
  return row;
}

/** A network device exactly as Quick Add stores it, as pg returns it: NUMERIC -> string. */
function seedNetworkDevice(overrides: Row = {}) {
  h.dbState.network_device_assets.push({
    tenant: TENANT,
    asset_id: ASSET_ID,
    device_type: 'switch',
    management_ip: '',
    port_count: 0,
    firmware_version: '',
    supports_poe: false,
    power_draw_watts: '0.00',
    vlan_config: {},
    port_config: {},
    ...overrides,
  });
}

function seedWorkstation(overrides: Row = {}) {
  h.dbState.workstation_assets.push({
    tenant: TENANT,
    asset_id: ASSET_ID,
    os_type: 'windows',
    os_version: '11',
    cpu_model: 'i7',
    cpu_cores: null,
    ram_gb: null,
    storage_type: 'ssd',
    storage_capacity_gb: null,
    gpu_model: null,
    last_login: null,
    installed_software: [],
    ...overrides,
  });
}

/**
 * What AssetForm submits for a network device after getAsset -> form mapping ->
 * handleSubmit, for a warranty-only edit with blank number fields.
 */
function networkDeviceFormPayload(overrides: Row = {}) {
  return {
    asset_type: 'network_device',
    client_id: CLIENT_ID,
    name: 'Core switch',
    asset_tag: 'NET-001',
    status: 'active',
    location_id: null,
    warranty_end_date: '2026-12-31T00:00:00.000Z',
    network_device: {
      device_type: 'switch',
      management_ip: '',
      port_count: null,
      firmware_version: '',
      supports_poe: false,
      power_draw_watts: null,
      vlan_config: {},
      port_config: {},
    },
    ...overrides,
  } as any;
}

function workstationFormPayload() {
  return {
    asset_type: 'workstation',
    client_id: CLIENT_ID,
    name: 'Desk PC',
    asset_tag: 'WS-001',
    status: 'active',
    location_id: null,
    warranty_end_date: '2026-12-31T00:00:00.000Z',
    workstation: {
      os_type: 'windows',
      os_version: '11',
      cpu_model: 'i7',
      cpu_cores: null,
      ram_gb: null,
      storage_type: 'ssd',
      storage_capacity_gb: null,
      installed_software: [],
    },
  } as any;
}

beforeEach(() => {
  h.resetDb();
  vi.clearAllMocks();
});

describe('getAsset returns the normalised Asset (alga0002283 root cause)', () => {
  it("normalises NUMERIC-as-string '0.00' to the number 0 and returns dates as ISO strings", async () => {
    seedAsset({ warranty_end_date: new Date('2026-02-10T00:00:00.000Z') });
    seedNetworkDevice({ power_draw_watts: '150.00' });

    const asset = (await getAsset(ASSET_ID)) as any;

    expect(asset.network_device.power_draw_watts).toBe(150);
    expect(asset.warranty_end_date).toBe('2026-02-10T00:00:00.000Z');
    expect(asset.created_at).toBe(NOW_ISO);
    expect(typeof asset.updated_at).toBe('string');
  });

  it("normalises the '0.00' Quick Add stores to 0", async () => {
    seedAsset();
    seedNetworkDevice({ power_draw_watts: '0.00' });

    const asset = (await getAsset(ASSET_ID)) as any;

    expect(asset.network_device.power_draw_watts).toBe(0);
    expect(typeof asset.network_device.power_draw_watts).toBe('number');
  });
});

describe('updateAsset: warranty-only edits (alga0002283)', () => {
  it('succeeds for a network device with blank (null) numerics and keeps them null', async () => {
    seedAsset();
    seedNetworkDevice();

    const result = (await updateAsset(ASSET_ID, networkDeviceFormPayload())) as any;

    expect(result.actionError).toBeUndefined();
    expect(result.warranty_end_date).toBe('2026-12-31T00:00:00.000Z');
    expect(h.dbState.network_device_assets[0].power_draw_watts).toBeNull();
    expect(h.dbState.network_device_assets[0].port_count).toBeNull();
    expect(result.network_device.power_draw_watts).toBeNull();
  });

  it('succeeds for a workstation with blank cpu_cores, ram_gb and storage_capacity_gb', async () => {
    seedAsset({ asset_type: 'workstation', asset_tag: 'WS-001', name: 'Desk PC' });
    seedWorkstation();

    const result = (await updateAsset(ASSET_ID, workstationFormPayload())) as any;

    expect(result.actionError).toBeUndefined();
    expect(result.warranty_end_date).toBe('2026-12-31T00:00:00.000Z');
    expect(h.dbState.workstation_assets[0]).toMatchObject({
      cpu_cores: null,
      ram_gb: null,
      storage_capacity_gb: null,
    });
    expect(result.workstation.cpu_cores).toBeNull();
  });

  it('round-trips a decimal power_draw_watts of 12.5', async () => {
    seedAsset();
    seedNetworkDevice();
    const payload = networkDeviceFormPayload();
    payload.network_device.power_draw_watts = 12.5;

    const result = (await updateAsset(ASSET_ID, payload)) as any;

    expect(result.network_device.power_draw_watts).toBe(12.5);
    expect(h.dbState.network_device_assets[0].power_draw_watts).toBe(12.5);
  });

  it('persists NULL when a previously stored value is cleared with null', async () => {
    seedAsset();
    seedNetworkDevice({ power_draw_watts: 12.5, port_count: 24 });

    await updateAsset(ASSET_ID, networkDeviceFormPayload());

    expect(h.dbState.network_device_assets[0].power_draw_watts).toBeNull();
    expect(h.dbState.network_device_assets[0].port_count).toBeNull();
  });
});

describe('updateAsset returns validation failures instead of throwing (alga0002283)', () => {
  it('returns an AssetActionError carrying validationIssues with the field path', async () => {
    seedAsset();
    seedNetworkDevice();
    const payload = networkDeviceFormPayload();
    payload.network_device.power_draw_watts = 'abc';

    const result = (await updateAsset(ASSET_ID, payload)) as any;

    expect(typeof result.actionError).toBe('string');
    expect(result.validationIssues).toHaveLength(1);
    expect(result.validationIssues[0].path).toEqual(['network_device', 'power_draw_watts']);
    expect(result.validationIssues[0].code).toBe('invalid_type');
    expect(typeof result.validationIssues[0].message).toBe('string');
    // Nothing was written.
    expect(h.dbState.network_device_assets[0].power_draw_watts).toBe('0.00');
    expect(h.dbState.assets[0].warranty_end_date).toBeNull();
  });

  it('bulk update still reports a per-asset error for a returned validation failure', async () => {
    seedAsset();

    const response = (await bulkUpdateAssets([ASSET_ID], { location_id: 'not-a-uuid' } as any)) as any;

    expect(response.failed).toBe(1);
    expect(response.results[0]).toMatchObject({ asset_id: ASSET_ID, success: false });
    expect(response.results[0].error).toContain('location_id');
    expect(response.results[0].error).not.toBe('Failed to update asset');
  });
});
