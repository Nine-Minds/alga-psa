import { describe, expect, it, vi } from 'vitest';

const { gateway, getConnection } = vi.hoisted(() => ({
  gateway: {
    getVerifiedAccountId: vi.fn(),
    listCustomersForImport: vi.fn(),
    getCustomerImportSnapshot: vi.fn(),
    updateCustomerMetadata: vi.fn(),
    updateSavedPaymentMethodMetadata: vi.fn(),
    capabilities: () => ({ supportedCurrencies: ['USD'] }),
  },
  getConnection: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({ getConnection, tenantDb: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@alga-psa/billing/services/invoiceBillingRecipientService', () => ({ resolveInvoiceBillingRecipient: vi.fn() }));
vi.mock('../../../lib/payments/StripePaymentProvider', () => ({ createStripePaymentProvider: () => gateway }));

import { StripeCustomerImportService } from '../../../lib/payments/StripeCustomerImportService';

describe('Stripe import initialization account guard', () => {
  it.each(['stripe-import/no-tenant-stripe-account', 'stripe-import/account-unbound', 'stripe-import/account-mismatch'])('rejects %s before tenant DB or Stripe customer access', async (code) => {
    gateway.getVerifiedAccountId.mockRejectedValueOnce(new Error(code));
    await expect(StripeCustomerImportService.create('tenant-1')).rejects.toThrow(code);
    expect(getConnection).not.toHaveBeenCalled();
    expect(gateway.listCustomersForImport).not.toHaveBeenCalled();
    expect(gateway.getCustomerImportSnapshot).not.toHaveBeenCalled();
    expect(gateway.updateCustomerMetadata).not.toHaveBeenCalled();
    expect(gateway.updateSavedPaymentMethodMetadata).not.toHaveBeenCalled();
  });
});
