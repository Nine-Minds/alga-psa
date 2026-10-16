import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: vi.fn() }));

const svc = vi.hoisted(() => ({
  verifyWebhookSignature: vi.fn(),
  handleWebhookEvent: vi.fn(),
}));
vi.mock('@enterprise/lib/stripe/StripeService', () => ({ getStripeService: () => svc }));

import { POST } from '../index';

function request(): any {
  return { text: async () => '{}', headers: { get: () => 'sig' } };
}

describe('POST /api/webhooks/stripe error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    svc.verifyWebhookSignature.mockResolvedValue({ id: 'evt_1', type: 'customer.subscription.updated', created: 1, livemode: false });
  });

  it('returns 5xx for a retryable appliance lifecycle error so Stripe re-delivers', async () => {
    // Plain object/Error with the structural discriminator: no shared class identity.
    const err = Object.assign(new Error('license down'), { name: 'ApplianceLifecycleRetryableError', retryable: true });
    svc.handleWebhookEvent.mockRejectedValue(err);
    const res = await POST(request());
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await res.json()).toMatchObject({ processed: false, retryable: true });
  });

  it('keeps 200 {processed:false} for any other error', async () => {
    svc.handleWebhookEvent.mockRejectedValue(new Error('boom'));
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, processed: false });
  });

  it('does not treat a name match without retryable=true as retryable', async () => {
    svc.handleWebhookEvent.mockRejectedValue(Object.assign(new Error('x'), { name: 'ApplianceLifecycleRetryableError' }));
    expect((await POST(request())).status).toBe(200);
  });
});
