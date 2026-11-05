import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { secretProvider, stripeMock, configRow, persistenceFailure, customerRetrieve } = vi.hoisted(() => ({
  secretProvider: { getTenantSecret: vi.fn(), getAppSecret: vi.fn() },
  stripeMock: vi.fn(),
  persistenceFailure: { value: false },
  customerRetrieve: vi.fn(),
  configRow: { config_id: 'cfg-1', tenant: 't1', provider_type: 'stripe', is_enabled: true, credentials_vault_path: 'tenant/t1/stripe_payment_secret_key', configuration: { publishable_key: 'pk_test', stripe_account_id: 'acct_bound' } },
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => ({ transaction: async (fn: any) => fn({ fn: { now: () => new Date() } }) })),
  tenantDb: vi.fn(() => ({ table: () => ({ where: () => ({ first: async () => configRow, forUpdate: () => ({ first: async () => configRow }), update: async (patch: any) => { if (persistenceFailure.value) return 0; Object.assign(configRow, patch); return 1; } }) }) })),
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
    customerRetrieve.mockReset();
    stripeMock.mockImplementation(function () { return { accounts: { retrieve: vi.fn().mockResolvedValue({ id: 'acct_bound' }) }, customers: { retrieve: customerRetrieve } }; });
    process.env.STRIPE_SECRET_KEY = 'sk_test_platform_env';
    configRow.configuration.stripe_account_id = 'acct_bound';
    configRow.credentials_vault_path = 'tenant/t1/stripe_payment_secret_key';
    persistenceFailure.value = false;
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
    expect(configRow.configuration.stripe_account_id).toBe('acct_bound');
  });

  it('binds an unbound tenant config only after verifying and persisting the account', async () => {
    configRow.configuration.stripe_account_id = '';
    await expect((new StripePaymentProvider('t1') as any).getStripe()).resolves.toBeTruthy();
    expect(configRow.configuration.stripe_account_id).toBe('acct_bound');
  });

  it('fails closed when durable first-use binding persistence fails', async () => {
    configRow.configuration.stripe_account_id = '';
    persistenceFailure.value = true;
    await expect(new StripePaymentProvider('t1').getCustomerImportSnapshot('cus_1')).rejects.toThrow('Could not persist verified Stripe account binding');
    expect(configRow.configuration.stripe_account_id).toBe('');
    expect(customerRetrieve).not.toHaveBeenCalled();
  });

  it('does not replace a binding established by a concurrent first use', async () => {
    configRow.configuration.stripe_account_id = '';
    stripeMock.mockImplementation(function () { return { accounts: { retrieve: vi.fn().mockImplementation(async () => {
      configRow.configuration.stripe_account_id = 'acct_other';
      return { id: 'acct_bound' };
    }) } }; });
    await expect((new StripePaymentProvider('t1') as any).getStripe()).rejects.toMatchObject({ code: 'stripe-import/account-mismatch' });
    expect(configRow.configuration.stripe_account_id).toBe('acct_other');
  });

  it('fails closed if credentials are changed while account identity is being verified', async () => {
    configRow.configuration.stripe_account_id = '';
    stripeMock.mockImplementation(function () { return { accounts: { retrieve: vi.fn().mockImplementation(async () => {
      configRow.credentials_vault_path = 'tenant/t1/other_key';
      return { id: 'acct_bound' };
    }) } }; });
    await expect((new StripePaymentProvider('t1') as any).getStripe()).rejects.toThrow('Stripe configuration changed during account verification');
    expect(configRow.configuration.stripe_account_id).toBe('');
  });

  it('does not bind a legacy row when its selected Vault credential changes in place', async () => {
    configRow.configuration.stripe_account_id = '';
    let selectedKeyReads = 0;
    secretProvider.getTenantSecret.mockImplementation(async (_tenant: string, name: string) => {
      if (name === 'stripe_payment_secret_key') {
        selectedKeyReads++;
        return selectedKeyReads === 1 ? 'sk_test_tenant' : 'sk_test_replaced';
      }
      return null;
    });

    await expect((new StripePaymentProvider('t1') as any).getStripe())
      .rejects.toThrow('Stripe credentials changed during account verification');
    expect(selectedKeyReads).toBe(2);
    expect(configRow.configuration.stripe_account_id).toBe('');
  });
});
