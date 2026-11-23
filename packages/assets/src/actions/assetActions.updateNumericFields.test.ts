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
      'asset_group_contacts', 'asset_documents',
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
    private objWheres: Array<Record<string, any>> = [];
    private inWheres: Array<{ col: string; vals: any[] }> = [];
    private groupColumns: string[] = [];
    private countExpression: string | null = null;
    private rowLimit: number | undefined;
    private rowOffset = 0;

    constructor(tableSpec: string) {
      this.table = tableSpec.split(' as ')[0];
    }

    clone() {
      const query = new QB(this.table);
      query.objWheres = this.objWheres.map((where) => ({ ...where }));
      query.inWheres = this.inWheres.map(({ col, vals }) => ({ col, vals: [...vals] }));
      query.nullWheres = this.nullWheres.map((where) => ({ ...where }));
      query.groupColumns = [...this.groupColumns];
      query.countExpression = this.countExpression;
      query.rowLimit = this.rowLimit;
      query.rowOffset = this.rowOffset;
      return query;
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
    private nullWheres: Array<{ col: string; isNull: boolean }> = [];
    whereNull(col: string) { this.nullWheres.push({ col: stripPrefix(col), isNull: true }); return this; }
    whereNotNull(col: string) { this.nullWheres.push({ col: stripPrefix(col), isNull: false }); return this; }
    join(_table: any, _fn: any) { return this; }
    leftJoin(_table: any, _fn: any) { return this; }
    orderBy() { return this; }
    groupBy(...columns: string[]) { this.groupColumns.push(...columns.map(stripPrefix)); return this; }
    limit(value: number) { this.rowLimit = value; return this; }
    offset(value: number) { this.rowOffset = value; return this; }

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
      let rows = this.filtered();
      if (this.countExpression) {
        const [expression, alias = 'count'] = this.countExpression.split(' as ');
        const groups = new Map<string, Row[]>();
        if (this.groupColumns.length === 0) groups.set('all', rows);
        else for (const row of rows) {
          const key = JSON.stringify(this.groupColumns.map((column) => row[column]));
          const group = groups.get(key) ?? [];
          group.push(row);
          groups.set(key, group);
        }
        rows = [...groups.values()].map((group) => ({
          ...Object.fromEntries(this.groupColumns.map((column) => [column, group[0][column]])),
          [alias]: String(group.filter((row) => expression === '*' || row[stripPrefix(expression)] != null).length),
        }));
      }
      return rows.slice(this.rowOffset, this.rowLimit === undefined ? undefined : this.rowOffset + this.rowLimit)
        .map((row) => ({ ...row }));
    }

    first() { return Promise.resolve(this.detached()[0]); }
    count(expression: string) {
      this.countExpression = expression;
      return this;
    }
    sum(expression: string) {
      const key = expression.split(' as ')[1] ?? 'sum';
      const value = this.filtered().reduce((total, row) => total + Number(row[expression.split(' as ')[0]] || 0), 0);
      const result: any = Promise.resolve([{ [key]: String(value) }]);
      result.first = () => Promise.resolve({ [key]: String(value) });
      return result;
    }

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
      for (const row of rows) {
        Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, value]) => !(value && typeof value === 'object' && (value as any).__raw))));
        if (patch.attributes && (patch.attributes as any).__raw) {
          row.attributes = { ...(row.attributes ?? {}), ...JSON.parse((patch.attributes as any).bindings) };
        }
      }
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

  return {
    TENANT, dbState, knexMock, mockUser, readDecisions, resetDb,
    privateGroupSummary: null as Row | null,
    authorizedGroupSummary: vi.fn(async (..._args: unknown[]) => null),
    authorizedGroupSummaries: vi.fn(async (..._args: unknown[]) => new Map()),
  };
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

vi.mock('@alga-psa/authorization/kernel', async (importOriginal) => ({
  // The real restriction predicate: whether the list must authorize each record (closed bundles included).
  bundleRulesRestrict: (await importOriginal<typeof import('@alga-psa/authorization/kernel')>()).bundleRulesRestrict,
  builtinResolversRestrict: () => false,
  BuiltinAuthorizationKernelProvider: class {},
  BundleAuthorizationKernelProvider: class {
    constructor(_opts: unknown) {}
  },
  RequestLocalAuthorizationCache: class {},
  createAuthorizationKernel: () => ({
    authorizeResource: async (input: any) => h.readDecisions[input.resource.id] ?? { allowed: true, redactedFields: [] },
    authorizeMutation: async () => ({ allowed: true }),
  }),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));

vi.mock('@alga-psa/authorization/pagination', () => ({
  buildAuthorizationAwarePage: async ({ page, limit, scanLimit, fetchPage, authorizeRecord }: any) => {
    const result = await fetchPage(1, Math.max(limit, scanLimit ?? 100));
    const data = [];
    for (const record of result.data) if (await authorizeRecord(record)) data.push(record);
    return { data: data.slice(0, limit), total: data.length };
  },
}));
vi.mock('../lib/assetFactsService', () => ({ listAvailableAssetFactsForAsset: vi.fn(async () => []) }));
vi.mock('../lib/assetGroups', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  getAssetGroupSummary: async () => h.privateGroupSummary,
  getAssetGroupSummariesForAssets: async (_trx: unknown, _tenant: string, assetIds: string[]) =>
    new Map(assetIds.filter((assetId) => h.privateGroupSummary).map((assetId) => [assetId, h.privateGroupSummary])),
  getAuthorizedAssetGroupSummary: (...args: unknown[]) => h.authorizedGroupSummary(...args),
  getAuthorizedAssetGroupSummariesForAssets: (...args: unknown[]) => h.authorizedGroupSummaries(...args),
}));

import { bulkUpdateAssets, createAsset, getAsset, getAssetDetailBundle, getAssetHistory, getAssetMaintenanceReport, listAssets, listEntityAssets, updateAsset, updateAssetRecord } from './assetActions';
import { buildAssetUpdatedPayload } from '@alga-psa/workflow-streams';

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
  h.privateGroupSummary = null;
  vi.clearAllMocks();
  h.authorizedGroupSummary.mockResolvedValue(null);
  h.authorizedGroupSummaries.mockResolvedValue(new Map());
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

  it('keeps an authorized asset visible when its group summary is denied', async () => {
    seedAsset();
    seedNetworkDevice();
    h.privateGroupSummary = { group_id: 'secret-group', name: 'Forbidden group', member_count: 2 };

    const asset = (await getAsset(ASSET_ID)) as any;

    expect(asset.asset_id).toBe(ASSET_ID);
    expect(asset.group).toBeNull();
    expect(h.authorizedGroupSummary).toHaveBeenCalledWith(h.knexMock, TENANT, h.mockUser, ASSET_ID);
  });

  it('keeps the asset detail bundle visible while suppressing a denied group summary', async () => {
    seedAsset({ asset_type: 'unknown' });
    h.privateGroupSummary = { group_id: 'secret-group', name: 'Forbidden group', member_count: 2 };
    const result = (await getAssetDetailBundle(ASSET_ID)) as any;

    expect(result.asset.asset_id).toBe(ASSET_ID);
    expect(result.asset.group).toBeNull();
    expect(h.authorizedGroupSummary).toHaveBeenCalledWith(h.knexMock, TENANT, h.mockUser, ASSET_ID);
  });

  it('keeps listed assets visible while suppressing denied batch group summaries', async () => {
    seedAsset();
    h.privateGroupSummary = { group_id: 'secret-group', name: 'Forbidden group', member_count: 2 };

    const result = (await listAssets({ page: 1, limit: 10 } as any)) as any;

    expect(result.assets.map((asset: any) => asset.asset_id)).toContain(ASSET_ID);
    expect(result.assets.find((asset: any) => asset.asset_id === ASSET_ID).group).toBeNull();
    expect(h.authorizedGroupSummaries).toHaveBeenCalledWith(h.knexMock, TENANT, h.mockUser, [ASSET_ID]);
  });

  it('T113: lists authorized group summaries alongside assets whose groups are denied', async () => {
    const otherAssetId = 'e0000000-0000-4000-8000-00000000000e';
    seedAsset();
    seedAsset({ asset_id: otherAssetId, asset_tag: 'NET-002', name: 'Other switch' });
    const allowedSummary = {
      group_id: 'b0000000-0000-4000-8000-00000000000b',
      name: 'Allowed group',
      kind: 'bundle',
      member_count: 2,
      user_count: 0,
    };
    h.privateGroupSummary = { group_id: 'secret-group', name: 'Forbidden group', member_count: 2 };
    h.authorizedGroupSummaries.mockResolvedValue(new Map([[ASSET_ID, allowedSummary]]));

    const result = (await listAssets({ page: 1, limit: 10 } as any)) as any;

    expect(result.assets).toHaveLength(2);
    expect(result.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ asset_id: ASSET_ID, group: allowedSummary }),
      expect.objectContaining({ asset_id: otherAssetId, group: null }),
    ]));
    expect(JSON.stringify(result)).not.toContain('Forbidden group');
  });

  it.each([
    { filter: { asset_type: 'network_device' }, expectedIds: [ASSET_ID, 'denied-group-asset'] },
    { filter: { asset_types: ['network_device', 'workstation'] }, expectedIds: [ASSET_ID, 'denied-group-asset', 'workstation-asset'] },
  ])('keeps group visibility and type facets independent of the selected types: $filter', async ({ filter, expectedIds }) => {
    seedAsset();
    seedAsset({ asset_id: 'denied-group-asset' });
    seedAsset({ asset_id: 'workstation-asset', asset_type: 'workstation' });
    seedAsset({ asset_id: 'server-asset', asset_type: 'server' });
    seedAsset({ asset_id: 'inactive-asset', status: 'inactive' });
    seedAsset({ asset_id: 'foreign-asset', tenant: 'another-tenant' });
    const allowedSummary = { group_id: 'allowed-group', name: 'Allowed group', member_count: 2 };
    h.privateGroupSummary = { group_id: 'secret-group', name: 'Forbidden group', member_count: 2 };
    h.authorizedGroupSummaries.mockResolvedValue(new Map([[ASSET_ID, allowedSummary]]));

    const result = await listAssets({ page: 1, limit: 10, status: 'active', ...filter });

    expect(result).toMatchObject({
      total: expectedIds.length,
      asset_type_counts: { network_device: 2, workstation: 1, server: 1 },
    });
    expect('assets' in result && result.assets.map((asset) => asset.asset_id).sort()).toEqual([...expectedIds].sort());
    expect('assets' in result && result.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ asset_id: ASSET_ID, group: allowedSummary }),
      expect.objectContaining({ asset_id: 'denied-group-asset', group: null }),
    ]));
    expect(JSON.stringify(result)).not.toContain('Forbidden group');
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
    expect(await getAssetDetailBundle(ASSET_ID)).toMatchObject({ permissionError: expect.stringMatching(/Permission denied/) });
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
        fields: {
          name: { previous_value: 'Older private name', new_value: 'New private name' },
          workstation: { serial_number: { before: 'Old device secret', after: 'New device secret' }, os_version: 'visible OS' },
          attributes: { hudu_fields: { password: 'History password secret', public_note: 'visible history note' } },
        },
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
      maintenance_data: {
        workstation: { serial_number: 'Maintenance device secret', os_version: 'visible maintenance OS' },
        attributes: { hudu_fields: { password: 'Maintenance password secret', public_note: 'visible maintenance note' } },
        visible_note: 'visible',
      },
      created_at: new Date(NOW_ISO),
    });
    h.readDecisions[ASSET_ID] = {
      allowed: true,
      redactedFields: ['name', 'serial_number', 'workstation.serial_number', 'attributes.hudu_fields.password'],
    };

    const report = await getAssetMaintenanceReport(ASSET_ID) as any;
    expect(report.asset_name).toBeUndefined();
    expect(report.maintenance_history[0].maintenance_data).toEqual({
      workstation: { os_version: 'visible maintenance OS' },
      attributes: { hudu_fields: { public_note: 'visible maintenance note' } },
      visible_note: 'visible',
    });
    const bundle = await getAssetDetailBundle(ASSET_ID) as any;
    expect(bundle.maintenanceReport.maintenance_history[0].maintenance_data).toEqual(report.maintenance_history[0].maintenance_data);
    expect(bundle.maintenanceHistory[0].maintenance_data).toEqual(report.maintenance_history[0].maintenance_data);
    const history = await getAssetHistory(ASSET_ID) as any;
    expect(history[0].changes).toEqual({
      fields: {
        workstation: { os_version: 'visible OS' },
        attributes: { hudu_fields: { public_note: 'visible history note' } },
      },
    });

    h.readDecisions[ASSET_ID] = { allowed: true, redactedFields: [] };
    expect((await getAssetMaintenanceReport(ASSET_ID) as any).asset_name).toBe('Historical private name');
    expect((await getAssetMaintenanceReport(ASSET_ID) as any).maintenance_history[0].maintenance_data.workstation.serial_number).toBe('Maintenance device secret');
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

describe('updateAsset protects unreadable fields at the mutation boundary', () => {
  it('preserves concealed nullable values when an older form submits empty defaults with a name edit', async () => {
    const concealed = {
      purchase_cost: 987654,
      purchase_cost_currency: 'USD',
      manufacturer: 'Private manufacturer',
      model: 'Private model',
      order_number: 'PRIVATE-ORDER',
    };
    seedAsset(concealed);
    seedNetworkDevice({ power_draw_watts: '42.50' });
    h.readDecisions[ASSET_ID] = {
      allowed: true,
      redactedFields: [...Object.keys(concealed), 'network_device.power_draw_watts'],
    };

    const loaded = await getAsset(ASSET_ID) as any;
    for (const field of Object.keys(concealed)) expect(loaded).not.toHaveProperty(field);
    expect(loaded.network_device).not.toHaveProperty('power_draw_watts');

    // Older or already-open forms can still send null for an unreadable value.
    // Persistence must be safe independently of the client-side payload guard.
    const saved = await updateAsset(ASSET_ID, {
      name: 'Renamed core switch',
      ...Object.fromEntries(Object.keys(concealed).map((field) => [field, null])),
      network_device: { power_draw_watts: null },
    } as any) as any;

    expect(saved.actionError).toBeUndefined();
    expect(saved.name).toBe('Renamed core switch');
    expect(h.dbState.assets[0]).toMatchObject({ ...concealed, name: 'Renamed core switch' });
    expect(h.dbState.network_device_assets[0].power_draw_watts).toBe('42.50');

    const reloaded = await getAsset(ASSET_ID) as any;
    expect(reloaded.name).toBe('Renamed core switch');
    for (const field of Object.keys(concealed)) {
      expect(saved).not.toHaveProperty(field);
      expect(reloaded).not.toHaveProperty(field);
    }
    expect(saved.network_device).not.toHaveProperty('power_draw_watts');
    expect(reloaded.network_device).not.toHaveProperty('power_draw_watts');
  });

  it('keeps masked base, extension and structured values through unrelated and hostile updates', async () => {
    const storedPurchaseCost = 987654;
    const storedAsset = seedAsset({
      asset_type: 'network_device',
      purchase_cost: storedPurchaseCost,
      purchase_cost_currency: 'USD',
      manufacturer: 'Private manufacturer',
      attributes: { private_note: 'Private structured value', public_note: 'Public old value' },
    });
    seedNetworkDevice({ power_draw_watts: '42.50', management_ip: '10.40.56.123' });
    h.readDecisions[ASSET_ID] = {
      allowed: true,
      redactedFields: ['purchase_cost', 'manufacturer', 'network_device.power_draw_watts', 'network_device.management_ip', 'attributes.private_note'],
    };

    const maskedLoad = await getAsset(ASSET_ID) as any;
    expect(maskedLoad.purchase_cost).toBeUndefined();
    expect(maskedLoad.manufacturer).toBeUndefined();
    expect(maskedLoad.network_device.power_draw_watts).toBeUndefined();
    expect(maskedLoad.network_device.management_ip).toBeUndefined();
    expect(maskedLoad.attributes).toEqual({ public_note: 'Public old value' });

    const saveResult = await updateAsset(ASSET_ID, {
      name: 'Renamed switch',
      purchase_cost: null,
      manufacturer: 'Attacker replacement',
      network_device: { power_draw_watts: 'not-a-number', management_ip: '' } as any,
      attributes: { private_note: 'Attacker structured replacement', public_note: 'Public updated value' },
    } as any) as any;

    expect(saveResult.actionError).toBeUndefined();
    expect(saveResult.name).toBe('Renamed switch');
    expect(saveResult.purchase_cost).toBeUndefined();
    expect(saveResult.manufacturer).toBeUndefined();
    expect(saveResult.network_device.power_draw_watts).toBeUndefined();
    expect(saveResult.network_device.management_ip).toBeUndefined();
    expect(saveResult.attributes.private_note).toBeUndefined();
    expect(saveResult.attributes.public_note).toBe('Public updated value');
    expect(h.dbState.asset_history[0].changes.attributes).toEqual({ public_note: 'Public updated value' });
    expect(storedAsset.name).toBe('Renamed switch');
    expect(storedAsset.purchase_cost).toBe(storedPurchaseCost);
    expect(storedAsset.purchase_cost_currency).toBe('USD');
    expect(storedAsset.manufacturer).toBe('Private manufacturer');
    expect(storedAsset.attributes).toEqual({ private_note: 'Private structured value', public_note: 'Public updated value' });
    expect(h.dbState.network_device_assets[0]).toMatchObject({ power_draw_watts: '42.50', management_ip: '10.40.56.123' });

    // Trusted verification is separate from the masked mutation response.
    h.readDecisions[ASSET_ID] = { allowed: true, redactedFields: [] };
    const privilegedRead = await getAsset(ASSET_ID) as any;
    expect(privilegedRead.purchase_cost).toBe(storedPurchaseCost);
    expect(privilegedRead.manufacturer).toBe('Private manufacturer');
    expect(privilegedRead.network_device.power_draw_watts).toBe(42.5);
    expect(privilegedRead.network_device.management_ip).toBe('10.40.56.123');
    expect(privilegedRead.attributes.private_note).toBe('Private structured value');
  });

  it('still lets an authorized reader intentionally clear a readable nullable field', async () => {
    seedAsset({ purchase_cost: 12345, purchase_cost_currency: 'USD' });
    const result = await updateAsset(ASSET_ID, { purchase_cost: null } as any) as any;
    expect(result.purchase_cost).toBeNull();
    expect(h.dbState.assets[0].purchase_cost).toBeNull();
    expect(h.dbState.assets[0].purchase_cost_currency).toBeNull();
  });

  it('preserves masked descendants when JSON attributes and extension columns are replaced', async () => {
    seedAsset({ attributes: {
      config: { secret: 'KEEP', public: 'old' },
      entries: [{ secret: 'ARRAY-KEEP', public: 'old' }],
    } });
    seedNetworkDevice({ vlan_config: { secret: 'KEEP', public: 'old' } });
    const redactedFields = ['attributes.config.secret', 'attributes.entries.0.secret', 'network_device.vlan_config.secret'];
    h.readDecisions[ASSET_ID] = { allowed: true, redactedFields };

    const maskedLoad = await getAsset(ASSET_ID) as any;
    expect(maskedLoad.attributes.config).toEqual({ public: 'old' });
    expect(maskedLoad.attributes.entries).toEqual([{ public: 'old' }]);
    expect(maskedLoad.network_device.vlan_config).toEqual({ public: 'old' });

    const result = await updateAsset(ASSET_ID, {
      name: 'Updated name',
      attributes: { config: { public: 'new' }, entries: [{ public: 'new' }] },
      network_device: { vlan_config: { public: 'new' } },
    } as any) as any;

    expect(result.name).toBe('Updated name');
    expect(result.attributes.config).toEqual({ public: 'new' });
    expect(result.attributes.entries).toEqual([{ public: 'new' }]);
    expect(result.network_device.vlan_config).toEqual({ public: 'new' });
    expect(h.dbState.assets[0].attributes).toEqual({
      config: { secret: 'KEEP', public: 'new' },
      entries: [{ secret: 'ARRAY-KEEP', public: 'new' }],
    });
    expect(h.dbState.network_device_assets[0].vlan_config).toEqual({ secret: 'KEEP', public: 'new' });
    expect(h.dbState.asset_history[0].changes.attributes.config).toEqual({ public: 'new' });
    expect(h.dbState.asset_history[0].changes.network_device.vlan_config).toEqual({ public: 'new' });
    const eventInput = vi.mocked(buildAssetUpdatedPayload).mock.calls.at(-1)?.[0];
    expect(eventInput?.after.attributes).toEqual({
      config: { public: 'new' },
      entries: [{ public: 'new' }],
    });
    expect((eventInput?.after.network_device as any).vlan_config).toEqual({ public: 'new' });

    const ancestorReplacement = await updateAsset(ASSET_ID, {
      attributes: { config: 'replacement', entries: [] },
    } as any) as any;
    expect(ancestorReplacement.attributes.config).toEqual({ public: 'new' });
    expect(ancestorReplacement.attributes.entries).toEqual([{ public: 'new' }]);
    expect(h.dbState.assets[0].attributes).toEqual({
      config: { secret: 'KEEP', public: 'new' },
      entries: [{ secret: 'ARRAY-KEEP', public: 'new' }],
    });
    expect(h.dbState.asset_history[1].changes.attributes).toEqual({ config: 'replacement', entries: [] });

    h.readDecisions[ASSET_ID] = { allowed: true, redactedFields: [] };
    const privilegedRead = await getAsset(ASSET_ID) as any;
    expect(privilegedRead.attributes.config).toEqual({ secret: 'KEEP', public: 'new' });
    expect(privilegedRead.attributes.entries).toEqual([{ secret: 'ARRAY-KEEP', public: 'new' }]);
    expect(privilegedRead.network_device.vlan_config).toEqual({ secret: 'KEEP', public: 'new' });
  });

  it('preserves implicit array masks in attributes and extension JSON through masked load and save', async () => {
    seedAsset({ attributes: {
      entries: [
        { secret: 'ATTRIBUTE-KEEP-1', public: 'old-1' },
        { secret: 'ATTRIBUTE-KEEP-2', public: 'old-2' },
      ],
    } });
    seedNetworkDevice({ vlan_config: { entries: [{ secret: 'EXTENSION-KEEP', public: 'old' }] } });
    h.readDecisions[ASSET_ID] = {
      allowed: true,
      redactedFields: [
        'attributes.entries.secret',
        'network_device.vlan_config.entries.secret',
      ],
    };

    const maskedLoad = await getAsset(ASSET_ID) as any;
    expect(maskedLoad.attributes.entries).toEqual([{ public: 'old-1' }, { public: 'old-2' }]);
    expect(maskedLoad.network_device.vlan_config.entries).toEqual([{ public: 'old' }]);

    const result = await updateAsset(ASSET_ID, {
      name: 'Saved with implicit array masks',
      attributes: { ...maskedLoad.attributes, entries: [
        { ...maskedLoad.attributes.entries[0], public: 'new-1' },
        { ...maskedLoad.attributes.entries[1], public: 'new-2' },
      ] },
      network_device: { vlan_config: { entries: [{ public: 'extension-new' }] } },
    } as any) as any;

    expect(result.name).toBe('Saved with implicit array masks');
    expect(JSON.stringify(result)).not.toContain('ATTRIBUTE-KEEP');
    expect(JSON.stringify(result)).not.toContain('EXTENSION-KEEP');
    expect(h.dbState.assets[0].attributes.entries).toEqual([
      { secret: 'ATTRIBUTE-KEEP-1', public: 'new-1' },
      { secret: 'ATTRIBUTE-KEEP-2', public: 'new-2' },
    ]);
    expect(h.dbState.network_device_assets[0].vlan_config).toEqual({ entries: [
      { secret: 'EXTENSION-KEEP', public: 'extension-new' },
    ] });
    expect(JSON.stringify(h.dbState.asset_history[0].changes)).not.toContain('ATTRIBUTE-KEEP');
    expect(JSON.stringify(h.dbState.asset_history[0].changes)).not.toContain('EXTENSION-KEEP');
  });

  it('masks and preserves whole array elements at their original indices in attributes and extensions', async () => {
    seedAsset({ attributes: { entries: [
      { secret: 'ATTRIBUTE-ELEMENT-KEEP', public: 'old-1' },
      { public: 'old-2' },
    ] } });
    seedNetworkDevice({ vlan_config: { entries: [
      { secret: 'EXTENSION-ELEMENT-KEEP', public: 'old' },
      { public: 'visible' },
    ] } });
    h.readDecisions[ASSET_ID] = {
      allowed: true,
      redactedFields: [
        'attributes.entries.0',
        'network_device.vlan_config.entries.0',
      ],
    };

    const maskedLoad = await getAsset(ASSET_ID) as any;
    expect(maskedLoad.attributes.entries).toEqual([null, { public: 'old-2' }]);
    expect(maskedLoad.network_device.vlan_config.entries).toEqual([null, { public: 'visible' }]);
    expect(JSON.stringify(maskedLoad)).not.toContain('ELEMENT-KEEP');

    const result = await updateAsset(ASSET_ID, {
      name: 'Saved with whole-element masks',
      attributes: { entries: [null, { public: 'new-2' }] },
      network_device: { vlan_config: { entries: [null, { public: 'extension-new' }] } },
    } as any) as any;

    expect(result.actionError).toBeUndefined();
    expect(result.attributes.entries).toEqual([null, { public: 'new-2' }]);
    expect(result.network_device.vlan_config.entries).toEqual([null, { public: 'extension-new' }]);
    expect(JSON.stringify(result)).not.toContain('ELEMENT-KEEP');
    expect(h.dbState.assets[0].attributes.entries).toEqual([
      { secret: 'ATTRIBUTE-ELEMENT-KEEP', public: 'old-1' },
      { public: 'new-2' },
    ]);
    expect(h.dbState.network_device_assets[0].vlan_config.entries).toEqual([
      { secret: 'EXTENSION-ELEMENT-KEEP', public: 'old' },
      { public: 'extension-new' },
    ]);
    expect(JSON.stringify(h.dbState.asset_history[0].changes)).not.toContain('ELEMENT-KEEP');

    const history = await getAssetHistory(ASSET_ID) as any;
    expect(JSON.stringify(history)).not.toContain('ELEMENT-KEEP');
    expect(history[0].changes.attributes.entries[0]).toBeNull();
    expect(history[0].changes.network_device.vlan_config.entries[0]).toBeNull();
  });

  it('keeps a concealed required custom attribute while updating a readable sibling', async () => {
    seedAsset({
      asset_type: 'cloud_account',
      attributes: { account_name: 'Concealed required value', seats: 12 },
    });
    h.dbState.asset_type_registry.push({
      tenant: TENANT,
      type_id: 'e0000000-0000-4000-8000-00000000000e',
      slug: 'cloud_account',
      name: 'Cloud Account',
      icon: null,
      fields_schema: JSON.stringify([
        { key: 'account_name', label: 'Account Name', kind: 'text', required: true },
        { key: 'seats', label: 'Seats', kind: 'number' },
      ]),
      is_builtin: false,
      display_order: 0,
    });
    h.readDecisions[ASSET_ID] = { allowed: true, redactedFields: ['attributes.account_name'] };

    const maskedLoad = await getAsset(ASSET_ID) as any;
    expect(maskedLoad.attributes).toEqual({ seats: 12 });
    const result = await updateAsset(ASSET_ID, {
      asset_type: 'cloud_account',
      name: 'Renamed cloud account',
      attributes: { seats: 14 },
    } as any) as any;

    expect(result.name).toBe('Renamed cloud account');
    expect(result.attributes.account_name).toBeUndefined();
    expect(h.dbState.assets[0].attributes).toEqual({
      account_name: 'Concealed required value',
      seats: 14,
    });
    expect(h.dbState.asset_history[0].changes.attributes).toEqual({ seats: 14 });
  });
});

describe('updateAsset: warranty-only edits (alga0002283)', () => {
  it('keeps the trusted sessionless update core usable without caller authorization', async () => {
    seedAsset();
    seedNetworkDevice();
    const trustedSummary = {
      group_id: 'e0000000-0000-4000-8000-00000000000e',
      name: 'Trusted summary',
      kind: 'bundle',
      member_count: 2,
      user_count: 0,
    };
    h.privateGroupSummary = trustedSummary;

    const result = await updateAssetRecord(
      h.knexMock,
      TENANT,
      'system-actor',
      ASSET_ID,
      networkDeviceFormPayload(),
      { suppressRevalidate: true },
    );

    expect(result.asset_id).toBe(ASSET_ID);
    expect(result.group).toEqual(trustedSummary);
    expect(h.authorizedGroupSummary).not.toHaveBeenCalled();
  });

  it('treats a void authorization result as an unrestricted trusted update', async () => {
    const storedAsset = seedAsset({ name: 'Original name' });

    const result = await updateAssetRecord(
      h.knexMock,
      TENANT,
      'system-actor',
      ASSET_ID,
      { name: 'Updated by trusted authorizer' } as any,
      { suppressRevalidate: true },
      { authorize: async () => undefined },
    );

    expect(result.name).toBe('Updated by trusted authorizer');
    expect(storedAsset.name).toBe('Updated by trusted authorizer');
  });

  it('keeps an asset update successful and omits a denied group summary from the response', async () => {
    seedAsset();
    seedNetworkDevice();
    h.privateGroupSummary = { group_id: 'secret-group', name: 'Forbidden group', member_count: 2 };

    const result = (await updateAsset(ASSET_ID, networkDeviceFormPayload())) as any;

    expect(result.asset_id).toBe(ASSET_ID);
    expect(result.group).toBeNull();
    expect(JSON.stringify(result)).not.toContain('secret-group');
    expect(h.authorizedGroupSummary).toHaveBeenCalledWith(h.knexMock, TENANT, h.mockUser, ASSET_ID);
    expect(h.authorizedGroupSummary).toHaveBeenCalledTimes(1);
  });

  it('preserves an authorized group summary in the update response', async () => {
    seedAsset();
    seedNetworkDevice();
    const allowedSummary = { group_id: 'e0000000-0000-4000-8000-00000000000e', name: 'Allowed group', kind: 'bundle', member_count: 2, user_count: 0 };
    h.authorizedGroupSummary.mockResolvedValue(allowedSummary as any);

    const result = (await updateAsset(ASSET_ID, networkDeviceFormPayload())) as any;

    expect(result.asset_id).toBe(ASSET_ID);
    expect(result.group).toEqual(allowedSummary);
  });

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

describe('asset array masks across history and update normalization', () => {
  it.each(['field', 'field_name', 'path'])('conceals indexed and ancestor historical deltas labelled by %s', async (label) => {
    seedAsset();
    h.readDecisions[ASSET_ID] = {
      allowed: true,
      redactedFields: ['attributes.entries.secret', 'network_device.vlan_config.entries.secret'],
    };
    const changes = [
      { [label]: 'assets.attributes.entries.0.secret', before: 'HIDDEN-BEFORE', after: 'HIDDEN-AFTER' },
      { [label]: 'network_device.vlan_config.entries.0.secret', previous_value: 'HIDDEN-OLD', new_value: 'HIDDEN-NEW' },
      { [label]: 'attributes.entries.0', old_value: { secret: 'HIDDEN' }, value: { secret: 'HIDDEN-NEW' } },
      { [label]: 'attributes.entries.0.public', before: 'visible-before', after: 'visible-after' },
    ];
    h.dbState.asset_history.push({
      tenant: TENANT,
      asset_id: ASSET_ID,
      history_id: 'review-history',
      changed_at: new Date(NOW_ISO),
      changes,
    });
    const expectedChanges = [
      { [label]: changes[0][label] },
      { [label]: changes[1][label] },
      { [label]: changes[2][label] },
      changes[3],
    ];
    const history = await getAssetHistory(ASSET_ID) as any;
    expect(history[0].changes).toEqual(expectedChanges);
    const bundle = await getAssetDetailBundle(ASSET_ID) as any;
    expect(bundle.history[0].changes).toEqual(expectedChanges);
    expect(h.dbState.asset_history[0].changes).toEqual(changes);
  });

  it.each(['implicit', 'indexed'])('saves visible siblings without pruning empty array positions under %s masks', async (style) => {
    seedAsset({ attributes: { entries: [null, { secret: 'ATTRIBUTE-KEEP' }, { public: 'old' }] } });
    seedNetworkDevice({ vlan_config: { entries: [null, { secret: 'EXTENSION-KEEP' }, { public: 'old' }] } });
    const suffix = style === 'indexed' ? '1.secret' : 'secret';
    h.readDecisions[ASSET_ID] = {
      allowed: true,
      redactedFields: [`attributes.entries.${suffix}`, `network_device.vlan_config.entries.${suffix}`],
    };
    const loaded = await getAsset(ASSET_ID) as any;
    expect(loaded.attributes.entries).toEqual([null, {}, { public: 'old' }]);
    expect(loaded.network_device.vlan_config.entries).toEqual([null, {}, { public: 'old' }]);
    loaded.attributes.entries[2].public = 'new';
    loaded.network_device.vlan_config.entries[2].public = 'extension-new';
    const result = await updateAsset(ASSET_ID, {
      name: 'Renamed', attributes: loaded.attributes, network_device: loaded.network_device,
    } as any) as any;
    expect(result.name).toBe('Renamed');
    expect(result.attributes.entries).toEqual([null, {}, { public: 'new' }]);
    expect(result.network_device.vlan_config.entries).toEqual([null, {}, { public: 'extension-new' }]);
    expect(h.dbState.assets[0].attributes.entries).toEqual([null, { secret: 'ATTRIBUTE-KEEP' }, { public: 'new' }]);
    expect(h.dbState.network_device_assets[0].vlan_config.entries).toEqual([null, { secret: 'EXTENSION-KEEP' }, { public: 'extension-new' }]);
    const history = await getAssetHistory(ASSET_ID) as any;
    expect(history[0].changes.attributes.entries).toEqual([null, {}, { public: 'new' }]);
    expect(history[0].changes.network_device.vlan_config.entries).toEqual([null, {}, { public: 'extension-new' }]);
  });

  it('retains empty positions through multiple implicit array levels', async () => {
    seedAsset({ attributes: { groups: [{ entries: [{ secret: 'KEEP' }, { public: 'old' }] }] } });
    seedNetworkDevice({ vlan_config: { groups: [{ entries: [{ secret: 'EXTENSION-KEEP' }, { public: 'old' }] }] } });
    h.readDecisions[ASSET_ID] = {
      allowed: true,
      redactedFields: ['attributes.groups.entries.secret', 'network_device.vlan_config.groups.entries.secret'],
    };
    const loaded = await getAsset(ASSET_ID) as any;
    loaded.attributes.groups[0].entries[1].public = 'new';
    loaded.network_device.vlan_config.groups[0].entries[1].public = 'extension-new';
    const result = await updateAsset(ASSET_ID, {
      attributes: loaded.attributes, network_device: loaded.network_device,
    } as any) as any;
    expect(result.attributes.groups[0].entries).toEqual([{}, { public: 'new' }]);
    expect(result.network_device.vlan_config.groups[0].entries).toEqual([{}, { public: 'extension-new' }]);
    expect(h.dbState.assets[0].attributes.groups[0].entries).toEqual([{ secret: 'KEEP' }, { public: 'new' }]);
    expect(h.dbState.network_device_assets[0].vlan_config.groups[0].entries).toEqual([{ secret: 'EXTENSION-KEEP' }, { public: 'extension-new' }]);
  });
});
