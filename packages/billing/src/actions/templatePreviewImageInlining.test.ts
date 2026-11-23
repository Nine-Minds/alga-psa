/**
 * The preview is chunked into pages by the pooled Chromium the PDF is printed by, and that browser
 * has no route to the app: a tenant logo left as a `/api/documents/view/...` URL loads for nobody
 * but the author's own iframe, so the chunker would measure a header the author then sees drawn
 * taller — the preview and the print would disagree about where a page ends. Both designer previews
 * inline their images before paginating, exactly as the PDF path does.
 */
import { describe, expect, it, vi } from 'vitest';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';

const PNG = Buffer.from([137, 80, 78, 71]);
const PNG_URI = `data:image/png;base64,${PNG.toString('base64')}`;
const LOGO_URL = '/api/documents/view/aaaa-1111';

const mocks = vi.hoisted(() => ({
  paginated: [] as string[],
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
  hasPermission: async () => true,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async () => true,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({ table: () => ({ where: () => ({ first: async () => undefined }) }) }),
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
}));

vi.mock('@alga-psa/storage', () => ({
  StorageProviderFactory: { createProvider: async () => ({ download: async () => PNG }) },
  FileStoreModel: {
    findById: async () => ({
      file_id: 'aaaa-1111',
      tenant: 'test-tenant',
      is_deleted: false,
      mime_type: 'image/png',
      file_size: PNG.length,
      storage_path: 'test-tenant/aaaa-1111.png',
    }),
  },
}));

// The chunker itself needs a real browser; what matters here is the document it is handed.
vi.mock('../lib/invoice-template-ast/previewPagination.server', () => ({
  paginateDocumentPreviewHtml: async (html: string) => {
    mocks.paginated.push(html);
    return { html, pageCount: 1 };
  },
}));

import { runAuthoritativeInvoiceTemplatePreview } from './invoiceTemplatePreview';
import { runAuthoritativeQuoteTemplatePreview } from './quoteTemplatePreview';

const logoWorkspace = () => ({
  rootId: 'doc',
  nodesById: {
    doc: {
      id: 'doc',
      type: 'document',
      props: {
        name: 'Document',
        metadata: {},
        layout: { display: 'flex', flexDirection: 'column' },
        style: { width: '816px', height: '1056px' },
        size: { width: 816, height: 1056 },
        position: { x: 0, y: 0 },
      },
      children: ['logo'],
    },
    logo: {
      id: 'logo',
      type: 'image',
      props: {
        name: 'Logo',
        metadata: { src: LOGO_URL, alt: 'Logo' },
        size: { width: 180, height: 72 },
        position: { x: 0, y: 0 },
      },
      children: [],
    },
  },
  snapToGrid: true,
  gridSize: 8,
  showGuides: true,
  showRulers: true,
  canvasScale: 1,
}) as never;

describe('designer preview image inlining', () => {
  it('hands the chunker an invoice document with its images inlined', async () => {
    mocks.paginated.length = 0;
    const result = await (runAuthoritativeInvoiceTemplatePreview as any)(
      { id: 'test-user', tenant: 'test-tenant' },
      { tenant: 'test-tenant' },
      { workspace: logoWorkspace(), invoiceData: { invoiceNumber: 'INV-1', items: [], subtotal: 0, tax: 0, total: 0 } },
    );

    expect(result.success).toBe(true);
    expect(mocks.paginated).toHaveLength(1);
    expect(mocks.paginated[0]).toContain(PNG_URI);
    expect(mocks.paginated[0]).not.toContain(LOGO_URL);
  });

  it('hands the chunker a quote document with its images inlined', async () => {
    mocks.paginated.length = 0;
    const result = await (runAuthoritativeQuoteTemplatePreview as any)(
      { id: 'test-user', tenant: 'test-tenant' },
      { tenant: 'test-tenant' },
      { workspace: logoWorkspace(), quoteData: { quoteNumber: 'Q-1', lineItems: [], subtotal: 0, tax: 0, total: 0 } },
    );

    expect(result.success).toBe(true);
    expect(mocks.paginated).toHaveLength(1);
    expect(mocks.paginated[0]).toContain(PNG_URI);
    expect(mocks.paginated[0]).not.toContain(LOGO_URL);
  });

  it('previews an un-inlined document rather than failing when the tenant database is unreachable', async () => {
    const { inlinePreviewDocumentImages } = await import('../lib/invoice-template-ast/server-render');
    const db = await import('@alga-psa/db');
    const spy = vi.spyOn(db, 'createTenantKnex').mockRejectedValueOnce(new Error('no database'));
    const html = `<img src="${LOGO_URL}">`;
    expect(await inlinePreviewDocumentImages(html)).toBe(html);
    spy.mockRestore();
  });
});
