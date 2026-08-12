/**
 * Unit tests for hasEnabledPaymentProvider (packages/billing/src/actions/paymentActions.ts).
 *
 * Every provider call in the billing payment-action layer runs through the
 * `runPaymentServiceCall` boundary: non-`PaymentLinkError` failures are
 * rethrown as a `PaymentLinkError` with the native error preserved as `cause`
 * (server-side cause retention), while existing `PaymentLinkError`s pass
 * through untouched. These tests pin both halves of that contract for
 * `hasEnabledProvider`, whose value determines whether invoice emails carry
 * payment links.
 *
 * The only seams exercised are auth (resolved via the `@alga-psa/auth/getCurrentUser`
 * specifier that billing's authHelpers imports), the CE->EE payment-module
 * redirect (`@enterprise/lib/payments`), and the logger.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PaymentLinkError } from '../../src/actions/paymentLinkError';

const enterpriseState = vi.hoisted(() => ({
  paymentService: undefined as any,
}));

const authState = vi.hoisted(() => ({
  currentUser: undefined as any,
}));

const loggerState = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

// '@enterprise/lib/payments' is not resolvable in the OSS test environment;
// register a virtual mock whose PaymentService.create returns the service
// under test.
vi.mock('@enterprise/lib/payments', () => ({
  PaymentService: {
    create: vi.fn(async () => enterpriseState.paymentService),
  },
  createStripePaymentProvider: vi.fn(),
}));

// hasEnabledPaymentProvider resolves the actor through the
// '@alga-psa/auth/getCurrentUser' subpath specifier (see billing authHelpers);
// drive its tenant from per-test state.
vi.mock('@alga-psa/auth/getCurrentUser', () => ({
  getCurrentUser: vi.fn(async () => authState.currentUser),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    error: (...args: unknown[]) => loggerState.error(...args),
    warn: (...args: unknown[]) => loggerState.warn(...args),
    info: (...args: unknown[]) => loggerState.info(...args),
    debug: (...args: unknown[]) => loggerState.debug(...args),
  },
}));

import { hasEnabledPaymentProvider } from '../../src/actions/paymentActions';

describe('hasEnabledPaymentProvider', () => {
  beforeEach(() => {
    enterpriseState.paymentService = {
      hasEnabledProvider: vi.fn(async () => true),
    };
    authState.currentUser = { user_id: 'unit-test-user', tenant: 'unit-test-tenant' };
    loggerState.error.mockClear();
    loggerState.warn.mockClear();
    vi.stubEnv('EDITION', 'ee');
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'enterprise');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the provider decision unchanged on the successful path', async () => {
    await expect(hasEnabledPaymentProvider()).resolves.toBe(true);

    enterpriseState.paymentService.hasEnabledProvider.mockResolvedValueOnce(false);
    await expect(hasEnabledPaymentProvider()).resolves.toBe(false);
  });

  it('wraps a non-PaymentLinkError provider failure, preserving the native error as cause', async () => {
    const nativeError = new Error('db connection refused at 10.0.0.5');
    enterpriseState.paymentService.hasEnabledProvider.mockRejectedValueOnce(nativeError);

    const promise = hasEnabledPaymentProvider();
    await expect(promise).rejects.toBeInstanceOf(PaymentLinkError);
    const error = await promise.catch((e: unknown) => e) as PaymentLinkError;
    expect(error.code).toBe('payment_link_creation_failed');
    expect(error.message).toBe('Failed to check payment provider');
    expect(error.cause).toBe(nativeError);
    expect((error.cause as Error).message).toBe('db connection refused at 10.0.0.5');
  });

  it('passes an existing PaymentLinkError through unchanged without double-wrapping', async () => {
    const original = new PaymentLinkError('payment_link_creation_failed', 'provider says no');
    enterpriseState.paymentService.hasEnabledProvider.mockRejectedValueOnce(original);

    const promise = hasEnabledPaymentProvider();
    await expect(promise).rejects.toBe(original);
    const error = await promise.catch((e: unknown) => e) as PaymentLinkError;
    expect(error).toBeInstanceOf(PaymentLinkError);
    expect(error.code).toBe('payment_link_creation_failed');
    expect(error.message).toBe('provider says no');
    expect(error.cause).toBeUndefined();
  });
});
