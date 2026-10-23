import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPaymentLink: vi.fn(),
  PaymentRedirect: vi.fn(() => null),
  PaymentUnavailable: vi.fn(() => null),
}));

vi.mock('@alga-psa/client-portal/actions/clientPaymentActions', () => ({
  getClientPortalInvoicePaymentLink: mocks.getPaymentLink,
}));
vi.mock('@alga-psa/client-portal/components', () => ({
  PaymentRedirect: mocks.PaymentRedirect,
  PaymentUnavailable: mocks.PaymentUnavailable,
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import PayInvoicePage from './page';

describe('client portal direct-pay route', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['check', 'bank_transfer'])('renders unavailable instead of redirecting %s invoices to Stripe', async (method) => {
    mocks.getPaymentLink.mockResolvedValue({
      success: false,
      error: { code: 'offline_payment_method', message: 'Offline payment', retryable: false },
    });

    const result = await PayInvoicePage({ params: Promise.resolve({ invoiceId: 'invoice-1' }) });

    expect(mocks.getPaymentLink).toHaveBeenCalledWith('invoice-1');
    expect(result.type).toBe(mocks.PaymentUnavailable);
    expect(result.props.code).toBe('offline_payment_method');
    expect(mocks.PaymentRedirect).not.toHaveBeenCalled();
  });

  it.each(['credit_card', null])('keeps the Stripe redirect route available for %s snapshots', async () => {
    mocks.getPaymentLink.mockResolvedValue({
      success: true,
      data: { paymentUrl: 'https://checkout.test/session' },
    });

    const result = await PayInvoicePage({ params: Promise.resolve({ invoiceId: 'invoice-1' }) });

    expect(result.type).toBe(mocks.PaymentRedirect);
    expect(result.props.url).toBe('https://checkout.test/session');
    expect(mocks.PaymentUnavailable).not.toHaveBeenCalled();
  });
});
