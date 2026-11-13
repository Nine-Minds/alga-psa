import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const T = '0ad8e710-13bc-4e01-a6ca-3f8992978ae8';
const TENANT_URL = `https://app.example.com/api/webhooks/stripe/payments/${T}`;
const LEGACY_URL = 'https://app.example.com/api/webhooks/stripe/payments';

const stripeMock = {
  webhookEndpoints: { retrieve: vi.fn(), update: vi.fn(), create: vi.fn(), del: vi.fn() },
};
const dbUpdate = vi.fn();

vi.mock('stripe', () => ({ default: vi.fn().mockImplementation(function () { return stripeMock; }) }));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({ default: loggerMock }));
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
  migrateStripeWebhookEndpointOnDemand,
  resetOnDemandMigrationState,
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

describe('URL-only scope', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('updates with { url } only and does not rewrite webhook_events', async () => {
    stripeMock.webhookEndpoints.retrieve.mockResolvedValue({ id: 'we_1', url: LEGACY_URL, enabled_events: ['charge.refunded'] });
    stripeMock.webhookEndpoints.update.mockResolvedValue({});
    expect(await reconcileStripeWebhookEvents(T, { ...opts, scope: 'url' })).toBe(true);
    expect(stripeMock.webhookEndpoints.update).toHaveBeenCalledTimes(1);
    expect(stripeMock.webhookEndpoints.update).toHaveBeenCalledWith('we_1', { url: TENANT_URL });
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it('endpoint already at the tenant URL: no update even when events differ', async () => {
    stripeMock.webhookEndpoints.retrieve.mockResolvedValue({ id: 'we_1', url: TENANT_URL, enabled_events: ['charge.refunded'] });
    expect(await reconcileStripeWebhookEvents(T, { ...opts, scope: 'url' })).toBe(true);
    expect(stripeMock.webhookEndpoints.update).not.toHaveBeenCalled();
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it('full mode still passes enabled_events and writes the config', async () => {
    stripeMock.webhookEndpoints.retrieve.mockResolvedValue({ id: 'we_1', url: LEGACY_URL, enabled_events: ['charge.refunded'] });
    stripeMock.webhookEndpoints.update.mockResolvedValue({ enabled_events: STRIPE_WEBHOOK_EVENTS });
    await reconcileStripeWebhookEvents(T, opts);
    expect(stripeMock.webhookEndpoints.update).toHaveBeenCalledWith('we_1', { url: TENANT_URL, enabled_events: STRIPE_WEBHOOK_EVENTS });
    expect(dbUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('migrateStripeWebhookEndpointOnDemand', () => {
  const env = { ...process.env };
  beforeEach(() => {
    vi.clearAllMocks();
    resetOnDemandMigrationState();
    process.env.STRIPE_WEBHOOK_BASE_URL = 'https://app.example.com';
    (process.env as any).NODE_ENV = 'production';
  });
  afterEach(() => { process.env = { ...env }; });

  it('a burst of concurrent calls makes one retrieve and one update', async () => {
    stripeMock.webhookEndpoints.retrieve.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { id: 'we_1', url: LEGACY_URL, enabled_events: [] };
    });
    stripeMock.webhookEndpoints.update.mockResolvedValue({});
    await Promise.all(Array.from({ length: 10 }, () => migrateStripeWebhookEndpointOnDemand(T)));
    expect(stripeMock.webhookEndpoints.retrieve).toHaveBeenCalledTimes(1);
    expect(stripeMock.webhookEndpoints.update).toHaveBeenCalledTimes(1);
    expect(stripeMock.webhookEndpoints.update).toHaveBeenCalledWith('we_1', { url: TENANT_URL });
    // TTL marker: steady traffic afterwards does not retrieve again.
    await migrateStripeWebhookEndpointOnDemand(T);
    expect(stripeMock.webhookEndpoints.retrieve).toHaveBeenCalledTimes(1);
  });

  it('swallows a failing update and retries on the next call', async () => {
    stripeMock.webhookEndpoints.retrieve.mockResolvedValue({ id: 'we_1', url: LEGACY_URL, enabled_events: [] });
    stripeMock.webhookEndpoints.update.mockRejectedValueOnce(new Error('stripe down'));
    await expect(migrateStripeWebhookEndpointOnDemand(T)).resolves.toBeUndefined();
    expect(loggerMock.error).toHaveBeenCalled();
    stripeMock.webhookEndpoints.update.mockResolvedValueOnce({});
    await migrateStripeWebhookEndpointOnDemand(T);
    expect(stripeMock.webhookEndpoints.retrieve).toHaveBeenCalledTimes(2);
    expect(stripeMock.webhookEndpoints.update).toHaveBeenCalledTimes(2);
  });

  it.each(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'http://app.example.com'])(
    'guard: %s in production makes no Stripe calls and warns', async (base) => {
      process.env.STRIPE_WEBHOOK_BASE_URL = base;
      await migrateStripeWebhookEndpointOnDemand(T);
      expect(stripeMock.webhookEndpoints.retrieve).not.toHaveBeenCalled();
      expect(stripeMock.webhookEndpoints.update).not.toHaveBeenCalled();
      expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining('On-demand migration skipped'), expect.objectContaining({ tenantId: T }));
    });
});

describe('Stripe client for reconcile', () => {
  const saved = { base: process.env.STRIPE_API_BASE_URL, env: process.env.NODE_ENV };
  beforeEach(() => {
    vi.clearAllMocks();
    stripeMock.webhookEndpoints.retrieve.mockResolvedValue({ id: 'we_1', url: TENANT_URL, enabled_events: [] });
  });
  afterEach(() => {
    if (saved.base === undefined) delete process.env.STRIPE_API_BASE_URL; else process.env.STRIPE_API_BASE_URL = saved.base;
    (process.env as any).NODE_ENV = saved.env;
  });

  it('talks to real Stripe by default', async () => {
    delete process.env.STRIPE_API_BASE_URL;
    const { default: StripeCtor } = await import('stripe');
    await reconcileStripeWebhookEvents(T, { ...opts, scope: 'url' });
    expect(vi.mocked(StripeCtor).mock.calls.at(-1)?.[1]).not.toHaveProperty('host');
  });

  it('honours the guarded loopback emulator override (STRIPE_API_BASE_URL) outside production', async () => {
    process.env.STRIPE_API_BASE_URL = 'http://localhost:4507';
    (process.env as any).NODE_ENV = 'development';
    const { default: StripeCtor } = await import('stripe');
    await reconcileStripeWebhookEvents(T, { ...opts, scope: 'url' });
    expect(vi.mocked(StripeCtor).mock.calls.at(-1)?.[1]).toMatchObject({ host: 'localhost', port: 4507, protocol: 'http' });
  });

  it('ignores the override in production without the explicit local-review opt-in', async () => {
    process.env.STRIPE_API_BASE_URL = 'http://localhost:4507';
    (process.env as any).NODE_ENV = 'production';
    const { default: StripeCtor } = await import('stripe');
    await reconcileStripeWebhookEvents(T, { ...opts, scope: 'url' });
    expect(vi.mocked(StripeCtor).mock.calls.at(-1)?.[1]).not.toHaveProperty('host');
  });
});
