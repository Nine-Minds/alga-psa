import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';

const fetchTenantParty = vi.fn();
const mapDbSalesOrderToViewModel = vi.fn();
const evaluateTemplateAst = vi.fn();
const renderTemplateAstHtmlDocument = vi.fn();
const hasPermission = vi.fn();

const salesOrderRows: Array<{ so_id: string; so_number: string; client_name?: string | null }> = [];
let salesOrderCount = '0';
const ilikeCalls: unknown[][] = [];

/**
 * Minimal chainable knex stub: the query is cloned once for the count and once for the page, so the
 * builder is both thenable (resolves the page rows) and able to answer `count(...).first()`.
 */
const createQueryBuilder = (): any => {
  const builder: any = {
    leftJoin: () => builder,
    where: () => builder,
    andWhere: (clause: any) => {
      if (typeof clause === 'function') {
        clause({
          whereILike: (...args: unknown[]) => {
            ilikeCalls.push(args);
            return { orWhereILike: (...more: unknown[]) => ilikeCalls.push(more) };
          },
        });
      }
      return builder;
    },
    clone: () => builder,
    count: () => builder,
    first: async () => ({ count: salesOrderCount }),
    select: () => builder,
    orderBy: () => builder,
    limit: (value: number) => {
      builder.limitValue = value;
      return builder;
    },
    offset: (value: number) => {
      builder.offsetValue = value;
      return builder;
    },
    then: (resolve: (rows: unknown) => unknown) => Promise.resolve(salesOrderRows).then(resolve),
  };
  return builder;
};

const knexStub = () => createQueryBuilder();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexStub })),
  withTransaction: vi.fn(),
  tenantDb: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermission(...args),
}));

vi.mock('../lib/adapters/tenantPartyAdapter', () => ({
  fetchTenantParty: (...args: any[]) => fetchTenantParty(...args),
}));

vi.mock('../lib/adapters/salesOrderAdapters', () => ({
  mapDbSalesOrderToViewModel: (...args: any[]) => mapDbSalesOrderToViewModel(...args),
}));

vi.mock('../lib/invoice-template-ast/evaluator', () => ({
  evaluateTemplateAst: (...args: any[]) => evaluateTemplateAst(...args),
}));

vi.mock('../lib/invoice-template-ast/server-render', () => ({
  renderTemplateAstHtmlDocument: (...args: any[]) => renderTemplateAstHtmlDocument(...args),
}));

const templateAst = {
  kind: 'invoice-template-ast',
  version: 1,
  layout: { id: 'root', type: 'document', children: [] },
} as unknown as TemplateAst;

const previewedModel = () => evaluateTemplateAst.mock.calls.at(-1)?.[1] as Record<string, any>;

const importActions = () => import('./documentTemplateActions');

describe('generic document template preview against an existing document', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    salesOrderRows.length = 0;
    ilikeCalls.length = 0;
    salesOrderCount = '0';
    hasPermission.mockImplementation(async () => true);
    evaluateTemplateAst.mockReturnValue({});
    renderTemplateAstHtmlDocument.mockResolvedValue('<html></html>');
  });

  it('lists existing sales orders as preview options for every registered document type', async () => {
    salesOrderRows.push(
      { so_id: 'so-1', so_number: 'SO-00100', client_name: 'Acme Corp' },
      { so_id: 'so-2', so_number: 'SO-00101', client_name: null },
    );
    salesOrderCount = '2';

    const { listExistingDocumentsForPreview } = await importActions();
    for (const documentType of ['sales-order', 'packing-slip', 'pick-list']) {
      const result = await listExistingDocumentsForPreview(documentType, { search: '', page: 1, pageSize: 10 });

      expect(result).toEqual({
        options: [
          { value: 'so-1', label: 'SO-00100 · Acme Corp' },
          { value: 'so-2', label: 'SO-00101' },
        ],
        total: 2,
      });
    }
  });

  it('escapes wildcards in the search term', async () => {
    const { listExistingDocumentsForPreview } = await importActions();
    await listExistingDocumentsForPreview('sales-order', { search: '50%_off' });

    expect(ilikeCalls[0]).toEqual(['so.so_number', '%50\\%\\_off%']);
  });

  it('denies listing when the caller cannot read sales orders', async () => {
    hasPermission.mockImplementation(async (_user: unknown, resource: string) => resource !== 'sales_order');

    const { listExistingDocumentsForPreview } = await importActions();
    const result = await listExistingDocumentsForPreview('sales-order', {});

    expect(result).toMatchObject({ permissionError: 'Permission denied: cannot read sales orders' });
  });

  it('renders the selected existing document instead of the sample', async () => {
    mapDbSalesOrderToViewModel.mockResolvedValue({
      so_number: 'SO-00100',
      customer: { name: 'Acme Corp' },
      tenantClient: { name: 'Emerald City IT', address: '1010 Emerald Street', logo_url: 'https://cdn/logo.png' },
      line_items: [],
    });

    const { runAuthoritativeTemplatePreview } = await importActions();
    const result = await runAuthoritativeTemplatePreview('packing-slip', templateAst, 'en', 'so-1');

    expect(result).toEqual({ html: '<html></html>' });
    expect(mapDbSalesOrderToViewModel).toHaveBeenCalledWith(knexStub, 'tenant-1', 'so-1');
    expect(previewedModel().so_number).toBe('SO-00100');
    // A real document carries its own branding — the sample overlay must stay out of the way.
    expect(fetchTenantParty).not.toHaveBeenCalled();
    expect(previewedModel().tenantClient?.name).toBe('Emerald City IT');
  });

  it('reports a missing existing document instead of silently falling back to the sample', async () => {
    mapDbSalesOrderToViewModel.mockResolvedValue(null);

    const { runAuthoritativeTemplatePreview } = await importActions();
    const result = await runAuthoritativeTemplatePreview('sales-order', templateAst, 'en', 'so-missing');

    expect(result).toMatchObject({ actionError: 'Document not found.' });
    expect(evaluateTemplateAst).not.toHaveBeenCalled();
  });

  it('denies an existing-document preview when the caller cannot read sales orders', async () => {
    hasPermission.mockImplementation(async (_user: unknown, resource: string) => resource !== 'sales_order');

    const { runAuthoritativeTemplatePreview } = await importActions();
    const result = await runAuthoritativeTemplatePreview('sales-order', templateAst, 'en', 'so-1');

    expect(result).toMatchObject({ permissionError: 'Permission denied: cannot read sales orders' });
    expect(mapDbSalesOrderToViewModel).not.toHaveBeenCalled();
  });

  it('still renders the branded sample when no existing document is selected', async () => {
    fetchTenantParty.mockResolvedValue({
      name: 'Emerald City IT',
      address: '1010 Emerald Street',
      email: null,
      phone: null,
      logo_url: null,
    });

    const { runAuthoritativeTemplatePreview } = await importActions();
    await runAuthoritativeTemplatePreview('sales-order', templateAst, 'en', null);

    expect(mapDbSalesOrderToViewModel).not.toHaveBeenCalled();
    expect(previewedModel().so_number).toBe('SO-00042');
    expect(previewedModel().tenantClient?.name).toBe('Emerald City IT');
  });
});
