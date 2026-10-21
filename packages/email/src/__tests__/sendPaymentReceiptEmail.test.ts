import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tenantSendMock, templateCtor } = vi.hoisted(() => ({
  tenantSendMock: vi.fn(),
  templateCtor: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => ({})),
  runWithTenant: (_t: string, cb: () => Promise<unknown>) => cb(),
}));
vi.mock('../index', () => ({
  TenantEmailService: { getInstance: vi.fn(() => ({ sendEmail: tenantSendMock })) },
}));
vi.mock('../emailLocaleResolver', () => ({ resolveEmailLocale: vi.fn(async () => 'en') }));
vi.mock('../templateProcessors', () => ({
  DatabaseTemplateProcessor: class {
    constructor(...args: unknown[]) { templateCtor(...args); }
  },
}));

import { sendPaymentReceiptEmail } from '../sendPaymentReceiptEmail';

const params = {
  tenant: 'tenant-1',
  email: 'billing@acme.test',
  clientId: 'client-1',
  clientName: 'Acme Corp',
  invoiceNumber: 'INV-000123',
  amountMinor: 125000,
  currency: 'USD',
  paymentDate: new Date('2026-07-15T12:00:00Z'),
  paymentMethod: 'Stripe',
  invoiceUrl: 'https://app.example.test/client-portal/billing?tab=invoices&invoiceId=inv-1',
};

describe('sendPaymentReceiptEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantSendMock.mockResolvedValue({ success: true });
  });

  it('sends the payment-received template with its invoice.* variables via the tenant provider', async () => {
    await expect(sendPaymentReceiptEmail(params)).resolves.toBe(true);
    expect(templateCtor).toHaveBeenCalledWith(expect.anything(), 'payment-received');
    expect(tenantSendMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      to: 'billing@acme.test',
      mailClass: 'billing',
      locale: 'en',
      templateData: {
        invoice: {
          number: 'INV-000123',
          clientName: 'Acme Corp',
          amountPaid: '$1,250.00',
          paymentDate: 'July 15, 2026',
          paymentMethod: 'Stripe',
          url: params.invoiceUrl,
        },
      },
    }));
  });

  it('throws when the provider reports failure', async () => {
    tenantSendMock.mockResolvedValue({ success: false, error: 'rejected' });
    await expect(sendPaymentReceiptEmail(params)).rejects.toThrow('rejected');
  });
});
