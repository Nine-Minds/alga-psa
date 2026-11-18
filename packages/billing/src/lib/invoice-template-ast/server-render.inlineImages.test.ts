import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  download: vi.fn(),
  createProvider: vi.fn(),
  tenantRows: new Map<string, Record<string, unknown>>(),
  tenantQueries: [] as Array<{ tenant: string; where: Record<string, unknown> }>,
}));

vi.mock('@alga-psa/storage', () => ({
  StorageProviderFactory: { createProvider: () => mocks.createProvider() },
  FileStoreModel: { findById: mocks.findById },
}));

// tenantDb stand-in that applies the tenant filter the way the real one does:
// a row only matches when its `tenant` column equals the scoped tenant.
vi.mock('@alga-psa/db', () => ({
  tenantDb: (_knex: unknown, tenant: string) => ({
    table: () => ({
      where: (where: Record<string, unknown>) => {
        mocks.tenantQueries.push({ tenant, where });
        return {
          first: async () => {
            const row = mocks.tenantRows.get(String(where.file_id));
            return row && row.tenant === tenant ? row : undefined;
          },
        };
      },
    }),
  }),
}));

import {
  MAX_INLINED_IMAGE_BYTES,
  inlineDocumentImageUrls,
  inlineDocumentImageUrl,
  inlineTemplateImageSources,
  renderTemplateAstHtmlDocument,
} from './server-render';
import { evaluateTemplateAst } from './evaluator';

const PNG = Buffer.from([137, 80, 78, 71]);
const PNG_URI = `data:image/png;base64,${PNG.toString('base64')}`;
const knex = {} as any;

const file = (over: Record<string, unknown> = {}) => ({
  file_id: 'aaaa-1111',
  tenant: 'tenant-1',
  is_deleted: false,
  mime_type: 'image/png',
  file_size: PNG.length,
  storage_path: 'tenant-1/aaaa-1111.png',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tenantRows.clear();
  mocks.tenantQueries.length = 0;
  mocks.download.mockResolvedValue(PNG);
  mocks.createProvider.mockImplementation(async () => ({ download: mocks.download }));
});

describe('inlineDocumentImageUrls', () => {
  it('leaves every URL in place when the storage provider cannot be created', async () => {
    mocks.createProvider.mockRejectedValueOnce(new Error('no storage'));
    const html = '<img src="/api/documents/view/aaaa-1111">';
    expect(await inlineDocumentImageUrls(html, { knex })).toBe(html);
  });

  it("with unresolved: 'drop', blanks a document image that cannot be inlined", async () => {
    mocks.findById.mockResolvedValue(null);
    expect(await inlineDocumentImageUrl('/api/documents/view/aaaa-1111?t=1', { knex, unresolved: 'drop' })).toBeNull();
    expect(await inlineDocumentImageUrl('/api/documents/view/aaaa-1111?t=1', { knex })).toBe('/api/documents/view/aaaa-1111?t=1');
    expect(await inlineDocumentImageUrl('https://cdn.example/logo.png', { knex, unresolved: 'drop' })).toBe('https://cdn.example/logo.png');

    const ast = { layout: { type: 'image', src: { type: 'literal', value: '/api/documents/view/aaaa-1111' } } };
    const out: any = await inlineTemplateImageSources(ast, { knex, unresolved: 'drop' });
    expect(out.layout.src.value).toBe('');
  });

  it('replaces plain and ?t= variant URLs with data URIs (ambient-tenant lookup, PDF path)', async () => {
    mocks.findById.mockResolvedValue(file());
    const html = '<img src="/api/documents/view/aaaa-1111?t=123"><img src="/api/documents/view/aaaa-1111">';
    const out = await inlineDocumentImageUrls(html, { knex });
    expect(out).toBe(`<img src="${PNG_URI}"><img src="${PNG_URI}">`);
    expect(mocks.findById).toHaveBeenCalledTimes(1);
  });

  it('leaves the URL in place when the file cannot be resolved', async () => {
    mocks.findById.mockResolvedValue(null);
    const html = '<img src="/api/documents/view/aaaa-1111">';
    expect(await inlineDocumentImageUrls(html, { knex })).toBe(html);

    mocks.findById.mockResolvedValue(file());
    mocks.download.mockRejectedValue(new Error('gone'));
    expect(await inlineDocumentImageUrls(html, { knex })).toBe(html);
  });

  it('does not inline non-image files', async () => {
    mocks.findById.mockResolvedValue(file({ mime_type: 'application/pdf' }));
    const html = '<img src="/api/documents/view/aaaa-1111">';
    expect(await inlineDocumentImageUrls(html, { knex })).toBe(html);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('does not inline files over the size cap (by metadata or by bytes read)', async () => {
    const html = '<img src="/api/documents/view/aaaa-1111">';
    mocks.findById.mockResolvedValue(file({ file_size: MAX_INLINED_IMAGE_BYTES + 1 }));
    expect(await inlineDocumentImageUrls(html, { knex })).toBe(html);
    expect(mocks.download).not.toHaveBeenCalled();

    mocks.findById.mockResolvedValue(file({ file_size: 10 }));
    mocks.download.mockResolvedValue(Buffer.alloc(MAX_INLINED_IMAGE_BYTES + 1));
    expect(await inlineDocumentImageUrls(html, { knex })).toBe(html);
  });

  it('with a tenant, queries explicitly scoped and never inlines another tenant\'s file', async () => {
    mocks.tenantRows.set('bbbb-2222', file({ file_id: 'bbbb-2222', tenant: 'tenant-OTHER' }));
    mocks.tenantRows.set('aaaa-1111', file());
    const html = '<img src="/api/documents/view/bbbb-2222"><img src="/api/documents/view/aaaa-1111">';

    const out = await inlineDocumentImageUrls(html, { knex, tenant: 'tenant-1' });

    expect(out).toBe(`<img src="/api/documents/view/bbbb-2222"><img src="${PNG_URI}">`);
    expect(mocks.findById).not.toHaveBeenCalled();
    expect(mocks.tenantQueries.every((q) => q.tenant === 'tenant-1')).toBe(true);
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });

  it('inlineDocumentImageUrl only touches a value that is wholly a document URL', async () => {
    mocks.findById.mockResolvedValue(file());
    expect(await inlineDocumentImageUrl('/api/documents/view/aaaa-1111?t=9', { knex })).toBe(PNG_URI);
    const text = 'Acme /api/documents/view/aaaa-1111 Ltd';
    expect(await inlineDocumentImageUrl(text, { knex })).toBe(text);
    expect(await inlineDocumentImageUrl(undefined, { knex })).toBeUndefined();
  });

  it('inlineTemplateImageSources inlines only literal image node srcs', async () => {
    mocks.findById.mockResolvedValue(file());
    const url = '/api/documents/view/aaaa-1111';
    const ast = {
      layout: {
        type: 'document',
        children: [
          { type: 'image', src: { type: 'literal', value: url } },
          { type: 'text', content: { type: 'literal', value: url } },
          { type: 'image', src: { type: 'path', path: url } },
        ],
      },
    };
    const out: any = await inlineTemplateImageSources(ast, { knex });
    expect(out.layout.children[0].src.value).toBe(PNG_URI);
    expect(out.layout.children[1].content.value).toBe(url);
    expect(out.layout.children[2].src.path).toBe(url);
    expect((ast.layout.children[0] as any).src.value).toBe(url);
  });
});

describe('renderTemplateAstHtmlDocument (PDF path)', () => {
  it('still turns document image URLs into data URIs when knex is provided', async () => {
    mocks.findById.mockResolvedValue(file());
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
      layout: {
        id: 'root',
        type: 'document',
        children: [
          { id: 'img', type: 'image', src: { type: 'literal', value: '/api/documents/view/aaaa-1111' } } as any,
        ],
      },
    };
    const evaluation = evaluateTemplateAst(ast, { invoiceNumber: 'INV-1', items: [] });
    const html = await renderTemplateAstHtmlDocument(ast, evaluation, { knex });
    expect(html).toContain(PNG_URI);
    expect(html).not.toContain('/api/documents/view/aaaa-1111');
  });
});
