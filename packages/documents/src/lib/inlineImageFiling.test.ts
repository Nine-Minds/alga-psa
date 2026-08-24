import { INLINE_IMAGE_FOLDER_PATH } from './editorImageUpload';

interface FolderRow extends Record<string, any> {}

const rows: FolderRow[] = [];
const calls: Array<{ table: string; tenant: string }> = [];

const makeQuery = (table: string, tenant: string) => {
  calls.push({ table, tenant });
  let paths: string[] = [];
  let entityIdIsNull = false;
  const query: any = {
    whereIn(_column: string, values: string[]) {
      paths = values;
      return query;
    },
    whereNull() {
      entityIdIsNull = true;
      return query;
    },
    select(..._columns: string[]) {
      return Promise.resolve(
        rows.filter(
          (row) =>
            row.tenant === tenant &&
            paths.includes(row.folder_path) &&
            (!entityIdIsNull || row.entity_id === null)
        )
      );
    },
    async insert(values: FolderRow[]) {
      rows.push(...values);
      return values.length;
    },
  };
  return query;
};

vi.mock('@alga-psa/db', () => ({
  tenantDb: (_knex: unknown, tenant: string) => ({
    table: (table: string) => makeQuery(table, tenant),
  }),
}));

const { ensureInlineImageFolder } = await import('./inlineImageFiling');

describe('ensureInlineImageFolder', () => {
  beforeEach(() => {
    rows.length = 0;
    calls.length = 0;
  });

  it('provisions the folder and its parent on first use', async () => {
    const path = await ensureInlineImageFolder({} as any, 'tenant-1', 'user-1');

    expect(path).toBe(INLINE_IMAGE_FOLDER_PATH);
    expect(rows.map((row) => row.folder_path)).toEqual([
      '/Knowledge Base',
      INLINE_IMAGE_FOLDER_PATH,
    ]);

    const attachments = rows[1];
    expect(attachments.folder_name).toBe('Attachments');
    expect(attachments.parent_folder_id).toBe(rows[0].folder_id);
    expect(attachments.created_by).toBe('user-1');
    // Tenant-level, not one folder per article.
    expect(attachments.entity_id).toBeNull();
    expect(attachments.entity_type).toBeNull();
    // Inline uploads force their own visibility; a file dropped here by hand
    // later must not be published just because of where it landed.
    expect(attachments.is_client_visible).toBe(false);
    expect(rows[0].is_client_visible).toBe(false);
  });

  it('reuses an existing parent folder', async () => {
    rows.push({
      tenant: 'tenant-1',
      folder_id: 'kb-folder',
      folder_path: '/Knowledge Base',
      entity_id: null,
    });

    await ensureInlineImageFolder({} as any, 'tenant-1', 'user-1');

    expect(rows).toHaveLength(2);
    expect(rows[1].folder_path).toBe(INLINE_IMAGE_FOLDER_PATH);
    expect(rows[1].parent_folder_id).toBe('kb-folder');
  });

  it('is a no-op once the folder exists', async () => {
    rows.push({
      tenant: 'tenant-1',
      folder_id: 'attachments',
      folder_path: INLINE_IMAGE_FOLDER_PATH,
      entity_id: null,
    });

    const path = await ensureInlineImageFolder({} as any, 'tenant-1', 'user-1');

    expect(path).toBe(INLINE_IMAGE_FOLDER_PATH);
    expect(rows).toHaveLength(1);
  });

  it('ignores another tenant’s folder rows', async () => {
    rows.push({
      tenant: 'tenant-2',
      folder_id: 'other',
      folder_path: INLINE_IMAGE_FOLDER_PATH,
      entity_id: null,
    });

    await ensureInlineImageFolder({} as any, 'tenant-1', 'user-1');

    expect(rows.filter((row) => row.tenant === 'tenant-1')).toHaveLength(2);
    expect(calls.every((call) => call.table === 'document_folders')).toBe(true);
    expect(calls.every((call) => call.tenant === 'tenant-1')).toBe(true);
  });
});
