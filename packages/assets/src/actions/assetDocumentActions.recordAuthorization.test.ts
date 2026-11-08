import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    assets: [{ tenant: 'tenant-1', asset_id: 'asset-1', client_id: 'client-1' }],
    asset_associations: [],
    documents: [
      { tenant: 'tenant-1', document_id: 'document-1' },
      { tenant: 'tenant-1', document_id: 'document-2' },
    ],
    document_associations: [{ tenant: 'tenant-1', association_id: 'association-1', entity_id: 'asset-1', entity_type: 'asset', document_id: 'document-1' }],
  } as Record<string, any[]>;
  let readable = true;
  const allowedActions = new Set(['update', 'delete']);

  class Query {
    private filters: Array<(row: Record<string, any>) => boolean> = [];
    constructor(private tableName: string) {}
    where(filter: Record<string, unknown>) { this.filters.push((row) => Object.entries(filter).every(([key, value]) => row[key] === value)); return this; }
    whereIn(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
    orderBy(..._columns: string[]) { return this; }
    // Single-threaded fixture queries do not contend for row locks.
    forUpdate() { return this; }
    select(..._columns: string[]) { return this; }
    private rows() {
      return (state[this.tableName] ?? []).filter((row) => this.filters.every((filter) => filter(row)));
    }
    then(resolve: (rows: any[]) => unknown, reject?: (reason: unknown) => unknown) { return Promise.resolve(this.rows()).then(resolve, reject); }
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
    allowedActions,
    deniedDocuments: new Set<string>(),
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
vi.mock('@shared/lib/documentAuthorization', () => ({
  authorizeAndRedactDocuments: vi.fn(async (_trx: unknown, _tenant: string, _user: unknown, documents: Array<{ document_id: string }>) =>
    documents.filter((document) => !h.deniedDocuments.has(document.document_id))),
}));
vi.mock('../lib/assetReadAuthorization', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/assetReadAuthorization')>(),
  createAssetReadContext: vi.fn(async () => ({
    subject: {},
    requestCache: {},
    authorizationKernel: {
      authorizeResource: vi.fn(async ({ resource }: { resource: { action: string } }) => ({
        allowed: resource.action === 'read' ? h.readable : h.allowedActions.has(resource.action),
      })),
    },
  })),
}));
vi.mock('./assetActionErrors', () => ({ assetActionErrorFrom: (error: unknown) => ({ actionError: String(error) }) }));

import { associateDocumentWithAsset, removeDocumentFromAsset } from './assetDocumentActions';

beforeEach(() => {
  h.state.document_associations = [{ tenant: 'tenant-1', association_id: 'association-1', entity_id: 'asset-1', entity_type: 'asset', document_id: 'document-1' }];
  h.readable = true;
  h.allowedActions.clear();
  for (const action of ['update', 'delete']) h.allowedActions.add(action);
  h.deniedDocuments.clear();
  h.permissions.length = 0;
});

describe('asset document association authorization', () => {
  const deniedResult = (operation: string) => ({
    permissionError: operation === 'associate'
      ? 'Permission denied: Cannot associate documents with assets'
      : 'Permission denied: Cannot remove documents from assets',
  });

  it.each([
    ['associate', async () => associateDocumentWithAsset({ entity_id: 'asset-1', entity_type: 'asset', document_id: 'document-2' } as any)],
    ['remove', async () => removeDocumentFromAsset('association-1')],
  ])('%s refuses unreadable assets and leaves associations unchanged', async (_operation, invoke) => {
    h.readable = false;
    const before = structuredClone(h.state.document_associations);
    const result = await invoke();
    expect(result).toEqual(deniedResult(_operation));
    expect(h.state.document_associations).toEqual(before);
  });

  it.each([
    ['associate', 'update', async () => associateDocumentWithAsset({ entity_id: 'asset-1', entity_type: 'asset', document_id: 'document-2' } as any)],
    ['remove', 'delete', async () => removeDocumentFromAsset('association-1')],
  ])('%s refuses a readable asset when %s is denied and leaves associations unchanged', async (_operation, action, invoke) => {
    h.allowedActions.delete(action);
    const before = structuredClone(h.state.document_associations);
    const result = await invoke();
    expect(result).toEqual(deniedResult(_operation));
    expect(h.state.document_associations).toEqual(before);
  });

  it.each([
    ['associate', async () => associateDocumentWithAsset({ entity_id: 'asset-1', entity_type: 'asset', document_id: 'document-2' } as any)],
    ['remove', async () => removeDocumentFromAsset('association-1')],
  ])('%s succeeds when read and the mutation action are allowed', async (_operation, invoke) => {
    const result = await invoke();
    if (_operation === 'associate') {
      expect(result).toMatchObject({ entity_id: 'asset-1', entity_type: 'asset', document_id: 'document-2' });
    } else {
      expect(result).toBeUndefined();
    }
    expect(h.permissions).toContainEqual([h.user, 'asset', _operation === 'associate' ? 'update' : 'delete']);
    expect(h.state.document_associations).toHaveLength(_operation === 'associate' ? 2 : 0);
    if (_operation === 'associate') {
      expect(h.state.document_associations.some((row) => row.document_id === 'document-2')).toBe(true);
    }
    expect(h.state.document_associations.some((row) => row.association_id === 'association-1')).toBe(_operation === 'associate');
  });

  it.each([
    ['associate', 'document-2', async () => associateDocumentWithAsset({ entity_id: 'asset-1', entity_type: 'asset', document_id: 'document-2' } as any)],
    ['remove', 'document-1', async () => removeDocumentFromAsset('association-1')],
  ])('%s refuses an unreadable document and leaves associations unchanged', async (_operation, documentId, invoke) => {
    h.deniedDocuments.add(documentId);
    const before = structuredClone(h.state.document_associations);
    expect(await invoke()).toEqual(deniedResult(_operation));
    expect(h.state.document_associations).toEqual(before);
  });

  it('refuses to remove an association owned by another entity type', async () => {
    h.state.document_associations[0].entity_type = 'ticket';
    const before = structuredClone(h.state.document_associations);
    expect(await removeDocumentFromAsset('association-1')).toEqual(deniedResult('remove'));
    expect(h.state.document_associations).toEqual(before);
  });
});
