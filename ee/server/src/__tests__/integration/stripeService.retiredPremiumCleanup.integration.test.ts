import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

import { createTestDbConnection } from '@ee/lib/testing/db-test-utils';
import { StripeService } from '../../lib/stripe/StripeService';

type StripeCleanupHarness = {
  stripe: {
    subscriptionSchedules: {
      retrieve: ReturnType<typeof vi.fn>;
      release: ReturnType<typeof vi.fn>;
    };
    subscriptions: {
      update: ReturnType<typeof vi.fn>;
    };
  };
  cleanupRetiredPremiumSchedules(connection: Knex | Knex.Transaction): Promise<void>;
};

describe('StripeService retired Premium schedule cleanup query', () => {
  let db: Knex;

  beforeAll(() => {
    db = createTestDbConnection();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('executes the JSONB marker query and releases only a proven Premium-trial schedule', async () => {
    const trx = await db.transaction();
    try {
      await trx.raw(`
        CREATE TEMPORARY TABLE stripe_subscriptions (
          tenant text NOT NULL,
          stripe_subscription_id text PRIMARY KEY,
          stripe_subscription_external_id text,
          metadata jsonb,
          updated_at timestamptz
        ) ON COMMIT DROP
      `);
      await trx('stripe_subscriptions').insert([
        {
          tenant: 'tenant-proven',
          stripe_subscription_id: 'dbsub-proven',
          stripe_subscription_external_id: 'sub-proven',
          metadata: {
            retired_premium_schedule_id: 'sub_sched-proven',
            retired_premium_schedule_source: 'confirmed_premium_trial',
          },
        },
        {
          tenant: 'tenant-unproven',
          stripe_subscription_id: 'dbsub-unproven',
          stripe_subscription_external_id: 'sub-unproven',
          metadata: {
            retired_premium_schedule_id: 'sub_sched-seat-change',
          },
        },
      ]);

      const service = new StripeService() as unknown as StripeCleanupHarness;
      service.stripe = {
        subscriptionSchedules: {
          retrieve: vi.fn().mockResolvedValue({ status: 'active' }),
          release: vi.fn().mockResolvedValue({}),
        },
        subscriptions: {
          update: vi.fn().mockResolvedValue({}),
        },
      };

      await service.cleanupRetiredPremiumSchedules(trx);

      expect(service.stripe.subscriptionSchedules.retrieve).toHaveBeenCalledOnce();
      expect(service.stripe.subscriptionSchedules.retrieve).toHaveBeenCalledWith('sub_sched-proven');
      expect(service.stripe.subscriptionSchedules.release).toHaveBeenCalledOnce();
      expect(service.stripe.subscriptionSchedules.release).toHaveBeenCalledWith('sub_sched-proven');
      expect(service.stripe.subscriptions.update).toHaveBeenCalledOnce();
      expect(service.stripe.subscriptions.update).toHaveBeenCalledWith(
        'sub-proven',
        expect.any(Object),
      );

      const proven = await trx('stripe_subscriptions')
        .where({ stripe_subscription_id: 'dbsub-proven' })
        .first('metadata');
      const unproven = await trx('stripe_subscriptions')
        .where({ stripe_subscription_id: 'dbsub-unproven' })
        .first('metadata');
      expect(proven.metadata).toEqual({});
      expect(unproven.metadata).toEqual({
        retired_premium_schedule_id: 'sub_sched-seat-change',
      });
    } finally {
      await trx.rollback();
    }
  });
});
