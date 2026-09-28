import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { EmulatorHost } from '@alga-psa/emulator-host';
import smtpSink from '../../../emulators/smtp-sink/src/index';

const mocks = vi.hoisted(() => ({
  invoiceById: new Map<string, any>(),
  sender: {
    sender_id: 'sender-billing', tenant: 'tenant-test', email_address: 'accounts@billing-profile.test',
    display_name: 'Accounts', verification_status: 'verified',
  },
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
  getConnection: vi.fn(async () => ({})),
  isTenantSuspended: vi.fn(async () => false),
  tenantDb: () => ({
    tenantJoin: () => undefined,
    table: (tableName: string) => {
      const query: any = {
        where: () => query,
        whereNull: () => query,
        tenantJoin: () => query,
        select: () => query,
        then: (resolve: (value: any) => unknown) => Promise.resolve(
          tableName === 'email_sender_addresses' ? [mocks.sender]
            : tableName === 'email_sender_routes' ? [{ tenant: 'tenant-test', route_type: 'mail_class', mail_class: 'billing', sender_id: mocks.sender.sender_id }]
            : [],
        ).then(resolve),
        first: async () => tableName === 'tenant_companies as tc' ? undefined
          : tableName === 'tenants' ? ({ client_name: 'Test MSP' })
          : tableName === 'tenant_email_settings' ? ({
          email_provider: 'smtp',
          provider_configs: [{ providerId: 'smtp-provider', providerType: 'smtp', isEnabled: true, config: { host: '127.0.0.1', port: Number(process.env.EMAIL_PORT), secure: false, from: process.env.EMAIL_FROM } }],
        }) : ({
          subject: 'Invoice {{invoice.number}}',
          html_content: '<p>{{invoice.invoiceDate}} / {{invoice.dueDate}}</p>',
          text_content: '{{invoice.invoiceDate}} / {{invoice.dueDate}}',
        }),
      };
      return query;
    },
  }),
}));
vi.mock('@alga-psa/core/logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
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
const testEnvironmentKeys = [
  'EMAIL_ENABLE', 'EMAIL_PROVIDER_TYPE', 'EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_FROM',
  'EMAIL_USERNAME', 'EMAIL_PASSWORD', 'NEXTAUTH_URL', 'TZ',
] as const;
const originalEnvironment = new Map(testEnvironmentKeys.map((key) => [key, process.env[key]]));

function invoice(invoiceId: string, paymentMethod: 'check' | 'bank_transfer') {
  return {
    invoice_id: invoiceId,
    invoice_number: invoiceId === 'invoice-check' ? 'PM-SMOKE-0925-CHECK' : 'PM-SMOKE-0925-BANK',
    client_id: 'client-test',
    // Match the PostgreSQL DATE parser's local-midnight Date boundary.
    invoice_date: new Date(2026, 9, 10),
    due_date: new Date(2026, 9, 10),
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
  const body = await response.json() as { result: Array<{ from: string; to: string[]; subject: string; html: string; text: string }> };
  return body.result;
}

beforeAll(async () => {
  const externalControlUrl = process.env.BILLING_EMAIL_TEST_SMTP_CONTROL_URL;
  if (process.env.BILLING_EMAIL_TEST_EXTERNAL_SMTP === 'true') {
    if (!externalControlUrl || !process.env.EMAIL_PORT) {
      throw new Error('External SMTP capture requires BILLING_EMAIL_TEST_SMTP_CONTROL_URL and EMAIL_PORT');
    }
    controlUrl = externalControlUrl;
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
  for (const key of testEnvironmentKeys) {
    const value = originalEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(async () => {
  mocks.invoiceById.clear();
  mocks.invoiceById.set('invoice-check', invoice('invoice-check', 'check'));
  mocks.invoiceById.set('invoice-bank', invoice('invoice-bank', 'bank_transfer'));
  await fetch(`${controlUrl}/control/smtp-sink/reset`, { method: 'POST' });
});

describe('invoice email calendar dates and real SMTP delivery', () => {
  it.each(['UTC', 'America/New_York', 'Asia/Tokyo'])('%s preserves dates in recipient output and delivered emails', async (timezone) => {
    process.env.TZ = timezone;
    mocks.invoiceById.set('invoice-check', invoice('invoice-check', 'check'));
    mocks.invoiceById.set('invoice-bank', invoice('invoice-bank', 'bank_transfer'));

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
    if (process.env.BILLING_EMAIL_TEST_EXTERNAL_SMTP === 'true') {
      console.info('[billing-email-smtp-capture]', JSON.stringify(emails.map((email) => {
        const body = `${email.html}\n${email.text}`;
        return {
          subject: email.subject,
          portalLinkRetained: body.includes('https://portal.example.test/client-portal/billing?tab=invoices'),
          stripePayNowPresent: /pay now|checkout\.stripe/i.test(body),
        };
      })));
    }
    for (const email of emails) {
      expect(email.from).toBe('"Accounts" <accounts@billing-profile.test>');
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
