import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => ({ success: true, queued: false })),
  generateAndStore: vi.fn(async () => ({ file_id: 'file-invoice-1' })),
  invoiceStatus: 'finalized',
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => unknown) => (...args: any[]) => action(
    { user_id: 'billing-user' }, { tenant: 'tenant-test' }, ...args,
  ),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
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
vi.mock('../src/lib/adapters/tenantPartyAdapter', () => ({ fetchTenantParty: vi.fn(async () => ({ name: 'Test MSP' })) }));
vi.mock('../src/services/invoiceBillingRecipientService', () => ({
  resolveInvoiceBillingRecipient: vi.fn(async () => ({
    recipientEmail: 'billing@example.test', recipientName: 'Billing Contact', recipientSource: 'billing_email',
  })),
}));
vi.mock('../src/services/pdfGenerationService', () => ({
  createPDFGenerationService: () => ({ generateAndStore: mocks.generateAndStore }),
  publishGeneratedDocumentsToClient: vi.fn(async () => undefined),
}));
vi.mock('../src/actions/invoiceQueries', () => ({
  getInvoiceForRendering: vi.fn(async () => ({
    invoice_id: 'invoice-1', invoice_number: 'INV-1', client_id: 'client-1', status: mocks.invoiceStatus,
    finalized_at: '2026-01-01T00:00:00Z', invoice_type: 'standard', total_amount: 10000,
    credit_applied: 0, currencyCode: 'USD', invoice_date: new Date(2026, 0, 1),
    due_date: new Date(2026, 0, 31), payment_method: null,
  })),
}));
vi.mock('../src/services/ensureInvoiceEmailLinks', () => ({
  ensureInvoiceEmailLinks: ({ html, text }: { html: string; text: string }) => ({ html, text }),
}));
vi.mock('../src/actions/invoiceEmailLinkContext', () => ({
  getInvoiceEmailLinkContext: vi.fn(async () => ({ paymentUrl: null, portalUrl: null })),
}));

import { sendInvoiceEmailAction } from '../src/actions/invoiceJobActions';

describe('sendInvoiceEmailAction status gate', () => {
  beforeEach(() => {
    mocks.sendEmail.mockClear();
    mocks.generateAndStore.mockClear();
    mocks.invoiceStatus = 'finalized';
  });

  it('refuses a cancelled invoice: typed reason, readable sentence, no PDF and no email', async () => {
    mocks.invoiceStatus = 'cancelled';
    const result: any = await sendInvoiceEmailAction(['invoice-1']);

    expect(result.successCount).toBe(0);
    expect(result.results[0]).toMatchObject({
      success: false,
      ok: false,
      reason: 'invoice-cancelled',
      error: expect.stringContaining('voided'),
    });
    expect(mocks.generateAndStore).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('sends a paid invoice labelled as a receipt that says it is paid', async () => {
    mocks.invoiceStatus = 'paid';
    const result: any = await sendInvoiceEmailAction(['invoice-1']);

    expect(result).toMatchObject({ successCount: 1, failureCount: 0 });
    const sent: any = (mocks.sendEmail.mock.calls[0] as any[])[0];
    expect(sent.subject).toMatch(/^Receipt for paid invoice INV-1/);
    expect(sent.html).toContain('has been paid');
  });

  it('keeps the normal invoice message for an open invoice', async () => {
    await sendInvoiceEmailAction(['invoice-1']);
    const sent: any = (mocks.sendEmail.mock.calls[0] as any[])[0];
    expect(sent.subject).not.toMatch(/Receipt/);
  });
});

describe('sendInvoiceEmailAction sender plumbing', () => {
  beforeEach(() => mocks.sendEmail.mockClear());

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
});
