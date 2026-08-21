import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
    select() {
      return query;
    },
    orderBy() {
      return Promise.resolve(tables[table].filter((row) => matches(row, filter)));
    },
    async first() {
      return tables[table].find((row) => matches(row, filter));
    },
    async insert(rows: FakeRow | FakeRow[]) {
      tables[table].push(...(Array.isArray(rows) ? rows : [rows]));
      return rows;
    },
    async update(values: Record<string, any>) {
      const rows = tables[table].filter((row) => matches(row, filter));
      rows.forEach((row) => Object.assign(row, values));
      return rows.length;
    },
    del() {
      const remaining = tables[table].filter((row) => !matches(row, filter));
      const removed = tables[table].length - remaining.length;
      tables[table] = remaining;
      return Object.assign(Promise.resolve(removed), { catch: () => Promise.resolve(removed) });
    },
  };
  return query;
};

const hasPermissionMock = vi.fn(async () => true);

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: (...args: unknown[]) => hasPermissionMock(...(args as [])),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {}, tenant: 'tenant-1' }),
  tenantDb: () => ({ table: (name: string) => makeQuery(name.split(' as ')[0]) }),
  withTransaction: async (_knex: unknown, fn: any) => fn({}),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  permissionError: (message: string) => ({ _type: 'permission-error', message }),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: async () => undefined,
}));

vi.mock('@alga-psa/shared/models/kbArticleModel', () => ({
  KB_ARTICLE_SELECT_COLUMNS: ['article_id'],
  createKbArticle: async () => ({ article_id: 'article-1' }),
  generateKbArticleSlug: (title: string) => title.toLowerCase(),
  publishKbArticleCreated: async () => undefined,
}));

const enqueueMock = vi.fn(async () => ({ jobId: 'job-1', scheduledJobId: 'sched-1' }));

vi.mock('@alga-psa/core', () => ({
  enqueueImmediateJob: (...args: unknown[]) => enqueueMock(...(args as [])),
}));

import { getArticleImportStatus, startArticleImport } from '../src/actions/kbArticleActions';
import {
  KB_IMPORT_MAX_FILES,
  KB_IMPORT_MAX_FILE_BYTES,
  KB_IMPORT_MAX_TOTAL_BYTES,
} from '../src/lib/kbImportLimits';

const file = (overrides: Partial<{ filename: string; content: string }> = {}) => ({
  filename: 'printer-guide.md',
  content: '# Printer Guide',
  ...overrides,
});

describe('startArticleImport', () => {
  beforeEach(() => {
    tables.kb_import_files = [];
    tables.jobs = [];
    enqueueMock.mockClear();
    enqueueMock.mockImplementation(async () => ({ jobId: 'job-1', scheduledJobId: 'sched-1' }));
    hasPermissionMock.mockImplementation(async () => true);
  });

  it('stages the files and enqueues the import job by reference, not by content', async () => {
    const result = (await startArticleImport({ files: [file(), file({ filename: 'vpn.html' })] })) as any;

    expect(result).toEqual({ jobId: 'job-1', total: 2 });
    expect(tables.kb_import_files).toHaveLength(2);
    expect(tables.kb_import_files[0]).toMatchObject({
      tenant: 'tenant-1',
      job_id: 'job-1',
      filename: 'printer-guide.md',
      content: '# Printer Guide',
      status: 'pending',
      audience: 'internal',
      article_type: 'reference',
    });

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const [jobName, jobData] = enqueueMock.mock.calls[0] as any[];
    expect(jobName).toBe('kb-article-import');
    expect(jobData.tenantId).toBe('tenant-1');
    expect(jobData.userId).toBe('user-1');
    expect(jobData.fileIds).toHaveLength(2);
    expect(JSON.stringify(jobData)).not.toContain('# Printer Guide');
  });

  it('carries the batch options onto every staged row', async () => {
    await startArticleImport({
      files: [file()],
      audience: 'client',
      articleType: 'how_to',
      categoryId: 'category-9',
    });

    expect(tables.kb_import_files[0]).toMatchObject({
      audience: 'client',
      article_type: 'how_to',
      category_id: 'category-9',
    });
  });

  it('rejects oversized batches, oversized files, bad extensions and empty files', async () => {
    await expect(startArticleImport({ files: [] })).rejects.toThrow('No files provided');

    const tooMany = Array.from({ length: KB_IMPORT_MAX_FILES + 1 }, (_, i) =>
      file({ filename: `doc-${i}.md` }),
    );
    await expect(startArticleImport({ files: tooMany })).rejects.toThrow(
      `You can import at most ${KB_IMPORT_MAX_FILES} files at a time`,
    );

    await expect(
      startArticleImport({ files: [file({ filename: 'notes.pdf' })] }),
    ).rejects.toThrow('notes.pdf: unsupported file type. Use .md or .html');

    await expect(
      startArticleImport({ files: [file({ content: '   ' })] }),
    ).rejects.toThrow('printer-guide.md is empty');

    await expect(
      startArticleImport({ files: [file({ content: 'x'.repeat(KB_IMPORT_MAX_FILE_BYTES + 1) })] }),
    ).rejects.toThrow('printer-guide.md is larger than 5MB');

    // Under the per-file cap but over the batch cap: the browser refuses this
    // too, but the action is the authoritative check.
    const fatBatch = Array.from(
      { length: Math.ceil(KB_IMPORT_MAX_TOTAL_BYTES / KB_IMPORT_MAX_FILE_BYTES) + 1 },
      (_, i) => file({ filename: `doc-${i}.md`, content: 'x'.repeat(KB_IMPORT_MAX_FILE_BYTES) }),
    );
    await expect(startArticleImport({ files: fatBatch })).rejects.toThrow(
      'This batch is larger than 20MB. Import fewer files at once.',
    );

    expect(tables.kb_import_files).toHaveLength(0);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('removes the staged rows when the job cannot be enqueued', async () => {
    enqueueMock.mockImplementationOnce(async () => {
      throw new Error('Job enqueuer has not been registered');
    });

    await expect(startArticleImport({ files: [file()] })).rejects.toThrow(
      'Job enqueuer has not been registered',
    );
    expect(tables.kb_import_files).toHaveLength(0);
  });

  it('refuses callers without document create permission', async () => {
    hasPermissionMock.mockImplementationOnce(async () => false);

    const result = (await startArticleImport({ files: [file()] })) as any;

    expect(result._type).toBe('permission-error');
    expect(tables.kb_import_files).toHaveLength(0);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe('getArticleImportStatus', () => {
  beforeEach(() => {
    tables.kb_import_files = [];
    tables.jobs = [{ tenant: 'tenant-1', job_id: 'job-1', status: 'processing' }];
    hasPermissionMock.mockImplementation(async () => true);
  });

  it('reports progress while files are still pending', async () => {
    tables.kb_import_files = [
      { tenant: 'tenant-1', job_id: 'job-1', filename: 'a.md', status: 'imported', error: null },
      { tenant: 'tenant-1', job_id: 'job-1', filename: 'b.md', status: 'pending', error: null },
    ];

    const status = (await getArticleImportStatus('job-1')) as any;

    expect(status).toEqual({ status: 'processing', total: 2, imported: 1, failed: [] });
  });

  it('reports completion with per-file failures once every row is settled', async () => {
    tables.kb_import_files = [
      { tenant: 'tenant-1', job_id: 'job-1', filename: 'a.md', status: 'imported', error: null },
      {
        tenant: 'tenant-1',
        job_id: 'job-1',
        filename: 'b.md',
        status: 'failed',
        error: 'An article with this slug already exists',
      },
    ];

    const status = (await getArticleImportStatus('job-1')) as any;

    expect(status).toEqual({
      status: 'completed',
      total: 2,
      imported: 1,
      failed: [{ filename: 'b.md', error: 'An article with this slug already exists' }],
    });
  });

  it('surfaces a failed job even when rows never reached a terminal state', async () => {
    tables.jobs = [{ tenant: 'tenant-1', job_id: 'job-1', status: 'failed' }];
    tables.kb_import_files = [
      { tenant: 'tenant-1', job_id: 'job-1', filename: 'a.md', status: 'pending', error: null },
    ];

    const status = (await getArticleImportStatus('job-1')) as any;

    expect(status).toEqual({
      status: 'failed',
      total: 1,
      imported: 0,
      failed: [{ filename: 'a.md', error: 'Failed to import article' }],
    });
  });
});

describe('kb import job name contract', () => {
  it('keeps the inlined job name in sync with the handler constant', () => {
    // The action inlines the name on purpose: a vertical package importing
    // @alga-psa/jobs would close a jobs -> vertical -> jobs cycle.
    const actionSource = readFileSync(
      resolve(__dirname, '../src/actions/kbArticleActions.ts'),
      'utf8',
    );
    const handlerSource = readFileSync(
      resolve(__dirname, '../../jobs/src/lib/handlers/kbArticleImportHandler.ts'),
      'utf8',
    );

    expect(actionSource).toContain("const KB_ARTICLE_IMPORT_JOB = 'kb-article-import';");
    expect(handlerSource).toContain("export const KB_ARTICLE_IMPORT_JOB = 'kb-article-import';");
    expect(actionSource).not.toContain("from '@alga-psa/jobs");
    expect(actionSource).toContain("import { enqueueImmediateJob } from '@alga-psa/core';");
  });
});
