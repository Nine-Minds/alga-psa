import { beforeEach, describe, expect, it, vi } from 'vitest';

const T = '0ad8e710-13bc-4e01-a6ca-3f8992978ae8';
const TENANT_URL = `https://app.example.com/api/webhooks/stripe/payments/${T}`;
const LEGACY_URL = 'https://app.example.com/api/webhooks/stripe/payments';

const stripeMock = {
  webhookEndpoints: { retrieve: vi.fn(), update: vi.fn(), create: vi.fn(), del: vi.fn() },
};
const dbUpdate = vi.fn();

vi.mock('stripe', () => ({ default: vi.fn().mockImplementation(function () { return stripeMock; }) }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({ getTenantSecret: vi.fn(async () => 'sk_test') })),
}));
vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => ({ fn: { now: () => 'NOW' } })),
  tenantDb: vi.fn(() => ({
    table: () => ({
      where: () => ({
        first: async () => ({ config_id: 'c1', configuration: { webhook_endpoint_id: 'we_1' } }),
        update: dbUpdate,
      }),
    }),
  })),
}));

import {
  reconcileAllStripeWebhookEndpoints,
  reconcileStripeWebhookEvents,
  STRIPE_WEBHOOK_EVENTS,
} from '../../../lib/payments/stripeWebhookEvents';

const opts = { baseUrl: 'https://app.example.com' };

describe('reconcileStripeWebhookEvents URL migration', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('migrates a legacy URL with update and no create; a second run makes no update', async () => {
    let live = { id: 'we_1', url: LEGACY_URL, enabled_events: [...STRIPE_WEBHOOK_EVENTS] };
    stripeMock.webhookEndpoints.retrieve.mockImplementation(async () => live);
    stripeMock.webhookEndpoints.update.mockImplementation(async (_id: string, p: any) => {
      live = { ...live, url: p.url, enabled_events: p.enabled_events };
      return live;
    });

    expect(await reconcileStripeWebhookEvents(T, opts)).toBe(true);
    expect(stripeMock.webhookEndpoints.update).toHaveBeenCalledTimes(1);
    expect(stripeMock.webhookEndpoints.update).toHaveBeenCalledWith('we_1', { url: TENANT_URL, enabled_events: STRIPE_WEBHOOK_EVENTS });
    expect(stripeMock.webhookEndpoints.create).not.toHaveBeenCalled();

    expect(await reconcileStripeWebhookEvents(T, opts)).toBe(true);
    expect(stripeMock.webhookEndpoints.update).toHaveBeenCalledTimes(1);
  });

  it('logs and skips a missing or deleted endpoint without creating one', async () => {
    stripeMock.webhookEndpoints.retrieve.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'resource_missing' }));
    expect(await reconcileStripeWebhookEvents(T, opts)).toBe(false);
    stripeMock.webhookEndpoints.retrieve.mockResolvedValueOnce({ id: 'we_1', deleted: true });
    expect(await reconcileStripeWebhookEvents(T, opts)).toBe(false);
    expect(stripeMock.webhookEndpoints.update).not.toHaveBeenCalled();
    expect(stripeMock.webhookEndpoints.create).not.toHaveBeenCalled();
  });

  it('reconcileAll isolates per-tenant failures', async () => {
    stripeMock.webhookEndpoints.retrieve.mockRejectedValue(new Error('stripe down'));
    const r = await reconcileAllStripeWebhookEndpoints({ ...opts, tenants: [T] });
    expect(r).toEqual({ total: 1, reconciled: 0, skipped: 0, failed: [T] });
  });
});
