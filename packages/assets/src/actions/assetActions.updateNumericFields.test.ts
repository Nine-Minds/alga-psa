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
  const readDecisions: Record<string, { allowed: boolean; redactedFields: string[] }> = {};
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
      'server_assets', 'mobile_device_assets', 'printer_assets', 'asset_maintenance_history',
      'asset_maintenance_schedules', 'asset_maintenance_notifications', 'asset_groups', 'asset_group_members',
    ]) {
      dbState[table] = [];
    }
    // The status registry backs FR-B3 validation on every asset write.
    dbState.asset_statuses = [
      { tenant: TENANT, status_id: 'st-active', slug: 'active', label: 'Active', kind: 'deployable', is_builtin: true, is_active: true, display_order: 0 },
      { tenant: TENANT, status_id: 'st-in-stock', slug: 'in_stock', label: 'In stock', kind: 'deployable', is_builtin: true, is_active: true, display_order: 1 },
      { tenant: TENANT, status_id: 'st-maintenance', slug: 'maintenance', label: 'In maintenance', kind: 'pending', is_builtin: true, is_active: true, display_order: 2 },
      { tenant: TENANT, status_id: 'st-inactive', slug: 'inactive', label: 'Inactive', kind: 'undeployable', is_builtin: true, is_active: true, display_order: 3 },
      { tenant: TENANT, status_id: 'st-retired', slug: 'retired', label: 'Retired', kind: 'archived', is_builtin: true, is_active: true, display_order: 4 },
    ];
    uuidCounter = 0;
    for (const key of Object.keys(readDecisions)) delete readDecisions[key];
  };

  const stripPrefix = (key: string) => (key.includes('.') ? key.split('.').pop()! : key);

  class QB {
    private readonly table: string;
    private countMode = false;
    private rowLimit?: number;
    private rowOffset = 0;
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
    modify(callback: (query: any) => void) { callback(this); return this; }
    count() { this.countMode = true; return this; }
    sum() { return this; }
    groupBy() { return this; }
    limit(value: number) { this.rowLimit = value; return this; }
    offset(value: number) { this.rowOffset = value; return this; }
    private nullWheres: Array<{ col: string; isNull: boolean }> = [];
    whereNull(col: string) { this.nullWheres.push({ col: stripPrefix(col), isNull: true }); return this; }
    whereNotNull(col: string) { this.nullWheres.push({ col: stripPrefix(col), isNull: false }); return this; }
    join(_table: any, _fn: any) { return this; }
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
      for (const { col, isNull } of this.nullWheres) {
        rows = rows.filter((row) => (isNull ? row[col] === null || row[col] === undefined : row[col] !== null && row[col] !== undefined));
      }
      return rows;
    }

    private detached(): Row[] {
      return this.filtered().map((row) => ({ ...row }));
    }

    first() { return Promise.resolve(this.countMode ? { count: String(this.filtered().length) } : this.detached()[0]); }

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
      let rows = this.detached();
      if (this.rowOffset) rows = rows.slice(this.rowOffset);
      if (this.rowLimit !== undefined) rows = rows.slice(0, this.rowLimit);
      return Promise.resolve(rows).then(resolve, reject);
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

  return { TENANT, dbState, knexMock, mockUser, readDecisions, resetDb };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(h.mockUser, { tenant: h.TENANT }, ...args),
  hasPermission: vi.fn(async (_user: unknown, resource?: string) => resource === undefined || resource === 'asset'),
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

vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn(async () => undefined), publishEvent: vi.fn(async () => undefined), publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined), publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async () => undefined), publishUnregisteredEventType: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/event-bus/workflow/dateDomainEvents', () => ({
  emitDateDomainEventOnce: vi.fn(async () => undefined),
  toTenantLocalDate: vi.fn(() => '2026-12-31'),
}));

vi.mock('@alga-psa/workflow-streams', async (importOriginal) => ({
  ...((await importOriginal()) as any),
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
  createAuthorizationKernel: () => ({ authorizeResource: async (input: any) => h.readDecisions[input.resource.id] ?? { allowed: true, redactedFields: [] } }),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));

vi.mock('@alga-psa/authorization/pagination', () => ({
  buildAuthorizationAwarePage: async (input: any) => {
    const result = await input.fetchPage(1, Math.max(input.limit, input.scanLimit ?? 100));
    const data = [];
    for (const row of result.data) if (await input.authorizeRecord(row)) data.push(row);
    return { data: data.slice(0, input.limit), total: data.length };
  },
}));
vi.mock('../lib/assetFactsService', () => ({ listAvailableAssetFactsForAsset: vi.fn(async () => []) }));

import { bulkUpdateAssets, createAsset, getAsset, getAssetDetailBundle, getAssetHistory, getAssetMaintenanceReport, listAssets, listEntityAssets, updateAsset } from './assetActions';

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

describe('asset read redaction boundaries', () => {
  it('projects getAsset fields and preserves unrestricted values; denial still returns an action error', async () => {
    seedAsset({ asset_type: 'workstation', contact_name_id: 'contact-1', contact_name: 'Contact Secret', serial_number: 'BASE-SECRET' });
    seedWorkstation({ serial_number: 'EXT-SECRET' });
    h.readDecisions[ASSET_ID] = { allowed: true, redactedFields: ['contact_name_id', 'workstation.serial_number'] };
    const redacted = await getAsset(ASSET_ID) as any;
    expect(redacted.contact_name_id).toBeUndefined();
    expect(redacted.contact_name).toBeUndefined();
    expect(redacted.workstation.serial_number).toBeUndefined();
    expect(redacted.serial_number).toBe('BASE-SECRET');

    h.readDecisions[ASSET_ID] = { allowed: true, redactedFields: ['client_id'] };
    const identifierRedacted = await getAsset(ASSET_ID) as any;
    expect(identifierRedacted.client_id).toBeUndefined();
    expect(identifierRedacted.client.client_id).toBeUndefined();

    h.readDecisions[ASSET_ID] = { allowed: true, redactedFields: [] };
    expect((await getAsset(ASSET_ID) as any).workstation.serial_number).toBe('EXT-SECRET');
    h.readDecisions[ASSET_ID] = { allowed: false, redactedFields: [] };
    expect((await getAsset(ASSET_ID) as any).permissionError).toMatch(/Permission denied/);
  });

  it('projects detail history changes and maintenance aliases, while enforcing denial', async () => {
    seedAsset({ name: 'Secret asset name' });
    h.dbState.asset_history.push({ tenant: TENANT, asset_id: ASSET_ID, history_id: 'h1', changes: { name: 'Secret asset name', serial_number: 'Secret serial' }, changed_at: new Date(NOW_ISO) });
    h.readDecisions[ASSET_ID] = { allowed: true, redactedFields: ['name', 'serial_number'] };
    const bundle = await getAssetDetailBundle(ASSET_ID) as any;
    expect(bundle.asset.name).toBeUndefined();
    expect(bundle.maintenanceReport.asset_name).toBeUndefined();
    expect(bundle.history[0].changes).toEqual({});
    h.readDecisions[ASSET_ID] = { allowed: false, redactedFields: [] };
    await expect(getAssetDetailBundle(ASSET_ID)).rejects.toThrow(/Permission denied/);
  });

  it('applies each allowed entity asset decision after assembling aliases and extensions', async () => {
    seedAsset({ asset_type: 'workstation', name: 'Hidden list name', serial_number: 'BASE-SECRET' });
    seedWorkstation({ serial_number: 'EXT-SECRET', os_version: 'visible' });
    h.dbState.asset_associations.push({ tenant: TENANT, entity_id: 'ticket-1', entity_type: 'ticket', asset_id: ASSET_ID, created_at: new Date(NOW_ISO) });
    h.readDecisions[ASSET_ID] = { allowed: true, redactedFields: ['name', 'workstation.serial_number'] };

    const result = await listEntityAssets('ticket-1', 'ticket') as any;
    expect(result).toHaveLength(1);
    expect(result[0].name).toBeUndefined();
    expect(result[0].workstation.serial_number).toBeUndefined();
    expect(result[0].workstation.os_version).toBe('visible');
    expect(result[0].serial_number).toBe('BASE-SECRET');

    h.readDecisions[ASSET_ID] = { allowed: false, redactedFields: [] };
    expect(await listEntityAssets('ticket-1', 'ticket')).toEqual([]);
    h.readDecisions[ASSET_ID] = { allowed: true, redactedFields: [] };
    expect(((await listEntityAssets('ticket-1', 'ticket')) as any)[0].workstation.serial_number).toBe('EXT-SECRET');
  });

  it('masks standalone maintenance report aliases and standalone historical deltas', async () => {
    seedAsset({ name: 'Historical private name' });
    h.dbState.asset_history.push({
      tenant: TENANT,
      asset_id: ASSET_ID,
      history_id: 'history-private',
      changes: {
        name: { before: 'Old private name', after: 'Historical private name' },
        fields: { name: { previous_value: 'Older private name', new_value: 'New private name' } },
        serial_number: 'Private historical serial',
      },
      changed_at: new Date(NOW_ISO),
    });
    h.dbState.asset_maintenance_history.push({
      tenant: TENANT,
      history_id: 'e0000000-0000-4000-8000-000000000001',
      asset_id: ASSET_ID,
      schedule_id: 'e0000000-0000-4000-8000-000000000002',
      performed_at: new Date(NOW_ISO),
      performed_by: 'd0000000-0000-4000-8000-00000000000d',
      description: 'Routine inspection',
      maintenance_data: { serial_number: 'Maintenance historical secret', visible_note: 'visible' },
      created_at: new Date(NOW_ISO),
    });
    h.readDecisions[ASSET_ID] = { allowed: true, redactedFields: ['name', 'serial_number'] };

    const report = await getAssetMaintenanceReport(ASSET_ID) as any;
    expect(report.asset_name).toBeUndefined();
    expect(report.maintenance_history[0].maintenance_data).toEqual({ visible_note: 'visible' });
    const history = await getAssetHistory(ASSET_ID) as any;
    expect(history[0].changes).toEqual({ fields: {} });

    h.readDecisions[ASSET_ID] = { allowed: true, redactedFields: [] };
    expect((await getAssetMaintenanceReport(ASSET_ID) as any).asset_name).toBe('Historical private name');
    expect((await getAssetHistory(ASSET_ID) as any)[0].changes.name.before).toBe('Old private name');

    h.readDecisions[ASSET_ID] = { allowed: false, redactedFields: [] };
    expect((await getAssetMaintenanceReport(ASSET_ID) as any).permissionError).toMatch(/Permission denied/);
    expect((await getAssetHistory(ASSET_ID) as any).permissionError).toMatch(/Permission denied/);
  });

  it('uses a distinct decision mask for each list row and honors flat aliases and extensions', async () => {
    const secondId = 'f0000000-0000-4000-8000-000000000010';
    seedAsset({ contact_name_id: 'contact-1', contact_name: 'Contact One', client_name: 'Client One' });
    seedAsset({ asset_id: secondId, asset_tag: 'WS-002', contact_name_id: 'contact-2', contact_name: 'Contact Two', client_name: 'Client Two', asset_type: 'workstation' });
    h.dbState.workstation_assets.push({ tenant: TENANT, asset_id: secondId, serial_number: 'EXT-SECRET', os_version: 'visible' });
    h.readDecisions[ASSET_ID] = { allowed: true, redactedFields: ['contact_name_id', 'client'] };
    h.readDecisions[secondId] = { allowed: true, redactedFields: ['workstation.serial_number', 'client.client_id'] };
    const result = await listAssets({ page: 1, limit: 10, include_extension_data: true } as any) as any;
    const first = result.assets.find((asset: any) => asset.asset_id === ASSET_ID);
    const second = result.assets.find((asset: any) => asset.asset_id === secondId);
    expect(first.contact_name).toBeUndefined();
    expect(first.client_name).toBeUndefined();
    expect(first.client).toBeUndefined();
    expect(first.client_id).toBeUndefined();
    expect(second.contact_name).toBe('Contact Two');
    expect(second.workstation.serial_number).toBeUndefined();
    expect(second.workstation.os_version).toBe('visible');
    expect(second.client.client_id).toBeUndefined();
    expect(second.client_id).toBeUndefined();
    expect(first.created_at).toBeInstanceOf(Date);
    h.readDecisions[secondId] = { allowed: false, redactedFields: [] };
    const deniedList = await listAssets({ page: 1, limit: 10, include_extension_data: true } as any) as any;
    expect(deniedList.assets.some((asset: any) => asset.asset_id === secondId)).toBe(false);
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
