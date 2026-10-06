/**
 * alga0002283: nothing that runs after the write can make a committed asset
 * save report failure.
 *
 * - The output-schema check runs INSIDE the transaction (update and create): a
 *   failure rolls the write back and is reported honestly.
 * - Event publishing and the warranty date-event emit run after the commit and
 *   are best-effort: a rejection is logged with tenant / asset / event type and
 *   never re-thrown.
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


import { createAsset, updateAsset } from './assetActions';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { emitDateDomainEventOnce } from '@alga-psa/event-bus/workflow/dateDomainEvents';
import { buildAssetUpdatedPayload, computeAssetWarrantyExpiring } from '@alga-psa/workflow-streams';

function seedWorkstationAsset(overrides: Row = {}): Row {
  const row: Row = {
    tenant: TENANT,
    asset_id: ASSET_ID,
    asset_type: 'workstation',
    client_id: CLIENT_ID,
    asset_tag: 'WS-001',
    name: 'Desk PC',
    status: 'active',
    serial_number: '',
    location: '',
    location_id: null,
    created_at: new Date(NOW_ISO),
    updated_at: new Date(NOW_ISO),
    purchase_date: null,
    warranty_end_date: null,
    attributes: null,
    ...overrides,
  };
  h.dbState.assets.push(row);
  h.dbState.workstation_assets.push({
    tenant: TENANT,
    asset_id: row.asset_id,
    os_type: 'windows',
    os_version: '11',
    cpu_model: 'i7',
    cpu_cores: 8,
    ram_gb: 16,
    storage_type: 'ssd',
    storage_capacity_gb: 512,
    gpu_model: null,
    last_login: null,
    installed_software: [],
  });
  return row;
}

const WARRANTY_SOON = {
  expiresAt: '2026-12-31T00:00:00.000Z',
  daysUntilExpiry: 10,
  windowDays: 30,
};

function armWarrantyAndUpdateEvents() {
  vi.mocked(buildAssetUpdatedPayload).mockReturnValue({ updatedFields: ['warranty_end_date'] } as any);
  vi.mocked(computeAssetWarrantyExpiring).mockReturnValue(WARRANTY_SOON as any);
}

beforeEach(() => {
  h.resetDb();
  vi.clearAllMocks();
  vi.mocked(buildAssetUpdatedPayload).mockReturnValue({} as any);
  vi.mocked(computeAssetWarrantyExpiring).mockReturnValue(null as any);
});

describe('post-commit effects are best-effort (alga0002283)', () => {
  it('updateAsset still resolves with the updated asset when publish and date-event emit reject', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    seedWorkstationAsset();
    armWarrantyAndUpdateEvents();
    vi.mocked(publishWorkflowEvent).mockRejectedValue(new Error('redis down'));
    vi.mocked(emitDateDomainEventOnce).mockRejectedValue(new Error('emit failed'));

    const result = (await updateAsset(ASSET_ID, { warranty_end_date: '2026-12-31T00:00:00.000Z' })) as any;

    expect(result.actionError).toBeUndefined();
    expect(result.warranty_end_date).toBe('2026-12-31T00:00:00.000Z');
    expect(h.dbState.assets[0].warranty_end_date).toBe('2026-12-31T00:00:00.000Z');
    expect(publishWorkflowEvent).toHaveBeenCalled();
    expect(emitDateDomainEventOnce).toHaveBeenCalled();

    // Each failure is logged with tenant, asset id and event type.
    const logged = consoleError.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
    expect(logged).toContain(TENANT);
    expect(logged).toContain(ASSET_ID);
    expect(logged).toContain('ASSET_UPDATED');
    expect(logged).toContain('ASSET_WARRANTY_EXPIRING');
    consoleError.mockRestore();
  });

  it('createAsset still resolves with the created asset when publish and date-event emit reject', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(computeAssetWarrantyExpiring).mockReturnValue(WARRANTY_SOON as any);
    vi.mocked(publishWorkflowEvent).mockRejectedValue(new Error('redis down'));
    vi.mocked(emitDateDomainEventOnce).mockRejectedValue(new Error('emit failed'));

    const created = (await createAsset({
      asset_type: 'workstation',
      client_id: CLIENT_ID,
      asset_tag: 'WS-NEW',
      name: 'New PC',
      status: 'active',
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
    } as any)) as any;

    expect(created.actionError).toBeUndefined();
    expect(created.asset_tag).toBe('WS-NEW');
    expect(h.dbState.assets).toHaveLength(1);
    const logged = consoleError.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
    expect(logged).toContain(TENANT);
    expect(logged).toContain('ASSET_CREATED');
    expect(logged).toContain('ASSET_WARRANTY_EXPIRING');
    consoleError.mockRestore();
  });
});

describe('output-schema check runs inside the transaction (alga0002283)', () => {
  it('updateAsset rolls the write back and returns an error when the output fails validation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A legacy row the output schema rejects (status must be a string).
    seedWorkstationAsset({ status: null });

    const result = (await updateAsset(ASSET_ID, { name: 'Renamed' })) as any;

    expect(typeof result.actionError).toBe('string');
    expect(h.dbState.assets[0].name).toBe('Desk PC');
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('createAsset rolls the insert back when the output fails validation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A stray extension row the new asset id will collide with; its gpu_model
    // is not a string, so the formatted output is invalid.
    h.dbState.workstation_assets.push({
      tenant: TENANT,
      asset_id: 'c0000000-0000-4000-8000-000000000001',
      os_type: 'windows',
      os_version: '11',
      cpu_model: 'i7',
      cpu_cores: 1,
      ram_gb: 1,
      storage_type: 'ssd',
      storage_capacity_gb: 1,
      gpu_model: 123,
      installed_software: [],
    });

    const result = (await createAsset({
      asset_type: 'workstation',
      client_id: CLIENT_ID,
      asset_tag: 'WS-NEW',
      name: 'New PC',
      status: 'active',
      workstation: {
        os_type: 'windows',
        os_version: '11',
        cpu_model: 'i7',
        cpu_cores: 2,
        ram_gb: 4,
        storage_type: 'ssd',
        storage_capacity_gb: 100,
        installed_software: [],
      },
    } as any).catch((error: Error) => error)) as any;

    expect(result).toBeInstanceOf(Error);
    expect(h.dbState.assets).toHaveLength(0);
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
