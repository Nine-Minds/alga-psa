import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    assets: [{ tenant: 'tenant-1', asset_id: 'asset-1', client_id: 'client-1' }],
    document_associations: [{ tenant: 'tenant-1', association_id: 'association-1', entity_id: 'asset-1', entity_type: 'asset', document_id: 'document-1' }],
  } as Record<string, any[]>;
  let readable = true;
  const deniedActions = new Set<string>();

  class Query {
    private filters: Record<string, unknown>[] = [];
    constructor(private tableName: string) {}
    where(filter: Record<string, unknown>) { this.filters.push(filter); return this; }
    select(..._columns: string[]) { return this; }
    private rows() {
      return (state[this.tableName] ?? []).filter((row) => this.filters.every((filter) => Object.entries(filter).every(([key, value]) => row[key] === value)));
    }
    first() { return Promise.resolve(this.rows()[0]); }
    insert(row: Record<string, unknown>) {
      const inserted = { ...row, association_id: 'association-new' };
      state[this.tableName].push(inserted);
      const result: any = Promise.resolve([inserted]);
      result.returning = () => Promise.resolve([inserted]);
      return result;
    }
    delete() {
      const matched = this.rows();
      state[this.tableName] = state[this.tableName].filter((row) => !matched.includes(row));
      return Promise.resolve(matched.length);
    }
  }
  const knex: any = (tableName: string) => new Query(tableName);
  return {
    state,
    knex,
    user: { user_id: 'user-1', user_type: 'internal' },
    permissions: [] as Array<[unknown, string, string]>,
    get readable() { return readable; },
    set readable(value: boolean) { readable = value; },
    deniedActions,
  };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(h.user, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async (...args: [unknown, string, string]) => { h.permissions.push(args); return true; }),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: h.knex })),
  withTransaction: vi.fn(async (_knex: unknown, fn: (trx: unknown) => unknown) => fn(h.knex)),
  tenantDb: (conn: any, tenant: string) => ({ table: (table: string) => conn(table).where({ tenant }) }),
}));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({ permissionError: (message: string) => ({ permissionError: message }) }));
vi.mock('@shared/lib/documentAuthorization', () => ({ authorizeAndRedactDocuments: vi.fn() }));
vi.mock('../lib/assetReadAuthorization', () => ({
  createAssetReadContext: vi.fn(async () => ({})),
  isAssetReadAllowed: vi.fn(async () => h.readable),
  isAssetActionAllowed: vi.fn(async (_trx: unknown, _tenant: string, _context: unknown, _asset: unknown, action: string) => !h.deniedActions.has(action)),
}));
vi.mock('./assetActionErrors', () => ({ assetActionErrorFrom: (error: unknown) => ({ actionError: String(error) }) }));

import { associateDocumentWithAsset, removeDocumentFromAsset } from './assetDocumentActions';

beforeEach(() => {
  h.state.document_associations = [{ tenant: 'tenant-1', association_id: 'association-1', entity_id: 'asset-1', entity_type: 'asset', document_id: 'document-1' }];
  h.readable = true;
  h.deniedActions.clear();
  h.permissions.length = 0;
});

describe('asset document association authorization', () => {
  it.each([
    ['associate', async () => associateDocumentWithAsset({ entity_id: 'asset-1', entity_type: 'asset', document_id: 'document-2' } as any)],
    ['remove', async () => removeDocumentFromAsset('association-1')],
  ])('%s refuses unreadable assets and leaves associations unchanged', async (_operation, invoke) => {
    h.readable = false;
    const before = [...h.state.document_associations];
    const result = await invoke();
    expect(JSON.stringify(result)).toContain('Asset not found');
    expect(h.state.document_associations).toEqual(before);
  });

  it.each([
    ['associate', 'update', async () => associateDocumentWithAsset({ entity_id: 'asset-1', entity_type: 'asset', document_id: 'document-2' } as any)],
    ['remove', 'delete', async () => removeDocumentFromAsset('association-1')],
  ] as const)('%s refuses a readable asset when %s is denied and leaves associations unchanged', async (_operation, action, invoke) => {
    h.deniedActions.add(action);
    const before = [...h.state.document_associations];
    const result = await invoke();
    expect(result).toEqual({ actionError: `Error: Permission denied: Cannot ${action} assets` });
    expect(h.state.document_associations).toEqual(before);
  });

  it.each([
    ['associate', 'update', 'delete', async () => associateDocumentWithAsset({ entity_id: 'asset-1', entity_type: 'asset', document_id: 'document-2' } as any)],
    ['remove', 'delete', 'update', async () => removeDocumentFromAsset('association-1')],
  ] as const)('%s succeeds when read and %s are allowed even if %s is narrowed', async (_operation, _action, otherAction, invoke) => {
    // Record-level bundle rules narrow the operation's action independently of
    // the coarse asset:update permission required to edit document associations.
    h.deniedActions.add(otherAction);
    const result = await invoke();
    if (result !== undefined) expect(JSON.stringify(result)).not.toContain('Permission denied');
    expect(h.permissions).toContainEqual([h.user, 'asset', 'update']);
    expect(h.state.document_associations).toHaveLength(_operation === 'associate' ? 2 : 0);
    if (_operation === 'associate') {
      expect(h.state.document_associations.some((row) => row.document_id === 'document-2')).toBe(true);
    }
    expect(h.state.document_associations.some((row) => row.association_id === 'association-1')).toBe(_operation === 'associate');
  });
});
