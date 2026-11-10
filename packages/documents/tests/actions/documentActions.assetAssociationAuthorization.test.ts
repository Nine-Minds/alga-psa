import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  user: { user_id: 'user-1', user_type: 'internal' },
  rows: {
    assets: [{ tenant: 'tenant-1', asset_id: 'asset-1', client_id: 'client-1' }],
    asset_associations: [] as Array<Record<string, string>>,
    documents: [
      { tenant: 'tenant-1', document_id: 'doc-1', created_by: 'user-1', is_client_visible: false },
      { tenant: 'tenant-1', document_id: 'doc-2', created_by: 'user-1', is_client_visible: false },
    ],
    document_associations: [] as Array<Record<string, string>>,
    document_block_content: [] as Array<Record<string, any>>,
    shared_document_types: [{ tenant: 'tenant-1', type_id: 'type-1', type_name: 'application/octet-stream' }],
  } as Record<string, Array<Record<string, any>>>,
  permissions: new Map<string, boolean>(),
  activeTransaction: null as object | null,
  assetReadable: true,
  assetUpdatable: true,
  assetDeletable: true,
  deniedDocuments: new Set<string>(),
  authorizationRequests: [] as Array<{ action: string; id: string }>,
  generatedId: 0,
  deletedStorageFileIds: [] as string[],
}));

class Query {
  private filters: Array<(row: Record<string, any>) => boolean> = [];
  constructor(private tableName: string, private tenant: string) {}
  where(column: string | Record<string, unknown>, value?: unknown) {
    if (typeof column === 'object') {
      for (const [key, expected] of Object.entries(column)) this.where(key, expected);
    } else {
      this.filters.push((row) => row[column] === value);
    }
    return this;
  }
  andWhere(column: string, value: unknown) { return this.where(column, value); }
  whereIn(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
  orderBy(_column: string, _direction: 'asc' | 'desc') { return this; }
  select(..._columns: string[]) { return this; }
  // Single-threaded fixture queries do not contend for row locks.
  forUpdate() { return this; }
  clone() { const query = new Query(this.tableName, this.tenant); query.filters = [...this.filters]; return query; }
  private rows() {
    return (h.rows[this.tableName] ?? []).filter((row) => row.tenant === this.tenant && this.filters.every((filter) => filter(row)));
  }
  async first() { return this.rows()[0] ?? undefined; }
  insert(value: Record<string, any> | Array<Record<string, any>>) {
    const rows = Array.isArray(value) ? value : [value];
    h.rows[this.tableName].push(...rows);
    const result: any = {
      returning: async () => rows.map((row) => ({ content_id: row.content_id })),
      then: (resolve: (value: Array<Record<string, any>>) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
    };
    return result;
  }
  async delete() {
    const removed = new Set(this.rows());
    h.rows[this.tableName] = h.rows[this.tableName].filter((row) => !removed.has(row));
    return removed.size;
  }
  then(resolve: (value: Array<Record<string, any>>) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve(this.rows()).then(resolve, reject);
  }
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(h.user, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async (_user: unknown, resource: string, action: string, connection?: unknown) => {
    // Model a pool with one connection: authorization must reuse the open transaction.
    if (h.activeTransaction && connection !== h.activeTransaction) {
      throw new Error('Permission check tried to acquire a second pooled connection');
    }
    return h.permissions.get(`${resource}:${action}`) ?? true;
  }),
  checkMultiplePermissions: vi.fn(async (_user: unknown, checks: Array<{ resource: string; action: string }>) => checks.map((check) => ({ ...check, granted: true }))),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
  withTransaction: vi.fn(async (_knex: unknown, fn: (trx: unknown) => unknown) => {
    const trx = { fn: { now: () => new Date() } };
    h.activeTransaction = trx;
    try {
      return await fn(trx);
    } finally {
      h.activeTransaction = null;
    }
  }),
  tenantDb: (_conn: unknown, tenant: string) => ({ table: (table: string) => new Query(table, tenant) }),
}));
vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: {
    validateFileUpload: vi.fn(async () => undefined),
    uploadFile: vi.fn(async () => ({ file_id: 'uploaded-file-1', storage_path: '/documents/uploaded-file-1' })),
    deleteFile: vi.fn(async (fileId: string) => { h.deletedStorageFileIds.push(fileId); }),
  },
}));
vi.mock('@alga-psa/documents/lib/documentPreviewGenerator', () => ({ generateDocumentPreviews: vi.fn(async () => ({})) }));
vi.mock('../../src/lib/documentPermissions', () => ({
  applyDocumentProductReadScope: vi.fn(),
  canReadDocument: vi.fn(async () => true),
  canReadTicketDocuments: vi.fn(async () => true),
  canUploadDocument: vi.fn(async () => true),
}));
vi.mock('../../src/models/document', () => ({
  default: {
    insert: vi.fn(async (_trx: unknown, document: Record<string, any>) => {
      h.rows.documents.push(document);
      return document;
    }),
  },
}));
vi.mock('@alga-psa/documents/models/documentAssociation', () => ({
  default: {
    create: vi.fn(async (_trx: unknown, association: Record<string, any>) => {
      const row = { ...association, association_id: `association-${h.rows.document_associations.length + 1}` };
      h.rows.document_associations.push(row);
      return row;
    }),
  },
}));
vi.mock('uuid', () => ({ v4: vi.fn(() => `generated-${++h.generatedId}`) }));
vi.mock('@alga-psa/authorization/assetReadAuthorization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/authorization/assetReadAuthorization')>();
  return {
    ...actual,
    createAssetReadContext: vi.fn(async () => ({
      subject: { tenant: 'tenant-1', userId: 'user-1', userType: 'internal', roleIds: [], teamIds: [], managedUserIds: [], clientId: null, portfolioClientIds: [] },
      authorizationKernel: {
        authorizeResource: vi.fn(async (request: { resource: { action: string; id: string } }) => {
          h.authorizationRequests.push({ action: request.resource.action, id: request.resource.id });
          const allowed = { read: h.assetReadable, update: h.assetUpdatable, delete: h.assetDeletable };
          return { allowed: allowed[request.resource.action as keyof typeof allowed] ?? false };
        }),
      },
      requestCache: {},
    })),
  };
});
vi.mock('@shared/lib/documentAuthorization', () => ({
  authorizeAndRedactDocuments: vi.fn(async (_trx: unknown, _tenant: string, _user: unknown, docs: Array<{ document_id: string }>) =>
    docs.filter((doc) => !h.deniedDocuments.has(doc.document_id) && h.rows.documents.some((row) => row.document_id === doc.document_id && row.tenant === 'tenant-1'))),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/workflow-streams', () => ({
  buildDocumentAssociatedPayload: vi.fn(),
  buildDocumentDeletedPayload: vi.fn(),
  buildDocumentDetachedPayload: vi.fn(),
}), { virtual: true });

import * as documentActions from '../../src/actions/documentActions';
import { createBlockDocument } from '../../src/actions/documentBlockContentActions';
import { StorageService } from '@alga-psa/storage/StorageService';
const getDocumentTypeIdSpy = vi.spyOn(documentActions, 'getDocumentTypeId');

describe('generic document asset association actions', () => {
  beforeEach(() => {
    h.rows.assets = [{ tenant: 'tenant-1', asset_id: 'asset-1', client_id: 'client-1' }];
    h.rows.asset_associations = [];
    h.rows.documents = [
      { tenant: 'tenant-1', document_id: 'doc-1', created_by: 'user-1', is_client_visible: false },
      { tenant: 'tenant-1', document_id: 'doc-2', created_by: 'user-1', is_client_visible: false },
    ];
    h.rows.document_associations = [{ association_id: 'association-old', document_id: 'doc-1', entity_id: 'asset-1', entity_type: 'asset', tenant: 'tenant-1' }];
    h.rows.document_block_content = [];
    h.rows.shared_document_types = [{ tenant: 'tenant-1', type_id: 'type-1', type_name: 'application/octet-stream' }];
    h.permissions.clear();
    h.assetReadable = true;
    h.assetUpdatable = true;
    h.assetDeletable = true;
    h.deniedDocuments.clear();
    h.authorizationRequests = [];
    h.generatedId = 0;
    h.deletedStorageFileIds = [];
    vi.mocked(StorageService.uploadFile).mockResolvedValue({ file_id: 'uploaded-file-1', storage_path: '/documents/uploaded-file-1' } as any);
    vi.mocked(StorageService.deleteFile).mockClear();
    getDocumentTypeIdSpy.mockResolvedValue({ typeId: 'type-1', isShared: false });
  });

  const attach = (ids = ['doc-2'], assetId = 'asset-1') => documentActions.createDocumentAssociations(assetId, 'asset', ids as any);
  const detach = (ids = ['doc-1'], assetId = 'asset-1') => documentActions.removeDocumentAssociations(assetId, 'asset', ids as any);

  it.each([
    ['attach', () => attach()],
    ['detach', () => detach()],
  ])('%s conceals a read-denied asset and leaves association state unchanged', async (_operation, invoke) => {
    h.assetReadable = false;
    const before = structuredClone(h.rows.document_associations);
    const result = await invoke();
    expect(result).toMatchObject({ permissionError: 'Asset not found' });
    expect(h.rows.document_associations).toEqual(before);
    expect(h.authorizationRequests.map(({ action }) => action)).toEqual(['read']);
  });

  it.each([
    ['attach', () => attach()],
    ['detach', () => detach()],
  ])('%s refuses a readable but update-denied asset without changing association state', async (_operation, invoke) => {
    h.assetUpdatable = false;
    const before = structuredClone(h.rows.document_associations);
    const result = await invoke();
    expect(result).toMatchObject({ permissionError: 'Permission denied: Cannot update assets' });
    expect(h.rows.document_associations).toEqual(before);
    expect(h.authorizationRequests.map(({ action }) => action)).toEqual(['read', 'read', 'update']);
  });

  it.each([
    ['attach', () => attach()],
    ['detach', () => detach()],
  ])('%s succeeds with one pooled connection when the asset decisions allow it', async (_operation, invoke) => {
    const result = await invoke();
    expect(result).toMatchObject({ success: true });
    expect(h.authorizationRequests).toContainEqual({ action: 'update', id: 'asset-1' });
    expect(h.rows.document_associations.length).toBe(_operation === 'attach' ? 2 : 0);
  });

  it.each([
    ['attach', () => attach(['doc-1', 'doc-2'])],
    ['detach', () => detach(['doc-1'])],
  ])('%s requires coarse asset:update permission before changing associations', async (_operation, invoke) => {
    h.permissions.set('asset:update', false);
    const before = structuredClone(h.rows.document_associations);
    const result = await invoke();
    expect(result).toMatchObject({ permissionError: 'Permission denied: Cannot update assets' });
    expect(h.authorizationRequests).toEqual([]);
    expect(h.rows.document_associations).toEqual(before);
  });

  it('does not authorize or mutate an asset row that belongs to another tenant', async () => {
    h.rows.assets = [{ tenant: 'tenant-2', asset_id: 'foreign-asset', client_id: 'client-2' }];
    const before = structuredClone(h.rows.document_associations);
    const result = await attach(['doc-2'], 'foreign-asset');
    expect(result).toMatchObject({ permissionError: 'Asset not found' });
    expect(h.authorizationRequests).toEqual([]);
    expect(h.rows.document_associations).toEqual(before);
  });

  it('authorizes the asset and every document before committing a batch attach', async () => {
    h.rows.documents = h.rows.documents.filter((row) => row.document_id === 'doc-1');
    const before = structuredClone(h.rows.document_associations);
    const result = await attach(['doc-1', 'doc-2']);
    expect(result).toHaveProperty('permissionError');
    expect(h.rows.document_associations).toEqual(before);
    expect(h.authorizationRequests.some(({ action }) => action === 'update')).toBe(true);
  });

  it('detach requires delete scope even when asset read and update are allowed', async () => {
    h.assetDeletable = false;
    const before = structuredClone(h.rows.document_associations);
    expect(await detach()).toHaveProperty('permissionError');
    expect(h.authorizationRequests).toContainEqual({ action: 'delete', id: 'asset-1' });
    expect(h.rows.document_associations).toEqual(before);
  });

  it('detach requires coarse asset:delete permission even when asset:update is allowed', async () => {
    h.permissions.set('asset:delete', false);
    const before = structuredClone(h.rows.document_associations);
    expect(await detach()).toHaveProperty('permissionError');
    expect(h.rows.document_associations).toEqual(before);
  });

  it.each([
    ['attach', () => attach(['doc-1', 'doc-2'])],
    ['detach', () => detach(['doc-1', 'doc-2'])],
  ])('%s authorizes every document before changing any association', async (_operation, invoke) => {
    h.rows.document_associations.push({ association_id: 'association-second', document_id: 'doc-2', entity_id: 'asset-1', entity_type: 'asset', tenant: 'tenant-1' });
    h.deniedDocuments.add('doc-2');
    const before = structuredClone(h.rows.document_associations);
    expect(await invoke()).toHaveProperty('permissionError');
    expect(h.rows.document_associations).toEqual(before);
  });

  it('asset upload leaves no document or association and deletes the uploaded file when update is denied', async () => {
    h.assetUpdatable = false;
    const beforeDocuments = structuredClone(h.rows.documents);
    const beforeAssociations = structuredClone(h.rows.document_associations);
    const form = new FormData();
    form.set('file', new File(['asset document'], 'asset.txt', { type: 'text/plain' }));

    const result = await documentActions.uploadDocument(form, {
      userId: 'user-1',
      assetId: 'asset-1',
      folder_path: '/Assets/asset-1',
    });

    expect(result).toMatchObject({ permissionError: 'Permission denied: Cannot update assets' });
    expect(h.rows.documents).toEqual(beforeDocuments);
    expect(h.rows.document_block_content).toEqual([]);
    expect(h.rows.document_associations).toEqual(beforeAssociations);
    expect(h.deletedStorageFileIds).toEqual(['uploaded-file-1']);
  });

  it('asset upload creates a document and association when update is allowed', async () => {
    const result = await documentActions.uploadDocument(FormDataWithFile(), {
      userId: 'user-1',
      assetId: 'asset-1',
      folder_path: '/Assets/asset-1',
    });

    expect(result).toMatchObject({ success: true });
    expect(h.rows.documents).toHaveLength(3);
    expect(h.rows.document_associations).toHaveLength(2);
    expect(h.rows.document_associations.at(-1)).toMatchObject({ entity_id: 'asset-1', entity_type: 'asset' });
    expect(h.deletedStorageFileIds).toEqual([]);
  });

  it('block-document creation leaves no document, content, or association when update is denied', async () => {
    h.assetUpdatable = false;
    const beforeDocuments = structuredClone(h.rows.documents);
    const result = await createBlockDocument({
      document_name: 'Asset notes',
      user_id: 'user-1',
      block_data: { type: 'doc', content: [] },
      entityId: 'asset-1',
      entityType: 'asset',
    });

    expect(result).toMatchObject({ permissionError: 'Permission denied: Cannot update assets' });
    expect(h.rows.documents).toEqual(beforeDocuments);
    expect(h.rows.document_block_content).toEqual([]);
    expect(h.rows.document_associations).toHaveLength(1);
  });

  it('block-document creation writes document, content, and association when update is allowed', async () => {
    const result = await createBlockDocument({
      document_name: 'Asset notes',
      user_id: 'user-1',
      block_data: { type: 'doc', content: [] },
      entityId: 'asset-1',
      entityType: 'asset',
    });

    expect(result).toMatchObject({ document_id: expect.any(String), content_id: expect.any(String) });
    expect(h.rows.documents).toHaveLength(3);
    expect(h.rows.document_block_content).toHaveLength(1);
    expect(h.rows.document_associations).toHaveLength(2);
    expect(h.rows.document_associations.at(-1)).toMatchObject({ entity_id: 'asset-1', entity_type: 'asset' });
  });
});

function FormDataWithFile(): FormData {
  const form = new FormData();
  form.set('file', new File(['asset document'], 'asset.txt', { type: 'text/plain' }));
  return form;
}
