import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StripeService } from '../../lib/stripe/StripeService';

const getAdminConnectionMock = vi.hoisted(() => vi.fn());
const subscriptionsForCleanup = vi.hoisted(() => [] as Record<string, any>[]);
const localUpdates = vi.hoisted(
  () =>
    [] as Array<{
      tenant: string;
      where: Record<string, unknown>;
      values: Record<string, unknown>;
    }>,
);

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: getAdminConnectionMock,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (_knex: any, tenant: string) => ({
    unscoped: () => {
      const builder: any = {
        whereRaw: vi.fn(() => builder),
        select: vi.fn(async () => subscriptionsForCleanup),
      };
      return builder;
    },
    table: () => {
      let where: Record<string, unknown> = {};
      const builder: any = {
        where: vi.fn((value: Record<string, unknown>) => {
          where = value;
          return builder;
        }),
        update: vi.fn(async (values: Record<string, unknown>) => {
          localUpdates.push({ tenant, where, values });
          return 1;
        }),
      };
      return builder;
    },
  }),
}));

describe('StripeService retired Premium schedule cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscriptionsForCleanup.length = 0;
    localUpdates.length = 0;
    getAdminConnectionMock.mockResolvedValue({
      fn: { now: () => new Date('2026-08-02T00:00:00.000Z') },
    });
  });

  it('releases a pending schedule and removes retired metadata locally and remotely', async () => {
    subscriptionsForCleanup.push({
      tenant: 'tenant-1',
      stripe_subscription_id: 'dbsub-1',
      stripe_subscription_external_id: 'sub-1',
      metadata: {
        product_code: 'psa',
        premium_trial: 'confirmed',
        retired_premium_schedule_id: 'sub_sched-1',
        retired_premium_schedule_source: 'confirmed_premium_trial',
      },
    });

    const service = new StripeService() as any;
    service.stripe = {
      subscriptionSchedules: {
        retrieve: vi.fn().mockResolvedValue({ status: 'active' }),
        release: vi.fn().mockResolvedValue({}),
      },
      subscriptions: {
        update: vi.fn().mockResolvedValue({}),
      },
    };

    await service.cleanupRetiredPremiumSchedules();

    expect(service.stripe.subscriptionSchedules.release).toHaveBeenCalledWith(
      'sub_sched-1',
    );
    expect(service.stripe.subscriptions.update).toHaveBeenCalledWith(
      'sub-1',
      expect.objectContaining({
        metadata: expect.objectContaining({
          premium_trial: '',
          premium_trial_end: '',
          premium_trial_effective_date: '',
        }),
      }),
    );
    expect(localUpdates).toEqual([
      expect.objectContaining({
        tenant: 'tenant-1',
        where: { stripe_subscription_id: 'dbsub-1' },
        values: expect.objectContaining({ metadata: { product_code: 'psa' } }),
      }),
    ]);
  });

  it('retains the retry marker when Stripe cannot release the schedule', async () => {
    subscriptionsForCleanup.push({
      tenant: 'tenant-1',
      stripe_subscription_id: 'dbsub-1',
      stripe_subscription_external_id: 'sub-1',
      metadata: {
        retired_premium_schedule_id: 'sub_sched-1',
        retired_premium_schedule_source: 'confirmed_premium_trial',
      },
    });

    const service = new StripeService() as any;
    service.stripe = {
      subscriptionSchedules: {
        retrieve: vi.fn().mockRejectedValue(new Error('Stripe unavailable')),
        release: vi.fn(),
      },
      subscriptions: { update: vi.fn() },
    };

    await service.cleanupRetiredPremiumSchedules();

    expect(service.stripe.subscriptionSchedules.release).not.toHaveBeenCalled();
    expect(service.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(localUpdates).toEqual([]);
  });

  it('does not release a schedule without confirmed Premium-trial provenance', async () => {
    subscriptionsForCleanup.push({
      tenant: 'tenant-1',
      stripe_subscription_id: 'dbsub-1',
      stripe_subscription_external_id: 'sub-1',
      metadata: { retired_premium_schedule_id: 'sub_sched-seat-change' },
    });

    const service = new StripeService() as any;
    service.stripe = {
      subscriptionSchedules: {
        retrieve: vi.fn(),
        release: vi.fn(),
      },
      subscriptions: { update: vi.fn() },
    };

    await service.cleanupRetiredPremiumSchedules();

    expect(service.stripe.subscriptionSchedules.retrieve).not.toHaveBeenCalled();
    expect(service.stripe.subscriptionSchedules.release).not.toHaveBeenCalled();
    expect(service.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(localUpdates).toEqual([]);
  });
});
