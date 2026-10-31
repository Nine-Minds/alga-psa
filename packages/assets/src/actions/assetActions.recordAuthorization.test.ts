/**
 * alga-2026-0002940: updateAsset / deleteAsset make their per-record decision with the caller's real action.
 * Bundle rules match on exact resource + action, so a subject allowed to READ an asset but barred from
 * UPDATING it (restricted-asset-operator: read = selected_clients, update = same_team) must be refused and
 * the row left untouched.
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
    // The status registry backs FR-B3 validation on every asset write.
    dbState.asset_statuses = [
      { tenant: TENANT, status_id: 'st-active', slug: 'active', label: 'Active', kind: 'deployable', is_builtin: true, is_active: true, display_order: 0 },
      { tenant: TENANT, status_id: 'st-in-stock', slug: 'in_stock', label: 'In stock', kind: 'deployable', is_builtin: true, is_active: true, display_order: 1 },
      { tenant: TENANT, status_id: 'st-maintenance', slug: 'maintenance', label: 'In maintenance', kind: 'pending', is_builtin: true, is_active: true, display_order: 2 },
      { tenant: TENANT, status_id: 'st-inactive', slug: 'inactive', label: 'Inactive', kind: 'undeployable', is_builtin: true, is_active: true, display_order: 3 },
      { tenant: TENANT, status_id: 'st-retired', slug: 'retired', label: 'Retired', kind: 'archived', is_builtin: true, is_active: true, display_order: 4 },
    ];
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

  // Per-action kernel decisions: every authorizeResource request is recorded, and actions in `denied` are refused.
  const kernel = { requests: [] as Array<{ type: string; action: string; id: string }>, denied: new Set<string>() };

  return { TENANT, dbState, knexMock, mockUser, resetDb, kernel };
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
  createAuthorizationKernel: () => ({
    authorizeResource: async (req: any) => {
      h.kernel.requests.push({ type: req.resource.type, action: req.resource.action, id: req.resource.id });
      return { allowed: !h.kernel.denied.has(`${req.resource.type}:${req.resource.action}`) };
    },
  }),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));

vi.mock('@alga-psa/authorization/pagination', () => ({ buildAuthorizationAwarePage: vi.fn() }));
vi.mock('../lib/assetFactsService', () => ({ listAvailableAssetFactsForAsset: vi.fn(async () => []) }));


import { updateAsset, deleteAsset } from './assetActions';

function seedAsset(): Row {
  const row: Row = {
    tenant: TENANT, asset_id: ASSET_ID, asset_type: 'workstation', client_id: CLIENT_ID, asset_tag: 'WS-001',
    name: 'Desk PC', status: 'active', serial_number: '', location: '', location_id: null,
    created_at: new Date(NOW_ISO), updated_at: new Date(NOW_ISO), purchase_date: null, warranty_end_date: null, attributes: null,
  };
  h.dbState.assets.push(row);
  h.dbState.workstation_assets.push({
    tenant: TENANT, asset_id: ASSET_ID, os_type: 'windows', os_version: '11', cpu_model: 'i7', cpu_cores: 8,
    ram_gb: 16, storage_type: 'ssd', storage_capacity_gb: 512, gpu_model: null, last_login: null, installed_software: [],
  });
  return row;
}

beforeEach(() => {
  h.resetDb();
  h.kernel.requests.length = 0;
  h.kernel.denied.clear();
  vi.clearAllMocks();
});

describe('asset mutations are authorized with their own action (alga-2026-0002940)', () => {
  it('updateAsset refuses a subject whose read is allowed but update is denied, and leaves the row unchanged', async () => {
    seedAsset();
    h.kernel.denied.add('asset:update');

    const result = (await updateAsset(ASSET_ID, { name: 'Hijacked' })) as any;

    expect(result.permissionError).toBe('Permission denied: Cannot update assets');
    expect(h.dbState.assets[0].name).toBe('Desk PC');
    expect(h.kernel.requests.map((r) => r.action)).toContain('update');
  });

  it('updateAsset succeeds for a subject allowed to update, deciding with action update', async () => {
    seedAsset();

    const result = (await updateAsset(ASSET_ID, { name: 'Renamed' })) as any;

    expect(result.actionError).toBeUndefined();
    expect(h.dbState.assets[0].name).toBe('Renamed');
    expect(h.kernel.requests).toEqual([{ type: 'asset', action: 'update', id: ASSET_ID }]);
  });

  it('deleteAsset decides with action delete, not read', async () => {
    seedAsset();
    h.kernel.denied.add('asset:delete');

    const result = (await deleteAsset(ASSET_ID)) as any;

    expect(result.permissionError ?? result.message ?? result.error ?? JSON.stringify(result)).toContain('Permission denied: Cannot delete assets');
    expect(h.dbState.assets).toHaveLength(1);
    expect(h.kernel.requests.map((r) => r.action)).toEqual(['delete']);
  });
});
