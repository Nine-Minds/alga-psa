/**
 * Unit tests for processStripePaymentWebhookPayload (packages/billing/src/actions/paymentWebhookHelpers.ts).
 *
 * This helper is the CE/EE seam in front of the enterprise payment stack:
 * it gates on edition env vars, dynamically loads '@enterprise/lib/payments',
 * and must never leak internal errors to the (webhook) caller.
 *
 * The actual Stripe payload parsing / signature verification lives in the
 * enterprise provider, so here we verify the gating, delegation, and
 * error-shielding contract of the billing-side helper.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const enterpriseState = vi.hoisted(() => ({
  PaymentService: undefined as any,
  createStripePaymentProvider: undefined as any,
}));

// '@enterprise/lib/payments' is not resolvable in the OSS test environment;
// register a virtual mock whose exports are driven by per-test state.
vi.mock('@enterprise/lib/payments', () => ({
  get PaymentService() {
    return enterpriseState.PaymentService;
  },
  get createStripePaymentProvider() {
    return enterpriseState.createStripePaymentProvider;
  },
}));

import { processStripePaymentWebhookPayload } from '../../src/actions/paymentWebhookHelpers';

const RAW_PAYLOAD = JSON.stringify({
  id: 'evt_123',
  type: 'payment_intent.succeeded',
  data: { object: { id: 'pi_123', amount: 12345, currency: 'usd' } },
});

describe('processStripePaymentWebhookPayload', () => {
  beforeEach(() => {
    enterpriseState.PaymentService = undefined;
    enterpriseState.createStripePaymentProvider = undefined;
    vi.stubEnv('EDITION', '');
    vi.stubEnv('NEXT_PUBLIC_EDITION', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects processing on community edition without touching the enterprise module', async () => {
    const createSpy = vi.fn();
    enterpriseState.PaymentService = { create: createSpy };
    enterpriseState.createStripePaymentProvider = vi.fn();

    const result = await processStripePaymentWebhookPayload('tenant-1', RAW_PAYLOAD);

    expect(result).toEqual({ success: false, error: 'Payment integration not available' });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('returns not-available when EDITION=ee but the enterprise module exports are missing', async () => {
    vi.stubEnv('EDITION', 'ee');
    // PaymentService / createStripePaymentProvider stay undefined.

    const result = await processStripePaymentWebhookPayload('tenant-1', RAW_PAYLOAD);

    expect(result).toEqual({ success: false, error: 'Payment integration not available' });
  });

  it('delegates a valid payload to the enterprise stack and returns its result verbatim', async () => {
    vi.stubEnv('EDITION', 'ee');

    const parsedEvent = { id: 'evt_123', type: 'payment_intent.succeeded' };
    const processingResult = { success: true, eventId: 'evt_123', alreadyProcessed: false };

    const processWebhookEvent = vi.fn().mockResolvedValue(processingResult);
    const parseWebhookEvent = vi.fn().mockReturnValue(parsedEvent);
    const create = vi.fn().mockResolvedValue({ processWebhookEvent });
    const providerFactory = vi.fn().mockReturnValue({ parseWebhookEvent });

    enterpriseState.PaymentService = { create };
    enterpriseState.createStripePaymentProvider = providerFactory;

    const result = await processStripePaymentWebhookPayload('tenant-42', RAW_PAYLOAD);

    expect(create).toHaveBeenCalledWith('tenant-42');
    expect(providerFactory).toHaveBeenCalledWith('tenant-42');
    // The raw payload string must be handed to the provider untouched
    // (signature verification depends on the exact bytes).
    expect(parseWebhookEvent).toHaveBeenCalledWith(RAW_PAYLOAD);
    expect(processWebhookEvent).toHaveBeenCalledWith(parsedEvent);
    expect(result).toBe(processingResult);
  });

  it('also honors the NEXT_PUBLIC_EDITION=enterprise gate', async () => {
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'enterprise');

    const processWebhookEvent = vi.fn().mockResolvedValue({ success: true });
    enterpriseState.PaymentService = {
      create: vi.fn().mockResolvedValue({ processWebhookEvent }),
    };
    enterpriseState.createStripePaymentProvider = vi.fn().mockReturnValue({
      parseWebhookEvent: vi.fn().mockReturnValue({ id: 'evt_9' }),
    });

    const result = await processStripePaymentWebhookPayload('tenant-1', RAW_PAYLOAD);

    expect(result).toEqual({ success: true });
  });

  it('maps a malformed payload (parse failure) to a generic error without processing the event', async () => {
    vi.stubEnv('EDITION', 'ee');

    const processWebhookEvent = vi.fn();
    enterpriseState.PaymentService = {
      create: vi.fn().mockResolvedValue({ processWebhookEvent }),
    };
    enterpriseState.createStripePaymentProvider = vi.fn().mockReturnValue({
      parseWebhookEvent: vi.fn(() => {
        throw new Error('No webhook payload was provided');
      }),
    });

    const result = await processStripePaymentWebhookPayload('tenant-1', 'not-json{{{');

    expect(result).toEqual({ success: false, error: 'Payment webhook processing failed' });
    expect(processWebhookEvent).not.toHaveBeenCalled();
  });

  it('shields service-initialization failures behind a generic error message', async () => {
    vi.stubEnv('EDITION', 'ee');

    enterpriseState.PaymentService = {
      create: vi.fn().mockRejectedValue(new Error('db connection refused at 10.0.0.5')),
    };
    enterpriseState.createStripePaymentProvider = vi.fn().mockReturnValue({
      parseWebhookEvent: vi.fn().mockReturnValue({ id: 'evt_123' }),
    });

    const result = await processStripePaymentWebhookPayload('tenant-1', RAW_PAYLOAD);

    expect(result).toEqual({ success: false, error: 'Payment webhook processing failed' });
    // Internal details must not leak into the webhook response.
    expect(JSON.stringify(result)).not.toContain('10.0.0.5');
  });

  // NOTE (suspected product bug, intentionally NOT asserted here):
  // paymentWebhookHelpers.ts:57 does `return paymentService.processWebhookEvent(...)`
  // without `await` inside the try block, so an async rejection from
  // processWebhookEvent escapes the catch at line 58 and propagates raw to the
  // webhook route instead of being mapped to the generic
  // 'Payment webhook processing failed' result like every other failure mode.
});
