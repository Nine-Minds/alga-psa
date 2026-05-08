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
    if (table === 'apple_iap_subscriptions') {
      return {
        where: () => ({
          whereNotNull: () => ({
            first: async () => ({
              original_transaction_id: 'orig_tx_1',
              transition_stripe_subscription_external_id: 'sub_transition_1',
            }),
          }),
          update: async (values: Record<string, any>) => {
            state.appleUpdates.push({ criteria: {}, values });
            return 1;
          },
        }),
      };
    }

    if (table === 'tenants') {
      return {
        where: (criteria: Record<string, any>) => ({
          update: async (values: Record<string, any>) => {
            state.tenantUpdates.push({ criteria, values });
            return 1;
          },
        }),
      };
    }

    if (table === 'stripe_subscriptions') {
      return {
        where: (criteria: Record<string, any>) => ({
          update: async (values: Record<string, any>) => {
            state.stripeUpdates.push({ criteria, values });
            return 1;
          },
        }),
      };
    }

    throw new Error(`Unexpected table ${table}`);
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

