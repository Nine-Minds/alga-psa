import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import stripeEmulator from '../../../../../../packages/emulators/stripe/src/index';

const state = vi.hoisted(() => ({
  row: null as any,
  secret: null as string | null,
}));

const fakeKnex: any = {
  fn: { now: () => new Date() },
  raw: (sql: string) => ({ __raw: sql }),
  transaction: async (fn: any) => fn(fakeKnex),
};

vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1' }, { tenant: 'tenant-emulator' }, ...args) }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: vi.fn(async () => ({
  getTenantSecret: vi.fn(async () => state.secret),
  setTenantSecret: vi.fn(async (_tenant: string, _name: string, value: string) => { state.secret = value; }),
  deleteTenantSecret: vi.fn(),
})) }));
vi.mock('@/lib/db', () => ({ createTenantKnex: vi.fn(async () => ({ knex: fakeKnex, tenant: 'tenant-emulator' })) }));
vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn(() => ({ table: () => ({
  where: () => ({
    first: async () => state.row && { ...state.row },
    forUpdate: () => ({ first: async () => state.row && { ...state.row } }),
    update: async (patch: any) => {
      if (!state.row) return 0;
      if (patch.configuration?.__raw) {
        const { webhook_endpoint_id: _removed, ...configuration } = state.row.configuration;
        state.row = { ...state.row, ...patch, configuration };
      } else state.row = { ...state.row, ...patch };
      return 1;
    },
  }),
  insert: async (row: any) => { state.row = { config_id: 'cfg-emulator', ...row }; return 1; },
}) })) }));
vi.mock('../../../lib/payments/stripeWebhookEvents', () => ({ STRIPE_WEBHOOK_EVENTS: ['checkout.session.completed'], reconcileStripeWebhookEvents: vi.fn() }));

import { connectStripeAction, disconnectStripeAction } from '../../../lib/actions/payment-actions';

describe('Stripe credential save through shared SDK transport and emulator', () => {
  let host: EmulatorHost;
  let controlBase: string;
  const previousBase = process.env.STRIPE_API_BASE_URL;

  beforeAll(async () => {
    host = new EmulatorHost({ emulators: [stripeEmulator], controlPort: 0, ports: { stripe: 0 }, log() {} });
    const addresses = await host.start();
    process.env.STRIPE_API_BASE_URL = `http://127.0.0.1:${addresses.ports.stripe}`;
    controlBase = `http://127.0.0.1:${addresses.controlPort}`;
    const response = await fetch(`${controlBase}/control/stripe/seed/config`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secretKey: 'sk_test_emulator_save', accountId: 'acct_emulator_save' }),
    });
    expect(response.ok).toBe(true);
  });

  beforeEach(() => { state.row = null; state.secret = null; });

  afterAll(async () => {
    await host?.stop();
    if (previousBase === undefined) delete process.env.STRIPE_API_BASE_URL;
    else process.env.STRIPE_API_BASE_URL = previousBase;
  });

  it('verifies and saves credentials, then preserves the binding through disconnect and reconnect', async () => {
    const credentials = { secretKey: 'sk_test_emulator_save', publishableKey: 'pk_test_emulator_save' };
    expect((await (connectStripeAction as any)(credentials)).success).toBe(true);
    expect(state.row.configuration).toMatchObject({ stripe_account_id: 'acct_emulator_save', stripe_credential_fingerprint: expect.any(String) });
    expect(state.secret).toBe(credentials.secretKey);

    expect((await (disconnectStripeAction as any)()).success).toBe(true);
    expect(state.row.configuration.stripe_account_id).toBe('acct_emulator_save');
    expect((await (connectStripeAction as any)(credentials)).success).toBe(true);
    expect(state.row.configuration.stripe_account_id).toBe('acct_emulator_save');
  });
});
