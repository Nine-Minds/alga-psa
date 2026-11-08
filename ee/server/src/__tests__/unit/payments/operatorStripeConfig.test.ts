import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getAppSecret, stripeConstructor } = vi.hoisted(() => ({ getAppSecret: vi.fn(), stripeConstructor: vi.fn() }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: async () => ({ getAppSecret }) }));
vi.mock('stripe', () => ({ default: stripeConstructor }));

import { createOperatorStripeClient, getOperatorStripeConfig } from '../../../lib/payments/operatorStripeConfig';

const originalStripeSecretKey = process.env.STRIPE_SECRET_KEY;

describe('operator Stripe configuration', () => {
  afterEach(() => {
    if (originalStripeSecretKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalStripeSecretKey;
  });
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.STRIPE_SECRET_KEY;
    getAppSecret.mockImplementation(async (key: string) => ({
      stripe_secret_key: 'sk_test_platform', stripe_webhook_secret: 'whsec_saas',
      stripe_payment_webhook_secret: 'whsec_client_payments', stripe_publishable_key: 'pk_platform',
    }[key] ?? null));
    stripeConstructor.mockImplementation(function (key: string) { return { key }; });
  });

  it('preserves operator access to app credentials and platform environment fallback', async () => {
    await expect(getOperatorStripeConfig()).resolves.toMatchObject({ secretKey: 'sk_test_platform', webhookSecret: 'whsec_saas', publishableKey: 'pk_platform' });
    getAppSecret.mockResolvedValue(null);
    process.env.STRIPE_SECRET_KEY = 'sk_test_environment';
    await expect(createOperatorStripeClient()).resolves.toMatchObject({ key: 'sk_test_environment' });
    expect(stripeConstructor).toHaveBeenCalledWith('sk_test_environment', expect.any(Object));
  });
});
