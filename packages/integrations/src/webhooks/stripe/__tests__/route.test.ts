import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const handleWebhookEvent = vi.fn();
const verifyWebhookSignature = vi.fn();

vi.mock('@enterprise/lib/stripe/StripeService', () => ({
  getStripeService: () => ({ verifyWebhookSignature, handleWebhookEvent }),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => undefined,
    getTenantSecret: async () => undefined,
  })),
}));

import { POST } from '../index';

function makeRequest(): any {
  return {
    text: async () => JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated' }),
    headers: { get: (name: string) => (name.toLowerCase() === 'stripe-signature' ? 't=1,v1=x' : null) },
  };
}

describe('POST /api/webhooks/stripe', () => {
  const prevEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    handleWebhookEvent.mockReset();
    verifyWebhookSignature.mockReset();
    verifyWebhookSignature.mockResolvedValue({
      id: 'evt_1',
      type: 'customer.subscription.updated',
      created: 1,
      livemode: false,
    });
  });

  afterEach(() => {
    if (prevEdition === undefined) delete process.env.NEXT_PUBLIC_EDITION;
    else process.env.NEXT_PUBLIC_EDITION = prevEdition;
  });

  it('returns 5xx for a retryable appliance lifecycle error so Stripe retries', async () => {
    const err = Object.assign(new Error('alga-license down'), {
      name: 'ApplianceLifecycleSyncError',
      retryable: true,
    });
    handleWebhookEvent.mockRejectedValue(err);
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ received: true, processed: false, retryable: true });
  });

  it('keeps returning 200 processed:false for a plain (hosted) processing error', async () => {
    handleWebhookEvent.mockRejectedValue(new Error('boom'));
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ received: true, processed: false });
    expect(body.retryable).toBeUndefined();
  });

  it('returns 200 processed:true on success', async () => {
    handleWebhookEvent.mockResolvedValue(undefined);
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, processed: true });
  });
});
