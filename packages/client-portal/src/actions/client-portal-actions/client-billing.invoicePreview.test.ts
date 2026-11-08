import { beforeEach, describe, expect, it, vi } from 'vitest';

const currentUser = { user_id: 'user-1', tenant: 'tenant-1', roles: [] };
const PNG = Buffer.from([137, 80, 78, 71]);
const PNG_URI = `data:image/png;base64,${PNG.toString('base64')}`;

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  getInvoiceForRendering: vi.fn(),
  getInvoiceTemplates: vi.fn(),
  getResolvedInvoiceTemplateId: vi.fn(),
  download: vi.fn(),
  findById: vi.fn(),
  invoiceRow: undefined as Record<string, unknown> | undefined,
  // external_files rows by id, each tagged with its owning tenant
  files: new Map<string, Record<string, unknown>>(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (action: any) =>
    async (...args: any[]) =>
      action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

function chain(first: () => unknown) {
  const c: any = {};
  for (const m of ['where', 'whereNot', 'select']) c[m] = vi.fn(() => c);
  c.first = vi.fn(async () => first());
  return c;
}

vi.mock('@alga-psa/db', () => ({
  getConnection: (...a: any[]) => mocks.getConnection(...a),
  withTransaction: (conn: any, handler: (trx: any) => Promise<unknown>) => handler(conn),
  createTenantKnex: vi.fn(),
  // Applies the tenant filter like the real tenantDb: a row only matches for its own tenant.
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => {
      if (table === 'external_files') {
        let id = '';
        const c: any = {
          where: (w: any) => { id = w.file_id; return c; },
          first: async () => {
            const row = mocks.files.get(id);
            return row && row.tenant === tenant ? row : undefined;
          },
        };
        return c;
      }
      return conn(table);
    },
    unscoped: (table: string) => conn(table),
    tenantJoin: (q: any) => q,
  }),
}));

vi.mock('@alga-psa/storage', () => ({
  StorageProviderFactory: { createProvider: async () => ({ download: mocks.download }) },
  FileStoreModel: { findById: mocks.findById },
}));

vi.mock('./clientBillingPermissions', () => ({
  getClientIdFromPortalUser: vi.fn(async () => 'client-1'),
  hasClientBillingReadPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/billing/actions/invoiceJobActions', () => ({ scheduleInvoiceEmailAction: vi.fn() }));
vi.mock('@alga-psa/billing/models/invoice', () => ({ default: {} }));
vi.mock('@alga-psa/billing/models/quote', () => ({ default: {} }));
vi.mock('@alga-psa/billing/models/quoteActivity', () => ({ default: {} }));
vi.mock('@alga-psa/billing/services', () => ({ recalculateQuoteFinancials: vi.fn(), getStoredInvoicePdf: vi.fn() }));
vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({
  fetchInvoicesByClient: vi.fn(),
  getInvoiceLineItems: vi.fn(),
  getInvoiceForRendering: (...a: any[]) => mocks.getInvoiceForRendering(...a),
  getResolvedInvoiceTemplateId: (...a: any[]) => mocks.getResolvedInvoiceTemplateId(...a),
}));
vi.mock('@alga-psa/billing/actions/invoiceTemplates', () => ({
  getInvoiceTemplates: (...a: any[]) => mocks.getInvoiceTemplates(...a),
}));
vi.mock('@alga-psa/billing/actions/invoiceModification', () => ({ finalizeInvoice: vi.fn(), unfinalizeInvoice: vi.fn() }));
vi.mock('@alga-psa/jobs', () => ({ JobService: class {}, JobStatus: {} }));

const file = (id: string, over: Record<string, unknown> = {}) => ({
  file_id: id,
  tenant: 'tenant-1',
  is_deleted: false,
  mime_type: 'image/png',
  file_size: PNG.length,
  storage_path: `tenant-1/${id}.png`,
  ...over,
});

const templateWith = (id: string, extra: Record<string, unknown> = {}) => ({
  template_id: id,
  name: id,
  version: 1,
  templateAst: {
    kind: 'invoice-template-ast',
    version: 1,
    layout: { id: 'root', type: 'document', children: [{ id: 'img', type: 'image', src: { type: 'literal', value: '/api/documents/view/bbbb2222-0000-4000-8000-000000000002' } }] },
  },
  ...extra,
});

describe('getClientInvoicePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.files.clear();
    mocks.invoiceRow = { invoice_id: 'inv-1', client_id: 'client-1', status: 'sent' };
    mocks.getConnection.mockResolvedValue((table: string) => {
      if (table === 'invoices') return chain(() => mocks.invoiceRow);
      throw new Error(`Unexpected table: ${table}`);
    });
    mocks.download.mockResolvedValue(PNG);
    mocks.files.set('aaaa1111-0000-4000-8000-000000000001', file('aaaa1111-0000-4000-8000-000000000001'));
    mocks.files.set('bbbb2222-0000-4000-8000-000000000002', file('bbbb2222-0000-4000-8000-000000000002'));
    mocks.getInvoiceForRendering.mockResolvedValue({
      invoice_id: 'inv-1',
      tenantClient: { name: 'MSP', address: null, logoUrl: '/api/documents/view/aaaa1111-0000-4000-8000-000000000001?t=123' },
    });
    mocks.getInvoiceTemplates.mockResolvedValue([templateWith('tpl-std', { isStandard: true }), templateWith('tpl-custom')]);
    mocks.getResolvedInvoiceTemplateId.mockResolvedValue(null);
  });

  it('returns the logo and a designer image as data URIs', async () => {
    const { getClientInvoicePreview } = await import('./client-billing');
    const result: any = await getClientInvoicePreview('inv-1');

    expect(result.invoice.tenantClient.logoUrl).toBe(PNG_URI);
    expect(result.template.templateAst.layout.children[0].src.value).toBe(PNG_URI);
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it('refuses an invoice that belongs to another client, before loading or reading anything', async () => {
    mocks.invoiceRow = undefined;
    const { getClientInvoicePreview } = await import('./client-billing');
    const result = await getClientInvoicePreview('inv-other');

    expect(result).toEqual({ actionError: 'Invoice not found or access denied', messageKey: 'client-portal:errors.billing.invoiceNotFound' });
    expect(mocks.getInvoiceForRendering).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('does not inline a file id that belongs to another tenant (and drops it rather than leaving a URL)', async () => {
    mocks.files.set('aaaa1111-0000-4000-8000-000000000001', file('aaaa1111-0000-4000-8000-000000000001', { tenant: 'tenant-OTHER' }));
    const { getClientInvoicePreview } = await import('./client-billing');
    const result: any = await getClientInvoicePreview('inv-1');

    expect(result.invoice.tenantClient.logoUrl).toBeNull();
    expect(result.template.templateAst.layout.children[0].src.value).toBe(PNG_URI);
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });

  it('does not inline non-image files or files over the size cap', async () => {
    mocks.files.set('aaaa1111-0000-4000-8000-000000000001', file('aaaa1111-0000-4000-8000-000000000001', { mime_type: 'application/pdf' }));
    mocks.files.set('bbbb2222-0000-4000-8000-000000000002', file('bbbb2222-0000-4000-8000-000000000002', { file_size: 50 * 1024 * 1024 }));
    const { getClientInvoicePreview } = await import('./client-billing');
    const result: any = await getClientInvoicePreview('inv-1');

    expect(result.invoice.tenantClient.logoUrl).toBeNull();
    expect(result.template.templateAst.layout.children[0].src.value).toBe('');
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('still returns the preview, without the images, when a logo file is missing or storage fails', async () => {
    mocks.files.delete('aaaa1111-0000-4000-8000-000000000001');
    mocks.download.mockRejectedValue(new Error('object gone'));
    const { getClientInvoicePreview } = await import('./client-billing');
    const result: any = await getClientInvoicePreview('inv-1');

    expect(result.invoice.invoice_id).toBe('inv-1');
    expect(result.invoice.tenantClient).toEqual({ name: 'MSP', address: null, logoUrl: null });
    expect(result.template.templateAst.layout.children[0].src.value).toBe('');
  });

  it('leaves viewer-editable fields containing a document URL unchanged', async () => {
    const url = '/api/documents/view/bbbb2222-0000-4000-8000-000000000002';
    mocks.getInvoiceForRendering.mockResolvedValue({
      invoice_id: 'inv-1',
      customer: { name: url, address: `1 ${url}` },
      items: [{ description: `see ${url}` }],
      tenantClient: { name: 'MSP', address: null, logoUrl: '/api/documents/view/aaaa1111-0000-4000-8000-000000000001' },
    });
    const { getClientInvoicePreview } = await import('./client-billing');
    const result: any = await getClientInvoicePreview('inv-1');

    expect(result.invoice.customer).toEqual({ name: url, address: `1 ${url}` });
    expect(result.invoice.items[0].description).toBe(`see ${url}`);
    expect(result.invoice.tenantClient.logoUrl).toBe(PNG_URI);
    expect(result.template.templateAst.layout.children[0].src.value).toBe(PNG_URI);
    expect(mocks.download).toHaveBeenCalledTimes(2);
  });

  describe('template selection', () => {
    it('uses the resolved client/tenant template when available', async () => {
      mocks.getResolvedInvoiceTemplateId.mockResolvedValue('tpl-custom');
      const { getClientInvoicePreview } = await import('./client-billing');
      const result: any = await getClientInvoicePreview('inv-1');
      expect(result.template.template_id).toBe('tpl-custom');
    });

    it('falls back to the first standard template, then the first template', async () => {
      mocks.getResolvedInvoiceTemplateId.mockResolvedValue('tpl-missing');
      const { getClientInvoicePreview } = await import('./client-billing');
      expect(((await getClientInvoicePreview('inv-1')) as any).template.template_id).toBe('tpl-std');

      mocks.getInvoiceTemplates.mockResolvedValue([templateWith('tpl-a'), templateWith('tpl-b')]);
      expect(((await getClientInvoicePreview('inv-1')) as any).template.template_id).toBe('tpl-a');
    });

    it('returns a null template when none exist', async () => {
      mocks.getInvoiceTemplates.mockResolvedValue([]);
      const { getClientInvoicePreview } = await import('./client-billing');
      expect(((await getClientInvoicePreview('inv-1')) as any).template).toBeNull();
    });
  });
});
