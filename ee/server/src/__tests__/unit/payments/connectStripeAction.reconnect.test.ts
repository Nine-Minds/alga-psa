/**
 * Regression (alga-2026-0002724): reconnecting Stripe must keep every saved
 * payment setting. Uses an in-memory stand-in for payment_provider_configs
 * (no DB needed) and drives the real connect/disconnect actions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: { row: Record<string, any> | null } = { row: null };
const stripeMocks = vi.hoisted(() => ({
  accountRetrieve: vi.fn(), webhookList: vi.fn(), webhookCreate: vi.fn(), webhookUpdate: vi.fn(), webhookDelete: vi.fn(),
  webhookRetrieve: vi.fn(), customerList: vi.fn(), setupIntentList: vi.fn(), paymentIntentList: vi.fn(),
  checkoutSessionList: vi.fn(), paymentMethodList: vi.fn(), chargeList: vi.fn(),
}));
const secretMocks = vi.hoisted(() => ({ set: vi.fn(), get: vi.fn() }));
const dbMocks = vi.hoisted(() => ({ failUpdate: false }));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    setTenantSecret: secretMocks.set,
    getTenantSecret: secretMocks.get,
    deleteTenantSecret: vi.fn(),
  })),
}));
vi.mock('../../../lib/payments/stripeWebhookEvents', () => ({
  STRIPE_WEBHOOK_EVENTS: ['checkout.session.completed'],
  reconcileStripeWebhookEvents: vi.fn(),
  getStripeBaseUrl: () => 'http://localhost:3000',
  stripeWebhookUrls: (base: string, t: string) => ({ legacyUrl: `${base}/api/webhooks/stripe/payments`, tenantUrl: `${base}/api/webhooks/stripe/payments/${t}` }),
}));
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(function () { return {
    accounts: { retrieve: stripeMocks.accountRetrieve },
    webhookEndpoints: {
      list: stripeMocks.webhookList,
      create: stripeMocks.webhookCreate,
      update: stripeMocks.webhookUpdate,
      del: stripeMocks.webhookDelete,
      retrieve: stripeMocks.webhookRetrieve,
    },
    customers: { list: stripeMocks.customerList },
    setupIntents: { list: stripeMocks.setupIntentList },
    paymentIntents: { list: stripeMocks.paymentIntentList },
    checkout: { sessions: { list: stripeMocks.checkoutSessionList } },
    paymentMethods: { list: stripeMocks.paymentMethodList },
    charges: { list: stripeMocks.chargeList },
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
          if (dbMocks.failUpdate) throw new Error('database unavailable');
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

import { connectStripeAction, disconnectStripeAction, testStripeConnectionAction } from '../../../lib/actions/payment-actions';
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
    secretMocks.set.mockReset();
    secretMocks.get.mockReset().mockResolvedValue('sk_test_stored');
    stripeMocks.accountRetrieve.mockReset().mockResolvedValue({ id: 'acct_1' });
    stripeMocks.webhookList.mockReset().mockResolvedValue({ data: [] });
    stripeMocks.webhookCreate.mockReset().mockResolvedValue({ id: 'we_1', secret: 'whsec_1' });
    stripeMocks.webhookUpdate.mockReset().mockResolvedValue({});
    stripeMocks.webhookRetrieve.mockReset().mockImplementation(async (id: string) => ({ id, url: 'http://localhost:3000/api/webhooks/stripe/payments/tenant-1' }));
    stripeMocks.webhookDelete.mockReset().mockResolvedValue({});
    stripeMocks.customerList.mockReset().mockResolvedValue({ data: [] });
    stripeMocks.setupIntentList.mockReset().mockResolvedValue({ data: [] });
    stripeMocks.paymentIntentList.mockReset().mockResolvedValue({ data: [] });
    stripeMocks.checkoutSessionList.mockReset().mockResolvedValue({ data: [] });
    stripeMocks.paymentMethodList.mockReset().mockResolvedValue({ data: [] });
    stripeMocks.chargeList.mockReset().mockResolvedValue({ data: [] });
    dbMocks.failUpdate = false;
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

  it('connects with sk_ and rk_ keys with identical successful results', async () => {
    const standardResult = await (connectStripeAction as any)({ ...credentials, secretKey: 'sk_test_x' });
    store.row = {
      config_id: 'cfg-1', tenant: 'tenant-1', provider_type: 'stripe', is_enabled: true,
      configuration: { publishable_key: 'pk_old', webhook_endpoint_id: 'we_old' },
      webhook_secret_vault_path: null, settings: { ...customised },
    };
    stripeMocks.webhookList.mockClear();
    stripeMocks.webhookCreate.mockClear();
    stripeMocks.webhookUpdate.mockClear();
    const restrictedResult = await (connectStripeAction as any)({ ...credentials, secretKey: 'rk_test_x' });
    expect(standardResult).toEqual(restrictedResult);
    expect(restrictedResult.success).toBe(true);
    expect(stripeMocks.webhookList).toHaveBeenCalledWith({ limit: 1 });
    expect(stripeMocks.customerList).toHaveBeenCalledWith({ limit: 1 });
    expect(stripeMocks.setupIntentList).toHaveBeenCalledWith({ limit: 1 });
    expect(stripeMocks.paymentIntentList).toHaveBeenCalledWith({ limit: 1 });
    expect(stripeMocks.checkoutSessionList).toHaveBeenCalledWith({ limit: 1 });
    expect(stripeMocks.paymentMethodList).toHaveBeenCalledWith({ limit: 1 });
    expect(stripeMocks.chargeList).toHaveBeenCalledWith({ limit: 1 });
  });

  it('replaces a connected key in place while retaining the endpoint, signing-secret path, and settings', async () => {
    const url = 'http://localhost:3000/api/webhooks/stripe/payments/tenant-1';
    store.row!.webhook_secret_vault_path = 'tenant/tenant-1/stripe_payment_webhook_secret';
    stripeMocks.webhookList.mockResolvedValue({ data: [{ id: 'we_old', url }, { id: 'we_duplicate', url: 'http://localhost:3000/api/webhooks/stripe/payments' }] });

    const result = await (connectStripeAction as any)({ ...credentials, secretKey: 'rk_test_replacement' });

    expect(result.success).toBe(true);
    expect(store.row!.configuration.webhook_endpoint_id).toBe('we_old');
    expect(store.row!.webhook_secret_vault_path).toBe('tenant/tenant-1/stripe_payment_webhook_secret');
    expect(store.row!.settings).toEqual({ ...DEFAULT_PAYMENT_SETTINGS, ...customised });
    expect(stripeMocks.webhookUpdate).toHaveBeenCalledWith('we_old', expect.objectContaining({ enabled_events: ['checkout.session.completed'] }));
    expect(stripeMocks.webhookRetrieve).toHaveBeenCalledWith('we_old');
    expect(stripeMocks.webhookList).toHaveBeenCalledTimes(1); // manifest permission probe only
    expect(stripeMocks.webhookList).toHaveBeenCalledWith({ limit: 1 });
    expect(secretMocks.set).toHaveBeenCalledWith('tenant-1', 'stripe_payment_secret_key', 'rk_test_replacement');
    expect(secretMocks.set).not.toHaveBeenCalledWith('tenant-1', 'stripe_payment_webhook_secret', expect.anything());
  });

  it('rejects malformed keys before making any Stripe call', async () => {
    const result = await (connectStripeAction as any)({ ...credentials, secretKey: 'pk_test_nope' });
    expect(result.success).toBe(false);
    expect(stripeMocks.webhookList).not.toHaveBeenCalled();
    expect(stripeMocks.accountRetrieve).not.toHaveBeenCalled();
  });

  it('keeps the active key, webhook, signing secret path, and settings after webhook permission denial during replacement', async () => {
    stripeMocks.webhookList.mockResolvedValue({ data: [{ id: 'we_old', url: 'http://localhost:3000/api/webhooks/stripe/payments/tenant-1' }] });
    stripeMocks.webhookUpdate.mockRejectedValue({ type: 'StripePermissionError', statusCode: 403, message: 'Permission denied.' });
    store.row!.webhook_secret_vault_path = 'tenant/tenant-1/stripe_payment_webhook_secret';
    const priorRow = {
      ...store.row!,
      configuration: { ...store.row!.configuration },
      settings: { ...store.row!.settings },
    };
    const result = await (connectStripeAction as any)({ ...credentials, secretKey: 'rk_test_replacement' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('webhook_write');
    expect(result.error).toContain('webhooks');
    expect(secretMocks.set).not.toHaveBeenCalled();
    expect(store.row).toEqual(priorRow);
  });

  it('blocks connect before storing when a required core permission is denied', async () => {
    stripeMocks.customerList.mockRejectedValue({ type: 'StripeInvalidRequestError', message: 'Missing permissions: customer_read.' });
    const result = await (connectStripeAction as any)({ ...credentials, secretKey: 'rk_test_missingcore' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('core-payments');
    expect(result.error).toContain('customer_read');
    expect(stripeMocks.webhookCreate).not.toHaveBeenCalled();
    expect(store.row!.configuration.publishable_key).toBe('pk_old');
  });

  it('returns per-capability results from Test Connection when required permission is denied', async () => {
    stripeMocks.customerList.mockRejectedValue({ type: 'StripePermissionError', statusCode: 403, message: 'Permission denied.' });
    const result = await (testStripeConnectionAction as any)();
    expect(secretMocks.get).toHaveBeenCalledWith('tenant-1', 'stripe_payment_secret_key');
    expect(result.success).toBe(false);
    expect(result.data.capabilities).toContainEqual(expect.objectContaining({ capability: 'core-payments', status: 'denied', missingPermissions: expect.arrayContaining(['customer_read']) }));
    expect(result.data.permissions.customer_read).toBe('denied');
  });

  it('connects and reports a denied optional customer-import permission', async () => {
    stripeMocks.setupIntentList.mockRejectedValue({ type: 'StripePermissionError', statusCode: 403, message: 'Permission denied.' });
    const result = await (connectStripeAction as any)(credentials);
    expect(result.success).toBe(true);
    expect(result.data.unavailableCapabilities).toContainEqual({ capability: 'customer-import', permissionId: 'setup_intent_read' });
    expect(result.data.unavailableCapabilities).toContainEqual({ capability: 'saved-cards-auto-pay', permissionId: 'setup_intent_read' });
  });

  it('restores the active API secret when the database fails after the vault write', async () => {
    const priorRow = { ...store.row!, configuration: { ...store.row!.configuration }, settings: { ...store.row!.settings } };
    dbMocks.failUpdate = true;
    const result = await (connectStripeAction as any)({ ...credentials, secretKey: 'rk_test_replacement' });
    expect(result.success).toBe(false);
    expect(secretMocks.set).toHaveBeenCalledWith('tenant-1', 'stripe_payment_secret_key', 'rk_test_replacement');
    expect(secretMocks.set).toHaveBeenCalledWith('tenant-1', 'stripe_payment_secret_key', 'sk_test_stored');
    expect(store.row).toEqual(priorRow);
  });

  it('preserves standard-key partial success when a non-permission webhook setup error occurs initially', async () => {
    store.row = null;
    stripeMocks.webhookCreate.mockRejectedValue(new Error('stripe unavailable'));
    const result = await (connectStripeAction as any)(credentials);
    expect(result.success).toBe(true);
    expect(result.data.webhookConfigured).toBe(false);
    expect(store.row!.is_enabled).toBe(true);
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
