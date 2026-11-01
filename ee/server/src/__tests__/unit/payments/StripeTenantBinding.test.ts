import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { secretProvider, stripeMock, configRow } = vi.hoisted(() => ({
  secretProvider: { getTenantSecret: vi.fn(), getAppSecret: vi.fn() },
  stripeMock: vi.fn(),
  configRow: { credentials_vault_path: 'tenant/t1/stripe_payment_secret_key', configuration: { publishable_key: 'pk_test', stripe_account_id: 'acct_bound' } },
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => ({})),
  tenantDb: vi.fn(() => ({ table: () => ({ where: () => ({ first: async () => configRow }) }) })),
}));
vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: vi.fn(async () => secretProvider) }));
vi.mock('stripe', () => ({ default: stripeMock }));

import { StripePaymentProvider } from '../../../lib/payments/StripePaymentProvider';

const originalStripeSecretKey = process.env.STRIPE_SECRET_KEY;

describe('Stripe tenant account binding', () => {
  afterEach(() => {
    if (originalStripeSecretKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalStripeSecretKey;
  });
  beforeEach(() => {
    vi.clearAllMocks();
    secretProvider.getTenantSecret.mockResolvedValue('sk_test_tenant');
    secretProvider.getAppSecret.mockResolvedValue('sk_test_platform');
    stripeMock.mockImplementation(function () { return { accounts: { retrieve: vi.fn().mockResolvedValue({ id: 'acct_bound' }) } }; });
    process.env.STRIPE_SECRET_KEY = 'sk_test_platform_env';
    configRow.configuration.stripe_account_id = 'acct_bound';
  });

  it('never consults platform secrets when tenant credentials are missing', async () => {
    secretProvider.getTenantSecret.mockResolvedValue(null);
    await expect((new StripePaymentProvider('t1') as any).getStripe()).rejects.toThrow('stripe-import/no-tenant-stripe-account');
    expect(secretProvider.getAppSecret).not.toHaveBeenCalled();
    expect(stripeMock).not.toHaveBeenCalled();
  });

  it('verifies the durable account binding before returning a usable Stripe client', async () => {
    await expect((new StripePaymentProvider('t1') as any).getStripe()).resolves.toBeTruthy();
    expect(stripeMock).toHaveBeenCalledWith('sk_test_tenant', expect.any(Object));
  });

  it('rejects credentials whose verified account differs from the durable binding', async () => {
    stripeMock.mockImplementation(function () { return { accounts: { retrieve: vi.fn().mockResolvedValue({ id: 'acct_other' }) } }; });
    await expect((new StripePaymentProvider('t1') as any).getStripe()).rejects.toMatchObject({ code: 'stripe-import/account-mismatch' });
  });

  it('rejects an unbound tenant config before constructing a Stripe client', async () => {
    configRow.configuration.stripe_account_id = '';
    await expect((new StripePaymentProvider('t1') as any).getStripe()).rejects.toMatchObject({ code: 'stripe-import/account-unbound' });
    expect(stripeMock).not.toHaveBeenCalled();
  });
});
