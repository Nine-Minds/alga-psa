import { beforeEach, describe, expect, it, vi } from 'vitest';

const currentUser = { user_id: 'user-1', tenant: 'tenant-1', roles: [] };

const getConnectionMock = vi.fn();
const scheduleInvoiceZipActionMock = vi.fn();
let storedInvoiceDocument: { file_id: string } | undefined;
let invoiceRow: Record<string, unknown> | undefined;

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (action: any) =>
    async (...args: any[]) =>
      action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: (...args: any[]) => getConnectionMock(...args),
  withTransaction: (conn: any, handler: (trx: any) => Promise<unknown>) => handler(conn),
  createTenantKnex: vi.fn(),
  tenantDb: (conn: any) => ({
    table: (table: string) => conn(table),
    unscoped: (table: string) => conn(table),
    tenantJoin: (query: any) => query,
  }),
}));

vi.mock('./clientBillingPermissions', () => ({
  getClientIdFromPortalUser: vi.fn(async () => 'client-1'),
  hasClientBillingReadPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/billing/actions/invoiceJobActions', () => ({
  scheduleInvoiceEmailAction: vi.fn(),
  scheduleInvoiceZipAction: (...args: any[]) => scheduleInvoiceZipActionMock(...args),
}));

vi.mock('@alga-psa/billing/models/invoice', () => ({ default: {} }));
vi.mock('@alga-psa/billing/models/quote', () => ({ default: {} }));
vi.mock('@alga-psa/billing/models/quoteActivity', () => ({ default: {} }));
vi.mock('@alga-psa/billing/services', () => ({ recalculateQuoteFinancials: vi.fn() }));
vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({
  fetchInvoicesByClient: vi.fn(),
  getInvoiceLineItems: vi.fn(),
  getInvoiceForRendering: vi.fn(),
}));
vi.mock('@alga-psa/billing/actions/invoiceTemplates', () => ({ getInvoiceTemplates: vi.fn() }));
vi.mock('@alga-psa/billing/actions/invoiceModification', () => ({
  finalizeInvoice: vi.fn(),
  unfinalizeInvoice: vi.fn(),
}));
vi.mock('@alga-psa/jobs', () => ({ JobService: class {}, JobStatus: {} }));

function makeChain(result: unknown) {
  const chain: any = {};
  for (const method of ['where', 'whereNot', 'whereNotNull', 'orderBy', 'select', 'join', 'leftJoin']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.first = vi.fn(async () => result);
  return chain;
}

describe('downloadClientInvoicePdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedInvoiceDocument = undefined;
    invoiceRow = { invoice_id: 'invoice-1', client_id: 'client-1', status: 'sent' };

    getConnectionMock.mockResolvedValue((table: string) => {
      if (table === 'invoices') return makeChain(invoiceRow);
      if (table === 'document_associations as da') return makeChain(storedInvoiceDocument);
      throw new Error(`Unexpected table: ${table}`);
    });
  });

  it('returns the stored PDF the client was issued instead of regenerating', async () => {
    storedInvoiceDocument = { file_id: 'stored-invoice-file-1' };

    const { downloadClientInvoicePdf } = await import('./client-billing');
    const result = await downloadClientInvoicePdf('invoice-1');

    expect(result).toEqual({ success: true, fileId: 'stored-invoice-file-1' });
    expect(scheduleInvoiceZipActionMock).not.toHaveBeenCalled();
  });

  it('falls back to generating one for invoices filed before documents existed', async () => {
    storedInvoiceDocument = undefined;
    scheduleInvoiceZipActionMock.mockResolvedValue({ actionError: 'scheduled' });

    const { downloadClientInvoicePdf } = await import('./client-billing');
    const result = await downloadClientInvoicePdf('invoice-1');

    expect(scheduleInvoiceZipActionMock).toHaveBeenCalledWith(['invoice-1']);
    expect(result).toEqual({ actionError: 'scheduled' });
  });

  it('refuses invoices the portal user cannot see before looking for a document', async () => {
    invoiceRow = undefined;

    const { downloadClientInvoicePdf } = await import('./client-billing');
    const result = await downloadClientInvoicePdf('invoice-other-client');

    expect(result).toEqual({ actionError: 'Invoice not found or access denied' });
    expect(scheduleInvoiceZipActionMock).not.toHaveBeenCalled();
  });
});
