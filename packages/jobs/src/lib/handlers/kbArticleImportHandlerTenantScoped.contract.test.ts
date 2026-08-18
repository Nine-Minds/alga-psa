import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'kbArticleImportHandler.ts'), 'utf8');

interface FakeRow extends Record<string, any> {}

const tables: Record<string, FakeRow[]> = { kb_import_files: [], jobs: [] };

const matches = (row: FakeRow, filter: Record<string, any>): boolean =>
  Object.entries(filter).every(([key, value]) => row[key] === value);

const makeQuery = (table: string) => {
  let filter: Record<string, any> = {};
  const query: any = {
    where(criteria: Record<string, any>) {
      filter = { ...filter, ...criteria };
      return query;
    },
    async first() {
      return tables[table].find((row) => matches(row, filter));
    },
    async update(values: Record<string, any>) {
      const rows = tables[table].filter((row) => matches(row, filter));
      rows.forEach((row) => Object.assign(row, values));
      return rows.length;
    },
  };
  return query;
};

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async (tenantId: string) => ({ knex: {}, tenant: tenantId }),
  tenantDb: () => ({ table: (name: string) => makeQuery(name) }),
}));

const createKbArticleMock = vi.fn(async () => ({ article_id: 'article-1' }));

vi.mock('@alga-psa/shared/models/kbArticleModel', () => ({
  createKbArticle: (...args: unknown[]) => createKbArticleMock(...(args as [])),
}));

import { KB_ARTICLE_IMPORT_JOB, kbArticleImportHandler } from './kbArticleImportHandler';

const stageFile = (overrides: Partial<FakeRow> = {}): FakeRow => {
  const row: FakeRow = {
    tenant: 'tenant-1',
    import_file_id: overrides.import_file_id ?? 'file-1',
    job_id: 'job-1',
    filename: 'printer-guide.md',
    content: '# Printer Guide\n\nRestart the spooler.',
    status: 'pending',
    error: null,
    article_id: null,
    audience: 'internal',
    article_type: 'reference',
    category_id: null,
    ...overrides,
  };
  tables.kb_import_files.push(row);
  return row;
};

describe('kb-article-import handler tenant-scoped query contract', () => {
  it('routes every query root through the tenant facade', () => {
    expect(source).toContain("tenantDb(knex, tenant)\n      .table('kb_import_files')");
    expect(source).toContain("tenantDb(knex, tenant).table('jobs')");
    expect(source).not.toContain('knex.raw');
    expect(source).not.toContain('.where({ tenant,');
    expect(source).toContain('createTenantKnex(data.tenantId)');
  });

  it('keeps the handler loadable by the plain-Node-ESM temporal worker', () => {
    expect(source).not.toContain("from 'server/");
    expect(source).not.toContain('@alga-psa/billing');
    expect(source).not.toContain('@alga-psa/notifications');
    expect(source).not.toContain('@alga-psa/storage');
    expect(source).not.toContain('@alga-psa/tickets');
    expect(source).toContain("from '@alga-psa/shared/models/kbArticleModel'");
    expect(source).toContain("from '../handler-utils/kbImportBlocks'");
  });

  it('exposes the canonical job name and a parse budget', () => {
    expect(KB_ARTICLE_IMPORT_JOB).toBe('kb-article-import');
    expect(source).toContain('maxDurationMs: KB_IMPORT_PARSE_BUDGET_MS');
  });
});

describe('kb-article-import handler execution', () => {
  beforeEach(() => {
    tables.kb_import_files = [];
    tables.jobs = [{ tenant: 'tenant-1', job_id: 'job-1', metadata: { user_id: 'user-1' } }];
    createKbArticleMock.mockClear();
    createKbArticleMock.mockImplementation(async () => ({ article_id: 'article-1' }) as any);
  });

  const run = (fileIds: string[]) =>
    kbArticleImportHandler('job-1', {
      tenantId: 'tenant-1',
      userId: 'user-1',
      jobServiceId: 'job-1',
      fileIds,
    });

  it('rejects incomplete job data', async () => {
    await expect(kbArticleImportHandler('job-1', {} as any)).rejects.toThrow('Tenant ID is required');
    await expect(
      kbArticleImportHandler('job-1', { tenantId: 'tenant-1' } as any),
    ).rejects.toThrow('User ID is required');
    await expect(
      kbArticleImportHandler('job-1', { tenantId: 'tenant-1', userId: 'user-1', fileIds: [] } as any),
    ).rejects.toThrow('At least one import file is required');
  });

  it('imports pending rows, records the article and drops the staged content', async () => {
    const row = stageFile();

    const result = await run(['file-1']);

    expect(result).toEqual({ total: 1, processed: 1, imported: 1, failed: 0 });
    expect(createKbArticleMock).toHaveBeenCalledTimes(1);
    const [, context, input] = createKbArticleMock.mock.calls[0] as any[];
    expect(context).toEqual({ tenant: 'tenant-1', userId: 'user-1' });
    expect(input.title).toBe('Printer Guide');
    expect(input.articleType).toBe('reference');
    expect(input.audience).toBe('internal');
    expect(input.content[0]).toEqual({
      type: 'heading',
      props: { level: 1 },
      content: [{ type: 'text', text: 'Printer Guide' }],
    });
    expect(row.status).toBe('imported');
    expect(row.article_id).toBe('article-1');
    expect(row.content).toBeNull();
  });

  it('is idempotent across retries: already consumed rows are not re-imported', async () => {
    stageFile({ import_file_id: 'file-1', status: 'imported' });
    stageFile({ import_file_id: 'file-2', status: 'failed' });

    const result = await run(['file-1', 'file-2']);

    expect(createKbArticleMock).not.toHaveBeenCalled();
    expect(result).toEqual({ total: 2, processed: 2, imported: 1, failed: 1 });
    // A retry that finds every row already consumed must still leave the final
    // counts on the job row, or the dialog polls a batch that never settles.
    const metadata = JSON.parse(tables.jobs[0].metadata as string);
    expect(metadata.kbImport).toEqual({ total: 2, processed: 2, imported: 1, failed: 1 });
  });

  it('maps user-facing failures onto the staged row', async () => {
    const row = stageFile({ import_file_id: 'file-1' });
    createKbArticleMock.mockImplementationOnce(async () => {
      throw new Error('An article with this slug already exists');
    });

    const result = await run(['file-1']);

    expect(result).toEqual({ total: 1, processed: 1, imported: 0, failed: 1 });
    expect(row.status).toBe('failed');
    expect(row.error).toBe('An article with this slug already exists');
    expect(row.content).toBeNull();
  });

  it('hides internal failure detail behind a generic message', async () => {
    const row = stageFile({ import_file_id: 'file-1' });
    createKbArticleMock.mockImplementationOnce(async () => {
      throw new Error('insert into "documents" violates foreign key constraint');
    });

    await run(['file-1']);

    expect(row.error).toBe('Failed to import article');
  });

  it('publishes progress onto the job row after each file', async () => {
    stageFile({ import_file_id: 'file-1' });
    stageFile({ import_file_id: 'file-2', filename: 'vpn-setup.html', content: '<h1>VPN</h1>' });

    await run(['file-1', 'file-2']);

    const job = tables.jobs[0];
    const metadata = JSON.parse(job.metadata as string);
    expect(metadata.user_id).toBe('user-1');
    expect(metadata.kbImport).toEqual({ total: 2, processed: 2, imported: 2, failed: 0 });
  });

  it('counts missing staged rows as failures instead of throwing', async () => {
    const result = await run(['missing-file']);

    expect(result).toEqual({ total: 1, processed: 1, imported: 0, failed: 1 });
  });
});
