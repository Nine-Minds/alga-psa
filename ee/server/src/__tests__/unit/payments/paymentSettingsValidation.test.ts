import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ update: vi.fn(), first: vi.fn() }));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u1' }, { tenant: 't1' }, ...args),
}));
vi.mock('@/lib/db', () => ({ createTenantKnex: vi.fn(async () => ({ knex: { fn: { now: vi.fn() }, raw: vi.fn() }, tenant: 't1' })) }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn(() => ({
    table: vi.fn(() => ({
      where: vi.fn(() => ({ first: mocks.first, update: mocks.update })),
    })),
  })),
}));
vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('stripe', () => ({ default: class {} }));
vi.mock('../../../lib/payments/stripeWebhookEvents', () => ({ STRIPE_WEBHOOK_EVENTS: [], reconcileStripeWebhookEvents: vi.fn() }));

import { updatePaymentSettingsAction } from '../../../lib/actions/payment-actions';

describe('updatePaymentSettingsAction — payment link expiration', () => {
  beforeEach(() => {
    mocks.update.mockReset().mockResolvedValue(1);
    mocks.first.mockReset().mockResolvedValue({ config_id: 'c1', settings: {} });
  });

  it.each([0, 721, 1.5, -5, '24', null, NaN])('rejects %j before touching the database', async (hours) => {
    const result: any = await (updatePaymentSettingsAction as any)({ paymentLinkExpirationHours: hours });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/between 1 and 720/);
    expect(mocks.first).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([1, 720])('accepts %s and persists it', async (hours) => {
    const result: any = await (updatePaymentSettingsAction as any)({ paymentLinkExpirationHours: hours });
    expect(result.success).toBe(true);
    expect(result.data.paymentLinkExpirationHours).toBe(hours);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
