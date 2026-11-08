import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const h = vi.hoisted(() => ({
  allowed: true,
  hasNarrowing: true,
  tables: {} as Record<string, Row[]>,
  authorizationCalls: [] as string[],
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: h })),
  withTransaction: vi.fn(async (_knex: unknown, cb: (trx: any) => Promise<unknown>) => cb(h)),
  tenantDb: (_conn: any, _tenant: string) => ({ table: (table: string) => {
    let rows = h.tables[table] ?? [];
    let where: Record<string, unknown> = {};
    let columns: string[] = [];
    const query: any = {
      where(criteria: Record<string, unknown>) { where = criteria; rows = rows.filter((row) => Object.entries(criteria).every(([k, v]) => row[k] === v)); return query; },
      whereIn(column: string, values: unknown[]) { rows = rows.filter((row) => values.includes(row[column])); return query; },
      // These fixtures have no asset associations, so their ordering is immaterial.
      orderBy(_column: string, _direction?: 'asc' | 'desc') { return query; },
      select(...selected: string[]) { columns = selected; return query; },
      first() { return Promise.resolve(project(rows[0])); },
      insert(row: Row) { h.tables[table] ??= []; h.tables[table].push(row); return Promise.resolve(); },
      update(values: Row) { rows.forEach((row) => Object.assign(row, values)); return Promise.resolve(); },
      delete() { h.tables[table] = (h.tables[table] ?? []).filter((row) => !Object.entries(where).every(([k, v]) => row[k] === v)); return Promise.resolve(); },
      then(resolve: any, reject: any) { return Promise.resolve(rows.map(project)).then(resolve, reject); },
      catch(reject: any) { return Promise.resolve(rows.map(project)).catch(reject); },
    };
    function project(row?: Row) { return !row || columns.length === 0 ? row : Object.fromEntries(columns.map((column) => [column, row[column]])); }
    return query;
  } }),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async (_trx: unknown, input: any) => {
    h.authorizationCalls.push(input.resource.action);
    if (!h.hasNarrowing) return [];
    return [{
      id: `asset-${input.resource.action}-rule`, resource: 'asset', action: input.resource.action,
      templateKey: 'selected_clients', selectedClientIds: h.allowed ? ['client-1'] : ['client-outside-policy'],
    }];
  }),
}));
vi.mock('@shared/lib/documentAuthorization', () => ({
  authorizeAndRedactDocuments: vi.fn(async (_trx: unknown, _tenant: string, _user: unknown, documents: Row[]) => documents),
}));
vi.mock('../assetActionErrors', () => ({
  assetActionErrorFrom: (error: Error) => ({ actionError: error.message }),
}));

import { deleteAssetNote, getAssetNoteContent, saveAssetNote } from './assetNoteActions';

function seedNotes() {
  h.allowed = true;
  h.hasNarrowing = true;
  h.authorizationCalls = [];
  h.tables = {
    assets: [{ asset_id: 'asset-1', client_id: 'client-1', name: 'Device', notes_document_id: 'doc-1' }],
    documents: [{ document_id: 'doc-1', document_name: 'Device Notes', updated_at: '2026-01-01' }],
    document_block_content: [{ document_id: 'doc-1', block_data: '[{"type":"paragraph"}]', updated_at: '2026-01-02' }],
    document_associations: [{ document_id: 'doc-1', entity_id: 'asset-1', entity_type: 'asset' }],
    asset_associations: [],
    user_roles: [],
    team_members: [],
    users: [],
  };
  (h as any).fn = { now: () => 'now' };
}

describe('asset note actions authorization', () => {
  beforeEach(seedNotes);

  it('checks read access before loading the note document or block data', async () => {
    h.allowed = false;
    const result = await getAssetNoteContent('asset-1');
    expect(result).toMatchObject({ permissionError: expect.stringContaining('Cannot read asset notes') });
    expect(h.authorizationCalls).toEqual(['read']);
  });

  it('does not change any note or asset state when save authorization is denied', async () => {
    h.allowed = false;
    const before = structuredClone(h.tables);
    const result = await saveAssetNote('asset-1', [{ type: 'paragraph', content: [{ type: 'text', text: 'changed' }] }]);
    expect(result).toMatchObject({ permissionError: expect.stringContaining('Cannot update asset notes') });
    expect(h.tables).toEqual(before);
    expect(h.authorizationCalls).toEqual(['read']);
  });

  it('does not unlink or delete note data when delete authorization is denied', async () => {
    h.allowed = false;
    const before = structuredClone(h.tables);
    const result = await deleteAssetNote('asset-1', true);
    expect(result).toMatchObject({ permissionError: expect.stringContaining('Cannot delete asset notes') });
    expect(h.tables).toEqual(before);
    expect(h.authorizationCalls).toEqual(['read']);
  });

  it('reads and updates BlockNote content for an authorized asset', async () => {
    await expect(getAssetNoteContent('asset-1')).resolves.toMatchObject({
      document: { document_id: 'doc-1' }, blockData: [{ type: 'paragraph' }],
    });
    const next = [{ type: 'paragraph', content: [{ type: 'text', text: 'updated' }] }];
    await expect(saveAssetNote('asset-1', next)).resolves.toEqual({ document_id: 'doc-1' });
    expect(h.tables.document_block_content[0].block_data).toBe(JSON.stringify(next));
    expect(h.authorizationCalls).toEqual(['read', 'read', 'update']);
  });

  it('reads, saves and deletes notes with asset permissions and no bundle narrowing', async () => {
    h.hasNarrowing = false;
    await expect(getAssetNoteContent('asset-1')).resolves.toMatchObject({
      document: { document_id: 'doc-1' }, blockData: [{ type: 'paragraph' }],
    });
    const next = [{ type: 'paragraph', content: [{ type: 'text', text: 'updated' }] }];
    await expect(saveAssetNote('asset-1', next)).resolves.toEqual({ document_id: 'doc-1' });
    expect(h.tables.document_block_content[0].block_data).toBe(JSON.stringify(next));

    await expect(deleteAssetNote('asset-1', true)).resolves.toBeUndefined();
    expect(h.tables.assets[0].notes_document_id).toBeNull();
    expect(h.tables.documents).toEqual([]);
    expect(h.tables.document_block_content).toEqual([]);
    expect(h.tables.document_associations).toEqual([]);
    expect(h.authorizationCalls).toEqual(['read', 'read', 'update', 'read', 'delete']);
  });
});
