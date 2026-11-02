import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  user: { user_id: 'user-1', user_type: 'internal' },
  associations: [] as Array<Record<string, string>>,
  permissions: new Map<string, boolean>(),
  assetAuthorizationError: null as { permissionError: string } | null,
  documentIds: new Set(['doc-1', 'doc-2']),
}));

class Query {
  private filters: Array<(row: Record<string, string>) => boolean> = [];
  constructor(private tableName: string) {}
  where(column: string, value: string) { this.filters.push((row) => row[column] === value); return this; }
  andWhere(column: string, value: string) { return this.where(column, value); }
  whereIn(column: string, values: string[]) { this.filters.push((row) => values.includes(row[column])); return this; }
  select(..._columns: string[]) { return Promise.resolve(this.rows()); }
  clone() { const query = new Query(this.tableName); query.filters = [...this.filters]; return query; }
  private rows() {
    const rows = this.tableName === 'documents'
      ? [...h.documentIds].map((document_id) => ({ document_id, created_by: 'user-1', is_client_visible: false }))
      : h.associations;
    return rows.filter((row) => this.filters.every((filter) => filter(row)));
  }
  async delete() {
    const deleted = new Set(this.rows());
    h.associations = h.associations.filter((row) => !deleted.has(row));
    return deleted.size;
  }
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(h.user, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) => h.permissions.get(`${resource}:${action}`) ?? true),
  checkMultiplePermissions: vi.fn(),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_knex: unknown, fn: (trx: unknown) => unknown) => fn({})),
  tenantDb: () => ({ table: (table: string) => new Query(table) }),
}));
vi.mock('@alga-psa/documents/models/documentAssociation', () => ({
  default: {
    create: vi.fn(async (_trx: unknown, association: Record<string, string>) => {
      const row = { ...association, association_id: `association-${h.associations.length + 1}` };
      h.associations.push(row);
      return row;
    }),
  },
}));
vi.mock('../../src/lib/assetAssociationAuthorization', () => ({
  authorizeAssetAssociationWrite: vi.fn(async () => h.assetAuthorizationError),
}));
vi.mock('@shared/lib/documentAuthorization', () => ({
  authorizeAndRedactDocuments: vi.fn(async (_trx: unknown, _tenant: string, _user: unknown, docs: Array<{ document_id: string }>) =>
    docs.filter((doc) => h.documentIds.has(doc.document_id))),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/workflow-streams', () => ({
  buildDocumentAssociatedPayload: vi.fn(),
  buildDocumentDeletedPayload: vi.fn(),
  buildDocumentDetachedPayload: vi.fn(),
}), { virtual: true });

import { createDocumentAssociations, removeDocumentAssociations } from '../../src/actions/documentActions';
import { authorizeAssetAssociationWrite } from '../../src/lib/assetAssociationAuthorization';
const authorizeAssetAssociationWriteMock = vi.mocked(authorizeAssetAssociationWrite);

describe('generic document asset association actions', () => {
  beforeEach(() => {
    h.associations = [{ association_id: 'association-old', document_id: 'doc-1', entity_id: 'asset-1', entity_type: 'asset', tenant: 'tenant-1' }];
    h.permissions.clear();
    h.assetAuthorizationError = null;
    h.documentIds = new Set(['doc-1', 'doc-2']);
    authorizeAssetAssociationWriteMock.mockClear();
  });

  const attach = (ids = ['doc-2']) => createDocumentAssociations('asset-1', 'asset', ids as any);
  const detach = (ids = ['doc-1']) => removeDocumentAssociations('asset-1', 'asset', ids as any);

  it.each([
    ['attach', () => attach()],
    ['detach', () => detach()],
  ])('%s conceals a read-denied asset and leaves association state unchanged', async (_operation, invoke) => {
    h.assetAuthorizationError = { permissionError: 'Asset not found' };
    const before = structuredClone(h.associations);
    const result = await invoke();
    expect(result).toMatchObject({ permissionError: 'Asset not found' });
    expect(h.associations).toEqual(before);
  });

  it.each([
    ['attach', () => attach()],
    ['detach', () => detach()],
  ])('%s refuses read-allowed/update-denied assets without changing association state', async (_operation, invoke) => {
    h.assetAuthorizationError = { permissionError: 'Permission denied: Cannot update assets' };
    const before = structuredClone(h.associations);
    const result = await invoke();
    expect(result).toMatchObject({ permissionError: 'Permission denied: Cannot update assets' });
    expect(h.associations).toEqual(before);
  });

  it.each([
    ['attach', () => attach()],
    ['detach', () => detach()],
  ])('%s succeeds for an authorized asset', async (_operation, invoke) => {
    const result = await invoke();
    expect(result).toMatchObject({ success: true });
    expect(authorizeAssetAssociationWriteMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', h.user, 'asset-1');
    expect(h.associations.length).toBe(_operation === 'attach' ? 2 : 0);
  });

  it.each([
    ['attach', () => attach(['doc-1', 'doc-2'])],
    ['detach', () => detach(['doc-1'])],
  ])('%s requires coarse asset:update permission before changing associations', async (_operation, invoke) => {
    h.permissions.set('asset:update', false);
    const before = structuredClone(h.associations);
    const result = await invoke();
    expect(result).toMatchObject({ permissionError: 'Permission denied: Cannot update assets' });
    expect(authorizeAssetAssociationWriteMock).not.toHaveBeenCalled();
    expect(h.associations).toEqual(before);
  });

  it('authorizes the asset and all documents before committing a batch attach', async () => {
    h.documentIds = new Set(['doc-1']); // One requested document is not authorized.
    const before = structuredClone(h.associations);
    const result = await attach(['doc-1', 'doc-2']);
    expect(result).toHaveProperty('permissionError');
    expect(h.associations).toEqual(before);
  });
});
