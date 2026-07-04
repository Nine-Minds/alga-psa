import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const permissionState = { read: true, update: true, systemUpdate: true };
  const mockUser = { user_id: 'user-1', tenant: 'tenant_a' };
  const dbState: { asset_type_registry: Row[]; assets: Row[] } = {
    asset_type_registry: [],
    assets: [],
  };

  let idCounter = 0;

  const matches = (row: Row, where: Record<string, any>) =>
    Object.entries(where).every(([k, v]) => {
      const key = k.includes('.') ? k.split('.').pop()! : k;
      return row[key] === v;
    });

  class QB {
    private whereClauses: Array<Record<string, any>> = [];
    private countSpec: string | null = null;

    constructor(private readonly table: 'asset_type_registry' | 'assets') {}

    private get rows(): Row[] {
      return dbState[this.table];
    }

    where(where: Record<string, any> | string, value?: any) {
      if (typeof where === 'string') {
        this.whereClauses.push({ [where]: value });
      } else {
        this.whereClauses.push(where);
      }
      return this;
    }

    orderBy() {
      return this;
    }

    count(spec: string) {
      this.countSpec = spec;
      return this;
    }

    private filtered(): Row[] {
      let rows = [...this.rows];
      for (const where of this.whereClauses) {
        rows = rows.filter((row) => matches(row, where));
      }
      return rows;
    }

    first() {
      if (this.countSpec) {
        return Promise.resolve({ count: String(this.filtered().length) });
      }
      return Promise.resolve(this.filtered()[0]);
    }

    insert(data: Row | Row[]) {
      const incoming = (Array.isArray(data) ? data : [data]).map((row) => ({
        type_id: `type_${++idCounter}`,
        icon: null,
        is_builtin: false,
        display_order: 0,
        fields_schema: '[]',
        created_at: new Date('2026-06-12T12:00:00.000Z'),
        updated_at: new Date('2026-06-12T12:00:00.000Z'),
        ...row,
      }));
      for (const row of incoming) {
        this.rows.push(row);
      }
      return Promise.resolve();
    }

    update(patch: Row) {
      const rows = this.filtered();
      for (const row of rows) {
        Object.assign(row, patch);
      }
      return Promise.resolve(rows.length);
    }

    delete() {
      const remaining = this.rows.filter((row) => !this.whereClauses.every((where) => matches(row, where)));
      const removed = this.rows.length - remaining.length;
      dbState[this.table] = remaining;
      return Promise.resolve(removed);
    }

    then(resolve: (value: any) => void, reject?: (reason: unknown) => void) {
      return Promise.resolve(this.filtered()).then(resolve, reject);
    }
  }

  const knexMock: any = (table: 'asset_type_registry' | 'assets') => new QB(table);
  knexMock.fn = { now: () => new Date('2026-06-12T12:00:00.000Z') };

  return { permissionState, mockUser, dbState, knexMock };
});

const hasPermissionMock = vi.hoisted(() =>
  vi.fn(async (_user: unknown, resource: string, action: string) => {
    if (resource === 'asset' && action === 'read') return h.permissionState.read;
    if (resource === 'asset' && action === 'update') return h.permissionState.update;
    if (resource === 'system_settings' && action === 'update') return h.permissionState.systemUpdate;
    return false;
  })
);

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(h.mockUser, { tenant: 'tenant_a' }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: h.knexMock, tenant: 'tenant_a' })),
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: 'asset_type_registry' | 'assets') => conn(table).where(`${table}.tenant`, tenant),
  }),
  withTransaction: vi.fn(async (_knex: unknown, callback: (trx: unknown) => Promise<unknown>) => callback(h.knexMock)),
}));

import {
  createAssetTypeAction,
  deleteAssetTypeAction,
  getAssetType,
  getAssetTypes,
  updateAssetTypeAction,
} from './assetTypeRegistryActions';

beforeEach(() => {
  h.permissionState.read = true;
  h.permissionState.update = true;
  h.permissionState.systemUpdate = true;
  h.dbState.asset_type_registry.length = 0;
  h.dbState.assets.length = 0;
  hasPermissionMock.mockClear();
});

describe('asset type registry action RBAC (T307)', () => {
  it('getAssetTypes requires asset.read', async () => {
    h.permissionState.read = false;
    await expect(getAssetTypes()).rejects.toThrow('Permission denied: Cannot read asset types');
    expect(hasPermissionMock).toHaveBeenCalledWith(h.mockUser, 'asset', 'read');
  });

  it('getAssetType requires asset.read', async () => {
    h.permissionState.read = false;
    await expect(getAssetType('workstation')).rejects.toThrow('Permission denied: Cannot read asset types');
  });

  it('reads succeed with asset.read even without asset.update', async () => {
    h.permissionState.update = false;
    h.dbState.asset_type_registry.push({
      tenant: 'tenant_a',
      type_id: 'builtin_1',
      slug: 'workstation',
      name: 'Workstation',
      icon: null,
      fields_schema: '[]',
      is_builtin: true,
      display_order: 0,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const listed = await getAssetTypes();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ slug: 'workstation', is_builtin: true });

    const single = await getAssetType('workstation');
    expect(single?.slug).toBe('workstation');
  });

  it('createAssetTypeAction requires system settings update (asset permissions alone are not enough)', async () => {
    h.permissionState.systemUpdate = false;
    await expect(createAssetTypeAction({ name: 'Door Access' })).rejects.toThrow(
      'Permission denied: Cannot manage asset types'
    );
    expect(hasPermissionMock).toHaveBeenCalledWith(h.mockUser, 'system_settings', 'update');
    expect(h.dbState.asset_type_registry).toHaveLength(0);
  });

  it('updateAssetTypeAction requires system settings update', async () => {
    h.permissionState.systemUpdate = false;
    await expect(updateAssetTypeAction('door_access', { name: 'Doors' })).rejects.toThrow(
      'Permission denied: Cannot manage asset types'
    );
  });

  it('deleteAssetTypeAction requires system settings update', async () => {
    h.permissionState.systemUpdate = false;
    await expect(deleteAssetTypeAction('door_access')).rejects.toThrow(
      'Permission denied: Cannot manage asset types'
    );
  });

  it('authorized create returns a typed success envelope', async () => {
    const result = await createAssetTypeAction({
      name: 'Door Access',
      fields_schema: [{ key: 'badge_system', label: 'Badge System', kind: 'text' }],
    });

    expect(result).toMatchObject({
      success: true,
      data: { slug: 'door_access', name: 'Door Access', is_builtin: false },
    });
  });

  it('domain failures surface as typed error envelopes, not throws', async () => {
    await createAssetTypeAction({ name: 'Door Access' });

    const conflict = await createAssetTypeAction({ name: 'Door Access' });
    expect(conflict).toEqual({ success: false, error: { code: 'slug_conflict', slug: 'door_access' } });

    const reserved = await createAssetTypeAction({ name: 'Server' });
    expect(reserved).toEqual({ success: false, error: { code: 'reserved_slug', slug: 'server' } });

    const missing = await deleteAssetTypeAction('nope');
    expect(missing).toEqual({ success: false, error: { code: 'not_found', slug: 'nope' } });

    const update = await updateAssetTypeAction('door_access', { name: 'Door Access 2' });
    expect(update).toMatchObject({ success: true, data: { name: 'Door Access 2', slug: 'door_access' } });
  });
});
