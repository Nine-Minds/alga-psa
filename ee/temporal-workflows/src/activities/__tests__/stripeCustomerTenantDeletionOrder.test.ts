import { describe, it } from 'vitest';
import { expectTenantDeletion } from '../../test-utils/tenant-deletion-harness';

describe('Stripe customer tenant deletion ordering', () => {
  it('deletes real activity mappings before their owner bindings and preserves a neighboring tenant', async () => {
    const target = 'tenant-to-delete';
    const neighbor = 'another-tenant';

    await expectTenantDeletion(
      [['stripe_customers', 'stripe_customer_bindings']],
      {},
      {
        stripe_customers: {
          [target]: { stripe_customer_external_id: 'cus_target' },
          [neighbor]: { stripe_customer_external_id: 'cus_neighbor' },
        },
        stripe_customer_bindings: {
          [target]: { stripe_customer_external_id: 'cus_target' },
          [neighbor]: { stripe_customer_external_id: 'cus_neighbor' },
        },
      },
      true,
    );
  });
});
