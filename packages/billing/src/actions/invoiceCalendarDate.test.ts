import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { EmulatorHost } from '@alga-psa/emulator-host';
import smtpSink from '../../../emulators/smtp-sink/src/index';

const mocks = vi.hoisted(() => ({
  invoiceById: new Map<string, any>(),
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  generateAndStore: vi.fn(async ({ invoiceId }: { invoiceId: string }) => ({ file_id: `file-${invoiceId}` })),
  downloadFile: vi.fn(async () => ({ buffer: Buffer.from('%PDF-test') })),
  getPaymentService: vi.fn(async () => ({
    hasEnabledProvider: vi.fn(async () => true),
    getPaymentSettings: vi.fn(async () => ({ paymentLinksInEmails: true })),
    getOrCreatePaymentLink: vi.fn(async () => ({ url: 'https://checkout.stripe.test/pay' })),
  })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => unknown) => (...args: any[]) => action(
    { user_id: 'billing-user' }, { tenant: 'tenant-test' }, ...args,
  ),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  tenantDb: () => ({
    table: () => {
      const query: any = {
        where: () => query,
        first: async () => ({
          subject: 'Invoice {{invoice.number}}',
          html_content: '<p>{{invoice.invoiceDate}} / {{invoice.dueDate}}</p>',
          text_content: '{{invoice.invoiceDate}} / {{invoice.dueDate}}',
        }),
      };
      return query;
    },
  }),
}));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/storage/StorageService', () => ({ StorageService: { downloadFile: mocks.downloadFile } }));
vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({
  resolveEmailLocale: vi.fn(async () => 'en-US'),
  getTenantDefaultLocale: vi.fn(async () => 'en-US'),
}));
vi.mock('@alga-psa/shared/billingClients/clients', () => ({
  getClientById: vi.fn(async () => ({ client_id: 'client-test', client_name: 'Test Client' })),
}));
vi.mock('../lib/adapters/tenantPartyAdapter', () => ({
  fetchTenantParty: vi.fn(async () => ({ name: 'Test MSP' })),
}));
vi.mock('../services/invoiceBillingRecipientService', () => ({
  resolveInvoiceBillingRecipient: vi.fn(async () => ({
    recipientEmail: 'billing@example.test',
    recipientName: 'Billing Contact',
    recipientSource: 'billing_email',
  })),
}));
vi.mock('../services/pdfGenerationService', () => ({
  createPDFGenerationService: () => ({ generateAndStore: mocks.generateAndStore }),
  publishGeneratedDocumentsToClient: vi.fn(async () => undefined),
}));
vi.mock('./invoiceQueries', () => ({
  getInvoiceForRendering: vi.fn(async (invoiceId: string) => mocks.invoiceById.get(invoiceId)),
}));
vi.mock('@alga-psa/tenancy/server', () => ({
  getPortalDomainStatusForTenant: vi.fn(async () => ({ status: 'none' })),
}));
vi.mock('./paymentActions', () => ({
  getPaymentService: mocks.getPaymentService,
  expireInvoicePaymentLinksForTerminalStatus: vi.fn(),
}));
vi.mock('@alga-psa/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/email')>();
  return {
    ...actual,
    embedBrandLogo: vi.fn(async (html: string) => ({ html, attachments: [] })),
  };
});

import { getInvoiceEmailRecipientAction, sendInvoiceEmailAction } from './invoiceJobActions';

let smtp: EmulatorHost;
let smtpPort: number;
let controlUrl: string;
const originalTimezone = process.env.TZ;

function invoice(invoiceId: string, paymentMethod: 'check' | 'bank_transfer') {
  return {
    invoice_id: invoiceId,
    invoice_number: invoiceId === 'invoice-check' ? 'PM-SMOKE-0925-CHECK' : 'PM-SMOKE-0925-BANK',
    client_id: 'client-test',
    // PostgreSQL's DATE parser returns Date objects through this model path.
    // Other invoiceQueries paths convert date strings to Temporal.PlainDate.
    invoice_date: new Date('2026-10-10T00:00:00.000Z'),
    due_date: new Date('2026-10-10T00:00:00.000Z'),
    status: 'finalized',
    finalized_at: '2026-10-10T12:00:00Z',
    invoice_type: 'standard',
    total_amount: 12_500,
    credit_applied: 0,
    currencyCode: 'USD',
    payment_method: paymentMethod,
    invoice_charges: [],
  };
}

async function capturedEmails() {
  const response = await fetch(`${controlUrl}/control/smtp-sink/state/emails`);
  const body = await response.json() as { result: Array<{ to: string[]; subject: string; html: string; text: string }> };
  return body.result;
}

beforeAll(async () => {
  controlUrl = process.env.SMTP_SINK_CONTROL_URL ?? '';
  if (controlUrl) {
    smtpPort = Number(process.env.EMAIL_PORT);
  } else {
    smtp = new EmulatorHost({ emulators: [smtpSink], controlPort: 0, ports: { 'smtp-sink': 0 } });
    const started = await smtp.start();
    smtpPort = started.ports['smtp-sink'];
    controlUrl = `http://127.0.0.1:${started.controlPort}`;
  }
  process.env.EMAIL_ENABLE = 'true';
  process.env.EMAIL_PROVIDER_TYPE = 'smtp';
  process.env.EMAIL_HOST = '127.0.0.1';
  process.env.EMAIL_PORT = String(smtpPort);
  process.env.EMAIL_FROM = 'noreply@billing-profile.test';
  process.env.NEXTAUTH_URL = 'https://portal.example.test';
  delete process.env.EMAIL_USERNAME;
  delete process.env.EMAIL_PASSWORD;
});

afterAll(async () => {
  await smtp?.stop();
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

beforeEach(async () => {
  mocks.invoiceById.clear();
  mocks.invoiceById.set('invoice-check', invoice('invoice-check', 'check'));
  mocks.invoiceById.set('invoice-bank', invoice('invoice-bank', 'bank_transfer'));
  await fetch(`${controlUrl}/control/smtp-sink/reset`, { method: 'POST' });
});

describe('invoice email calendar dates and real SMTP delivery', () => {
  it.each(['UTC', 'America/New_York'])('%s preserves dates in recipient output and delivered emails', async (timezone) => {
    process.env.TZ = timezone;

    const recipientResult = await getInvoiceEmailRecipientAction(['invoice-check']) as any;
    expect(recipientResult.errors).toEqual([]);
    expect(recipientResult.recipients[0]).toMatchObject({
      invoiceDate: 'October 10, 2026',
      dueDate: 'October 10, 2026',
    });

    const sent = await sendInvoiceEmailAction(['invoice-check', 'invoice-bank']) as any;
    expect(sent).toMatchObject({ successCount: 2, failureCount: 0 });

    const emails = await capturedEmails();
    expect(emails).toHaveLength(2);
    for (const email of emails) {
      expect(email.to).toContain('billing@example.test');
      expect(email.html).toContain('October 10, 2026 / October 10, 2026');
      expect(email.text).toContain('October 10, 2026 / October 10, 2026');
      expect(email.html).toContain('https://portal.example.test/client-portal/billing?tab=invoices');
      expect(email.text).toContain('https://portal.example.test/client-portal/billing?tab=invoices');
      expect(`${email.html}\n${email.text}`).not.toMatch(/pay now|checkout\.stripe/i);
    }
    expect(mocks.getPaymentService).not.toHaveBeenCalled();
    expect(emails.map((email) => email.subject)).toEqual(expect.arrayContaining([
      'Invoice PM-SMOKE-0925-CHECK',
      'Invoice PM-SMOKE-0925-BANK',
    ]));
  });

  it('also formats PlainDate values returned by invoiceQueries date adapters', () => {
    const adaptedInvoice = invoice('invoice-check', 'check');
    adaptedInvoice.invoice_date = Temporal.PlainDate.from('2026-10-10') as any;
    adaptedInvoice.due_date = Temporal.PlainDate.from('2026-10-10') as any;
    mocks.invoiceById.set('invoice-adapted', adaptedInvoice);
    process.env.TZ = 'America/New_York';
    return getInvoiceEmailRecipientAction(['invoice-adapted']).then((result: any) => {
      expect(result.recipients[0]).toMatchObject({
        invoiceDate: 'October 10, 2026',
        dueDate: 'October 10, 2026',
      });
    });
  });
});
