/**
 * Regression (alga-2026-0002724): reconnecting Stripe must keep every saved
 * payment setting. Uses an in-memory stand-in for payment_provider_configs
 * (no DB needed) and drives the real connect/disconnect actions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: { row: Record<string, any> | null } = { row: null };

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    setTenantSecret: vi.fn(),
    getTenantSecret: vi.fn(async () => 'sk_test_stored'),
    deleteTenantSecret: vi.fn(),
  })),
}));
vi.mock('../../../lib/payments/stripeWebhookEvents', () => ({
  STRIPE_WEBHOOK_EVENTS: ['checkout.session.completed'],
  reconcileStripeWebhookEvents: vi.fn(),
}));
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(function () { return {
    accounts: { retrieve: vi.fn().mockResolvedValue({ id: 'acct_1' }) },
    webhookEndpoints: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn().mockResolvedValue({ id: 'we_1', secret: 'whsec_1' }),
      update: vi.fn(),
      del: vi.fn(),
    },
  }; }),
}));

const fakeKnex: any = {
  fn: { now: () => 'NOW' },
  raw: (sql: string) => ({ __raw: sql }),
};

vi.mock('@/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: fakeKnex, tenant: 'tenant-1' })),
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn(() => ({
    table: () => ({
      where: () => ({
        first: async () => (store.row ? { ...store.row } : undefined),
        update: async (patch: Record<string, any>) => {
          const next: Record<string, any> = { ...store.row, ...patch };
          // disconnect strips webhook_endpoint_id with a raw jsonb expression
          if (patch.configuration && (patch.configuration as any).__raw) {
            const { webhook_endpoint_id: _drop, ...rest } = store.row!.configuration;
            next.configuration = rest;
          }
          store.row = next;
          return 1;
        },
      }),
      insert: async (row: Record<string, any>) => {
        store.row = { config_id: 'cfg-1', ...row };
      },
    }),
  })),
}));

import { connectStripeAction, disconnectStripeAction } from '../../../lib/actions/payment-actions';
import { DEFAULT_PAYMENT_SETTINGS } from '@alga-psa/types';

const credentials = { secretKey: 'sk_test_x', publishableKey: 'pk_test_x' };

const customised = {
  paymentLinksInEmails: false,
  sendPaymentConfirmations: false,
  paymentLinkExpirationHours: 720,
  autopayEnabled: true,
  autopayChargeTiming: 'on_due_date',
  autopayRetryDays: [1, 2],
  autopayConsentText: 'I agree to be charged automatically.',
  autopayConsentTextVersion: '4',
  futureSetting: 'keep-me',
};

describe('connectStripeAction settings preservation', () => {
  beforeEach(() => {
    store.row = {
      config_id: 'cfg-1',
      tenant: 'tenant-1',
      provider_type: 'stripe',
      is_enabled: true,
      configuration: { publishable_key: 'pk_old', webhook_endpoint_id: 'we_old' },
      webhook_secret_vault_path: null,
      settings: { ...customised },
    };
  });

  it('keeps all saved settings when connecting again over an existing row', async () => {
    const result = await (connectStripeAction as any)(credentials);
    expect(result.success).toBe(true);
    expect(store.row!.settings).toEqual({ ...DEFAULT_PAYMENT_SETTINGS, ...customised });
    expect(store.row!.configuration.publishable_key).toBe('pk_test_x');
  });

  it('keeps all saved settings across disconnect then reconnect', async () => {
    expect((await (disconnectStripeAction as any)()).success).toBe(true);
    expect(store.row!.is_enabled).toBe(false);
    expect(store.row!.settings).toEqual(customised);

    expect((await (connectStripeAction as any)(credentials)).success).toBe(true);
    expect(store.row!.is_enabled).toBe(true);
    expect(store.row!.settings).toEqual({ ...DEFAULT_PAYMENT_SETTINGS, ...customised });
  });

  it('keeps settings that the DB driver returns as a JSON string', async () => {
    store.row!.settings = JSON.stringify(customised);
    await (connectStripeAction as any)(credentials);
    expect(store.row!.settings.paymentLinkExpirationHours).toBe(720);
    expect(store.row!.settings.autopayConsentText).toBe('I agree to be charged automatically.');
  });

  it('writes defaults on a first-time connect', async () => {
    store.row = null;
    const result = await (connectStripeAction as any)(credentials);
    expect(result.success).toBe(true);
    expect(store.row!.settings).toEqual(DEFAULT_PAYMENT_SETTINGS);
  });
});
