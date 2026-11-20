import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { StripePaymentProvider } from '../../../lib/payments/StripePaymentProvider';

const customer = {
  id: 'cus_1', object: 'customer', email: 'tenant@example.test', name: 'Tenant Customer',
  created: 1, currency: 'usd', metadata: {}, invoice_settings: { default_payment_method: null },
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': 'req_stub' },
  });
}

function providerWithTransport(fetchStub: (url: URL) => Response | Promise<Response>) {
  const stripe = new Stripe('sk_test_stub', {
    httpClient: Stripe.createFetchHttpClient((input: string | URL | Request) => fetchStub(new URL(String(input)))),
    maxNetworkRetries: 0,
  });
  const provider = new StripePaymentProvider('tenant_1');
  (provider as any).stripe = stripe;
  (provider as any).initPromise = Promise.resolve();
  return provider;
}

describe('StripePaymentProvider paginated permission handling', () => {
  it('preserves the installed SDK pagination helpers for customer import listing', async () => {
    const requests: URL[] = [];
    const provider = providerWithTransport((url) => {
      requests.push(url);
      const isSecondPage = url.searchParams.has('starting_after');
      return response({
        object: 'list', data: [isSecondPage ? { ...customer, id: 'cus_2' } : customer],
        has_more: !isSecondPage, url: '/v1/customers',
      });
    });

    const result = await provider.listCustomersForImport(5);
    expect(result.customers.map(({ id }) => id)).toEqual(['cus_1', 'cus_2']);
    expect(result.truncated).toBe(false);
    expect(requests).toHaveLength(2);
  });

  it('loads a customer import snapshot through SDK pagination', async () => {
    const provider = providerWithTransport((url) => {
      if (url.pathname === '/v1/customers/cus_1') return response(customer);
      if (url.pathname === '/v1/customers/cus_1/payment_methods') return response({ object: 'list', data: [], has_more: false, url: url.pathname });
      if (url.pathname === '/v1/setup_intents' || url.pathname === '/v1/payment_intents') return response({ object: 'list', data: [], has_more: false, url: url.pathname });
      throw new Error(`Unexpected Stripe request ${url.pathname}`);
    });

    await expect(provider.getCustomerImportSnapshot('cus_1')).resolves.toMatchObject({
      id: 'cus_1', email: 'tenant@example.test', paymentMethods: [],
    });
  });

  it('translates permission denial raised while fetching a later snapshot page', async () => {
    const provider = providerWithTransport((url) => {
      if (url.pathname === '/v1/customers/cus_1') return response(customer);
      if (url.pathname === '/v1/customers/cus_1/payment_methods' || url.pathname === '/v1/payment_intents') {
        return response({ object: 'list', data: [], has_more: false, url: url.pathname });
      }
      if (url.pathname === '/v1/setup_intents' && !url.searchParams.has('starting_after')) {
        return response({ object: 'list', data: [{ id: 'seti_1', object: 'setup_intent', status: 'succeeded', usage: 'off_session', payment_method: 'pm_1' }], has_more: true, url: url.pathname });
      }
      if (url.pathname === '/v1/setup_intents') {
        return response({ error: { type: 'invalid_request_error', message: 'Permission denied.' } }, 403);
      }
      throw new Error(`Unexpected Stripe request ${url.pathname}`);
    });

    await expect(provider.getCustomerImportSnapshot('cus_1')).rejects.toThrow(
      'Stripe capability saved-cards-auto-pay, customer-import is unavailable: missing permission setup_intent_read.',
    );
  });
});
