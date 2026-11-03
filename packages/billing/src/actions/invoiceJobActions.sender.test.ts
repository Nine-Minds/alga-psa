import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => ({ success: true, queued: false })),
  hasPermission: vi.fn(async (_user: unknown, _resource: string, _action: string) => true),
  enqueueImmediateJob: vi.fn(async () => ({ jobId: 'job-1', scheduledJobId: 'scheduled-1' })),
  generateAndStore: vi.fn(async () => ({ file_id: 'file-invoice-1' })),
  publish: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => unknown) => (...args: any[]) => action(
    { user_id: 'billing-user' }, { tenant: 'tenant-test' }, ...args,
  ),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/core', () => ({
  enqueueImmediateJob: mocks.enqueueImmediateJob,
  formatCurrency: () => '$100.00',
  formatLocalizedCalendarDate: () => 'Jan 1, 2026',
  isValidEmail: () => true,
}));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  tenantDb: () => ({
    table: () => ({
      where: () => ({
        first: async () => ({
          subject: 'Invoice {{invoice.number}}',
          html_content: '<p>Invoice {{invoice.number}}</p>',
          text_content: 'Invoice {{invoice.number}}',
        }),
      }),
    }),
  }),
}));
vi.mock('@alga-psa/email', () => ({
  StaticTemplateProcessor: class {
    constructor(public subject: string, public html: string, public text: string) {}
  },
  TenantEmailService: {
    getInstance: vi.fn(() => ({ sendEmail: mocks.sendEmail })),
  },
}));
vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: { downloadFile: vi.fn(async () => ({ buffer: Buffer.from('%PDF-test') })) },
}));
vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({
  resolveEmailLocale: vi.fn(async () => 'en'),
  getTenantDefaultLocale: vi.fn(async () => 'en'),
}));
vi.mock('@alga-psa/shared/billingClients/clients', () => ({
  getClientById: vi.fn(async () => ({ client_id: 'client-1', client_name: 'Test Client' })),
}));
vi.mock('../lib/adapters/tenantPartyAdapter', () => ({ fetchTenantParty: vi.fn(async () => ({ name: 'Test MSP' })) }));
vi.mock('../services/invoiceBillingRecipientService', () => ({
  resolveInvoiceBillingRecipient: vi.fn(async () => ({
    recipientEmail: 'billing@example.test', recipientName: 'Billing Contact', recipientSource: 'billing_email',
  })),
}));
vi.mock('../services/pdfGenerationService', () => ({
  createPDFGenerationService: () => ({ generateAndStore: mocks.generateAndStore }),
  publishGeneratedDocumentsToClient: mocks.publish,
}));
vi.mock('./invoiceQueries', () => ({
  getInvoiceForRendering: vi.fn(async () => ({
    invoice_id: 'invoice-1', invoice_number: 'INV-1', client_id: 'client-1', status: 'finalized',
    finalized_at: '2026-01-01T00:00:00Z', invoice_type: 'standard', total_amount: 10000,
    credit_applied: 0, currencyCode: 'USD', invoice_date: new Date(2026, 0, 1),
    due_date: new Date(2026, 0, 31), payment_method: null,
  })),
}));
vi.mock('../services/ensureInvoiceEmailLinks', () => ({
  ensureInvoiceEmailLinks: ({ html, text }: { html: string; text: string }) => ({ html, text }),
}));
vi.mock('./invoiceEmailLinkContext', () => ({
  getInvoiceEmailLinkContext: vi.fn(async () => ({ paymentUrl: null, portalUrl: null })),
}));

import { scheduleInvoiceEmailAction, sendInvoiceEmailAction } from './invoiceJobActions';

describe('sendInvoiceEmailAction sender plumbing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.enqueueImmediateJob.mockResolvedValue({ jobId: 'job-1', scheduledJobId: 'scheduled-1' });
  });

  it('sends the billing class and selected sender with only the PDF attachment', async () => {
    const senderId = 'sender-invoices';
    const result = await sendInvoiceEmailAction(['invoice-1'], undefined, senderId);

    expect(result).toMatchObject({ successCount: 1, failureCount: 0 });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      mailClass: 'billing',
      senderId,
      attachments: [expect.objectContaining({
        filename: 'Invoice_INV-1.pdf',
        content: Buffer.from('%PDF-test'),
        contentType: 'application/pdf',
      })],
    }));
  });

  it.each([
    ['schedule', () => scheduleInvoiceEmailAction(['invoice-1'])],
    ['immediate send', () => sendInvoiceEmailAction(['invoice-1'])],
  ])('denies %s with billing create/read but without invoice send before side effects', async (_label, invoke) => {
    mocks.hasPermission.mockImplementation(async (_user: unknown, resource: string, action: string) =>
      resource === 'billing' && (action === 'create' || action === 'read'));

    const result = await invoke();

    expect(result).toMatchObject({ permissionError: 'Permission denied: invoice send required' });
    expect(mocks.hasPermission).toHaveBeenCalledWith(expect.anything(), 'invoice', 'send');
    expect(mocks.enqueueImmediateJob).not.toHaveBeenCalled();
    expect(mocks.generateAndStore).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('allows invoice:send to schedule the invoice email job', async () => {
    await expect(scheduleInvoiceEmailAction(['invoice-1'])).resolves.toMatchObject({ jobId: 'job-1' });
    expect(mocks.enqueueImmediateJob).toHaveBeenCalledWith('invoice_email', expect.objectContaining({
      invoiceIds: ['invoice-1'], tenantId: 'tenant-test',
    }));
  });
});
