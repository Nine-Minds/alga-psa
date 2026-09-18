/**
 * The Temporal worker never loads this handler's TypeScript. package.json maps
 * "./handlers/*" to ./dist/lib/handlers/*.mjs, so executeJobHandler imports the
 * built artifact while every other test on this branch runs the source through
 * vitest aliases. That is the one seam where "the tests pass" does not mean
 * "the worker will do this": a stale dist or a tsup entry change would bring
 * back alt-text-only imports with a green suite.
 *
 * So build the package and assert against the emitted .mjs — the same claims
 * kbArticleImportHandlerTenantScoped.contract.test.ts makes against src.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const packageRoot = resolve(__dirname, '../../..');
const artifact = resolve(packageRoot, 'dist/lib/handlers/kbArticleImportHandler.mjs');

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
    forUpdate() {
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

const fakeKnex: any = {
  transaction: async (callback: (trx: unknown) => Promise<unknown>) => callback(fakeKnex),
};

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async (tenantId: string) => ({ knex: fakeKnex, tenant: tenantId }),
  tenantDb: () => ({ table: (name: string) => makeQuery(name) }),
}));

const createKbArticleMock = vi.fn(async () => ({ article_id: 'article-1' }));

vi.mock('@alga-psa/shared/models/kbArticleModel', () => ({
  createKbArticle: (...args: unknown[]) => createKbArticleMock(...(args as [])),
  publishKbArticleCreated: async () => undefined,
}));

let kbArticleImportHandler: (jobId: string, data: Record<string, unknown>) => Promise<any>;

const stageFile = (overrides: Partial<FakeRow> = {}): FakeRow => {
  const row: FakeRow = {
    tenant: 'tenant-1',
    import_file_id: 'file-1',
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

describe('kb-article-import built artifact', () => {
  beforeAll(async () => {
    // tsup takes about a second for this package; nx builds nothing for it
    // (nx:noop target), so call the package script directly.
    execFileSync('npm', ['--prefix', packageRoot, 'run', 'build'], { stdio: 'pipe' });
    expect(existsSync(artifact), `${artifact} was not emitted by the build`).toBe(true);
    kbArticleImportHandler = (await import(pathToFileURL(artifact).href)).kbArticleImportHandler;
  }, 180_000);

  beforeEach(() => {
    tables.kb_import_files = [];
    tables.jobs = [{ tenant: 'tenant-1', job_id: 'job-1', metadata: { user_id: 'user-1' } }];
    createKbArticleMock.mockClear();
  });

  const run = (fileIds: string[]) =>
    kbArticleImportHandler('job-1', {
      tenantId: 'tenant-1',
      userId: 'user-1',
      jobServiceId: 'job-1',
      fileIds,
    });

  it('carries markdown and html images through the shipped handler', async () => {
    stageFile({
      import_file_id: 'file-1',
      filename: 'printer-guide.md',
      content: '# Printer Guide\n\n![alt](https://example.com/a.png)\n',
    });
    stageFile({
      import_file_id: 'file-2',
      filename: 'vpn-setup.html',
      content: '<h1>VPN</h1><p><img src="/api/documents/view/abc" alt="VPN client" /></p>',
    });

    const result = await run(['file-1', 'file-2']);

    expect(result).toEqual({ total: 2, processed: 2, imported: 2, failed: 0 });
    const [, , markdownInput] = createKbArticleMock.mock.calls[0] as any[];
    expect(markdownInput.content).toContainEqual({
      type: 'image',
      props: { url: 'https://example.com/a.png', caption: 'alt' },
    });
    const [, , htmlInput] = createKbArticleMock.mock.calls[1] as any[];
    expect(htmlInput.content).toContainEqual({
      type: 'image',
      props: { url: '/api/documents/view/abc', caption: 'VPN client' },
    });
  });

  it('hoists list-item images in the shipped handler too', async () => {
    stageFile({
      import_file_id: 'file-1',
      filename: 'steps.md',
      content: '# Steps\n\n1. Open the queue ![shot](https://example.com/step.png)\n',
    });

    await run(['file-1']);

    const [, , input] = createKbArticleMock.mock.calls[0] as any[];
    expect(input.content).toContainEqual({
      type: 'image',
      props: { url: 'https://example.com/step.png', caption: 'shot' },
    });
  });

  it('keeps the shipped handler guarding unsafe image sources', async () => {
    stageFile({
      import_file_id: 'file-1',
      content: '# Printer Guide\n\n![Spooler dialog](javascript:alert(1))\n',
    });

    await run(['file-1']);

    const [, , input] = createKbArticleMock.mock.calls[0] as any[];
    expect(JSON.stringify(input.content).toLowerCase()).not.toContain('script:');
    expect(JSON.stringify(input.content)).toContain('Spooler dialog');
  });
});
