import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createCheckoutSessionMock = vi.hoisted(() => vi.fn());
const getStripeClientMock = vi.hoisted(() => vi.fn());
const getOrImportCustomerMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../../../ee/server/src/lib/stripe/StripeService', () => ({
  getStripeService: () => ({
    getStripeClient: getStripeClientMock,
    getOrImportCustomer: getOrImportCustomerMock,
  }),
}));

describe('AI gateway checkout helpers', () => {
  beforeEach(() => {
    createCheckoutSessionMock.mockReset();
    getStripeClientMock.mockReset();
    getOrImportCustomerMock.mockReset();
    getStripeClientMock.mockResolvedValue({
      checkout: { sessions: { create: createCheckoutSessionMock } },
    });
    getOrImportCustomerMock.mockResolvedValue({
      stripe_customer_external_id: 'cus_hosted',
    });
    process.env.AI_ADDON_PRICE_ID = 'price_ai_monthly';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
  });

  afterEach(() => {
    delete process.env.AI_ADDON_PRICE_ID;
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it('creates a hosted subscription checkout that saves a payment method', async () => {
    createCheckoutSessionMock.mockResolvedValue({
      id: 'cs_addon',
      url: 'https://checkout.stripe.test/addon',
    });
    const { createAiAddonCheckoutSession } = await import('../../../../../../ee/server/src/lib/aiGateway/checkout');

    await expect(createAiAddonCheckoutSession('tenant-1')).resolves.toEqual({
      checkoutUrl: 'https://checkout.stripe.test/addon',
    });
    expect(createCheckoutSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      customer: 'cus_hosted',
      mode: 'subscription',
      line_items: [{ price: 'price_ai_monthly', quantity: 1 }],
      payment_method_collection: 'always',
      metadata: {
        tenant_id: 'tenant-1',
        deployment_type: 'hosted',
        purpose: 'ai-addon',
      },
      subscription_data: {
        metadata: {
          tenant_id: 'tenant-1',
          deployment_type: 'hosted',
          purpose: 'ai-addon',
        },
      },
    }));
  });

  it('creates a one-time hosted top-up checkout with webhook metadata', async () => {
    createCheckoutSessionMock.mockResolvedValue({
      id: 'cs_topup',
      url: 'https://checkout.stripe.test/topup',
    });
    const { createAiTopupCheckoutSession } = await import('../../../../../../ee/server/src/lib/aiGateway/checkout');

    await expect(createAiTopupCheckoutSession('tenant-2', 'price_pack_100')).resolves.toEqual({
      checkoutUrl: 'https://checkout.stripe.test/topup',
    });
    expect(createCheckoutSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      customer: 'cus_hosted',
      mode: 'payment',
      line_items: [{ price: 'price_pack_100', quantity: 1 }],
      metadata: {
        tenant_id: 'tenant-2',
        deployment_type: 'hosted',
        purpose: 'ai-topup',
      },
      payment_intent_data: expect.objectContaining({
        setup_future_usage: 'off_session',
      }),
    }));
  });
});
