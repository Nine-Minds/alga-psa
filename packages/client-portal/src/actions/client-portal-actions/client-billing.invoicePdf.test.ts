import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser = { user_id: 'user-1', user_type: 'client', contact_id: 'contact-1', tenant: 'tenant-1', roles: [] };

const getConnectionMock = vi.fn();
const generateAndStoreMock = vi.fn();
const getStoredInvoicePdfMock = vi.fn();
const enqueueImmediateJobMock = vi.fn();
const getClientIdFromPortalUserMock = vi.fn(async (): Promise<string | null> => 'client-1');
const hasClientBillingReadPermissionMock = vi.fn(async () => true);
let storedInvoiceDocument: { file_id: string } | undefined;
let invoiceRow: Record<string, unknown> | undefined;
let jobRow: Record<string, unknown> | undefined;

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (action: any) =>
    async (...args: any[]) =>
      action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: (...args: any[]) => getConnectionMock(...args),
  withTransaction: (conn: any, handler: (trx: any) => Promise<unknown>) => handler(conn),
  createTenantKnex: vi.fn(async () => ({ knex: await getConnectionMock() })),
  tenantDb: (conn: any) => ({
    table: (table: string) => conn(table),
    unscoped: (table: string) => conn(table),
    tenantJoin: (query: any) => query,
  }),
}));

vi.mock('./clientBillingPermissions', () => ({
  getClientIdFromPortalUser: getClientIdFromPortalUserMock,
  hasClientBillingReadPermission: hasClientBillingReadPermissionMock,
}));

vi.mock('@alga-psa/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enqueueImmediateJob: enqueueImmediateJobMock,
}));

vi.mock('@alga-psa/billing/models/invoice', () => ({ default: {} }));
vi.mock('@alga-psa/billing/models/quote', () => ({ default: {} }));
vi.mock('@alga-psa/billing/models/quoteActivity', () => ({ default: {} }));
vi.mock('@alga-psa/billing/services', () => ({
  recalculateQuoteFinancials: vi.fn(),
  createPDFGenerationService: vi.fn(() => ({ generateAndStore: generateAndStoreMock })),
  getStoredInvoicePdf: (...args: any[]) => getStoredInvoicePdfMock(...args),
}));
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

function makeChain(result: unknown, tableName?: string) {
  const chain: any = {};
  let selectedResult = result;
  for (const method of ['where', 'whereNot', 'whereNotNull', 'orderBy', 'select', 'join', 'leftJoin']) {
    chain[method] = vi.fn((criteria?: Record<string, unknown>) => {
      if (tableName === 'invoices' && criteria?.client_id && (result as any)?.client_id !== criteria.client_id) {
        selectedResult = undefined;
      }
      return chain;
    });
  }
  chain.first = vi.fn(async () => selectedResult);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(selectedResult).then(resolve);
  return chain;
}

describe('client billing actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { user_id: 'user-1', user_type: 'client', contact_id: 'contact-1', tenant: 'tenant-1', roles: [] };
    getClientIdFromPortalUserMock.mockResolvedValue('client-1');
    hasClientBillingReadPermissionMock.mockResolvedValue(true);
    storedInvoiceDocument = undefined;
    invoiceRow = { invoice_id: 'invoice-1', client_id: 'client-1', status: 'sent', invoice_number: 'INV-001' };
    jobRow = { job_id: 'job-1', status: 'completed', metadata: {} };
    enqueueImmediateJobMock.mockResolvedValue({ jobId: 'job-1', scheduledJobId: 'scheduled-1' });

    getConnectionMock.mockResolvedValue((table: string) => {
      if (table === 'invoices') return makeChain(invoiceRow, table);
      if (table === 'jobs') return makeChain(jobRow);
      if (table === 'job_details') return makeChain([]);
      if (table === 'document_associations as da') return makeChain(storedInvoiceDocument);
      throw new Error(`Unexpected table: ${table}`);
    });
  });

  it('lets a portal client resend only an owned invoice through a fixed job payload', async () => {
    const { sendClientInvoiceEmail } = await import('./client-billing');
    const result = await sendClientInvoiceEmail('invoice-1');

    expect(result).toEqual({ success: true });
    expect(enqueueImmediateJobMock).toHaveBeenCalledWith('invoice_email', expect.objectContaining({
      invoiceIds: ['invoice-1'],
      tenantId: 'tenant-1',
      user_id: 'user-1',
      metadata: expect.objectContaining({ invoice_count: 1 }),
    }));
    const payload = enqueueImmediateJobMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('senderId');
    expect(payload).not.toHaveProperty('customMessage');
  });

  it('does not enqueue a resend for an invoice owned by another client', async () => {
    invoiceRow = { invoice_id: 'invoice-other-client', client_id: 'client-2', status: 'sent', invoice_number: 'INV-002' };
    const { sendClientInvoiceEmail } = await import('./client-billing');
    const result = await sendClientInvoiceEmail('invoice-other-client');

    expect(result).toMatchObject({ actionError: 'Invoice not found or access denied' });
    expect(enqueueImmediateJobMock).not.toHaveBeenCalled();
  });

  it('denies an internal MSP session with an owned linked-contact invoice and billing access before enqueueing', async () => {
    currentUser = { user_id: 'internal-1', user_type: 'internal', contact_id: 'contact-1', tenant: 'tenant-1', roles: [] };
    // The invoice fixture belongs to client-1, and the test setup grants portal
    // billing read access. Identity must still be rejected before either lookup.
    const { sendClientInvoiceEmail } = await import('./client-billing');
    const result = await sendClientInvoiceEmail('invoice-1');

    expect(result).toMatchObject({ permissionError: 'Unauthorized' });
    expect(hasClientBillingReadPermissionMock).toHaveBeenCalledTimes(0);
    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(enqueueImmediateJobMock).not.toHaveBeenCalled();
  });

  it('denies a portal user without contact identity before enqueueing', async () => {
    currentUser = { ...currentUser, contact_id: '' };
    getClientIdFromPortalUserMock.mockResolvedValue(null);
    const { sendClientInvoiceEmail } = await import('./client-billing');
    const result = await sendClientInvoiceEmail('invoice-1');

    expect(result).toMatchObject({ permissionError: 'Unauthorized' });
    expect(enqueueImmediateJobMock).not.toHaveBeenCalled();
  });

  it('denies a portal user without billing read permission before enqueueing', async () => {
    hasClientBillingReadPermissionMock.mockResolvedValue(false);
    const { sendClientInvoiceEmail } = await import('./client-billing');
    const result = await sendClientInvoiceEmail('invoice-1');

    expect(result).toMatchObject({ permissionError: 'Unauthorized to access invoice data' });
    expect(enqueueImmediateJobMock).not.toHaveBeenCalled();
  });

  it('returns the stored PDF the client was issued instead of regenerating', async () => {
    storedInvoiceDocument = { file_id: 'stored-invoice-file-1' };

    const { downloadClientInvoicePdf } = await import('./client-billing');
    const result = await downloadClientInvoicePdf('invoice-1');

    expect(result).toEqual({ success: true, fileId: 'stored-invoice-file-1' });
    expect(generateAndStoreMock).not.toHaveBeenCalled();
  });

  it('returns bytes, never a file id, when no published copy exists', async () => {
    storedInvoiceDocument = undefined;
    getStoredInvoicePdfMock.mockResolvedValue(Buffer.from([37, 80, 68, 70]));

    const { downloadClientInvoicePdf } = await import('./client-billing');
    const result = await downloadClientInvoicePdf('invoice-1');

    expect(getStoredInvoicePdfMock).toHaveBeenCalledWith({
      tenant: 'tenant-1',
      invoiceId: 'invoice-1',
      invoiceNumber: 'INV-001',
      userId: 'user-1',
      logLabel: '[downloadClientInvoicePdf]',
    });
    // A freshly filed invoice document is is_client_visible=false, which the
    // documents download route denies to portal users, so handing back its
    // file id would 404. Bytes are unconditional.
    expect(result).toEqual({
      success: true,
      pdfData: [37, 80, 68, 70],
      invoiceNumber: 'INV-001',
    });
    expect((result as { fileId?: string }).fileId).toBeUndefined();
  });

  it('surfaces a typed error instead of throwing when the render fails', async () => {
    storedInvoiceDocument = undefined;
    getStoredInvoicePdfMock.mockRejectedValue(new Error('Failed to launch the browser process'));

    const { downloadClientInvoicePdf } = await import('./client-billing');
    const result = await downloadClientInvoicePdf('invoice-1');

    // Thrown server-action messages are redacted in production, which is how a
    // missing chromium binary became a generic "Failed to download PDF" toast.
    expect(result).toEqual({
      actionError:
        'The invoice PDF could not be generated. Please try again, and contact support if the problem continues.',
    });
  });

  it('refuses invoices the portal user cannot see before looking for a document', async () => {
    invoiceRow = undefined;

    const { downloadClientInvoicePdf } = await import('./client-billing');
    const result = await downloadClientInvoicePdf('invoice-other-client');

    expect(result).toEqual({ actionError: 'Invoice not found or access denied', messageKey: 'client-portal:errors.billing.invoiceNotFound' });
    expect(generateAndStoreMock).not.toHaveBeenCalled();
    expect(getStoredInvoicePdfMock).not.toHaveBeenCalled();
  });
});
