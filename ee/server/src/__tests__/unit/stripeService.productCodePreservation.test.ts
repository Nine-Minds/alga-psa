import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StripeService } from '../../lib/stripe/StripeService';

const getConnectionMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db/db', () => ({
  getConnection: getConnectionMock,
}));

function createTransitionKnex(state: {
  tenantUpdates: Array<{ criteria: Record<string, any>; values: Record<string, any> }>;
  appleUpdates: Array<{ criteria: Record<string, any>; values: Record<string, any> }>;
  stripeUpdates: Array<{ criteria: Record<string, any>; values: Record<string, any> }>;
}) {
  const knex = ((table: string) => {
    const updates = table === 'tenants' ? state.tenantUpdates
      : table === 'apple_iap_subscriptions' ? state.appleUpdates
        : table === 'stripe_subscriptions' ? state.stripeUpdates : null;
    if (!updates) throw new Error(`Unexpected table ${table}`);
    const criteria: Record<string, any> = {};
    const query = {
      where: (field: string | Record<string, any>, value?: unknown) => {
        const values = typeof field === 'string' ? { [field]: value } : field;
        for (const [key, value] of Object.entries(values)) criteria[key.split('.').at(-1)!] = value;
        return query;
      },
      whereNotNull: () => query,
      first: async () => ({ original_transaction_id: 'orig_tx_1', transition_stripe_subscription_external_id: 'sub_transition_1' }),
      update: async (values: Record<string, any>) => { updates.push({ criteria, values }); return 1; },
    };
    return query;
  }) as any;

  knex.fn = { now: () => new Date('2026-05-05T00:00:00.000Z') };
  knex.transaction = async (cb: (trx: any) => Promise<void>) => cb(knex);

  return knex;
}

describe('StripeService product_code preservation during IAP transitions', () => {
  beforeEach(() => {
    getConnectionMock.mockReset();
  });

  it('F040: cancelIapToStripeTransition updates plan/billing fields without touching product_code', async () => {
    const state = { tenantUpdates: [], appleUpdates: [], stripeUpdates: [] } as {
      tenantUpdates: Array<{ criteria: Record<string, any>; values: Record<string, any> }>;
      appleUpdates: Array<{ criteria: Record<string, any>; values: Record<string, any> }>;
      stripeUpdates: Array<{ criteria: Record<string, any>; values: Record<string, any> }>;
    };
    getConnectionMock.mockResolvedValue(createTransitionKnex(state));

    const service = new StripeService() as any;
    service.initPromise = Promise.resolve();
    service.stripe = { subscriptions: { cancel: vi.fn().mockResolvedValue({}) } };

    const result = await service.cancelIapToStripeTransition('tenant-1');
    expect(result).toEqual({ success: true });
    expect(state.tenantUpdates[0]?.values).toEqual(
      expect.objectContaining({ plan: 'solo' }),
    );
    expect(state.tenantUpdates[0]?.values).not.toHaveProperty('product_code');
  });
});

