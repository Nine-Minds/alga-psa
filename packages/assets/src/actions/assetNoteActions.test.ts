import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  state: { tables: {} as Record<string, any[]>, tenant: 'tenant-a' },
  permissions: new Set<string>(),
  assetAllowed: new Set<string>(),
  documentAllowed: true,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => action,
  hasPermission: async (_user: any, resource: string, action: string) => h.permissions.has(`${resource}:${action}`),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: { fn: { now: () => 'now' } } }),
  tenantDb: (_conn: any, tenant: string) => ({
    table: (name: string) => new MemoryQuery(name, tenant),
  }),
  withTransaction: async (_knex: any, callback: (trx: any) => Promise<any>) => callback({ fn: { now: () => 'now' } }),
}));

// Keep the pre-fix implementation executable in the baseline check: these
// helpers model its real persistence behavior while intentionally adding no
// authorization of their own.
vi.mock('@alga-psa/block-content/actions/blockContentActions', () => ({
  getBlockContent: async (documentId: string) => h.state.tables.document_block_content?.find(row => row.document_id === documentId) ?? null,
  updateBlockContent: async (documentId: string, input: any) => {
    const content = h.state.tables.document_block_content?.find(row => row.document_id === documentId);
    if (content) content.block_data = typeof input.block_data === 'string' ? input.block_data : JSON.stringify(input.block_data);
    const document = h.state.tables.documents?.find(row => row.document_id === documentId);
    if (document) document.edited_by = input.user_id;
    return content ?? null;
  },
  createBlockDocument: async (input: any) => {
    const documentId = 'generated-id';
    h.state.tables.documents.push({ document_id: documentId, document_name: input.document_name, created_by: input.user_id, tenant: h.state.tenant });
    h.state.tables.document_block_content.push({ content_id: 'generated-content', document_id: documentId, block_data: JSON.stringify(input.block_data), tenant: h.state.tenant });
    if (input.entityId && input.entityType) h.state.tables.document_associations.push({ document_id: documentId, entity_id: input.entityId, entity_type: input.entityType, tenant: h.state.tenant });
    return { document_id: documentId, content_id: 'generated-content' };
  },
}));

vi.mock('../lib/assetReadAuthorization', () => ({
  createAssetReadContext: async () => ({}),
  isAssetActionAllowed: async (_trx: any, _tenant: string, _context: any, asset: any, action: string) => h.assetAllowed.has(`${asset.asset_id}:${action}`),
}));

vi.mock('@shared/lib/documentAuthorization', () => ({
  authorizeAndRedactDocuments: async (_trx: any, _tenant: string, _user: any, documents: any[]) => h.documentAllowed ? documents : [],
}));

vi.mock('uuid', () => ({ v4: () => 'generated-id' }));

class MemoryQuery {
  private filters: Array<[string, unknown]> = [];
  constructor(private readonly tableName: string, private readonly tenant: string) {}
  where(key: string | Record<string, unknown>, value?: unknown) {
    if (typeof key === 'string') this.filters.push([key, value]);
    else Object.entries(key).forEach(([k, v]) => this.filters.push([k, v]));
    return this;
  }
  select(..._columns: string[]) { return this; }
  private rows() {
    return (h.state.tables[this.tableName] ?? []).filter(row => row.tenant === this.tenant && this.filters.every(([key, value]) => row[key] === value));
  }
  async first() { return this.rows()[0] ?? undefined; }
  async insert(row: any) { h.state.tables[this.tableName] ??= []; h.state.tables[this.tableName].push({ ...row }); return [row]; }
  async update(values: any) { const rows = this.rows(); rows.forEach(row => Object.assign(row, values)); return rows.length; }
  async delete() {
    const rows = this.rows();
    h.state.tables[this.tableName] = (h.state.tables[this.tableName] ?? []).filter(row => !rows.includes(row));
    return rows.length;
  }
}

const user = { user_id: 'user-a', tenant: 'tenant-a', user_type: 'internal' } as any;
const invokeAction = (action: any, ...args: any[]) => action(...args);
const grant = (...permissions: string[]) => permissions.forEach(permission => h.permissions.add(permission));
const assetAccess = (action: string) => h.assetAllowed.add(`asset-a:${action}`);

function seedNote() {
  h.state.tables = {
    assets: [{ asset_id: 'asset-a', name: 'Laptop', client_id: 'client-a', notes_document_id: 'doc-a', tenant: 'tenant-a' }],
    documents: [{ document_id: 'doc-a', document_name: 'Laptop Notes', created_by: 'user-a', updated_at: 'before', tenant: 'tenant-a' }],
    document_block_content: [{ content_id: 'content-a', document_id: 'doc-a', block_data: '{"text":"original"}', updated_at: 'before', tenant: 'tenant-a' }],
    document_associations: [{ association_id: 'association-a', document_id: 'doc-a', entity_id: 'asset-a', entity_type: 'asset', tenant: 'tenant-a' }],
  };
  grant('asset:update', 'asset:delete', 'asset:read', 'document:read', 'document:update', 'document:create', 'document:delete');
  assetAccess('read'); assetAccess('update'); assetAccess('delete');
  h.documentAllowed = true;
}

describe('asset note action authorization', () => {
  beforeEach(() => {
    h.permissions.clear(); h.assetAllowed.clear(); h.documentAllowed = true;
    seedNote();
  });

  it('denies overwriting when asset record update access is missing and preserves the note', async () => {
    h.assetAllowed.delete('asset-a:update');
    const before = structuredClone(h.state.tables);
    const { saveAssetNote } = await import('./assetNoteActions');
    const result = await invokeAction(saveAssetNote, user, { tenant: 'tenant-a' }, 'asset-a', { text: 'changed' });
    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(h.state.tables).toEqual(before);
  });

  it('denies overwriting when document update authorization is missing and preserves content and linkage', async () => {
    h.permissions.delete('document:update');
    const before = structuredClone(h.state.tables);
    const { saveAssetNote } = await import('./assetNoteActions');
    const result = await invokeAction(saveAssetNote, user, { tenant: 'tenant-a' }, 'asset-a', { text: 'changed' });
    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(h.state.tables).toEqual(before);
  });

  it('denies deleting when document authorization is missing and preserves records and associations', async () => {
    h.documentAllowed = false;
    const before = structuredClone(h.state.tables);
    const { deleteAssetNote } = await import('./assetNoteActions');
    const result = await invokeAction(deleteAssetNote, user, { tenant: 'tenant-a' }, 'asset-a', true);
    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(h.state.tables).toEqual(before);
  });

  it('denies unlinking when asset record delete access is missing and preserves the note', async () => {
    h.assetAllowed.delete('asset-a:delete');
    const before = structuredClone(h.state.tables);
    const { deleteAssetNote } = await import('./assetNoteActions');
    const result = await invokeAction(deleteAssetNote, user, { tenant: 'tenant-a' }, 'asset-a', false);
    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(h.state.tables).toEqual(before);
  });

  it('denies reading when asset record read access is missing', async () => {
    h.assetAllowed.delete('asset-a:read');
    const { getAssetNoteContent } = await import('./assetNoteActions');
    const result = await invokeAction(getAssetNoteContent, user, { tenant: 'tenant-a' }, 'asset-a');
    expect(result).toMatchObject({ permissionError: expect.any(String) });
  });

  it('denies creating a note when document:create is missing without creating or linking records', async () => {
    h.state.tables.assets[0].notes_document_id = null;
    h.permissions.delete('document:create');
    const before = structuredClone(h.state.tables);
    const { saveAssetNote } = await import('./assetNoteActions');
    const result = await invokeAction(saveAssetNote, user, { tenant: 'tenant-a' }, 'asset-a', { text: 'new note' });
    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(h.state.tables).toEqual(before);
  });

  it('creates, updates, reads, unlinks, and deletes notes for an authorized tenant asset', async () => {
    const { getAssetNoteContent, saveAssetNote, deleteAssetNote } = await import('./assetNoteActions');
    expect(await invokeAction(getAssetNoteContent, user, { tenant: 'tenant-a' }, 'asset-a')).toMatchObject({ blockData: { text: 'original' } });
    expect(await invokeAction(saveAssetNote, user, { tenant: 'tenant-a' }, 'asset-a', { text: 'updated' })).toEqual({ document_id: 'doc-a' });
    expect(h.state.tables.document_block_content[0].block_data).toBe('{"text":"updated"}');
    expect(await invokeAction(deleteAssetNote, user, { tenant: 'tenant-a' }, 'asset-a', false)).toBeUndefined();
    expect(h.state.tables.assets[0].notes_document_id).toBeNull();
    expect(h.state.tables.documents).toHaveLength(1);
    expect(await invokeAction(saveAssetNote, user, { tenant: 'tenant-a' }, 'asset-a', { text: 'created' })).toEqual({ document_id: 'generated-id' });
    expect(h.state.tables.documents).toHaveLength(2);
    expect(h.state.tables.document_associations).toHaveLength(1);
    expect(await invokeAction(deleteAssetNote, user, { tenant: 'tenant-a' }, 'asset-a', true)).toBeUndefined();
    expect(h.state.tables.assets[0].notes_document_id).toBeNull();
    expect(h.state.tables.documents).toHaveLength(1);
  });

  it('does not resolve an asset belonging to another tenant', async () => {
    h.state.tables.assets = [{ asset_id: 'asset-a', name: 'Other tenant asset', notes_document_id: 'doc-a', tenant: 'tenant-b' }];
    const { saveAssetNote } = await import('./assetNoteActions');
    const result = await invokeAction(saveAssetNote, user, { tenant: 'tenant-a' }, 'asset-a', { text: 'changed' });
    expect(result).toMatchObject({ actionError: expect.any(String) });
    expect(h.state.tables.assets[0].notes_document_id).toBe('doc-a');
  });
});
